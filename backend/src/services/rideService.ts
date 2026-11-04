import { 
  VehicleType, 
  ServiceType, 
  RideStatus, 
  PaymentMethod, 
  TransactionStatus, 
  TransactionType, 
  UserType,
  Prisma
} from '@prisma/client';
import axios from 'axios';
import { prisma } from '../config/prisma';
import { enqueuePayoutJob, enqueueRefundJob } from '../jobs/payoutQueue';
import { chargePassengerMobileMoney, isValidBissauPhone, executeRideDisbursement } from './mobileMoneyService';
import { sendPushNotification, PUSH_CHANNELS } from './pushNotifications';
import { getIo } from '../server';

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || '';
const IS_MOCK_MODE = process.env.ENABLE_MOCK_PAYMENTS === 'true' || process.env.NODE_ENV !== 'production';
const CANCELLATION_PENALTY_XOF = 500;
const MIN_DRIVER_BALANCE_FOR_CASH = -2000;
const MIN_DRIVER_BALANCE_FOR_ONLINE = 1000;
const RideOfferStatus = { PENDING: 'PENDING', ACCEPTED: 'ACCEPTED' } as any;

export async function calculateRouteAndDistance(
  pLat: number,
  pLng: number,
  dLat: number,
  dLng: number
): Promise<{ distanceKm: number; durationMin: number }> {
  const distanceKm = calculateDistance(pLat, pLng, dLat, dLng);
  const durationMin = Math.max(3, Math.ceil((distanceKm / 25) * 60));
  return { distanceKm, durationMin };
}

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
      io.to(room).emit(event, payload);
    }
  } catch (err) {
    console.warn(`⚠️ [SOCKET EMIT ERROR] Falha ao disparar ${event} para ${room}:`, err);
  }
}

// -----------------------------------------------------------------------------
// HELPER PARA DISPARO DE NOVAS CORRIDAS PARA MOTORISTAS (COM MULTI-SALAS)
// -----------------------------------------------------------------------------
export async function notifyDriversNewRide(rideId: string): Promise<void> {
  console.log(`\n🚨 [RIDE DISPATCH] Buscando motoristas para notificar sobre a corrida ${rideId}...`);
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
    if (!ride) return;

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

      if (ride.paymentMethod === 'CASH' && Number(driver.walletBalance || 0) < MIN_DRIVER_BALANCE_FOR_CASH) {
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

    console.log(`🔍 [RIDE DISPATCH] ${qualifiedDrivers.length} motoristas qualificados no raio de 5km.`);

    const ridePayload = {
      rideId: ride.id,
      id: ride.id,
      passengerName: ride.passenger?.fullName || 'Passageiro',
      passengerPhoto: ride.passenger?.profilePicture,
      passengerRating: Number(ride.passenger?.ratingAverage || 5.0),
      originAddress: ride.originAddress,
      originLat: Number(ride.originLat),
      originLng: Number(ride.originLng),
      pickupLat: Number(ride.originLat),
      pickupLng: Number(ride.originLng),
      destinationAddress: ride.destinationAddress,
      destinationLat: Number(ride.destinationLat),
      destinationLng: Number(ride.destinationLng),
      
      distanceKm: Number(ride.distanceKm || 0),
      estimatedDistance: Number(ride.distanceKm || 0),
      durationMin: Number(ride.durationMin || 0),

      pickupReferencePoint: (ride as any).pickupReferencePoint || ride.referencePoint || '',
      dropoffReferencePoint: (ride as any).dropoffReferencePoint || '',
      extraStopReferencePoint: (ride as any).extraStopReferencePoint || '',
      referencePoint: ride.referencePoint || '',

      priceXof: Number(ride.priceXof),
      estimatedPrice: Number(ride.priceXof),
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
      }).catch((err: any) => console.warn(`⚠️ [RIDE OFFER CREATION FAIL] Driver: ${driver.id}`, err?.message));

      // 🟢 EMISSÃO MULTI-SALAS PARA GARANTIR CHEGADA AO SOCKET NO MOBILE
      const driverRooms = [
        driver.id,
        `driver_${driver.id}`,
        `driver:${driver.id}`,
        `user_${driver.id}`
      ];

      driverRooms.forEach(room => {
        safeSocketEmit(room, 'ride:new_request', {
          ...ridePayload,
          isQueuedOffer: false
        });
        safeSocketEmit(room, 'ride:offer', ridePayload);
      });

      if (driver.deviceToken) {
        sendPushNotification(
          driver.deviceToken,
          '🚗 Nova Corrida Solicitada!',
          `Ganho estimado: ${ride.priceXof} XOF (${ride.distanceKm} km). Toque para aceitar.`,
          { type: 'NEW_RIDE_REQUEST', rideId: ride.id, isQueuedOffer: false },
          PUSH_CHANNELS.NEW_RIDE_ALARM
        ).catch(() => null);
      }
    }
  } catch (error) {
    console.error('💥 [RIDE DISPATCH ERROR] Falha ao disparar notificações de nova corrida:', error);
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

export async function createRideAndInitiateEscrow(passengerId: string, data: {
  originLat: number; originLng: number; destinationLat: number; destinationLng: number;
  requestedVehicleType: VehicleType | string; serviceType: ServiceType | string;
  originAddress?: string; destinationAddress?: string; 
  referencePoint?: string;
  pickupReferencePoint?: string;
  dropoffReferencePoint?: string;
  stops?: Array<{ address: string; lat: number; lng: number; status?: string; referencePoint?: string }>;
  paymentMethod?: PaymentMethod | string;
  idempotencyKey?: string;
  estimatedPrice?: number;
  estimatedDistance?: number;
}) {
  const { 
    originLat, originLng, destinationLat, destinationLng, 
    requestedVehicleType, serviceType, originAddress, destinationAddress, 
    referencePoint, pickupReferencePoint, dropoffReferencePoint,
    stops = [], estimatedPrice, estimatedDistance
  } = data;

  if (!isValidCoordinate(originLat, originLng) || !isValidCoordinate(destinationLat, destinationLng)) {
    throw new Error('BAD_REQUEST: Coordenadas geográficas de origem ou destino inválidas.');
  }

  if (!isWithinGuineaBissau(originLat, originLng)) {
    throw new Error('OUT_OF_SERVICE_AREA: O serviço Nô Bai 245 está disponível apenas no território da Guiné-Bissau.');
  }

  const passenger = await prisma.passenger.findUnique({ 
    where: { id: passengerId },
    select: { id: true, status: true, currentRideId: true, paymentProvider: true, paymentAccountNumber: true, phone: true }
  });

  if (!passenger || passenger.status !== 'ACTIVE') {
    throw new Error('UNAUTHORIZED: Conta de passageiro inexistente, inativa ou suspensa.');
  }

  if (passenger.currentRideId) {
    const activeRide = await prisma.ride.findUnique({
      where: { id: passenger.currentRideId },
      select: { id: true, status: true, createdAt: true }
    });

    const isFinished = !activeRide || ['CANCELLED', 'COMPLETED'].includes(activeRide.status);
    const isStaleSearching = activeRide && ['SEARCHING', 'AWAITING_PAYMENT', 'PENDING'].includes(activeRide.status) && 
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
      throw new Error('ACTIVE_RIDE_EXISTS: Passageiro já possui corrida ativa em andamento.');
    }
  }

  const rawMethod = data.paymentMethod || passenger.paymentProvider || 'CASH';
  const chosenMethod = String(rawMethod).toUpperCase().trim() as PaymentMethod;
  const isCash = chosenMethod === PaymentMethod.CASH;

  if (!isCash) {
    const paymentPhone = passenger.paymentAccountNumber || passenger.phone || (IS_MOCK_MODE ? '245955000000' : null);
    if (!paymentPhone || (!IS_MOCK_MODE && !isValidBissauPhone(paymentPhone))) {
      throw new Error('PAYMENT_REQUIRED: Conta Mobile Money não configurada ou número inválido (+245).');
    }
  }

  const routeWaypoints = stops.map(s => ({ lat: s.lat, lng: s.lng }));
  const routeCalc = await getRouteDistanceAndDuration(
    originLat, originLng, destinationLat, destinationLng, routeWaypoints
  );

  const distanceKm = (estimatedDistance && estimatedDistance > 0) ? Number(estimatedDistance.toFixed(2)) : routeCalc.distanceKm;
  const durationMin = routeCalc.durationMin;
  
  const { totalPrice: calculatedPrice } = await calculateRidePrice(
    distanceKm, durationMin, requestedVehicleType as VehicleType, serviceType as ServiceType
  );
  
  const priceXof = (estimatedPrice && estimatedPrice > 0) 
    ? Math.round(estimatedPrice) 
    : calculatedPrice;
  
  const initialStatus = isCash ? RideStatus.SEARCHING : RideStatus.AWAITING_PAYMENT;
  const initialTxStatus = isCash ? TransactionStatus.PENDING : TransactionStatus.HELD_IN_ESCROW;
  
  const startOtp = Math.floor(1000 + Math.random() * 9000).toString();
  const finishOtp = Math.floor(1000 + Math.random() * 9000).toString();

  const formattedStops = stops.map((s, idx) => ({
    ...s,
    order: idx + 1,
    status: s.status || 'PENDING',
    referencePoint: s.referencePoint || (idx === stops.length - 1 ? dropoffReferencePoint : null)
  }));

  const { ride, transaction } = await prisma.$transaction(async (tx) => {
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

    const newTx = await tx.transaction.create({
      data: {
        passengerId, 
        rideId: newRide.id, 
        type: TransactionType.RIDE_PAYMENT,
        status: initialTxStatus, 
        amount: priceXof,
        reference: `PAY-${newRide.id.slice(0, 8)}-${Date.now()}`, 
        paymentMethod: chosenMethod,
        idempotencyKey: data.idempotencyKey
      }
    });

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

    return { ride: newRide, transaction: newTx };
  });

  if (isCash) {
    return { success: true, pendingVerification: false, ride };
  }

  const paymentPhone = passenger.paymentAccountNumber || passenger.phone!;

  try {
    const chargeResult = await chargePassengerMobileMoney({
      phone: paymentPhone,
      amount: priceXof,
      provider: chosenMethod,
      rideId: ride.id,
      transactionId: transaction.id
    });

    if (!chargeResult.success) {
      throw new Error(chargeResult.details || 'Falha ao gerar cobrança no Gateway.');
    }

    return { 
      success: true, 
      pendingVerification: true, 
      ride, 
      ussdCommand: chargeResult.ussdCommand,
      targetPhone: chargeResult.targetPhone,
      amount: chargeResult.amount,
      provider: chargeResult.provider,
      instructions: chargeResult.instructions
    };
  } catch (error: any) {
    if (ride?.id && transaction?.id) {
      await prisma.$transaction([
        prisma.ride.update({ where: { id: ride.id }, data: { status: RideStatus.CANCELLED, cancellationReason: 'Gateway de pagamento indisponível' } }),
        prisma.transaction.update({ where: { id: transaction.id }, data: { status: TransactionStatus.FAILED, failureReason: error.message } }),
        prisma.passenger.update({ where: { id: passengerId }, data: { currentRideId: null } })
      ]).catch(() => null);
    }
    throw new Error('Não foi possível realizar a solicitação via Mobile Money. Tente novamente.');
  }
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

  return places.map(place => ({
    id: place.id,
    name: place.name,
    popularName: place.popularName,
    neighborhoodName: place.neighborhood?.name || 'Bissau',
    latitude: place.latitude,
    longitude: place.longitude,
    referenceNotes: place.referenceNotes
  }));
}

// -----------------------------------------------------------------------------
// 2. ACEITAR CORRIDA (COM AUTO-LIMPEZA E EMISSÃO UNIFICADA)
// -----------------------------------------------------------------------------
export async function acceptRideLogic(rideId: string, driverId: string) {
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver || !driver.isOnline || driver.status !== 'APPROVED') {
    throw new Error('DRIVER_UNAVAILABLE: Motorista indisponível ou conta não aprovada.');
  }

  if (driver.currentRideId && driver.currentRideId !== rideId) {
    const currentActiveRide = await prisma.ride.findUnique({
      where: { id: driver.currentRideId },
      select: { id: true, status: true, updatedAt: true }
    });

    const isStuckOrFinished = 
      !currentActiveRide || 
      ['CANCELLED', 'COMPLETED', 'SEARCHING'].includes(currentActiveRide.status) ||
      (Date.now() - new Date(currentActiveRide.updatedAt).getTime() > 30 * 60 * 1000);

    if (isStuckOrFinished) {
      // ✅ Corrigido para bater 100% com o schema.prisma:
if (currentActiveRide && !['CANCELLED', 'COMPLETED'].includes(currentActiveRide.status)) {
  await prisma.ride.update({
    where: { id: driver.currentRideId },
    data: { status: RideStatus.CANCELLED, cancellationReason: 'AUTO_CLEANUP_ORPHANED_RIDE' }
  }).catch(() => null);
}

      await prisma.driver.update({
        where: { id: driverId },
        data: { currentRideId: null, isAvailable: true }
      });
    } else {
      throw new Error('DRIVER_BUSY: Você já possui uma corrida em andamento.');
    }
  }

  const ride = await prisma.ride.findUnique({ where: { id: rideId } });
  if (!ride || ride.status !== RideStatus.SEARCHING) {
    throw new Error('RIDE_UNAVAILABLE: Corrida indisponível ou já aceita por outro motorista.');
  }

  if (ride.paymentMethod === PaymentMethod.CASH) {
    const currentBalance = Number(driver.walletBalance || 0);
    if (currentBalance < MIN_DRIVER_BALANCE_FOR_CASH) {
      throw new Error('INSUFFICIENT_DRIVER_BALANCE: Seu saldo de comissões está abaixo do mínimo exigido (1.000 XOF).');
    }
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
      throw new Error('RIDE_ALREADY_TAKEN: Esta corrida acabou de ser aceita por outro motorista.');
    }

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

  console.log(`🚗 [RIDE ACCEPT] Motorista "${result.driver?.fullName}" aceitou a corrida ID: ${result.id}`);

  const fullPayload = {
    success: true,
    rideId: result.id,
    status: targetStatus,
    ride: result,
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
    priceXof: Number(result.priceXof || 0),
    distanceKm: Number(result.distanceKm || 0),
    durationMin: Number(result.durationMin || 0),
    originAddress: result.originAddress,
    destinationAddress: result.destinationAddress,
    pickupLat: Number(result.originLat),
    pickupLng: Number(result.originLng),
    destinationLat: Number(result.destinationLat),
    destinationLng: Number(result.destinationLng),
    pickupReferencePoint: (result as any).pickupReferencePoint || result.referencePoint || ''
  };

  const allRooms = [
    result.id,
    result.passengerId,
    `passenger_${result.passengerId}`,
    `passenger:${result.passengerId}`,
    `user_${result.passengerId}`,
    result.driverId!,
    `driver_${result.driverId}`,
    `driver:${result.driverId}`,
    `user_${result.driverId}`
  ];

  allRooms.forEach(room => {
    safeSocketEmit(room, 'ride:accepted', fullPayload);
    safeSocketEmit(room, 'driver:accept_ride_success', fullPayload);
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

  return result;
}

export const acceptRide = acceptRideLogic;

// -----------------------------------------------------------------------------
// 3. CHEGADA DO MOTORISTA
// -----------------------------------------------------------------------------
export async function driverArrivedLogic(rideId: string, driverId: string) {
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

  console.log(`📍 [RIDE LOG - ARRIVED] Motorista chegou ao local de embarque da corrida ID: ${rideId}`);

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
// 4. INÍCIO DA VIAGEM
// -----------------------------------------------------------------------------
export async function startRideLogic(rideId: string, driverId: string, otpInput: string) {
  const ride = await prisma.ride.findUnique({ 
    where: { id: rideId },
    include: { passenger: { select: { id: true, deviceToken: true } } }
  });
  if (!ride || ride.driverId !== driverId) throw new Error('UNAUTHORIZED: Operação não autorizada.');

  const cleanOtpInput = String(otpInput || '').trim().padStart(4, '0');
  const cleanStartOtp = String(ride.startOtp || '').trim().padStart(4, '0');

  if (cleanStartOtp && cleanStartOtp !== cleanOtpInput) {
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

  const startPayload = { 
    rideId: ride.id, 
    status: 'IN_PROGRESS',
    originAddress: ride.originAddress,
    destinationAddress: ride.destinationAddress,
    distanceKm: Number(ride.distanceKm || 0)
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
// 5. PROXIMIDADE DO MOTORISTA
// -----------------------------------------------------------------------------
export async function notifyDriverNearbyIfClose(rideId: string, distanceMeters: number) {
  if (distanceMeters > 300) return;

  const ride = await prisma.ride.findUnique({ 
    where: { id: rideId },
    include: { passenger: { select: { deviceToken: true } } }
  });
  if (!ride || ride.status !== RideStatus.ACCEPTED) return;

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
// 6. FINALIZAÇÃO DA CORRIDA E LIQUIDAÇÃO
// -----------------------------------------------------------------------------
export async function finalizeRideAndCharge(
  rideId: string, 
  finalLat: number, 
  finalLng: number,
  finishOtpInput?: string
): Promise<FinalizeRideResult> {
  if (!isValidCoordinate(finalLat, finalLng)) {
    throw new Error('INVALID_COORDINATES: Coordenadas finais de desembarque inválidas.');
  }

  const ride = await prisma.ride.findUnique({
    where: { id: rideId }, 
    include: { driver: true, passenger: true, paymentTransaction: true }
  });

  if (!ride || !ride.driver || !ride.passenger) {
    throw new Error('NOT_FOUND: Dados completos da corrida não localizados.');
  }
  
  if (ride.status === RideStatus.COMPLETED || ride.status === RideStatus.CANCELLED) {
    throw new Error('RIDE_FINISHED: A corrida já foi finalizada ou cancelada anteriormente.');
  }

  const rideFinishOtp = (ride as any).finishOtp;
  if (ride.serviceType === ServiceType.DELIVERY || rideFinishOtp) {
    const cleanInput = String(finishOtpInput || '').trim().padStart(4, '0');
    const cleanDbOtp = String(rideFinishOtp || '').trim().padStart(4, '0');

    if (cleanDbOtp && cleanDbOtp !== cleanInput) {
      throw new Error('INVALID_OTP: O código PIN de confirmação informado está incorreto.');
    }
  }

  const calculatedFare = Math.round(Number(ride.priceXof || 0));
  const distanceKm = Number(ride.distanceKm || 0.1);

  const tariff = await prisma.tariffConfig.findUnique({
    where: { vehicleType_serviceType: { vehicleType: ride.requestedVehicleType, serviceType: ride.serviceType } }
  }).catch(() => null);

  const commissionRate = tariff ? Number(tariff.commissionRate) / 100 : 0.15;
  const platformFee = Math.round(calculatedFare * commissionRate);
  const driverEarnings = calculatedFare - platformFee;
  const isCash = ride.paymentMethod === PaymentMethod.CASH;

  let payoutTransactionId = '';
  let commissionTransactionId = '';
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
    }).catch(() => null);

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

    if (isCash) {
      const currentDriverBalance = Number(ride.driver?.walletBalance || 0);
      finalDriverBalance = currentDriverBalance - platformFee;

      const shouldStayOnline = finalDriverBalance >= MIN_DRIVER_BALANCE_FOR_ONLINE;
      if (!shouldStayOnline) {
        wasForcedOfflineDueToBalance = true;
      }

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
          paymentMethod: PaymentMethod.CASH,
          amount: platformFee,
          reference: `COMM-CASH-${ride.id.slice(0, 8)}-${Date.now()}`,
          description: `Comissão da taxa de plataforma (${Math.round(commissionRate * 100)}%) sobre corrida em dinheiro de ${calculatedFare} XOF`
        }
      });
      commissionTransactionId = commTx.id;
    } else {
      await tx.transaction.updateMany({
        where: {
          rideId: ride.id,
          type: TransactionType.RIDE_PAYMENT,
          status: { in: [TransactionStatus.HELD_IN_ESCROW, TransactionStatus.COMPLETED] }
        },
        data: { status: TransactionStatus.COMPLETED }
      });

      if ((ride as any).paymentTransaction?.id) {
        await (tx as any).paymentTransaction.update({
          where: { id: (ride as any).paymentTransaction.id },
          data: { status: TransactionStatus.PROCESSING }
        }).catch(() => null);
      }

      await tx.driver.update({ 
        where: { id: ride.driverId! }, 
        data: { 
          currentRideId: nextCurrentRideId, 
          isAvailable: isDriverAvailable 
        } 
      });

      const payoutTx = await tx.transaction.create({
        data: {
          rideId: ride.id, 
          driverId: ride.driverId, 
          type: TransactionType.DRIVER_PAYOUT, 
          status: IS_MOCK_MODE ? TransactionStatus.COMPLETED : TransactionStatus.PENDING, 
          amount: driverEarnings, 
          reference: `PAYOUT-${ride.id.slice(0, 8)}-${Date.now()}`, 
          paymentMethod: ride.paymentMethod
        }
      });
      payoutTransactionId = payoutTx.id;

      const commissionTx = await tx.transaction.create({
        data: {
          rideId: ride.id, 
          type: TransactionType.COMMISSION_FEE, 
          status: IS_MOCK_MODE ? TransactionStatus.COMPLETED : TransactionStatus.PENDING, 
          amount: platformFee, 
          reference: `FEE-${ride.id.slice(0, 8)}-${Date.now()}`
        }
      });
      commissionTransactionId = commissionTx.id;
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

  console.log(`🏁 [RIDE LOG - COMPLETED] Corrida ID: ${rideId} finalizada. Valor: ${calculatedFare} XOF. Saldo motorista: ${finalDriverBalance} XOF`);

  const completedPayload = {
    rideId: ride.id,
    status: 'COMPLETED',
    priceXof: calculatedFare,
    fareXOF: calculatedFare,
    distanceKm,
    driverWalletBalance: finalDriverBalance,
    forcedOffline: wasForcedOfflineDueToBalance
  };

  const allRooms = [
    ride.id,
    ride.passengerId,
    `passenger_${ride.passengerId}`,
    `passenger:${ride.passengerId}`,
    `user_${ride.passengerId}`,
    ride.driverId!,
    `driver_${ride.driverId}`,
    `driver:${ride.driverId}`,
    `user_${ride.driverId}`
  ];

  allRooms.forEach(room => {
    safeSocketEmit(room, 'ride:completed', completedPayload);
    safeSocketEmit(room, 'ride:finished', completedPayload);
  });

  const driverRooms = [
    ride.driverId!, 
    `driver_${ride.driverId}`, 
    `driver:${ride.driverId}`,
    `user_${ride.driverId}`
  ];
  
  driverRooms.forEach(room => {
    safeSocketEmit(room, 'wallet:updated', { balance: finalDriverBalance });
    if (wasForcedOfflineDueToBalance) {
      safeSocketEmit(room, 'driver:forced_offline', { 
        reason: 'INSUFFICIENT_BALANCE', 
        message: 'Seu saldo da comissão é inferior a 1.000 XOF. Recarregue a carteira para ficar online.' 
      });
    }
  });

  if (ride.passenger?.deviceToken) {
    sendPushNotification(
      ride.passenger.deviceToken,
      '🏁 Viagem Concluída!',
      `Você chegou ao seu destino. Valor total: ${calculatedFare} XOF. Avalie seu motorista!`,
      { type: 'RIDE_COMPLETED', rideId: ride.id, priceXof: calculatedFare, fareXOF: calculatedFare, status: 'COMPLETED' },
      PUSH_CHANNELS.RIDE_UPDATE
    ).catch(err => console.error('❌ Erro no Push de finalização:', err));
  }

  const provider = (ride.paymentMethod || PaymentMethod.ORANGE_MONEY).toString().toUpperCase();
  const driverPhone = (ride.driver as any).paymentAccountNumber || ride.driver.phone;

  if (!IS_MOCK_MODE && driverEarnings > 0 && driverPhone && payoutTransactionId) {
    try {
      const payoutResult = await executeRideDisbursement({
        rideId: ride.id, driverId: ride.driverId!, amount: driverEarnings,
        phone: driverPhone, provider: provider as any, transactionId: payoutTransactionId
      });

      if (payoutResult.success) {
        await prisma.transaction.update({ 
          where: { id: payoutTransactionId }, 
          data: { status: TransactionStatus.COMPLETED, externalRef: payoutResult.providerRef || null } 
        });
      }
    } catch (err: any) {
      console.warn(`⚠️ [REPASSE MOTORISTA] Adicionado à fila: ${err.message}`);
      await enqueuePayoutJob({
        transactionId: payoutTransactionId, rideId: ride.id, driverId: ride.driverId!,
        amountXOF: driverEarnings, phone: driverPhone, provider
      }).catch(() => null);
    }
  }

  return { 
    success: true, 
    fareXOF: calculatedFare, 
    driverEarnings, 
    platformFee, 
    distanceKm, 
    paymentMethod: isCash ? 'CASH' : String(ride.paymentMethod), 
    hasQueuedRide: !!queuedRideToPromote, 
    nextRideId: queuedRideToPromote?.id || null 
  };
}

// -----------------------------------------------------------------------------
// 7. CANCELAMENTO DE CORRIDA
// -----------------------------------------------------------------------------
export async function cancelRideLogic(
  rideId: string, 
  userId: string, 
  userType: 'PASSENGER' | 'DRIVER', 
  reason?: string,
  isReportedProblem: boolean = false
) {
  const ride = await prisma.ride.findUnique({ 
    where: { id: rideId }, 
    include: { passenger: true, driver: true, paymentTransaction: true } 
  });
  if (!ride) throw new Error('NOT_FOUND: Corrida não encontrada.');

  if (ride.status === RideStatus.IN_PROGRESS && !isReportedProblem) {
    throw new Error('RIDE_IN_PROGRESS: A viagem já está em andamento. Cancele apenas via suporte ou emergência.');
  }

  const isCash = ride.paymentMethod === PaymentMethod.CASH;

  const originalPayment = await prisma.transaction.findFirst({
    where: { 
      rideId, 
      type: TransactionType.RIDE_PAYMENT, 
      status: { in: [TransactionStatus.HELD_IN_ESCROW, TransactionStatus.COMPLETED, TransactionStatus.PENDING] } 
    }
  });

  const now = new Date();
  const minutesSinceAcceptance = ride.acceptedAt 
    ? (now.getTime() - new Date(ride.acceptedAt).getTime()) / (1000 * 60) 
    : 0;

  const isLateCancellation = userType === 'PASSENGER' && (ride.status === RideStatus.ARRIVED || minutesSinceAcceptance >= 2);
  const penaltyAmount = isLateCancellation ? CANCELLATION_PENALTY_XOF : 0; 
  const refundAmount = (!isCash && originalPayment) ? Math.max(0, Number(ride.priceXof || 0) - penaltyAmount) : 0;

  const cleanReason = reason || 'Sem justificativa informada';
  const refundPhone = ride.passenger.paymentAccountNumber || ride.passenger.phone;

  let refundTransactionId = '';

  const dbResult = await prisma.$transaction(async (tx) => {
    const updatedRide = await tx.ride.updateMany({
      where: { id: rideId, version: ride.version, status: { notIn: [RideStatus.COMPLETED, RideStatus.CANCELLED] } },
      data: { status: RideStatus.CANCELLED, cancellationReason: cleanReason, cancelledBy: userType as UserType, version: { increment: 1 } }
    });

    if (updatedRide.count === 0) {
      throw new Error('STATE_CONFLICT: A corrida já foi alterada por outra operação.');
    }

    if ((ride as any).paymentTransaction?.id) {
      await (tx as any).paymentTransaction.update({
        where: { id: (ride as any).paymentTransaction.id },
        data: { status: TransactionStatus.PROCESSING }
      }).catch(() => null);
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

    if (originalPayment) {
      await tx.transaction.update({
        where: { id: originalPayment.id },
        data: { 
          status: isCash ? TransactionStatus.CANCELLED : TransactionStatus.REVERSED 
        }
      });
    }

    if (!isCash && refundAmount > 0 && originalPayment) {
      const refundTx = await tx.transaction.create({
        data: {
          rideId: ride.id, 
          passengerId: ride.passengerId, 
          type: TransactionType.REFUND, 
          status: IS_MOCK_MODE ? TransactionStatus.COMPLETED : TransactionStatus.PENDING,
          amount: refundAmount,
          reference: `REFUND-${ride.id.slice(0, 8)}-${Date.now()}`,
          paymentMethod: ride.paymentMethod
        }
      });
      refundTransactionId = refundTx.id;
    }

    return { appliedPenalty: penaltyAmount > 0, penaltyAmount };
  });

  if (!isCash && refundAmount > 0 && refundTransactionId && refundPhone && !IS_MOCK_MODE) {
    try {
      await executeRideDisbursement({
        rideId: ride.id,
        passengerId: ride.passengerId,
        refundId: refundTransactionId,
        amount: refundAmount,
        phone: refundPhone,
        provider: ride.paymentMethod || 'ORANGE_MONEY',
        transactionId: refundTransactionId
      });
    } catch (refundErr: any) {
      await enqueueRefundJob({
        transactionId: refundTransactionId,
        rideId: ride.id,
        passengerId: ride.passengerId,
        amountXOF: refundAmount,
        phone: refundPhone,
        provider: String(ride.paymentMethod)
      }).catch(() => null);
    }
  }

  const cancelRooms = [
    ride.passengerId,
    `passenger_${ride.passengerId}`,
    `passenger:${ride.passengerId}`,
    `user_${ride.passengerId}`
  ];

  cancelRooms.forEach(room => {
    safeSocketEmit(room, 'ride:cancelled', {
      rideId: ride.id,
      cancelledBy: userType,
      reason: cleanReason
    });
  });

  if (ride.driverId) {
    const driverCancelRooms = [
      ride.driverId,
      `driver_${ride.driverId}`,
      `driver:${ride.driverId}`,
      `user_${ride.driverId}`
    ];

    driverCancelRooms.forEach(room => {
      safeSocketEmit(room, 'ride:cancelled', {
        rideId: ride.id,
        cancelledBy: userType,
        reason: cleanReason
      });
    });
  }

  return dbResult;
}

// -----------------------------------------------------------------------------
// 8. AVALIAÇÕES E MENSAGENS DE CHAT
// -----------------------------------------------------------------------------
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

      await tx.driver.update({
        where: { id: receiverId },
        data: {
          ratingAverage: Number(agg._avg.stars || 5.0),
          totalRatings: Number(agg._count.stars || 0)
        }
      });
    } else if (reviewerType === 'DRIVER') {
      const agg = await tx.rating.aggregate({
        where: { receiverId, reviewerType: UserType.DRIVER },
        _avg: { stars: true },
        _count: { stars: true }
      });

      await tx.passenger.update({
        where: { id: receiverId },
        data: {
          ratingAverage: Number(agg._avg.stars || 5.0),
          totalRatings: Number(agg._count.stars || 0)
        }
      });
    }

    return rating;
  });

  return newRating;
}

export async function notifyNewChatMessage(data: {
  rideId: string;
  senderId: string;
  senderType: 'PASSENGER' | 'DRIVER';
  senderName: string;
  message: string;
}) {
  const chatMessage = await prisma.rideChatMessage.create({
    data: {
      rideId: data.rideId,
      senderId: data.senderId,
      senderType: data.senderType as any,
      message: data.message,
      isRead: false,
    },
  });

  const ride = await prisma.ride.findUnique({
    where: { id: data.rideId },
    select: {
      id: true,
      passengerId: true,
      driverId: true,
      passenger: { select: { deviceToken: true, fullName: true, phone: true } },
      driver: { select: { deviceToken: true, fullName: true, phone: true } },
    },
  });

  if (!ride) return chatMessage;

  const messagePayload = {
    id: chatMessage.id,
    rideId: data.rideId,
    sender: data.senderType.toLowerCase(),
    senderId: data.senderId,
    senderType: data.senderType,
    senderName: data.senderName,
    text: data.message,
    message: data.message,
    createdAt: chatMessage.createdAt.toISOString(),
  };

  try {
    const io = getIo();
    if (io) {
      // 💬 Envia para TODAS as salas possíveis de passageiro e motorista
      const chatRooms = [
        data.rideId,
        ride.passengerId,
        `passenger_${ride.passengerId}`,
        `passenger:${ride.passengerId}`,
        `user_${ride.passengerId}`,
        ride.driverId || '',
        `driver_${ride.driverId}`,
        `driver:${ride.driverId}`,
        `user_${ride.driverId}`
      ].filter(Boolean);

      chatRooms.forEach(room => {
        io.to(room).emit('chat:receive_message', messagePayload);
        io.to(room).emit('chat:message', messagePayload);
        io.to(room).emit('chat:new_message', messagePayload);
      });
    }
  } catch (wsErr) {
    console.warn('⚠️ [SOCKET] Erro ao emitir evento de chat:', wsErr);
  }

  try {
    const recipientToken = data.senderType === 'DRIVER'
      ? ride.passenger?.deviceToken
      : ride.driver?.deviceToken;

    if (recipientToken) {
      sendPushNotification(
        recipientToken,
        `💬 Nova mensagem de ${data.senderName}`,
        data.message,
        { type: 'CHAT_MESSAGE', rideId: data.rideId },
        PUSH_CHANNELS.CHAT
      ).catch(() => null);
    }
  } catch (pushErr) {
    console.warn('⚠️ [PUSH] Erro ao enviar push de chat:', pushErr);
  }

  return chatMessage;
}