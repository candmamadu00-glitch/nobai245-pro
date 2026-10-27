import { 
  VehicleType, 
  ServiceType, 
  RideStatus, 
  PaymentMethod, 
  TransactionStatus, 
  TransactionType, 
  UserType,
  RideOfferStatus 
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
// HELPER PARA DISPARO DE NOVAS CORRIDAS PARA MOTORISTAS (INCLUINDO FILA)
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
        currentRideId: true,
        currentRide: {
          select: {
            destinationLat: true,
            destinationLng: true,
            status: true
          }
        }
      },
    });

    const qualifiedDrivers = [];

    for (const driver of activeDrivers) {
      if (ride.paymentMethod === 'CASH' && Number(driver.walletBalance || 0) < MIN_DRIVER_BALANCE_FOR_CASH) {
        continue;
      }

      if (driver.currentRideId) {
        const existingQueuedRide = await prisma.ride.findFirst({
          where: {
            driverId: driver.id,
            status: { in: [RideStatus.ACCEPTED, RideStatus.QUEUED] },
            id: { not: driver.currentRideId }
          }
        });

        if (existingQueuedRide) continue;
      }

      let refLat: number | null = null;
      let refLng: number | null = null;

      if (driver.isAvailable || !driver.currentRideId) {
        refLat = driver.lastLat !== null && driver.lastLat !== undefined ? Number(driver.lastLat) : null;
        refLng = driver.lastLng !== null && driver.lastLng !== undefined ? Number(driver.lastLng) : null;
      } else if (driver.currentRide?.destinationLat && driver.currentRide?.destinationLng) {
        refLat = Number(driver.currentRide.destinationLat);
        refLng = Number(driver.currentRide.destinationLng);
      }

      if (refLat === null || refLng === null) {
        refLat = driver.lastLat !== null && driver.lastLat !== undefined ? Number(driver.lastLat) : null;
        refLng = driver.lastLng !== null && driver.lastLng !== undefined ? Number(driver.lastLng) : null;
      }

      if (refLat === null || refLng === null || isNaN(refLat) || isNaN(refLng)) continue;

      const distKm = calculateDistance(pLat, pLng, refLat, refLng);
      if (distKm <= 5.0) {
        qualifiedDrivers.push({
          ...driver,
          isQueuedOffer: !driver.isAvailable
        });
      }
    }

    console.log(`🔍 [RIDE DISPATCH] ${qualifiedDrivers.length} motoristas qualificados no raio de 5km.`);

    const ridePayload = {
      rideId: ride.id,
      passengerName: ride.passenger?.fullName || 'Passageiro',
      passengerPhoto: ride.passenger?.profilePicture,
      passengerRating: Number(ride.passenger?.ratingAverage || 5.0),
      originAddress: ride.originAddress,
      originLat: Number(ride.originLat),
      originLng: Number(ride.originLng),
      destinationAddress: ride.destinationAddress,
      destinationLat: Number(ride.destinationLat),
      destinationLng: Number(ride.destinationLng),
      priceXof: Number(ride.priceXof),
      serviceType: ride.serviceType,
      paymentMethod: ride.paymentMethod,
      stops: ride.stops || [],
    };

    const offerExpiresAt = new Date(Date.now() + 15000);

    for (const driver of qualifiedDrivers) {
      await prisma.rideOffer.upsert({
        where: { rideId_driverId: { rideId: ride.id, driverId: driver.id } },
        update: { status: RideOfferStatus.PENDING, expiresAt: offerExpiresAt },
        create: { rideId: ride.id, driverId: driver.id, status: RideOfferStatus.PENDING, expiresAt: offerExpiresAt }
      }).catch(err => console.warn(`⚠️ [RIDE OFFER CREATION FAIL] Driver: ${driver.id}`, err?.message));

      safeSocketEmit(`driver_${driver.id}`, 'ride:new_request', {
        ...ridePayload,
        isQueuedOffer: driver.isQueuedOffer
      });

      if (driver.deviceToken) {
        const title = driver.isQueuedOffer ? '🚗 Próxima Corrida (Fila) Solicitada!' : '🚗 Nova Corrida Solicitada!';
        sendPushNotification(
          driver.deviceToken,
          title,
          `Ganho estimado: ${ride.priceXof} XOF. Toque para aceitar.`,
          { type: 'NEW_RIDE_REQUEST', rideId: ride.id, isQueuedOffer: driver.isQueuedOffer },
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
  const surgeMultiplier = dbTariff ? Number(dbTariff.surgeMultiplier || 1.00) : 1.00;

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
  originAddress?: string; destinationAddress?: string; referencePoint?: string;
  stops?: Array<{ address: string; lat: number; lng: number; status: string }>;
  paymentMethod?: PaymentMethod | string;
  idempotencyKey?: string;
  estimatedPrice?: number;
}) {
  const { 
    originLat, originLng, destinationLat, destinationLng, 
    requestedVehicleType, serviceType, originAddress, destinationAddress, referencePoint, stops = [],
    estimatedPrice 
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
      throw new Error('ACTIVE_RIDE_EXISTS: Passageiro já possui corrida ativa em andamento.');
    }
  }

  const rawMethod = data.paymentMethod || passenger.paymentProvider || 'CASH';
  const chosenMethod = String(rawMethod).toUpperCase().trim();
  const isCash = chosenMethod === 'CASH' || chosenMethod === 'DINHEIRO';

  if (!isCash) {
    const paymentPhone = passenger.paymentAccountNumber || passenger.phone || (IS_MOCK_MODE ? '245955000000' : null);
    if (!paymentPhone || (!IS_MOCK_MODE && !isValidBissauPhone(paymentPhone))) {
      throw new Error('PAYMENT_REQUIRED: Conta Mobile Money não configurada ou número inválido (+245).');
    }
  }

  const routeWaypoints = stops.map(s => ({ lat: s.lat, lng: s.lng }));
  const { distanceKm, durationMin } = await getRouteDistanceAndDuration(
    originLat, originLng, destinationLat, destinationLng, routeWaypoints
  );
  
  const { totalPrice: calculatedPrice } = await calculateRidePrice(
    distanceKm, durationMin, requestedVehicleType as VehicleType, serviceType as ServiceType
  );
  
  const priceXof = (estimatedPrice && estimatedPrice > 0) 
    ? Math.round(estimatedPrice) 
    : calculatedPrice;
  
  const initialStatus = (isCash || IS_MOCK_MODE) ? RideStatus.SEARCHING : RideStatus.AWAITING_PAYMENT;
  const initialTxStatus = isCash 
    ? TransactionStatus.PENDING 
    : (IS_MOCK_MODE ? TransactionStatus.HELD_IN_ESCROW : TransactionStatus.PENDING);
  
  const startOtp = Math.floor(1000 + Math.random() * 9000).toString();
  const finishOtp = Math.floor(1000 + Math.random() * 9000).toString();

  const { ride, transaction } = await prisma.$transaction(async (tx) => {
    const newRide = await tx.ride.create({
      data: {
        passengerId, 
        serviceType: (serviceType || 'RIDE') as ServiceType,
        requestedVehicleType: (requestedVehicleType || 'PARTICULAR') as VehicleType,
        paymentMethod: chosenMethod as PaymentMethod, 
        originAddress: originAddress || '',
        originLat, originLng, 
        destinationAddress: destinationAddress || '',
        destinationLat, destinationLng, 
        referencePoint: referencePoint || null,
        stops: stops.length > 0 ? stops : undefined,
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
        passengerId, rideId: newRide.id, type: TransactionType.RIDE_PAYMENT,
        status: initialTxStatus, amount: priceXof,
        reference: `PAY-${newRide.id.slice(0, 8)}-${Date.now()}`, paymentMethod: chosenMethod as PaymentMethod,
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

  if (isCash || IS_MOCK_MODE) {
    return { success: true, pendingVerification: false, ride };
  }

  const paymentPhone = passenger.paymentAccountNumber || passenger.phone!;

  try {
    const chargeResult = await chargePassengerMobileMoney({
      phone: paymentPhone,
      amount: priceXof,
      provider: chosenMethod as PaymentMethod,
      rideId: ride.id,
      transactionId: transaction.id
    });

    if (!chargeResult.success) {
      throw new Error(chargeResult.details || 'Falha de comunicação com a operadora Mobile Money.');
    }

    return { 
      success: true, 
      pendingVerification: true, 
      ride, 
      providerRef: chargeResult.providerRef, 
      paymentUrl: chargeResult.paymentUrl 
    };
  } catch (error: any) {
    if (ride?.id && transaction?.id) {
      try {
        await prisma.$transaction([
          prisma.ride.update({ where: { id: ride.id }, data: { status: RideStatus.CANCELLED, cancellationReason: 'Gateway de pagamento indisponível' } }),
          prisma.transaction.update({ where: { id: transaction.id }, data: { status: TransactionStatus.FAILED, failureReason: error.message } }),
          prisma.passenger.update({ where: { id: passengerId }, data: { currentRideId: null } })
        ]);
      } catch (rollbackErr) {
        console.error('❌ Falha ao desfazer estado de corrida após erro de pagamento:', rollbackErr);
      }
    }
    throw new Error('Não foi possível realizar a cobrança via Mobile Money. Verifique o saldo do seu PIN/Carteira.');
  }
}

// -----------------------------------------------------------------------------
// 1. ACEITAR CORRIDA (COM MULTI-BROADCAST E PUSH)
// -----------------------------------------------------------------------------
export async function acceptRideLogic(rideId: string, driverId: string) {
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver || !driver.isOnline || driver.status !== 'APPROVED') {
    throw new Error('DRIVER_UNAVAILABLE: Motorista indisponível ou conta não aprovada.');
  }

  const ride = await prisma.ride.findUnique({ where: { id: rideId } });
  if (!ride || ride.status !== RideStatus.SEARCHING) {
    throw new Error('RIDE_UNAVAILABLE: Corrida indisponível ou já aceita por outro motorista.');
  }

  if (ride.paymentMethod === PaymentMethod.CASH) {
    const currentBalance = Number(driver.walletBalance || 0);
    if (currentBalance < MIN_DRIVER_BALANCE_FOR_CASH) {
      throw new Error('INSUFFICIENT_DRIVER_BALANCE: Seu saldo de comissões está negativo.');
    }
  }

  let targetStatus: RideStatus = RideStatus.ACCEPTED;

  if (driver.currentRideId) {
    const existingQueue = await prisma.ride.findFirst({
      where: {
        driverId,
        status: { in: [RideStatus.ACCEPTED, RideStatus.QUEUED] },
        id: { not: driver.currentRideId }
      }
    });

    if (existingQueue) {
      throw new Error('DRIVER_QUEUE_FULL: Você já possui uma corrida em andamento e outra agendada na fila.');
    }

    targetStatus = RideStatus.QUEUED;
  }

  const result = await prisma.$transaction(async (tx) => {
    if (!driver.currentRideId) {
      await tx.driver.update({
        where: { id: driverId },
        data: { currentRideId: rideId, isAvailable: false }
      });
    }

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

    await tx.rideOffer.updateMany({
      where: { rideId, driverId },
      data: { status: RideOfferStatus.ACCEPTED }
    }).catch(() => null);

    await tx.rideEventLog.create({
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

  console.log(`🚗 [RIDE LOG - ACCEPT] Motorista "${result.driver?.fullName}" aceitou a corrida ID: ${result.id} (Status: ${targetStatus})`);

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
    priceXof: Number(result.priceXof || 0),
    isQueuedRide: targetStatus === RideStatus.QUEUED
  };

  // 📣 MULTI-BROADCAST SOCKET COMPLETO
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

  // 🔔 PUSH NOTIFICATION DE ACEITE
  if (result.passenger?.deviceToken) {
    const pushMsg = targetStatus === RideStatus.QUEUED 
      ? `O motorista ${result.driver?.fullName || 'parceiro'} aceitou sua corrida! Ele concluirá a viagem atual antes de ir até você.`
      : `O motorista ${result.driver?.fullName || 'parceiro'} aceitou sua corrida e está a caminho!`;

    sendPushNotification(
      result.passenger.deviceToken,
      '✅ Corrida Aceita!',
      pushMsg,
      { type: 'RIDE_ACCEPTED', rideId: result.id, status: targetStatus },
      PUSH_CHANNELS.RIDE_UPDATE
    ).catch(err => console.error('❌ Erro no Push de Aceite:', err));
  }

  return {
    ...result,
    passenger: result.passenger ? { ...result.passenger, phone: maskPhoneNumber(result.passenger.phone) } : null,
    driver: result.driver ? { ...result.driver, phone: maskPhoneNumber(result.driver.phone) } : null
  };
}

export const acceptRide = acceptRideLogic;

// -----------------------------------------------------------------------------
// 2. CHEGADA DO MOTORISTA (COM MULTI-BROADCAST E PUSH COM OTP)
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

    await tx.rideEventLog.create({
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

  // 📣 MULTI-BROADCAST DUPLO (EVENTOS: 'ride:arrived' E 'ride:driver_arrived')
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

  // 🔔 PUSH NOTIFICATION DE CHEGADA
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
// 3. INÍCIO DA VIAGEM (COM MULTI-BROADCAST E PUSH)
// -----------------------------------------------------------------------------
export async function startRideLogic(rideId: string, driverId: string, otpInput: string) {
  const ride = await prisma.ride.findUnique({ 
    where: { id: rideId },
    include: { passenger: { select: { id: true, deviceToken: true } } }
  });
  if (!ride || ride.driverId !== driverId) throw new Error('UNAUTHORIZED: Operação não autorizada.');

  const cleanOtpInput = (otpInput || '').toString().trim();
  const cleanStartOtp = (ride.startOtp || '').toString().trim();

  if (cleanStartOtp && cleanStartOtp !== cleanOtpInput) {
    throw new Error('INVALID_OTP: Código OTP informado está incorreto.');
  }

  const updatedRide = await prisma.$transaction(async (tx) => {
    const updatedRes = await tx.ride.update({
      where: { id: rideId },
      data: { status: RideStatus.IN_PROGRESS, startedAt: new Date(), version: { increment: 1 } }
    });

    await tx.rideEventLog.create({
      data: {
        rideId,
        status: RideStatus.IN_PROGRESS,
        triggeredBy: UserType.DRIVER,
        userId: driverId
      }
    });

    return updatedRes;
  });

  console.log(`🚖 [RIDE LOG - STARTED] Viagem iniciada na corrida ID: ${rideId}`);

  const startPayload = { rideId: ride.id, status: 'IN_PROGRESS' };

  // 📣 MULTI-BROADCAST SOCKET
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

  // 🔔 PUSH NOTIFICATION DE INÍCIO
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
// 5. FINALIZAÇÃO DA CORRIDA E LIQUIDAÇÃO (COM MULTI-BROADCAST E PUSH)
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
    include: { driver: true, passenger: true }
  });

  if (!ride || !ride.driver || !ride.passenger) {
    throw new Error('NOT_FOUND: Dados completos da corrida não localizados.');
  }
  
  if (ride.status === RideStatus.COMPLETED || ride.status === RideStatus.CANCELLED) {
    throw new Error('RIDE_FINISHED: A corrida já foi finalizada anteriormente.');
  }

  const rideFinishOtp = ride.finishOtp;
  if (ride.serviceType === ServiceType.DELIVERY || rideFinishOtp) {
    const cleanInput = (finishOtpInput || '').toString().trim();
    const cleanDbOtp = (rideFinishOtp || '').toString().trim();

    if (cleanDbOtp && cleanDbOtp !== cleanInput) {
      throw new Error('INVALID_OTP: O código PIN de confirmação de entrega informado está incorreto.');
    }
  }

  const calculatedFare = Math.round(Number(ride.priceXof || 0));
  const { distanceKm } = await getRouteDistanceAndDuration(Number(ride.originLat), Number(ride.originLng), finalLat, finalLng);
  
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
      throw new Error('CONCURRENCY_ERROR: Ocorreu um conflito ao tentar finalizar a corrida.');
    }

    await tx.rideEventLog.create({
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
        status: { in: [RideStatus.ACCEPTED, RideStatus.QUEUED] },
        id: { not: ride.id }
      }
    });

    const nextCurrentRideId = queuedRideToPromote ? queuedRideToPromote.id : null;
    const isDriverAvailable = !queuedRideToPromote;

    if (queuedRideToPromote && queuedRideToPromote.status === RideStatus.QUEUED) {
      await tx.ride.update({
        where: { id: queuedRideToPromote.id },
        data: { status: RideStatus.ACCEPTED }
      });
    }

    if (isCash) {
      const currentDriverBalance = Number(ride.driver?.walletBalance || 0);
      const newDriverBalance = currentDriverBalance - platformFee;

      await tx.driver.update({ 
        where: { id: ride.driverId! }, 
        data: { 
          walletBalance: newDriverBalance,
          currentRideId: nextCurrentRideId, 
          isAvailable: isDriverAvailable 
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
          balanceBefore: currentDriverBalance,
          balanceAfter: newDriverBalance,
          reference: `COMM-CASH-${ride.id.slice(0, 8)}-${Date.now()}`,
          description: `Comissão cobrada sobre corrida em dinheiro (${calculatedFare} XOF)`
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

  console.log(`🏁 [RIDE LOG - COMPLETED] Corrida ID: ${rideId} finalizada com sucesso. Valor: ${calculatedFare} XOF`);

  const completedPayload = {
    rideId: ride.id,
    status: 'COMPLETED',
    priceXof: calculatedFare,
    fareXOF: calculatedFare,
    distanceKm
  };

  // 📣 MULTI-BROADCAST DUPLO (EVENTOS: 'ride:completed' E 'ride:finished')
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

  // 🔔 PUSH NOTIFICATION DE FINALIZAÇÃO
  if (ride.passenger?.deviceToken) {
    sendPushNotification(
      ride.passenger.deviceToken,
      '🏁 Viagem Concluída!',
      `Você chegou ao seu destino. Valor total: ${calculatedFare} XOF. Avalie seu motorista!`,
      { type: 'RIDE_COMPLETED', rideId: ride.id, priceXof: calculatedFare, fareXOF: calculatedFare, status: 'COMPLETED' },
      PUSH_CHANNELS.RIDE_UPDATE
    ).catch(err => console.error('❌ Erro no Push de finalização:', err));
  }

  if (queuedRideToPromote) {
    console.log(`🔄 [RIDE LOG - QUEUE] Promovendo próxima corrida da fila ID: ${queuedRideToPromote.id}`);

    const queuedPayload = {
      rideId: queuedRideToPromote.id,
      status: 'ACCEPTED'
    };

    safeSocketEmit(ride.driverId!, 'ride:queued_now_active', queuedPayload);
    safeSocketEmit(`driver_${ride.driverId}`, 'ride:queued_now_active', queuedPayload);
    safeSocketEmit(`driver:${ride.driverId}`, 'ride:queued_now_active', queuedPayload);

    const enRoutePayload = {
      rideId: queuedRideToPromote.id,
      status: 'ACCEPTED',
      message: 'Seu motorista concluiu a corrida anterior e já está a caminho!'
    };

    const queuedPassengerRooms = [
      queuedRideToPromote.id,
      queuedRideToPromote.passengerId,
      `passenger_${queuedRideToPromote.passengerId}`,
      `passenger:${queuedRideToPromote.passengerId}`
    ];

    queuedPassengerRooms.forEach(room => {
      safeSocketEmit(room, 'ride:driver_en_route', enRoutePayload);
      safeSocketEmit(room, 'ride:accepted', enRoutePayload);
    });

    const queuedPassenger = await prisma.passenger.findUnique({
      where: { id: queuedRideToPromote.passengerId },
      select: { deviceToken: true }
    });

    if (queuedPassenger?.deviceToken) {
      sendPushNotification(
        queuedPassenger.deviceToken,
        '🚗 Motorista a caminho!',
        'Seu motorista concluiu a corrida anterior e já está se deslocando para o seu local.',
        { type: 'DRIVER_EN_ROUTE', rideId: queuedRideToPromote.id },
        PUSH_CHANNELS.RIDE_UPDATE
      ).catch(() => null);
    }
  }

  if (isCash) {
    return { 
      success: true, 
      fareXOF: calculatedFare, 
      driverEarnings, 
      platformFee, 
      distanceKm, 
      paymentMethod: 'CASH', 
      hasQueuedRide: !!queuedRideToPromote, 
      nextRideId: queuedRideToPromote?.id || null 
    };
  }

  const provider = (ride.paymentMethod || PaymentMethod.ORANGE_MONEY).toString().toUpperCase();
  const driverPhone = (ride.driver as any).paymentAccountNumber || ride.driver.phone;

  const systemConfig = await prisma.systemConfig.findUnique({ where: { id: 'bai245-system-config' } });
  const adminPhone = provider === 'ORANGE_MONEY' 
    ? (systemConfig?.adminOrangeNumber || '245950000000') 
    : (systemConfig?.adminMtnNumber || '245960000000');

  // 🚀 REPASSE AUTOMÁTICO E INSTANTÂNEO AO MOTORISTA
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
        console.log(`💸 [REPASSE SUCESSO] ${driverEarnings} XOF enviados instantaneamente para o motorista (${driverPhone})`);
      } else {
        throw new Error(payoutResult.details || 'Falha no repasse automático síncrono');
      }
    } catch (err: any) {
      console.warn(`⚠️ [REPASSE MOTORISTA] Operadora offline (${err.message}). Agendando na fila de tentativas.`);
      await prisma.transaction.update({ 
        where: { id: payoutTransactionId }, 
        data: { status: TransactionStatus.PROCESSING, failureReason: err.message } 
      }).catch(() => null);

      await enqueuePayoutJob({
        transactionId: payoutTransactionId, rideId: ride.id, driverId: ride.driverId!,
        amountXOF: driverEarnings, phone: driverPhone, provider
      });
    }
  }

  // 🚀 REPASSE DA COMISSÃO À EMPRESA
  if (!IS_MOCK_MODE && platformFee > 0 && adminPhone && commissionTransactionId) {
    try {
      const commissionResult = await executeRideDisbursement({
        rideId: ride.id, driverId: ride.driverId!, amount: platformFee, 
        phone: adminPhone, provider: provider as any, transactionId: commissionTransactionId
      });

      if (commissionResult.success) {
        await prisma.transaction.update({ 
          where: { id: commissionTransactionId }, 
          data: { status: TransactionStatus.COMPLETED, externalRef: commissionResult.providerRef || null } 
        });
      }
    } catch (err: any) {
      console.warn(`⚠️ [REPASSE EMPRESA] Falha na comissão (${err.message}). Agendando na fila de tentativas.`);
      await enqueuePayoutJob({
        transactionId: commissionTransactionId, rideId: ride.id, driverId: ride.driverId!,
        amountXOF: platformFee, phone: adminPhone, provider
      });
    }
  }

  return { 
    success: true, 
    fareXOF: calculatedFare, 
    driverEarnings, 
    platformFee, 
    distanceKm, 
    paymentMethod: String(ride.paymentMethod), 
    hasQueuedRide: !!queuedRideToPromote, 
    nextRideId: queuedRideToPromote?.id || null 
  };
}

// -----------------------------------------------------------------------------
// 6. CANCELAMENTO DE CORRIDA E REEMBOLSO AUTOMÁTICO
// -----------------------------------------------------------------------------
export async function cancelRideLogic(
  rideId: string, 
  userId: string, 
  userType: 'PASSENGER' | 'DRIVER', 
  reason?: string,
  isReportedProblem: boolean = false
) {
  const ride = await prisma.ride.findUnique({ where: { id: rideId }, include: { passenger: true, driver: true } });
  if (!ride) throw new Error('NOT_FOUND: Corrida não encontrada.');

  if (ride.status === RideStatus.IN_PROGRESS && !isReportedProblem) {
    throw new Error('RIDE_IN_PROGRESS: A viagem já está em andamento. Cancele apenas via suporte/emergência.');
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
  let penaltyTransactionId = '';

  const dbResult = await prisma.$transaction(async (tx) => {
    const updatedRide = await tx.ride.updateMany({
      where: { id: rideId, version: ride.version, status: { notIn: [RideStatus.COMPLETED, RideStatus.CANCELLED] } },
      data: { status: RideStatus.CANCELLED, cancellationReason: cleanReason, cancelledBy: userType as UserType, version: { increment: 1 } }
    });

    if (updatedRide.count === 0) {
      throw new Error('STATE_CONFLICT: A corrida já foi alterada por outra operação.');
    }

    await tx.rideEventLog.create({
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

    let refundTx = null;
    if (!isCash && refundAmount > 0 && originalPayment) {
      refundTx = await tx.transaction.create({
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

    if (penaltyAmount > 0 && ride.driverId) {
      const penaltyTx = await tx.transaction.create({
        data: {
          rideId: ride.id,
          driverId: ride.driverId,
          type: TransactionType.COMMISSION_FEE,
          status: IS_MOCK_MODE ? TransactionStatus.COMPLETED : TransactionStatus.PENDING,
          amount: penaltyAmount,
          reference: `PENALTY-${ride.id.slice(0, 8)}-${Date.now()}`,
          paymentMethod: ride.paymentMethod
        }
      });
      penaltyTransactionId = penaltyTx.id;
    }

    return { appliedPenalty: penaltyAmount > 0, penaltyAmount };
  });

  // 💸 EXECUÇÃO DO ESTORNO AUTOMÁTICO E INSTANTÂNEO PARA O PASSAGEIRO
  if (!isCash && refundAmount > 0 && refundTransactionId && refundPhone && !IS_MOCK_MODE) {
    try {
      const refundResult = await executeRideDisbursement({
        rideId: ride.id,
        passengerId: ride.passengerId,
        refundId: refundTransactionId,
        amount: refundAmount,
        phone: refundPhone,
        provider: ride.paymentMethod || 'ORANGE_MONEY',
        transactionId: refundTransactionId
      });

      if (refundResult.success) {
        await prisma.transaction.update({
          where: { id: refundTransactionId },
          data: { status: TransactionStatus.COMPLETED, externalRef: refundResult.providerRef || null }
        });
        console.log(`💸 [ESTORNO SUCESSO] ${refundAmount} XOF devolvidos ao passageiro (${refundPhone})`);
      } else {
        throw new Error(refundResult.details || 'Falha na execução do estorno síncrono');
      }
    } catch (refundErr: any) {
      console.warn(`⚠️ [ESTORNO FALHA] Redirecionando estorno para a fila de retentativas:`, refundErr.message);
      await prisma.transaction.update({
        where: { id: refundTransactionId },
        data: { status: TransactionStatus.PROCESSING, failureReason: refundErr.message }
      }).catch(() => null);

      await enqueueRefundJob({
        transactionId: refundTransactionId,
        rideId: ride.id,
        passengerId: ride.passengerId,
        amountXOF: refundAmount,
        phone: refundPhone,
        provider: String(ride.paymentMethod)
      }).catch(qErr => console.error('❌ [FILA ESTORNO ERRO]:', qErr));
    }
  }

  console.log(`⚠️ [RIDE LOG - CANCEL] Corrida ID: ${rideId} cancelada por ${userType}. Motivo: ${cleanReason}`);

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
// 7. NOTIFICAÇÕES DE CHAT E AVALIAÇÕES
// -----------------------------------------------------------------------------

export async function notifyNewChatMessage(data: {
  rideId: string;
  senderId: string;
  senderType: 'PASSENGER' | 'DRIVER';
  senderName: string;
  message: string;
}) {
  try {
    const { rideId, senderId, senderType, senderName, message } = data;

    const ride = await prisma.ride.findUnique({
      where: { id: rideId },
      include: {
        passenger: { select: { id: true, fullName: true, deviceToken: true } },
        driver: { select: { id: true, fullName: true, deviceToken: true } }
      }
    });

    if (!ride) return;

    const isPassenger = senderType === 'PASSENGER';
    const targetUserId = isPassenger ? ride.driverId : ride.passengerId;
    const targetToken = isPassenger ? ride.driver?.deviceToken : ride.passenger?.deviceToken;

    const chatPayload = {
      id: `msg-${Date.now()}`,
      rideId,
      senderId,
      sender: isPassenger ? 'passenger' : 'driver',
      senderType,
      senderName,
      message,
      text: message,
      createdAt: new Date().toISOString()
    };

    // 📣 MULTI-BROADCAST SOCKET
    const targetRooms = [
      rideId,
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

    // 🔔 DISPARO DE PUSH NOTIFICATION
    if (targetToken) {
      sendPushNotification(
        targetToken,
        `💬 ${senderName}`,
        message,
        { type: 'CHAT_MESSAGE', rideId, sender: isPassenger ? 'passenger' : 'driver' },
        PUSH_CHANNELS.CHAT
      ).catch(err => console.warn('⚠️ [PUSH CHAT ERR]:', err?.message));
    }
  } catch (err) {
    console.error('💥 [CHAT NOTIFY ERROR]:', err);
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