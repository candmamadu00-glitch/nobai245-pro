import { VehicleType, ServiceType, RideStatus, PaymentMethod, TransactionStatus, TransactionType, UserType } from '@prisma/client';
import axios from 'axios';
import { prisma } from '../lib/prisma';
import { enqueuePayoutJob, enqueueRefundJob } from '../jobs/payoutQueue';
import { chargePassengerMobileMoney, isValidBissauPhone, executeRideDisbursement } from './mobileMoneyService';
import { sendPushNotification, PUSH_CHANNELS } from './pushNotifications';

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || '';
const IS_MOCK_MODE = process.env.ENABLE_MOCK_PAYMENTS === 'true' || process.env.NODE_ENV !== 'production';
const CANCELLATION_PENALTY_XOF = 500; // Taxa de cancelamento tardio (500 XOF)
const MIN_DRIVER_BALANCE_FOR_CASH = -2000; // Limite máximo de débito de comissão para aceitar corridas em dinheiro

export const FALLBACK_TARIFFS: Record<string, { baseFare: number; perKm: number; perMin: number; commissionRate: number }> = {
  MOTO: { baseFare: 300, perKm: 150, perMin: 25, commissionRate: 15 },
  MOTO_CARRO: { baseFare: 400, perKm: 200, perMin: 35, commissionRate: 15 },
  TAXI: { baseFare: 500, perKm: 250, perMin: 50, commissionRate: 15 },
  PARTICULAR: { baseFare: 700, perKm: 350, perMin: 60, commissionRate: 15 },
  TOCA_TOCA: { baseFare: 500, perKm: 200, perMin: 30, commissionRate: 15 },
};

// -----------------------------------------------------------------------------
// HELPER PARA NOTIFICAÇÃO PUSH DE MOTORISTAS PRÓXIMOS/ONLINE (FILTRADO)
// -----------------------------------------------------------------------------
export async function notifyDriversNewRide(rideId: string) {
  console.log(`\n🚨 [RIDE DISPATCH] Buscando motoristas para notificar sobre a corrida ${rideId}...`);
  try {
    const ride = await prisma.ride.findUnique({ where: { id: rideId } });
    if (!ride) return;

    const pLat = Number(ride.originLat);
    const pLng = Number(ride.originLng);
    const latDelta = 0.045; // ~5km em latitude
    const lngDelta = 0.045;

    const availableDrivers = await prisma.driver.findMany({
      where: {
        isOnline: true,
        isAvailable: true,
        status: 'APPROVED',
        vehicleType: ride.requestedVehicleType,
        lastLat: { gte: pLat - latDelta, lte: pLat + latDelta },
        lastLng: { gte: pLng - lngDelta, lte: pLng + lngDelta }
      },
      select: {
        id: true,
        fullName: true,
        deviceToken: true,
        lastLat: true,
        lastLng: true,
        walletBalance: true
      },
    });

    const qualifiedDrivers = availableDrivers.filter(driver => {
      if (driver.lastLat === null || driver.lastLng === null) return false;
      if (ride.paymentMethod === 'CASH' && Number(driver.walletBalance || 0) < MIN_DRIVER_BALANCE_FOR_CASH) {
        return false;
      }
      return calculateDistance(pLat, pLng, Number(driver.lastLat), Number(driver.lastLng)) <= 5.0;
    });

    console.log(`🔍 [RIDE DISPATCH] ${qualifiedDrivers.length} motoristas qualificados no raio de 5km.`);

    for (const driver of qualifiedDrivers) {
      if (driver.deviceToken) {
        console.log(`🔔 [PUSH MOTORISTA] Enviando notificação para: ${driver.fullName} (${driver.id})`);
        sendPushNotification(
          driver.deviceToken,
          '🚗 Nova Corrida Solicitada!',
          `Ganho estimado: ${ride.priceXof} XOF. Toque para aceitar.`,
          { type: 'NEW_RIDE_REQUEST', rideId: ride.id },
          PUSH_CHANNELS.NEW_RIDE_ALARM
        ).catch(err => console.warn(`⚠️ [PUSH ERROR] Falha ao notificar motorista ${driver.id}:`, err?.message || err));
      }
    }
  } catch (error) {
    console.error('💥 [RIDE DISPATCH ERROR] Falha ao disparar notificações de nova corrida:', error);
  }
}

// -----------------------------------------------------------------------------
// HELPER PARA MASCARAMENTO DE TELEFONE
// -----------------------------------------------------------------------------
export function maskPhoneNumber(phone?: string | null): string {
  if (!phone) return '****';
  const cleaned = phone.trim();
  if (cleaned.length <= 4) return '****';
  return cleaned.slice(0, 4) + ' **** ' + cleaned.slice(-3);
}

// -----------------------------------------------------------------------------
// 1. HELPERS E CÁLCULOS GEOGRÁFICOS (MAPPING & HAVERSINE)
// -----------------------------------------------------------------------------
export function isValidCoordinate(lat: number, lng: number): boolean {
  return typeof lat === 'number' && typeof lng === 'number' && !isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  if (!isValidCoordinate(lat1, lon1) || !isValidCoordinate(lat2, lon2)) return 0.5;
  const R = 6371; // Raio da Terra em KM
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * 
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.max(0.1, Number((R * c * 1.35).toFixed(2))); // Fator 1.35 para compensar curvas reais
}

export function calculateHaversineFallback(lat1: number, lon1: number, lat2: number, lon2: number) {
  if (!isValidCoordinate(lat1, lon1) || !isValidCoordinate(lat2, lon2)) {
    throw new Error('INVALID_COORDINATES: Coordenadas geográficas inválidas.');
  }
  const distanceKm = calculateDistance(lat1, lon1, lat2, lon2);
  const durationMin = Math.max(1, Math.ceil((distanceKm / 30) * 60)); // Média urbana de 30km/h
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
    return { distanceKm: totalDist, durationMin: Math.max(1, Math.ceil((totalDist / 30) * 60)) };
  }

  try {
    let waypointsStr = '';
    if (waypoints.length > 0) {
      waypointsStr = '&waypoints=' + waypoints.map(w => `${w.lat},${w.lng}`).join('|');
    }
    
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${lat1},${lon1}&destination=${lat2},${lon2}${waypointsStr}&key=${GOOGLE_MAPS_API_KEY}`;
    const response = await axios.get(url, { timeout: 4000 });
    
    if (response.data?.status === 'OK' && response.data.routes.length > 0) {
      const route = response.data.routes[0];
      let totalDistanceMeters = 0;
      let totalDurationSeconds = 0;
      
      route.legs.forEach((leg: any) => {
        totalDistanceMeters += leg.distance.value;
        totalDurationSeconds += leg.duration.value;
      });

      return {
        distanceKm: Math.max(0.1, Number((totalDistanceMeters / 1000).toFixed(2))),
        durationMin: Math.max(1, Math.ceil(totalDurationSeconds / 60))
      };
    }
  } catch (error) {
    console.warn('⚠️ [MAPS] API externa indisponível/timeout. Utilizando cálculo Haversine de contingência.');
  }
  
  return calculateHaversineFallback(lat1, lon1, lat2, lon2);
}

// -----------------------------------------------------------------------------
// 2. CÁLCULO DE TARIFA (XOF FRANCOS CFA)
// -----------------------------------------------------------------------------
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

  let totalPrice = baseFare + (distanceKm * perKm) + (durationMin * perMin);
  if (sType === ServiceType.DELIVERY) totalPrice *= 1.20; // Taxa de entrega/encomenda

  return { totalPrice: Math.round(totalPrice), commissionRate };
}

// -----------------------------------------------------------------------------
// 3. CRIAÇÃO DE CORRIDA E RETENÇÃO EM CAUÇÃO (ESCROW) / DINHEIRO
// -----------------------------------------------------------------------------
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

  const passenger = await prisma.passenger.findUnique({ where: { id: passengerId } });
  if (!passenger || passenger.status !== 'ACTIVE') {
    throw new Error('UNAUTHORIZED: Conta de passageiro inexistente, inativa ou suspensa.');
  }

  const chosenMethod = (data.paymentMethod || passenger.paymentProvider || PaymentMethod.ORANGE_MONEY) as PaymentMethod;
  const isCash = chosenMethod === PaymentMethod.CASH;

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

  const { ride, transaction } = await prisma.$transaction(async (tx) => {
    const newRide = await tx.ride.create({
      data: {
        passengerId, serviceType: (serviceType || 'RIDE') as ServiceType,
        requestedVehicleType: (requestedVehicleType || 'PARTICULAR') as VehicleType,
        paymentMethod: chosenMethod, originAddress: originAddress || '',
        originLat, originLng, destinationAddress: destinationAddress || '',
        destinationLat, destinationLng, referencePoint: referencePoint || null,
        stops: stops.length > 0 ? stops : undefined,
        priceXof, status: initialStatus, startOtp
      }
    });

    const lockPassenger = await tx.passenger.updateMany({
      where: { id: passengerId, currentRideId: null, status: 'ACTIVE' },
      data: { currentRideId: newRide.id }
    });

    if (lockPassenger.count === 0) {
      throw new Error('ACTIVE_RIDE_EXISTS: Passageiro já possui corrida ativa em andamento.');
    }

    const newTx = await tx.transaction.create({
      data: {
        passengerId, rideId: newRide.id, type: TransactionType.RIDE_PAYMENT,
        status: initialTxStatus, amount: priceXof,
        reference: `PAY-${newRide.id.slice(0, 8)}-${Date.now()}`, paymentMethod: chosenMethod,
        idempotencyKey: data.idempotencyKey
      }
    });

    return { ride: newRide, transaction: newTx };
  });

  if (isCash || IS_MOCK_MODE) {
    notifyDriversNewRide(ride.id).catch(err => console.error('Erro ao notificar motoristas:', err));
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
      throw new Error(chargeResult.details || 'Falha de comunicação com a operadora Mobile Money.');
    }

    notifyDriversNewRide(ride.id).catch(err => console.error('Erro ao notificar motoristas:', err));

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
// 4. ACEITE DE CORRIDA E CHEGADA DO MOTORISTA
// -----------------------------------------------------------------------------
export async function acceptRideLogic(rideId: string, driverId: string) {
  const driver = await prisma.driver.findUnique({ where: { id: driverId } });
  if (!driver || !driver.isOnline || !driver.isAvailable || driver.status !== 'APPROVED') {
    throw new Error('DRIVER_UNAVAILABLE: Motorista indisponível ou conta não aprovada.');
  }

  const ride = await prisma.ride.findUnique({ where: { id: rideId } });
  if (!ride || ride.status !== RideStatus.SEARCHING) {
    throw new Error('RIDE_UNAVAILABLE: Corrida indisponível ou já aceita por outro motorista.');
  }

  if (ride.paymentMethod === PaymentMethod.CASH) {
    const currentBalance = Number(driver.walletBalance || 0);
    if (currentBalance < MIN_DRIVER_BALANCE_FOR_CASH) {
      throw new Error(
        'INSUFFICIENT_DRIVER_BALANCE: Seu saldo de comissões está negativo. Recarregue via Mobile Money para aceitar corridas em dinheiro.'
      );
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const driverLock = await tx.driver.updateMany({
      where: { id: driverId, isAvailable: true, currentRideId: null },
      data: { currentRideId: rideId, isAvailable: false }
    });

    if (driverLock.count === 0) throw new Error('DRIVER_BUSY: O motorista já está em outra corrida.');

    const updatedRide = await tx.ride.updateMany({
      where: { id: rideId, status: RideStatus.SEARCHING },
      data: {
        driverId, status: RideStatus.ACCEPTED, acceptedAt: new Date(), version: { increment: 1 }
      }
    });

    if (updatedRide.count === 0) {
      throw new Error('RIDE_ALREADY_TAKEN: Esta corrida acabou de ser aceita por outro colega.');
    }

    const res = await tx.ride.findUnique({ 
      where: { id: rideId }, 
      include: { 
        passenger: { 
          select: { id: true, fullName: true, profilePicture: true, ratingAverage: true, phone: true, deviceToken: true } 
        }, 
        driver: { 
          select: { id: true, fullName: true, profilePicture: true, vehicleBrand: true, vehicleColor: true, vehiclePlate: true, ratingAverage: true, phone: true } 
        } 
      } 
    });

    if (!res) throw new Error('NOT_FOUND: Corrida não encontrada no banco de dados.');

    return res;
  });

  if (result.passenger?.deviceToken) {
    sendPushNotification(
      result.passenger.deviceToken,
      '✅ Corrida Aceita!',
      `O motorista ${result.driver?.fullName || 'parceiro'} aceitou sua corrida e está a caminho!`,
      { type: 'RIDE_ACCEPTED', rideId: result.id },
      PUSH_CHANNELS.RIDE_UPDATE
    ).catch(err => console.error('⚠️ Falha ao enviar push de aceite ao passageiro:', err));
  }

  return {
    ...result,
    passenger: result.passenger ? {
      ...result.passenger,
      phone: maskPhoneNumber(result.passenger.phone)
    } : null,
    driver: result.driver ? {
      ...result.driver,
      phone: maskPhoneNumber(result.driver.phone)
    } : null
  };
}

export const acceptRide = acceptRideLogic;

export async function driverArrivedLogic(rideId: string, driverId: string) {
  const ride = await prisma.ride.findUnique({ where: { id: rideId } });
  if (!ride || ride.driverId !== driverId) throw new Error('UNAUTHORIZED: Motorista não associado a esta viagem.');
  if (ride.status !== RideStatus.ACCEPTED) throw new Error('INVALID_STATUS: A corrida não está em estado aceito.');

  const updated = await prisma.ride.update({
    where: { id: rideId },
    data: { status: RideStatus.ARRIVED },
    include: { 
      passenger: { 
        select: { id: true, fullName: true, profilePicture: true, ratingAverage: true, phone: true, deviceToken: true } 
      } 
    }
  });

  if (updated.passenger?.deviceToken) {
    sendPushNotification(
      updated.passenger.deviceToken,
      '📍 Motorista Chegou!',
      'Seu motorista está no local de embarque aguardando por você.',
      { type: 'DRIVER_ARRIVED', rideId: updated.id },
      PUSH_CHANNELS.RIDE_UPDATE
    ).catch(err => console.error('⚠️ Falha ao enviar push de chegada ao passageiro:', err));
  }

  return {
    ...updated,
    passenger: updated.passenger ? {
      ...updated.passenger,
      phone: maskPhoneNumber(updated.passenger.phone)
    } : null
  };
}

export async function startRideLogic(rideId: string, driverId: string, otpInput: string) {
  const ride = await prisma.ride.findUnique({ where: { id: rideId } });
  if (!ride || ride.driverId !== driverId) throw new Error('UNAUTHORIZED: Operação não autorizada.');

  if (ride.startOtp && ride.startOtp !== otpInput.trim()) {
    throw new Error('INVALID_OTP: Código OTP informado está incorreto.');
  }

  return await prisma.ride.update({
    where: { id: rideId },
    data: { status: RideStatus.IN_PROGRESS, startedAt: new Date(), version: { increment: 1 } }
  });
}

// -----------------------------------------------------------------------------
// 5. FINALIZAÇÃO DA CORRIDA E LIQUIDAÇÃO (CASH x MOBILE MONEY)
// -----------------------------------------------------------------------------
export async function finalizeRideAndCharge(rideId: string, finalLat: number, finalLng: number) {
  if (!isValidCoordinate(finalLat, finalLng)) throw new Error('INVALID_COORDINATES: Coordenadas finais de desembarque inválidas.');

  const ride = await prisma.ride.findUnique({
    where: { id: rideId }, include: { driver: true, passenger: true }
  });

  if (!ride || !ride.driver || !ride.passenger) throw new Error('NOT_FOUND: Dados completos da corrida não localizados.');
  if (['COMPLETED', 'CANCELLED'].includes(ride.status)) throw new Error('RIDE_FINISHED: A corrida já foi finalizada anteriormente.');

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

  await prisma.$transaction(async (tx) => {
    const updatedRide = await tx.ride.updateMany({
      where: { id: rideId, version: ride.version, status: { in: [RideStatus.ACCEPTED, RideStatus.ARRIVED, RideStatus.IN_PROGRESS] } },
      data: {
        status: RideStatus.COMPLETED, finishedAt: new Date(), destinationLat: finalLat, destinationLng: finalLng,
        distanceKm, platformFee, driverEarnings, version: { increment: 1 }
      }
    });

    if (updatedRide.count === 0) throw new Error('CONCURRENCY_ERROR: Ocorreu um conflito ao tentar finalizar a corrida.');

    await tx.passenger.update({ where: { id: ride.passengerId }, data: { currentRideId: null } });

    if (isCash) {
      const currentDriverBalance = Number(ride.driver?.walletBalance || 0);
      const newDriverBalance = currentDriverBalance - platformFee;

      await tx.driver.update({ 
        where: { id: ride.driverId! }, 
        data: { 
          walletBalance: newDriverBalance,
          currentRideId: null, 
          isAvailable: true 
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
        data: { currentRideId: null, isAvailable: true } 
      });

      const payoutTx = await tx.transaction.create({
        data: {
          rideId: ride.id, driverId: ride.driverId, type: TransactionType.DRIVER_PAYOUT, 
          status: IS_MOCK_MODE ? TransactionStatus.COMPLETED : TransactionStatus.PENDING, amount: driverEarnings, 
          reference: `PAYOUT-${ride.id.slice(0, 8)}-${Date.now()}`, paymentMethod: ride.paymentMethod
        }
      });
      payoutTransactionId = payoutTx.id;

      const commissionTx = await tx.transaction.create({
        data: {
          rideId: ride.id, type: TransactionType.COMMISSION_FEE, 
          status: IS_MOCK_MODE ? TransactionStatus.COMPLETED : TransactionStatus.PENDING, 
          amount: platformFee, reference: `FEE-${ride.id.slice(0, 8)}-${Date.now()}`
        }
      });
      commissionTransactionId = commissionTx.id;
    }

    await tx.companyWallet.upsert({
      where: { id: 'bai245-main-wallet' },
      update: { balance: { increment: platformFee }, totalCollected: { increment: calculatedFare }, version: { increment: 1 } },
      create: { id: 'bai245-main-wallet', balance: platformFee, totalCollected: calculatedFare }
    });
  });

  if (isCash) {
    return { success: true, fareXOF: calculatedFare, driverEarnings, platformFee, distanceKm, paymentMethod: 'CASH' };
  }

  const provider = (ride.paymentMethod || PaymentMethod.ORANGE_MONEY).toString().toUpperCase();
  const driverPhone = provider === 'ORANGE_MONEY'
    ? (ride.driver.orangeNumber || ride.driver.phone)
    : (ride.driver.mtnNumber || ride.driver.phone);

  const systemConfig = await prisma.systemConfig.findUnique({ where: { id: 'bai245-system-config' } });
  const adminPhone = provider === 'ORANGE_MONEY' 
    ? (systemConfig?.adminOrangeNumber || '245950000000') 
    : (systemConfig?.adminMtnNumber || '245960000000');

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
      } else {
        throw new Error(payoutResult.details || 'Falha no repasse automático síncrono');
      }
    } catch (err: any) {
      console.warn(`⚠️ [REPASSE MOTORISTA] Operadora offline (${err.message}). Redirecionando para a fila assíncrona.`);
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
      console.warn(`⚠️ [REPASSE EMPRESA] Falha na comissão (${err.message}). Redirecionando para a fila assíncrona.`);
      await enqueuePayoutJob({
        transactionId: commissionTransactionId, rideId: ride.id, driverId: ride.driverId!,
        amountXOF: platformFee, phone: adminPhone, provider
      });
    }
  }

  return { success: true, fareXOF: calculatedFare, driverEarnings, platformFee, distanceKm, paymentMethod: ride.paymentMethod };
}

// -----------------------------------------------------------------------------
// 6. CANCELAMENTO E REEMBOLSO VIA OUTBOX & CAUÇÃO
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

  const isLateCancellation = userType === 'PASSENGER' && (ride.status === 'ARRIVED' || minutesSinceAcceptance >= 2);
  const penaltyAmount = isLateCancellation ? CANCELLATION_PENALTY_XOF : 0; 
  const refundAmount = (!isCash && originalPayment) ? Math.max(0, Number(ride.priceXof || 0) - penaltyAmount) : 0;

  const cleanReason = reason || 'Sem justificativa informada';
  const refundPhone = ride.passenger.paymentAccountNumber || ride.passenger.phone;

  let penaltyTransactionId = '';

  const dbResult = await prisma.$transaction(async (tx) => {
    const updatedRide = await tx.ride.updateMany({
      where: { id: rideId, version: ride.version, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      data: { status: 'CANCELLED', cancellationReason: cleanReason, cancelledBy: userType as UserType, version: { increment: 1 } }
    });

    if (updatedRide.count === 0) throw new Error('STATE_CONFLICT: A corrida já foi alterada por outra operação.');

    await tx.passenger.update({ where: { id: ride.passengerId }, data: { currentRideId: null } });
    if (ride.driverId) await tx.driver.update({ where: { id: ride.driverId }, data: { currentRideId: null, isAvailable: true } });

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

      if (refundPhone) {
        await tx.outboxEvent.create({
          data: {
            eventType: 'PROCESS_REFUND',
            payload: {
              transactionId: refundTx.id,
              rideId: ride.id,
              passengerId: ride.passengerId,
              phone: refundPhone,
              amountXOF: refundAmount,
              provider: ride.paymentMethod || 'ORANGE_MONEY',
              originalRef: originalPayment.externalRef || originalPayment.reference
            }
          }
        });
      }
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

  return dbResult;
}

// -----------------------------------------------------------------------------
// 7. AVALIAÇÃO DA CORRIDA E ATUALIZAÇÃO DE MÉDIAS
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
        where: { receiverId, reviewerType: 'PASSENGER' },
        _avg: { stars: true },
        _count: { stars: true }
      });

      await tx.driver.update({
        where: { id: receiverId },
        data: {
          ratingAverage: agg._avg.stars || 5.0,
          totalRatings: agg._count.stars || 0
        }
      });
    } else if (reviewerType === 'DRIVER') {
      const agg = await tx.rating.aggregate({
        where: { receiverId, reviewerType: 'DRIVER' },
        _avg: { stars: true },
        _count: { stars: true }
      });

      await tx.passenger.update({
        where: { id: receiverId },
        data: {
          ratingAverage: agg._avg.stars || 5.0,
          totalRatings: agg._count.stars || 0
        }
      });
    }

    return rating;
  });

  return newRating;
}