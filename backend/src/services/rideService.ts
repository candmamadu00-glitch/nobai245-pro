import { 
  VehicleType, 
  ServiceType, 
  RideStatus, 
  PaymentMethod, 
  TransactionStatus, 
  TransactionType, 
  UserType
} from '@prisma/client';
import axios from 'axios';
import { prisma } from '../config/prisma';
import { sendPushNotification, PUSH_CHANNELS } from './pushNotifications';
import { getIo } from '../server';
import { chargePassengerMobileMoney } from './mobileMoneyService';
import { enqueuePayoutJob, enqueueRefundJob } from '../jobs/payoutQueue';

export function normalizePaymentMethod(method?: string | null): PaymentMethod {
  const upper = String(method || 'CASH').trim().toUpperCase();
  if (upper.includes('ORANGE')) return PaymentMethod.ORANGE_MONEY;
  if (upper.includes('MTN') || upper.includes('TELECEL') || upper.includes('MOMO')) return PaymentMethod.MTN_MOMO;
  return PaymentMethod.CASH;
}

export function formatPaymentMethodLabel(method?: PaymentMethod | string | null): string {
  const normalized = normalizePaymentMethod(method as string);
  if (normalized === PaymentMethod.ORANGE_MONEY) return 'Orange Money';
  if (normalized === PaymentMethod.MTN_MOMO) return 'Telecel / MTN MoMo';
  return 'Dinheiro';
}

function detectProviderFromPhone(phone?: string | null): PaymentMethod | null {
  const digits = String(phone || '').replace(/\D/g, '');
  const local9 = digits.startsWith('245') ? digits.slice(3) : digits;
  if (local9.startsWith('95')) return PaymentMethod.ORANGE_MONEY;
  if (local9.startsWith('96') || local9.startsWith('97')) return PaymentMethod.MTN_MOMO;
  return null;
}

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || '';
const CANCELLATION_PENALTY_XOF = 500;
const MIN_DRIVER_BALANCE_FOR_CASH = 0; // 🟢 Exige saldo maior ou igual a 0 XOF para rodar em dinheiro
const MIN_DRIVER_BALANCE_FOR_ONLINE = 0;
const RideOfferStatus = { PENDING: 'PENDING', ACCEPTED: 'ACCEPTED' } as any;

export interface FinalizeRideResult {
  success: boolean;
  fareXOF: number;
  driverEarnings: number;
  platformFee: number;
  distanceKm: number;
  paymentMethod: string;
  hasQueuedRide: boolean;
  nextRideId: string | null;
}

export const FALLBACK_TARIFFS: Record<string, { baseFare: number; perKm: number; perMin: number; commissionRate: number }> = {
  MOTO: { baseFare: 300, perKm: 150, perMin: 25, commissionRate: 15 },
  MOTO_CARRO: { baseFare: 400, perKm: 200, perMin: 35, commissionRate: 15 },
  TAXI: { baseFare: 500, perKm: 250, perMin: 50, commissionRate: 15 },
  PARTICULAR: { baseFare: 700, perKm: 350, perMin: 60, commissionRate: 15 },
  TOCA_TOCA: { baseFare: 500, perKm: 200, perMin: 30, commissionRate: 15 },
};

function safeSocketEmit(room: string, event: string, payload: any): void {
  try {
    const io = getIo();
    if (io) {
      console.log(`🔄 [SOCKET_EMIT] Disparando evento "${event}" -> Sala: [${room}]`);
      io.to(room).emit(event, payload);
    } else {
      console.warn(`⚠️ [SOCKET_EMIT_WARN] Instância do Socket.io não está pronta. Evento omitido: ${event}`);
    }
  } catch (err) {
    console.error(`❌ [SOCKET_EMIT_ERROR] Falha ao disparar ${event} para ${room}:`, err);
  }
}

// -----------------------------------------------------------------------------
// HELPER PARA DISPARO DE NOVAS CORRIDAS PARA MOTORISTAS (APENAS DISPONÍVEIS E COM SALDO)
// -----------------------------------------------------------------------------
export async function notifyDriversNewRide(rideId: string): Promise<void> {
  console.log(`\n🚨 [RIDE_DISPATCH] Buscando motoristas para notificar sobre a corrida ID: ${rideId}...`);
  try {
    const ride = await prisma.ride.findUnique({ 
      where: { id: rideId },
      include: {
        passenger: {
          select: {
            fullName: true,
            ratingAverage: true,
            profilePicture: true,
          }
        }
      }
    });
    if (!ride) {
      console.warn(`⚠️ [RIDE_DISPATCH] Corrida ${rideId} não foi encontrada no banco.`);
      return;
    }

    const pLat = Number(ride.originLat);
    const pLng = Number(ride.originLng);

    const activeDrivers = await prisma.driver.findMany({
      where: {
        isOnline: true,
        status: 'APPROVED',
        vehicleType: ride.requestedVehicleType,
      },
      select: {
        id: true,
        fullName: true,
        deviceToken: true,
        lastLat: true,
        lastLng: true,
        walletBalance: true,
        isAvailable: true,
        currentRideId: true
      },
    });

    const qualifiedDrivers = [];

    for (const driver of activeDrivers) {
      if (!driver.isAvailable || driver.currentRideId) {
        continue;
      }

      if (Number(driver.walletBalance || 0) < MIN_DRIVER_BALANCE_FOR_CASH) {
        console.log(`⚠️ [RIDE_DISPATCH_SKIP] Motorista ${driver.fullName} (${driver.id}) sem saldo suficiente: ${driver.walletBalance} XOF`);
        continue;
      }

      const refLat = driver.lastLat !== null && driver.lastLat !== undefined ? Number(driver.lastLat) : null;
      const refLng = driver.lastLng !== null && driver.lastLng !== undefined ? Number(driver.lastLng) : null;

      if (refLat === null || refLng === null || isNaN(refLat) || isNaN(refLng)) continue;

      const distKm = calculateDistance(pLat, pLng, refLat, refLng);
      if (distKm <= 5.0) {
        qualifiedDrivers.push({
          ...driver,
          isQueuedOffer: false
        });
      }
    }

    console.log(`🔍 [RIDE_DISPATCH] ${qualifiedDrivers.length} motoristas qualificados encontrados no raio de 5km.`);

    const syncedPrice = Math.round(Number(ride.priceXof || 0));
    const syncedDistance = Number(Number(ride.distanceKm || 0).toFixed(2));
    const syncedDuration = Number(ride.durationMin || 0);

    const ridePayload = {
      rideId: ride.id,
      passengerName: ride.passenger?.fullName || 'Passageiro',
      passengerPhoto: ride.passenger?.profilePicture || null,
      passengerRating: Number(ride.passenger?.ratingAverage || 5.0),
      originAddress: ride.originAddress,
      originLat: Number(ride.originLat),
      originLng: Number(ride.originLng),
      destinationAddress: ride.destinationAddress,
      destinationLat: Number(ride.destinationLat),
      destinationLng: Number(ride.destinationLng),
      
      pickupReferencePoint: (ride as any).pickupReferencePoint || ride.referencePoint || '',
      dropoffReferencePoint: (ride as any).dropoffReferencePoint || '',
      extraStopReferencePoint: (ride as any).extraStopReferencePoint || '',
      referencePoint: ride.referencePoint || '',

      // 🟢 VALORES E QUILOMETRAGEM SINCRONIZADOS COM O PASSAGEIRO
      priceXof: syncedPrice,
      fareXOF: syncedPrice,
      estimatedPrice: syncedPrice,
      distanceKm: syncedDistance,
      durationMin: syncedDuration,

      serviceType: ride.serviceType,
      paymentMethod: ride.paymentMethod,
      stops: ride.stops || [],
    };

    const offerExpiresAt = new Date(Date.now() + 15000);

    for (const driver of qualifiedDrivers) {
      await (prisma as any).rideOffer.upsert({
        where: { rideId_driverId: { rideId: ride.id, driverId: driver.id } },
        update: { status: RideOfferStatus.PENDING, expiresAt: offerExpiresAt },
        create: { rideId: ride.id, driverId: driver.id, status: RideOfferStatus.PENDING, expiresAt: offerExpiresAt }
      }).catch((err: any) => console.warn(`⚠️ [RIDE_OFFER_CREATION_FAIL] Motorista: ${driver.id}`, err?.message));

      safeSocketEmit(`driver_${driver.id}`, 'ride:new_request', {
        ...ridePayload,
        isQueuedOffer: false
      });

      if (driver.deviceToken) {
        sendPushNotification(
          driver.deviceToken,
          '🚗 Nova Corrida Solicitada!',
          `Valor: ${syncedPrice} XOF (${syncedDistance} km) • ${ride.paymentMethod === 'CASH' ? 'Pagamento em Dinheiro' : 'Pago via ' + formatPaymentMethodLabel(ride.paymentMethod)}. Toque para aceitar.`,
          { type: 'NEW_RIDE_REQUEST', rideId: ride.id, isQueuedOffer: false },
          PUSH_CHANNELS.NEW_RIDE_ALARM
        ).catch(() => null);
      }
    }
  } catch (error) {
    console.error('💥 [RIDE_DISPATCH_ERROR] Falha ao disparar notificações de nova corrida:', error);
  }
}

export function maskPhoneNumber(phone?: string | null): string {
  if (!phone) return '****';
  const cleaned = phone.trim();
  if (cleaned.length <= 4) return '****';
  return cleaned.slice(0, 4) + ' **** ' + cleaned.slice(-3);
}

export function isValidCoordinate(lat: number, lng: number): boolean {
  return typeof lat === 'number' && typeof lng === 'number' && !isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  if (!isValidCoordinate(lat1, lon1) || !isValidCoordinate(lat2, lon2)) return 0.5;
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * 
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.max(0.1, Number((R * c * 1.35).toFixed(2)));
}

export function calculateHaversineFallback(lat1: number, lon1: number, lat2: number, lon2: number) {
  if (!isValidCoordinate(lat1, lon1) || !isValidCoordinate(lat2, lon2)) {
    throw new Error('INVALID_COORDINATES: Coordenadas geográficas inválidas.');
  }
  const distanceKm = calculateDistance(lat1, lon1, lat2, lon2);
  const durationMin = Math.max(1, Math.ceil((distanceKm / 30) * 60));
  return { distanceKm, durationMin };
}

export async function getRouteDistanceAndDuration(
  lat1: number, lon1: number, 
  lat2: number, lon2: number,
  waypoints: Array<{lat: number, lng: number}> = []
) {
  if (!isValidCoordinate(lat1, lon1) || !isValidCoordinate(lat2, lon2)) {
    throw new Error('INVALID_COORDINATES: Coordenadas de origem ou destino inválidas.');
  }

  if (!GOOGLE_MAPS_API_KEY) {
    let totalDist = 0;
    const points = [{lat: lat1, lng: lon1}, ...waypoints, {lat: lat2, lng: lon2}];
    for (let i = 0; i < points.length - 1; i++) {
      totalDist += calculateDistance(points[i].lat, points[i].lng, points[i+1].lat, points[i+1].lng);
    }
    return { distanceKm: Number(totalDist.toFixed(2)), durationMin: Math.max(1, Math.ceil((totalDist / 30) * 60)) };
  }

  try {
    let waypointsStr = '';
    if (waypoints.length > 0) {
      waypointsStr = '&waypoints=' + waypoints.map(w => `${w.lat},${w.lng}`).join('|');
    }
    
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${lat1},${lon1}&destination=${lat2},${lon2}${waypointsStr}&key=${GOOGLE_MAPS_API_KEY}`;
    const response = await axios.get(url, { timeout: 4000 });
    
    if (response.data?.status === 'OK' && Array.isArray(response.data.routes) && response.data.routes.length > 0) {
      const route = response.data.routes[0];
      let totalDistanceMeters = 0;
      let totalDurationSeconds = 0;
      
      if (Array.isArray(route.legs)) {
        route.legs.forEach((leg: any) => {
          totalDistanceMeters += Number(leg?.distance?.value || 0);
          totalDurationSeconds += Number(leg?.duration?.value || 0);
        });
      }

      if (totalDistanceMeters > 0) {
        return {
          distanceKm: Math.max(0.1, Number((totalDistanceMeters / 1000).toFixed(2))),
          durationMin: Math.max(1, Math.ceil(totalDurationSeconds / 60))
        };
      }
    }
  } catch (error) {
    console.warn('⚠️ [MAPS] API externa indisponível. Utilizando Haversine de contingência.');
  }
  
  return calculateHaversineFallback(lat1, lon1, lat2, lon2);
}

export async function calculateRidePrice(distanceKm: number, durationMin: number, vehicleType: VehicleType | string, serviceType: ServiceType | string) {
  const vType = (vehicleType || 'PARTICULAR') as VehicleType;
  const sType = (serviceType || 'RIDE') as ServiceType;

  const dbTariff = await prisma.tariffConfig.findUnique({
    where: { vehicleType_serviceType: { vehicleType: vType, serviceType: sType } }
  }).catch(() => null);

  const fallback = FALLBACK_TARIFFS[vType] || FALLBACK_TARIFFS.PARTICULAR;

  const baseFare = dbTariff ? Number(dbTariff.baseFare) : fallback.baseFare;
  const perKm = dbTariff ? Number(dbTariff.perKmFare) : fallback.perKm;
  const perMin = dbTariff ? Number(dbTariff.perMinuteFare) : fallback.perMin;
  const commissionRate = dbTariff ? Number(dbTariff.commissionRate) : fallback.commissionRate;
  const surgeMultiplier = dbTariff ? Number((dbTariff as any)?.surgeMultiplier || 1.00) : 1.00;

  let totalPrice = (baseFare + (distanceKm * perKm) + (durationMin * perMin)) * surgeMultiplier;
  if (sType === ServiceType.DELIVERY) totalPrice *= 1.20;

  return { totalPrice: Math.round(totalPrice), commissionRate };
}

export function isWithinGuineaBissau(lat: number, lng: number): boolean {
  const MIN_LAT = 10.8;
  const MAX_LAT = 12.8;
  const MIN_LNG = -16.8;
  const MAX_LNG = -13.6;

  return lat >= MIN_LAT && lat <= MAX_LAT && lng >= MIN_LNG && lng <= MAX_LNG;
}

// -----------------------------------------------------------------------------
// CRIAÇÃO DA CORRIDA (MODELO 100% DINHEIRO FÍSICO)
// -----------------------------------------------------------------------------
export async function createRideAndInitiateEscrow(passengerId: string, data: {
  originLat: number; originLng: number; destinationLat: number; destinationLng: number;
  requestedVehicleType: VehicleType | string; serviceType: ServiceType | string;
  originAddress?: string; destinationAddress?: string; 
  referencePoint?: string;
  pickupReferencePoint?: string;
  dropoffReferencePoint?: string;
  stops?: Array<{ address: string; lat: number; lng: number; status?: string; referencePoint?: string }>;
  paymentMethod?: PaymentMethod | string;
  payerPhone?: string;
  idempotencyKey?: string;
  estimatedPrice?: number;
  distanceKm?: number;
  estimatedDistanceKm?: number;
  durationMin?: number;
  estimatedDurationMin?: number;
}) {
  console.log(`📡 [CREATE_RIDE] Iniciando criação de corrida para Passageiro ID: ${passengerId}`);
  const { 
    originLat, originLng, destinationLat, destinationLng, 
    requestedVehicleType, serviceType, originAddress, destinationAddress, 
    referencePoint, pickupReferencePoint, dropoffReferencePoint,
    stops = [], estimatedPrice 
  } = data;

  if (!isValidCoordinate(originLat, originLng) || !isValidCoordinate(destinationLat, destinationLng)) {
    console.error(`❌ [CREATE_RIDE_ERROR] Coordenadas inválidas: Origem (${originLat}, ${originLng}) Destino (${destinationLat}, ${destinationLng})`);
    throw new Error('BAD_REQUEST: Coordenadas geográficas de origem ou destino inválidas.');
  }

  if (!isWithinGuineaBissau(originLat, originLng)) {
    console.error(`❌ [CREATE_RIDE_ERROR] Fora de Guiné-Bissau: (${originLat}, ${originLng})`);
    throw new Error('OUT_OF_SERVICE_AREA: O serviço Nô Bai 245 está disponível apenas no território da Guiné-Bissau.');
  }

  const passenger = await prisma.passenger.findUnique({ 
    where: { id: passengerId },
    select: { id: true, status: true, currentRideId: true, phone: true, paymentAccountNumber: true }
  });

  if (!passenger || passenger.status !== 'ACTIVE') {
    console.error(`❌ [CREATE_RIDE_ERROR] Passageiro inativo ou inexistente: ID ${passengerId}`);
    throw new Error('UNAUTHORIZED: Conta de passageiro inexistente, inativa ou suspensa.');
  }

  if (passenger.currentRideId) {
    const activeRide = await prisma.ride.findUnique({
      where: { id: passenger.currentRideId },
      select: { id: true, status: true, createdAt: true }
    });

    const isFinished = !activeRide || ['CANCELLED', 'COMPLETED'].includes(activeRide.status);
    const isStaleSearching = activeRide && ['SEARCHING', 'AWAITING_PAYMENT'].includes(activeRide.status) && 
      (Date.now() - new Date(activeRide.createdAt).getTime() > 3 * 60 * 1000);

    if (isFinished || isStaleSearching) {
      if (isStaleSearching && activeRide) {
        await prisma.ride.update({
          where: { id: activeRide.id },
          data: { status: RideStatus.CANCELLED, cancellationReason: 'TIMEOUT_EXPIRED' }
        }).catch(() => null);
      }

      await prisma.passenger.update({
        where: { id: passengerId },
        data: { currentRideId: null }
      });
    } else {
      console.warn(`⚠️ [CREATE_RIDE_WARN] Passageiro ${passengerId} tentou criar corrida mas já possui a corrida ativa: ${passenger.currentRideId}`);
      throw new Error('ACTIVE_RIDE_EXISTS: Passageiro já possui corrida ativa em andamento.');
    }
  }

  const chosenMethod = normalizePaymentMethod(data.paymentMethod);
  const isMobileMoney = chosenMethod === PaymentMethod.ORANGE_MONEY || chosenMethod === PaymentMethod.MTN_MOMO;
  const targetPayerPhone = String(data.payerPhone || passenger.paymentAccountNumber || passenger.phone || '').trim();
  if (isMobileMoney && !targetPayerPhone) {
    throw new Error('MISSING_PAYER_PHONE: Informe o número de telefone Mobile Money para concluir o pagamento.');
  }

  const routeWaypoints = stops.map(s => ({ lat: s.lat, lng: s.lng }));
  const fallbackRoute = await getRouteDistanceAndDuration(
    originLat, originLng, destinationLat, destinationLng, routeWaypoints
  );

  // 🟢 USA A QUILOMETRAGEM E DURAÇÃO EXATAS CALCULADAS NO APP DO PASSAGEIRO (MAPBOX) SE ENVIADAS
  const incomingDist = Number(data.distanceKm ?? data.estimatedDistanceKm ?? 0);
  const incomingDur = Number(data.durationMin ?? data.estimatedDurationMin ?? 0);

  const distanceKm = incomingDist > 0 ? Number(incomingDist.toFixed(2)) : fallbackRoute.distanceKm;
  const durationMin = incomingDur > 0 ? Math.max(1, Math.round(incomingDur)) : fallbackRoute.durationMin;
  
  const { totalPrice: calculatedPrice } = await calculateRidePrice(
    distanceKm, durationMin, requestedVehicleType as VehicleType, serviceType as ServiceType
  );
  
  const priceXof = (estimatedPrice && Number(estimatedPrice) > 0) 
    ? Math.round(Number(estimatedPrice)) 
    : calculatedPrice;
  
  const initialStatus = isMobileMoney ? RideStatus.AWAITING_PAYMENT : RideStatus.SEARCHING;
  const initialTxStatus = TransactionStatus.PENDING;
  
  const startOtp = Math.floor(1000 + Math.random() * 9000).toString();
  const finishOtp: string | null = null;

  const formattedStops = stops.map((s, idx) => ({
    ...s,
    order: idx + 1,
    status: s.status || 'PENDING',
    referencePoint: s.referencePoint || (idx === stops.length - 1 ? dropoffReferencePoint : null)
  }));

  const { ride } = await prisma.$transaction(async (tx) => {
    const newRide = await tx.ride.create({
      data: {
        passengerId, 
        serviceType: (serviceType || 'RIDE') as ServiceType,
        requestedVehicleType: (requestedVehicleType || 'PARTICULAR') as VehicleType,
        paymentMethod: chosenMethod, 
        originAddress: originAddress || '',
        originLat, 
        originLng, 
        destinationAddress: destinationAddress || '',
        destinationLat, 
        destinationLng, 
        referencePoint: referencePoint || pickupReferencePoint || null,
        stops: formattedStops.length > 0 ? formattedStops : undefined,
        distanceKm,
        durationMin,
        estimatedPriceXof: priceXof,
        priceXof, 
        status: initialStatus, 
        startOtp,
        finishOtp
      }
    });

    await tx.passenger.update({
      where: { id: passengerId },
      data: { currentRideId: newRide.id }
    });

    const payRef = `PAY-${newRide.id.slice(0, 8)}-${Date.now()}`;
    (newRide as any)._payRef = payRef;
    if (!isMobileMoney) {
      await tx.transaction.create({
        data: {
          passengerId, 
          rideId: newRide.id, 
          type: TransactionType.RIDE_PAYMENT,
          status: initialTxStatus, 
          amount: priceXof,
          reference: payRef, 
          paymentMethod: chosenMethod,
          idempotencyKey: data.idempotencyKey
        }
      });
    }

    await tx.rideEventLog.create({
      data: {
        rideId: newRide.id,
        status: initialStatus,
        triggeredBy: UserType.PASSENGER,
        userId: passengerId,
        lat: originLat,
        lng: originLng
      }
    });

    return { ride: newRide };
  });

  if (isMobileMoney) {
    const paymentReference = (ride as any)._payRef || `PAY-${ride.id.slice(0, 8)}-${Date.now()}`;
    const chargeResult = await chargePassengerMobileMoney({
      passengerId,
      rideId: ride.id,
      transactionId: paymentReference,
      phone: targetPayerPhone,
      amount: priceXof,
      provider: chosenMethod,
    });

    if (!chargeResult.success) {
      await prisma.$transaction(async (tx) => {
        await tx.ride.update({
          where: { id: ride.id },
          data: { status: RideStatus.CANCELLED, cancellationReason: `PAYMENT_INIT_FAILED: ${chargeResult.details || chargeResult.error || 'Falha na operadora'}` },
        });
        await tx.passenger.update({ where: { id: passengerId }, data: { currentRideId: null } });
      }).catch(() => null);
      throw new Error(`PAYMENT_INIT_FAILED: ${chargeResult.details || 'Não foi possível iniciar o pagamento Mobile Money.'}`);
    }

    return {
      success: true,
      pendingVerification: true,
      ride,
      payment: {
        provider: chosenMethod,
        providerLabel: formatPaymentMethodLabel(chosenMethod),
        reference: paymentReference,
        providerRef: chargeResult.providerRef || paymentReference,
        paymentUrl: chargeResult.paymentUrl || null,
        phone: targetPayerPhone,
        amountXOF: priceXof,
      },
    };
  }

  console.log(`✅ [CREATE_RIDE_SUCCESS] Corrida ${ride.id} criada! Distância: ${distanceKm} km | Valor: ${ride.priceXof} XOF`);
  return { success: true, pendingVerification: false, ride };
}

export async function searchLandmarks(query: string) {
  if (!query || query.trim().length < 2) return [];

  const cleanQuery = query.trim().toLowerCase();

  const places = await prisma.customPlace.findMany({
    where: {
      isActive: true,
      OR: [
        { name: { contains: cleanQuery, mode: 'insensitive' } },
        { popularName: { contains: cleanQuery, mode: 'insensitive' } },
        { searchKeywords: { has: cleanQuery } },
        { neighborhood: { name: { contains: cleanQuery, mode: 'insensitive' } } }
      ]
    },
    include: {
      neighborhood: {
        select: { name: true }
      }
    },
    take: 10
  });

  return places.map(place => {
    const neighborhood = place.neighborhood?.name || 'Bissau';
    const mainTitle = place.name;
    const subTitle = `${neighborhood}${place.referenceNotes ? ` • ${place.referenceNotes}` : ''}`;
    const display = place.popularName
      ? `${place.name} (${place.popularName}) - ${neighborhood}`
      : `${place.name} - ${neighborhood}`;

    return {
      id: place.id,
      name: place.name,
      popularName: place.popularName,
      neighborhoodName: neighborhood,
      neighborhood: neighborhood,
      latitude: place.latitude,
      longitude: place.longitude,
      referenceNotes: place.referenceNotes,
      title: mainTitle,
      subtitle: subTitle,
      displayText: display
    };
  });
}

// -----------------------------------------------------------------------------
// ACEITAR CORRIDA
// -----------------------------------------------------------------------------
export async function acceptRideLogic(rideId: string, driverId: string) {
  console.log(`📡 [ACCEPT_RIDE] Motorista ${driverId} solicitou aceite da corrida ${rideId}`);
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver || !driver.isOnline || driver.status !== 'APPROVED') {
    console.error(`❌ [ACCEPT_RIDE_ERROR] Motorista ${driverId} não está aprovado ou online.`);
    throw new Error('DRIVER_UNAVAILABLE: Motorista indisponível ou conta não aprovada.');
  }

  if (driver.currentRideId) {
    const currentActiveRide = await prisma.ride.findUnique({
      where: { id: driver.currentRideId },
      select: { status: true }
    });

    if (!currentActiveRide || ['CANCELLED', 'COMPLETED'].includes(currentActiveRide.status)) {
      await prisma.driver.update({
        where: { id: driverId },
        data: { currentRideId: null, isAvailable: true }
      });
    } else {
      console.warn(`⚠️ [ACCEPT_RIDE_WARN] Motorista ${driverId} já possui a corrida ativa: ${driver.currentRideId}`);
      throw new Error('DRIVER_BUSY: Você já possui uma corrida em andamento. Conclua-a antes de aceitar uma nova.');
    }
  }

  const ride = await prisma.ride.findUnique({ where: { id: rideId } });
  if (!ride || ride.status !== RideStatus.SEARCHING) {
    console.warn(`⚠️ [ACCEPT_RIDE_WARN] Corrida ${rideId} não está mais em SEARCHING (Status atual: ${ride?.status})`);
    throw new Error('RIDE_UNAVAILABLE: Corrida indisponível ou já aceita por outro motorista.');
  }

  const currentBalance = Number(driver.walletBalance || 0);
  if (ride.paymentMethod === PaymentMethod.CASH && currentBalance < MIN_DRIVER_BALANCE_FOR_CASH) {
    console.warn(`⚠️ [ACCEPT_RIDE_WARN] Motorista ${driverId} com saldo insuficiente na carteira: ${currentBalance} XOF`);
    throw new Error('INSUFFICIENT_DRIVER_BALANCE: Seu saldo na carteira digital está negativo. Recarregue para aceitar corridas em dinheiro.');
  }

  const targetStatus: RideStatus = RideStatus.ACCEPTED;

  const result = await prisma.$transaction(async (tx) => {
    await tx.driver.update({
      where: { id: driverId },
      data: { currentRideId: rideId, isAvailable: false }
    });

    const updatedRide = await tx.ride.updateMany({
      where: { id: rideId, status: RideStatus.SEARCHING },
      data: {
        driverId, 
        status: targetStatus, 
        acceptedAt: new Date(), 
        driverVehiclePlate: driver.vehiclePlate,
        driverVehicleType: driver.vehicleType,
        version: { increment: 1 }
      }
    });

    if (updatedRide.count === 0) {
      throw new Error('RIDE_ALREADY_TAKEN: Esta corrida acabou de ser aceita por outro colega.');
    }

    await (tx as any).rideOffer.updateMany({
      where: { rideId, driverId },
      data: { status: RideOfferStatus.ACCEPTED }
    }).catch(() => null);

    await (tx as any).rideEventLog.create({
      data: {
        rideId,
        status: targetStatus,
        triggeredBy: UserType.DRIVER,
        userId: driverId
      }
    });

    const res = await tx.ride.findUnique({ 
      where: { id: rideId }, 
      include: { 
        passenger: { 
          select: { id: true, fullName: true, profilePicture: true, ratingAverage: true, phone: true, deviceToken: true } 
        }, 
        driver: { 
          select: { id: true, fullName: true, profilePicture: true, vehicleBrand: true, vehicleColor: true, vehiclePlate: true, vehicleType: true, ratingAverage: true, phone: true } 
        } 
      } 
    });

    if (!res) throw new Error('NOT_FOUND: Corrida não encontrada no banco de dados.');

    return res;
  });

  console.log(`🚗 [RIDE_LOG_ACCEPT] Motorista "${result.driver?.fullName}" aceitou a corrida ID: ${result.id}`);

  const syncedPrice = Math.round(Number(result.priceXof || 0));
  const syncedDistance = Number(Number(result.distanceKm || 0).toFixed(2));
  const syncedDuration = Number(result.durationMin || 0);

  const passengerAcceptedPayload = {
    rideId: result.id,
    status: targetStatus,
    driverId: result.driverId,
    driverName: result.driver?.fullName || 'Motorista',
    driverPhone: result.driver?.phone || null,
    driverPhoto: result.driver?.profilePicture || null,
    carModel: result.driver?.vehicleBrand || 'Veículo Padrão',
    carColor: result.driver?.vehicleColor || 'BRANCO',
    licensePlate: result.driver?.vehiclePlate || 'N/A',
    vehicleType: result.driver?.vehicleType || 'PARTICULAR',
    driverRating: Number(result.driver?.ratingAverage || 5.0),
    startOtp: result.startOtp || null,
    priceXof: syncedPrice,
    fareXOF: syncedPrice,
    distanceKm: syncedDistance,
    durationMin: syncedDuration,
    originAddress: result.originAddress,
    destinationAddress: result.destinationAddress,
    pickupReferencePoint: (result as any).pickupReferencePoint || result.referencePoint || '',
    dropoffReferencePoint: (result as any).dropoffReferencePoint || '',
    isQueuedRide: false
  };
 
  const passengerRooms = [
    result.id,
    result.passengerId,
    `passenger_${result.passengerId}`,
    `passenger:${result.passengerId}`,
    `user_${result.passengerId}`
  ];

  passengerRooms.forEach(room => {
    safeSocketEmit(room, 'ride:accepted', passengerAcceptedPayload);
  });

  if (result.passenger?.deviceToken) {
    sendPushNotification(
      result.passenger.deviceToken,
      '✅ Corrida Aceita!',
      `O motorista ${result.driver?.fullName || 'parceiro'} aceitou sua corrida e está a caminho!`,
      { type: 'RIDE_ACCEPTED', rideId: result.id, status: targetStatus },
      PUSH_CHANNELS.RIDE_UPDATE
    ).catch(err => console.error('❌ Erro no Push de Aceite:', err));
  }

  return {
    ...result,
    priceXof: syncedPrice,
    fareXOF: syncedPrice,
    distanceKm: syncedDistance,
    durationMin: syncedDuration,
    passenger: result.passenger ? { ...result.passenger, phone: maskPhoneNumber(result.passenger.phone) } : null,
    driver: result.driver ? { ...result.driver, phone: maskPhoneNumber(result.driver.phone) } : null
  };
}

export const acceptRide = acceptRideLogic;

// -----------------------------------------------------------------------------
// CHEGADA DO MOTORISTA
// -----------------------------------------------------------------------------
export async function driverArrivedLogic(rideId: string, driverId: string) {
  console.log(`📡 [ARRIVED_RIDE] Motorista ${driverId} informou chegada ao local na corrida ${rideId}`);
  const ride = await prisma.ride.findUnique({ where: { id: rideId } });
  if (!ride || ride.driverId !== driverId) throw new Error('UNAUTHORIZED: Motorista não associado a esta viagem.');
  if (ride.status !== RideStatus.ACCEPTED) throw new Error('INVALID_STATUS: A corrida não está em estado aceito.');

  const updated = await prisma.$transaction(async (tx) => {
    const updatedRide = await tx.ride.update({
      where: { id: rideId },
      data: { status: RideStatus.ARRIVED, arrivedAt: new Date(), version: { increment: 1 } },
      include: { 
        passenger: { 
          select: { id: true, fullName: true, profilePicture: true, ratingAverage: true, phone: true, deviceToken: true } 
        } 
      }
    });

    await (tx as any).rideEventLog.create({
      data: {
        rideId,
        status: RideStatus.ARRIVED,
        triggeredBy: UserType.DRIVER,
        userId: driverId
      }
    });

    return updatedRide;
  });

  console.log(`📍 [RIDE_LOG_ARRIVED] Motorista chegou ao local de embarque da corrida ID: ${rideId}`);

  const arrivedPayload = {
    rideId: updated.id,
    status: 'ARRIVED',
    startOtp: updated.startOtp
  };

  const passengerRooms = [
    updated.id,
    updated.passengerId,
    `passenger_${updated.passengerId}`,
    `passenger:${updated.passengerId}`,
    `user_${updated.passengerId}`
  ];

  passengerRooms.forEach(room => {
    safeSocketEmit(room, 'ride:arrived', arrivedPayload);
    safeSocketEmit(room, 'ride:driver_arrived', arrivedPayload);
  });

  if (updated.passenger?.deviceToken) {
    sendPushNotification(
      updated.passenger.deviceToken,
      '📍 Motorista Chegou!',
      `Seu motorista está no local. Informe o código PIN ${updated.startOtp} ao embarcar.`,
      { type: 'DRIVER_ARRIVED', rideId: updated.id, startOtp: updated.startOtp, status: 'ARRIVED' },
      PUSH_CHANNELS.RIDE_UPDATE
    ).catch(err => console.error('⚠️ Falha ao enviar push de chegada ao passageiro:', err));
  }

  return {
    ...updated,
    passenger: updated.passenger ? { ...updated.passenger, phone: maskPhoneNumber(updated.passenger.phone) } : null
  };
}

// -----------------------------------------------------------------------------
// INÍCIO DA VIAGEM
// -----------------------------------------------------------------------------
export async function startRideLogic(rideId: string, driverId: string, otpInput: string) {
  console.log(`📡 [START_RIDE] Motorista ${driverId} solicitou início da corrida ${rideId} com OTP: "${otpInput}"`);
  const ride = await prisma.ride.findUnique({ 
    where: { id: rideId },
    include: { passenger: { select: { id: true, deviceToken: true } } }
  });
  if (!ride || ride.driverId !== driverId) throw new Error('UNAUTHORIZED: Operação não autorizada.');

  const cleanOtpInput = String(otpInput || '').trim().padStart(4, '0');
  const cleanStartOtp = String(ride.startOtp || '').trim().padStart(4, '0');

  if (cleanStartOtp && cleanStartOtp !== cleanOtpInput) {
    console.error(`❌ [START_RIDE_ERROR] PIN incorreto! Esperado: "${cleanStartOtp}", Recebido: "${cleanOtpInput}"`);
    throw new Error('INVALID_OTP: O código PIN informado está incorreto.');
  }

  const updatedRide = await prisma.$transaction(async (tx) => {
    const updatedRes = await tx.ride.update({
      where: { id: rideId },
      data: { status: RideStatus.IN_PROGRESS, startedAt: new Date(), version: { increment: 1 } }
    });

    await (tx as any).rideEventLog.create({
      data: {
        rideId,
        status: RideStatus.IN_PROGRESS,
        triggeredBy: UserType.DRIVER,
        userId: driverId
      }
    });

    return updatedRes;
  });

  console.log(`🟢 [START_RIDE_SUCCESS] Corrida ${rideId} iniciada com sucesso!`);

  const startPayload = { 
    rideId: ride.id, 
    status: 'IN_PROGRESS',
    originAddress: ride.originAddress,
    destinationAddress: ride.destinationAddress,
    priceXof: Math.round(Number(ride.priceXof || 0)),
    distanceKm: Number(Number(ride.distanceKm || 0).toFixed(2))
  };

  const passengerRooms = [
    ride.id,
    ride.passengerId,
    `passenger_${ride.passengerId}`,
    `passenger:${ride.passengerId}`,
    `user_${ride.passengerId}`
  ];

  passengerRooms.forEach(room => {
    safeSocketEmit(room, 'ride:started', startPayload);
  });

  if (ride.passenger?.deviceToken) {
    sendPushNotification(
      ride.passenger.deviceToken,
      '🚕 Viagem Iniciada!',
      'Sua viagem com o Nô Bai 245 começou. Tenha uma excelente viagem!',
      { type: 'RIDE_STARTED', rideId: ride.id, status: 'IN_PROGRESS' },
      PUSH_CHANNELS.RIDE_UPDATE
    ).catch(err => console.error('❌ Erro no Push de início:', err));
  }

  return updatedRide;
}

// -----------------------------------------------------------------------------
// 4. PROXIMIDADE DO MOTORISTA
// -----------------------------------------------------------------------------
export async function notifyDriverNearbyIfClose(rideId: string, distanceMeters: number) {
  if (distanceMeters > 300) return;

  console.log(`📍 [NEARBY_DEBUG] Motorista a ${Math.round(distanceMeters)}m do embarque na corrida ID: ${rideId}`);

  const ride = await prisma.ride.findUnique({ 
    where: { id: rideId },
    include: { passenger: { select: { deviceToken: true } } }
  });
  if (!ride || ride.status !== 'ACCEPTED') return;

  const nearbyPayload = { rideId: ride.id };

  const passengerRooms = [
    ride.id,
    ride.passengerId,
    `passenger_${ride.passengerId}`,
    `passenger:${ride.passengerId}`
  ];

  passengerRooms.forEach(room => {
    safeSocketEmit(room, 'ride:driver_nearby', nearbyPayload);
  });

  if (ride.passenger?.deviceToken) {
    sendPushNotification(
      ride.passenger.deviceToken,
      '📍 Motorista Chegando!',
      'Seu motorista está a menos de 300 metros do local de embarque.',
      { type: 'DRIVER_NEARBY', rideId: ride.id },
      PUSH_CHANNELS.RIDE_UPDATE
    ).catch(err => console.error('❌ Erro no Push de proximidade:', err));
  }
}

// -----------------------------------------------------------------------------
// 5. FINALIZAÇÃO DA CORRIDA E LIQUIDAÇÃO (COM DÉBITO AUTOMÁTICO DE COMISSÃO)
// -----------------------------------------------------------------------------
export async function finalizeRideAndCharge(
  rideId: string, 
  finalLat: number, 
  finalLng: number,
  finishOtpInput?: string
): Promise<FinalizeRideResult> {
  console.log(`🏁 [FINALIZE_DEBUG] Iniciando finalização da corrida ${rideId}. Destino final: (${finalLat}, ${finalLng})`);

  if (!isValidCoordinate(finalLat, finalLng)) {
    console.error(`❌ [FINALIZE_ERROR] Coordenadas de desembarque inválidas: (${finalLat}, ${finalLng})`);
    throw new Error('INVALID_COORDINATES: Coordenadas finais de desembarque inválidas.');
  }

  const ride = await prisma.ride.findUnique({
    where: { id: rideId }, 
    include: { driver: true, passenger: true }
  });

  if (!ride || !ride.driver || !ride.passenger) {
    console.error(`❌ [FINALIZE_ERROR] Dados incompletos para a corrida ID ${rideId}`);
    throw new Error('NOT_FOUND: Dados completos da corrida não localizados.');
  }
  
  if (ride.status === RideStatus.COMPLETED || ride.status === RideStatus.CANCELLED) {
    console.warn(`⚠️ [FINALIZE_WARN] Corrida ID ${rideId} já estava em estado final: ${ride.status}`);
    throw new Error('RIDE_FINISHED: A corrida já foi finalizada ou cancelada anteriormente.');
  }

  const rideFinishOtp = (ride as any).finishOtp;
  if (rideFinishOtp && finishOtpInput && String(finishOtpInput).trim().length > 0) {
    const cleanInput = String(finishOtpInput).trim().padStart(4, '0');
    const cleanDbOtp = String(rideFinishOtp).trim().padStart(4, '0');

    if (cleanDbOtp !== cleanInput) {
      console.error(`❌ [FINALIZE_ERROR] PIN de confirmação incorreto! Esperado: "${cleanDbOtp}", Informado: "${cleanInput}"`);
      throw new Error('INVALID_OTP: O código PIN de confirmação informado está incorreto.');
    }
  }

  // 🟢 PRESERVA O VALOR E A QUILOMETRAGEM ACORDADOS NA CORRIDA PARA EVITAR DIVERGÊNCIA ENTRE APPS
  const calculatedFare = Math.round(Number(ride.priceXof || 0));
  const savedDistanceKm = Number(ride.distanceKm || 0);
  const distanceKm = savedDistanceKm > 0
    ? Number(savedDistanceKm.toFixed(2))
    : (await getRouteDistanceAndDuration(Number(ride.originLat), Number(ride.originLng), finalLat, finalLng)).distanceKm;
  
  const tariff = await prisma.tariffConfig.findUnique({
    where: { vehicleType_serviceType: { vehicleType: ride.requestedVehicleType, serviceType: ride.serviceType } }
  }).catch(() => null);

  const commissionRate = tariff ? Number(tariff.commissionRate) / 100 : 0.15;
  const platformFee = Math.round(calculatedFare * commissionRate);
  const driverEarnings = calculatedFare - platformFee;

  const isDigitalRide = ride.paymentMethod === PaymentMethod.ORANGE_MONEY || ride.paymentMethod === PaymentMethod.MTN_MOMO;
  let driverPayoutPhone = '';
  let driverPayoutProvider: PaymentMethod = ride.paymentMethod === PaymentMethod.MTN_MOMO ? PaymentMethod.MTN_MOMO : PaymentMethod.ORANGE_MONEY;

  if (isDigitalRide && ride.driver) {
    if (ride.paymentMethod === PaymentMethod.ORANGE_MONEY && ride.driver.orangeNumber) {
      driverPayoutPhone = ride.driver.orangeNumber;
      driverPayoutProvider = PaymentMethod.ORANGE_MONEY;
    } else if (ride.paymentMethod === PaymentMethod.MTN_MOMO && ride.driver.mtnNumber) {
      driverPayoutPhone = ride.driver.mtnNumber;
      driverPayoutProvider = PaymentMethod.MTN_MOMO;
    } else if (ride.driver.orangeNumber) {
      driverPayoutPhone = ride.driver.orangeNumber;
      driverPayoutProvider = PaymentMethod.ORANGE_MONEY;
    } else if (ride.driver.mtnNumber) {
      driverPayoutPhone = ride.driver.mtnNumber;
      driverPayoutProvider = PaymentMethod.MTN_MOMO;
    } else {
      const fb = ride.driver.paymentAccountNumber || ride.driver.phone || '';
      driverPayoutPhone = fb;
      driverPayoutProvider = detectProviderFromPhone(fb) || driverPayoutProvider;
    }
  }

  let commissionTransactionId = '';
  let payoutTransactionId = '';
  let queuedRideToPromote: any = null;
  let finalDriverBalance = Number(ride.driver.walletBalance || 0);
  let wasForcedOfflineDueToBalance = false;

  await prisma.$transaction(async (tx) => {
    const updatedRide = await tx.ride.updateMany({
      where: { 
        id: rideId, 
        version: ride.version, 
        status: { in: [RideStatus.ACCEPTED, RideStatus.ARRIVED, RideStatus.IN_PROGRESS] } 
      },
      data: {
        status: RideStatus.COMPLETED, 
        finishedAt: new Date(), 
        destinationLat: finalLat, 
        destinationLng: finalLng,
        distanceKm, 
        platformFee, 
        driverEarnings, 
        version: { increment: 1 }
      }
    });

    if (updatedRide.count === 0) {
      throw new Error('CONCURRENCY_ERROR: Ocorreu um conflito ao tentar finalizar a corrida. Tente novamente.');
    }

    await (tx as any).rideEventLog.create({
      data: {
        rideId,
        status: RideStatus.COMPLETED,
        triggeredBy: UserType.DRIVER,
        userId: ride.driverId!,
        lat: finalLat,
        lng: finalLng
      }
    });

    await tx.passenger.update({ where: { id: ride.passengerId }, data: { currentRideId: null } });
  
    queuedRideToPromote = await tx.ride.findFirst({
      where: {
        driverId: ride.driverId!,
        status: { in: [RideStatus.ACCEPTED, ('QUEUED' as any)] },
        id: { not: ride.id }
      }
    });

    const nextCurrentRideId = queuedRideToPromote ? queuedRideToPromote.id : null;
    const isDriverAvailable = !queuedRideToPromote;

    if (queuedRideToPromote && queuedRideToPromote.status === ('QUEUED' as any)) {
      await tx.ride.update({
        where: { id: queuedRideToPromote.id },
        data: { status: RideStatus.ACCEPTED }
      });
    }

    const currentDriverBalance = Number(ride.driver?.walletBalance || 0);
    finalDriverBalance = isDigitalRide ? currentDriverBalance : (currentDriverBalance - platformFee);

    const shouldStayOnline = true; 
    wasForcedOfflineDueToBalance = false;

    await tx.driver.update({ 
      where: { id: ride.driverId! }, 
      data: { 
        walletBalance: finalDriverBalance,
        currentRideId: nextCurrentRideId, 
        isAvailable: isDriverAvailable,
        isOnline: shouldStayOnline
      } 
    });

    await tx.transaction.updateMany({
      where: { rideId: ride.id, type: TransactionType.RIDE_PAYMENT },
      data: { status: TransactionStatus.COMPLETED }
    });

    const commTx = await tx.transaction.create({
      data: {
        rideId: ride.id,
        driverId: ride.driverId,
        type: TransactionType.COMMISSION_FEE,
        status: TransactionStatus.COMPLETED,
        paymentMethod: ride.paymentMethod,
        amount: platformFee,
        balanceBefore: currentDriverBalance,
        balanceAfter: finalDriverBalance,
        reference: `COMM-${ride.paymentMethod}-${ride.id.slice(0, 8)}-${Date.now()}`,
        description: `Taxa da plataforma (${Math.round(commissionRate * 100)}%) sobre corrida (${formatPaymentMethodLabel(ride.paymentMethod)}) de ${calculatedFare} XOF`
      }
    });
    commissionTransactionId = commTx.id;

    if (isDigitalRide && driverEarnings > 0) {
      const hasValidPhone = Boolean(driverPayoutPhone && driverPayoutPhone.replace(/\D/g, '').length >= 9);
      const payoutTx = await tx.transaction.create({
        data: {
          rideId: ride.id,
          driverId: ride.driverId,
          type: TransactionType.DRIVER_PAYOUT,
          status: hasValidPhone ? TransactionStatus.PENDING : TransactionStatus.FAILED_MANUAL_REVIEW,
          paymentMethod: driverPayoutProvider,
          amount: driverEarnings,
          reference: `PAYOUT-${ride.id.slice(0, 8)}-${Date.now()}`,
          description: hasValidPhone ? `Split automático (${formatPaymentMethodLabel(driverPayoutProvider)}) para ${driverPayoutPhone}` : 'Motorista sem número Mobile Money cadastrado',
          failureReason: hasValidPhone ? null : 'MISSING_DRIVER_MOBILE_MONEY_PHONE',
        }
      });
      if (hasValidPhone) payoutTransactionId = payoutTx.id;
    }

    await tx.companyWallet.upsert({
      where: { id: 'bai245-main-wallet' },
      update: { 
        balance: { increment: platformFee }, 
        totalCollected: { increment: calculatedFare }, 
        version: { increment: 1 } 
      },
      create: { 
        id: 'bai245-main-wallet', 
        balance: platformFee, 
        totalCollected: calculatedFare 
      }
    });
  }); 

  if (isDigitalRide && payoutTransactionId && driverPayoutPhone) {
    enqueuePayoutJob({
      transactionId: payoutTransactionId,
      rideId: ride.id,
      driverId: ride.driverId!,
      amountXOF: driverEarnings,
      phone: driverPayoutPhone,
      provider: driverPayoutProvider,
    }).catch((err) => console.error('❌ [SPLIT_PAYOUT_ERR]:', err));
  } else if (isDigitalRide && !payoutTransactionId) {
    safeSocketEmit('admin_dashboard', 'admin:payout_alert', { rideId: ride.id, driverId: ride.driverId, amount: driverEarnings, provider: driverPayoutProvider, reason: 'Motorista sem número Mobile Money cadastrado.' });
  }
  console.log(`🏁 [RIDE_LOG_COMPLETED] Corrida ID: ${rideId} (${ride.paymentMethod}) finalizada! Total: ${calculatedFare} XOF | Líquido: ${driverEarnings} XOF`);

  const completedPayload = {
    rideId: ride.id,
    status: 'COMPLETED',
    priceXof: calculatedFare,
    fareXOF: calculatedFare,
    totalAmount: calculatedFare,
    driverEarnings,
    platformFee,
    distanceKm,
    transactionId: commissionTransactionId || `TRX-${ride.id.slice(0, 6).toUpperCase()}`,
    driverWalletBalance: finalDriverBalance,
    forcedOffline: wasForcedOfflineDueToBalance
  };

  const passengerRooms = [
    ride.id,
    ride.passengerId,
    `passenger_${ride.passengerId}`,
    `passenger:${ride.passengerId}`,
    `user_${ride.passengerId}`
  ];

  passengerRooms.forEach(room => {
    safeSocketEmit(room, 'ride:completed', completedPayload);
    safeSocketEmit(room, 'ride:finished', completedPayload);
  });

  const driverRooms = [ride.driverId!, `driver_${ride.driverId}`, `driver:${ride.driverId}`];
  driverRooms.forEach(room => {
    safeSocketEmit(room, 'driver:ride_finished_confirm', completedPayload);
    safeSocketEmit(room, 'wallet:updated', { balance: finalDriverBalance });
    if (wasForcedOfflineDueToBalance) {
      safeSocketEmit(room, 'driver:forced_offline', { 
        reason: 'INSUFFICIENT_BALANCE', 
        message: 'Seu saldo na carteira digital ficou zerado ou negativo. Recarregue enviando dinheiro para a conta administrativa para voltar a rodar.' 
      });
    }
  });

  if (ride.passenger?.deviceToken) {
    const finishBody = isDigitalRide
      ? `Você chegou ao seu destino. Pagamento de ${calculatedFare} XOF via ${formatPaymentMethodLabel(ride.paymentMethod)} confirmado! Avalie seu motorista!`
      : `Você chegou ao seu destino. Pague ${calculatedFare} XOF em dinheiro ao motorista. Avalie seu motorista!`;
    sendPushNotification(
      ride.passenger.deviceToken,
      '🏁 Viagem Concluída!',
      finishBody,
      { type: 'RIDE_COMPLETED', rideId: ride.id, priceXof: calculatedFare, fareXOF: calculatedFare, paymentMethod: ride.paymentMethod, status: 'COMPLETED' },
      PUSH_CHANNELS.RIDE_UPDATE
    ).catch(err => console.error('❌ Erro no Push de finalização:', err));
  }

  return { 
    success: true, 
    fareXOF: calculatedFare, 
    driverEarnings, 
    platformFee, 
    distanceKm, 
    paymentMethod: ride.paymentMethod, 
    hasQueuedRide: !!queuedRideToPromote, 
    nextRideId: queuedRideToPromote?.id || null 
  };
}

// -----------------------------------------------------------------------------
// 6. CANCELAMENTO DE CORRIDA
// -----------------------------------------------------------------------------
export async function cancelRideLogic(
  rideId: string, 
  userId: string, 
  userType: 'PASSENGER' | 'DRIVER', 
  reason?: string,
  isReportedProblem: boolean = false
) {
  console.log(`❌ [CANCEL_DEBUG] Solicitado cancelamento da corrida ${rideId} por ${userType} (ID: ${userId})`);
  const ride = await prisma.ride.findUnique({ where: { id: rideId }, include: { passenger: true, driver: true } });
  if (!ride) throw new Error('NOT_FOUND: Corrida não encontrada.');

  if (ride.status === RideStatus.IN_PROGRESS) {
    console.warn(`⚠️ [CANCEL_INFO] Corrida em andamento (ID: ${rideId}) cancelada por ${userType}.`);
  }

  const originalPayment = await prisma.transaction.findFirst({
    where: { 
      rideId, 
      type: TransactionType.RIDE_PAYMENT, 
      status: { in: [TransactionStatus.HELD_IN_ESCROW, TransactionStatus.COMPLETED, TransactionStatus.PENDING] } 
    }
  });

  const cleanReason = reason || 'Sem justificativa informada';

  const dbResult = await prisma.$transaction(async (tx) => {
    const updatedRide = await tx.ride.updateMany({
      where: { id: rideId, version: ride.version, status: { notIn: [RideStatus.COMPLETED, RideStatus.CANCELLED] } },
      data: { status: RideStatus.CANCELLED, cancellationReason: cleanReason, cancelledBy: userType as UserType, version: { increment: 1 } }
    });

    if (updatedRide.count === 0) {
      throw new Error('STATE_CONFLICT: A corrida já foi alterada por outra operação.');
    }

    await (tx as any).rideEventLog.create({
      data: {
        rideId,
        status: RideStatus.CANCELLED,
        triggeredBy: userType as UserType,
        userId,
        reason: cleanReason
      }
    });

    await tx.passenger.update({ where: { id: ride.passengerId }, data: { currentRideId: null } });

    if (ride.driverId) {
      const remainingQueuedRide = await tx.ride.findFirst({
        where: {
          driverId: ride.driverId,
          status: { in: [RideStatus.ACCEPTED, 'QUEUED' as any] },
          id: { not: ride.id }
        }
      });

      await tx.driver.update({
        where: { id: ride.driverId },
        data: {
          currentRideId: remainingQueuedRide ? remainingQueuedRide.id : null,
          isAvailable: remainingQueuedRide ? false : true
        }
      });
    }

    let refundTxId: string | null = null;
    let refundAmount = 0;
    let refundProvider: PaymentMethod = PaymentMethod.ORANGE_MONEY;

    if (originalPayment) {
      const isPaidDigital = (originalPayment.paymentMethod === PaymentMethod.ORANGE_MONEY || originalPayment.paymentMethod === PaymentMethod.MTN_MOMO) &&
        (originalPayment.status === TransactionStatus.HELD_IN_ESCROW || originalPayment.status === TransactionStatus.COMPLETED);

      if (isPaidDigital) {
        await tx.transaction.update({ where: { id: originalPayment.id }, data: { status: TransactionStatus.REVERSED } });
        refundAmount = Math.round(Number(originalPayment.amount));
        refundProvider = originalPayment.paymentMethod || PaymentMethod.ORANGE_MONEY;
        const rTx = await tx.transaction.create({
          data: {
            rideId: ride.id, passengerId: ride.passengerId, type: TransactionType.REFUND, status: TransactionStatus.PENDING,
            paymentMethod: refundProvider, amount: refundAmount, reference: `REFUND-${ride.id.slice(0, 8)}-${Date.now()}`,
            description: `Estorno automático (${formatPaymentMethodLabel(refundProvider)})`
          }
        });
        refundTxId = rTx.id;
      } else {
        await tx.transaction.update({ where: { id: originalPayment.id }, data: { status: TransactionStatus.CANCELLED } });
      }
    }

    return { appliedPenalty: false, penaltyAmount: 0, refundTxId, refundAmount, refundProvider };
  });

  if (dbResult.refundTxId && dbResult.refundAmount > 0) {
    const pPhone = ride.passenger?.paymentAccountNumber || ride.passenger?.phone || '';
    if (pPhone) {
      enqueueRefundJob({ transactionId: dbResult.refundTxId, rideId: ride.id, passengerId: ride.passengerId, phone: pPhone, amountXOF: dbResult.refundAmount, provider: dbResult.refundProvider })
        .catch((err) => console.error('❌ [REFUND_ENQUEUE_ERR]:', err));
    }
  }

  console.log(`⚠️ [RIDE_LOG_CANCEL] Corrida ID: ${rideId} cancelada por ${userType}. Motivo: ${cleanReason}`);

  safeSocketEmit(`passenger_${ride.passengerId}`, 'ride:cancelled', {
    rideId: ride.id,
    cancelledBy: userType,
    reason: cleanReason
  });

  if (ride.driverId) {
    safeSocketEmit(`driver_${ride.driverId}`, 'ride:cancelled', {
      rideId: ride.id,
      cancelledBy: userType,
      reason: cleanReason
    });
  }

  if (userType === 'DRIVER' && ride.passenger?.deviceToken) {
    sendPushNotification(
      ride.passenger.deviceToken,
      '⚠️ Corrida Cancelada pelo Motorista',
      `O motorista precisou cancelar a corrida. Motivo: ${cleanReason}`,
      { type: 'RIDE_CANCELLED', rideId: ride.id },
      PUSH_CHANNELS.RIDE_UPDATE
    ).catch(err => console.error('❌ Erro no push de cancelamento:', err));
  }

  if (userType === 'PASSENGER' && ride.driver?.deviceToken) {
    sendPushNotification(
      ride.driver.deviceToken,
      '⚠️ Corrida Cancelada pelo Passageiro',
      `O passageiro cancelou a corrida. Motivo: ${cleanReason}`,
      { type: 'RIDE_CANCELLED', rideId: ride.id },
      PUSH_CHANNELS.RIDE_UPDATE
    ).catch(err => console.error('❌ Erro no push de cancelamento:', err));
  }

  return dbResult;
}

// -----------------------------------------------------------------------------
// 7. NOTIFICAÇÕES DE CHAT E AVALIAÇÕES (VERSÃO PRODUÇÃO)
// -----------------------------------------------------------------------------
export async function notifyNewChatMessage(data: {
  rideId: string;
  senderId: string;
  senderType: 'PASSENGER' | 'DRIVER';
  senderName: string;
  message: string;
  audioUrl?: string | null;
  audioDuration?: number;
}) {
  try {
    const { rideId, senderId, senderType, senderName, message, audioUrl, audioDuration } = data;
    
    console.log(`💬 [CHAT_DEBUG] Nova mensagem na corrida ${rideId} de ${senderName} (${senderType})`);

    const ride = await prisma.ride.findUnique({
      where: { id: rideId },
      include: {
        passenger: { select: { id: true, fullName: true, deviceToken: true, pushToken: true, profilePicture: true } },
        driver: { select: { id: true, fullName: true, deviceToken: true, pushToken: true, profilePicture: true } }
      }
    });

    if (!ride) {
      console.warn(`⚠️ [CHAT_WARN] Corrida ${rideId} não encontrada ao enviar mensagem.`);
      return;
    }

    const isPassenger = senderType === 'PASSENGER';
    const targetUserId = isPassenger ? ride.driverId : ride.passengerId;

    const targetToken = isPassenger 
      ? (ride.driver?.deviceToken || (ride.driver as any)?.pushToken)
      : (ride.passenger?.deviceToken || (ride.passenger as any)?.pushToken);

    const isAudioMsg = Boolean(audioUrl || message?.startsWith('data:audio') || message?.length > 300);
    const pushBodyText = isAudioMsg ? '🎙️ Mensagem de áudio' : message;

    const chatPayload = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      rideId,
      senderId,
      sender: isPassenger ? 'passenger' : 'driver',
      senderType,
      senderName,
      message: isAudioMsg ? '' : message,
      text: isAudioMsg ? '' : message,
      audioUrl: audioUrl || (message?.startsWith('data:audio') ? message : null),
      audioDuration: audioDuration || 0,
      createdAt: new Date().toISOString()
    };

    const targetRooms = [
      rideId,
      `ride_${rideId}`,
      targetUserId,
      `passenger_${ride.passengerId}`,
      `passenger:${ride.passengerId}`,
      `driver_${ride.driverId}`,
      `driver:${ride.driverId}`
    ].filter(Boolean) as string[];

    targetRooms.forEach(room => {
      safeSocketEmit(room, 'chat:receive_message', chatPayload);
      safeSocketEmit(room, 'chat:new_message', chatPayload);
    });

    if (targetToken) {
      sendPushNotification(
        targetToken,
        `💬 ${senderName}`,
        pushBodyText,
        { 
          type: 'CHAT_MESSAGE', 
          rideId, 
          sender: isPassenger ? 'passenger' : 'driver',
          channelId: PUSH_CHANNELS.CHAT
        },
        PUSH_CHANNELS.CHAT
      ).catch(err => console.warn('⚠️ [PUSH CHAT ERR]:', err?.message));
    }
  } catch (err) {
    console.error('💥 [CHAT_NOTIFY_ERROR]:', err);
  }
}

export async function submitRatingLogic(data: {
  rideId: string;
  reviewerId: string;
  reviewerType: 'PASSENGER' | 'DRIVER' | 'ADMIN';
  receiverId: string;
  stars: number;
  tags?: string[];
  comment?: string;
}) {
  const { rideId, reviewerId, reviewerType, receiverId, stars, tags = [], comment } = data;
  console.log(`⭐ [RATING_DEBUG] Avaliação submetida para corrida ${rideId}. De: ${reviewerType} (${reviewerId}) Para: ${receiverId} Nota: ${stars}★`);

  const newRating = await prisma.$transaction(async (tx) => {
    const rating = await tx.rating.upsert({
      where: {
        rideId_reviewerId: { rideId, reviewerId }
      },
      create: {
        rideId,
        reviewerId,
        reviewerType: reviewerType as UserType,
        receiverId,
        stars,
        tags,
        comment
      },
      update: {
        stars,
        tags,
        comment
      }
    });

    if (reviewerType === 'PASSENGER') {
      const agg = await tx.rating.aggregate({
        where: { receiverId, reviewerType: UserType.PASSENGER },
        _avg: { stars: true },
        _count: { stars: true }
      });

      const avgStars = Number(agg._avg.stars || 5.0);
      const countStars = Number(agg._count.stars || 0);

      await tx.driver.update({
        where: { id: receiverId },
        data: {
          ratingAverage: avgStars,
          totalRatings: countStars
        }
      });
    } else if (reviewerType === 'DRIVER') {
      const agg = await tx.rating.aggregate({
        where: { receiverId, reviewerType: UserType.DRIVER },
        _avg: { stars: true },
        _count: { stars: true }
      });

      const avgStars = Number(agg._avg.stars || 5.0);
      const countStars = Number(agg._count.stars || 0);

      await tx.passenger.update({
        where: { id: receiverId },
        data: {
          ratingAverage: avgStars,
          totalRatings: countStars
        }
      });
    }

    return rating;
  });

  return newRating;
}