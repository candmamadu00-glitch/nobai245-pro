import {
  VehicleType,
  ServiceType,
  PaymentMethod,
  DriverStatus,
  UserType,
  TransactionType,
  TransactionStatus,
  Prisma,
} from '@prisma/client';
import { prisma } from '../lib/prisma';

const CANCELLATION_FEE_XOF = 500;
const FREE_CANCELLATION_MINUTES = 2;
const DRIVER_PENALTY_SHARE = 0.7; // 70% da penalidade vai para o motorista (350 XOF)

const DEFAULT_TARIFFS: Record<
  VehicleType,
  { baseFare: number; perKmFare: number; perMinuteFare: number; minimumFare: number }
> = {
  MOTO: { baseFare: 300, perKmFare: 150, perMinuteFare: 25, minimumFare: 500 },
  MOTO_CARRO: { baseFare: 400, perKmFare: 200, perMinuteFare: 35, minimumFare: 600 },
  TAXI: { baseFare: 500, perKmFare: 250, perMinuteFare: 50, minimumFare: 1000 },
  PARTICULAR: { baseFare: 700, perKmFare: 350, perMinuteFare: 60, minimumFare: 1200 },
  TOCA_TOCA: { baseFare: 500, perKmFare: 200, perMinuteFare: 30, minimumFare: 1000 },
};

// -----------------------------------------------------------------------------
// 1. VALIDAÇÃO E CÁLCULO GEOGRÁFICO
// -----------------------------------------------------------------------------
export function isValidCoordinate(lat: unknown, lng: unknown): boolean {
  if (lat === null || lng === null || typeof lat === 'boolean' || typeof lng === 'boolean') {
    return false;
  }
  const l = Number(lat);
  const lg = Number(lng);
  return Number.isFinite(l) && Number.isFinite(lg) && l >= -90 && l <= 90 && lg >= -180 && lg <= 180;
}

export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  if (!isValidCoordinate(lat1, lon1) || !isValidCoordinate(lat2, lon2)) {
    return 0.5; // Distância padrão mínima de segurança em KM
  }

  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.max(0.1, Number((R * c).toFixed(2)));
}

export async function calculateRouteAndDistance(
  pLat: number,
  pLng: number,
  dLat: number,
  dLng: number
): Promise<{ distanceKm: number; durationMin: number }> {
  const distanceKm = calculateDistance(pLat, pLng, dLat, dLng);
  // Estimativa base de velocidade na Guiné-Bissau (~25 km/h em zonas urbanas)
  const durationMin = Math.max(3, Math.ceil((distanceKm / 25) * 60));
  return { distanceKm, durationMin };
}

// -----------------------------------------------------------------------------
// 2. CÁLCULO DE TARIFA BLINDADO
// -----------------------------------------------------------------------------
export async function calculateRidePrice(
  distanceKm: number,
  durationMin: number,
  vehicleType: VehicleType,
  serviceType: ServiceType = ServiceType.RIDE
): Promise<number> {
  const safeDist = Math.max(0, Number.isFinite(Number(distanceKm)) ? Number(distanceKm) : 0);
  const safeDur = Math.max(0, Number.isFinite(Number(durationMin)) ? Number(durationMin) : 0);

  const tariff = await prisma.tariffConfig
    .findFirst({
      where: { vehicleType, serviceType, isActive: true },
    })
    .catch(() => null);

  const fallback = DEFAULT_TARIFFS[vehicleType] || DEFAULT_TARIFFS.PARTICULAR;

  const baseFare = tariff ? Number(tariff.baseFare) : fallback.baseFare;
  const perKmFare = tariff ? Number(tariff.perKmFare) : fallback.perKmFare;
  const perMinuteFare = tariff ? Number(tariff.perMinuteFare) : fallback.perMinuteFare;
  const minimumFare = tariff ? Number(tariff.minimumFare) : fallback.minimumFare;

  let totalPrice = baseFare + safeDist * perKmFare + safeDur * perMinuteFare;

  if (serviceType === ServiceType.DELIVERY) {
    totalPrice *= 1.2; // 20% adicional para entregas
  }

  if (totalPrice < minimumFare) {
    totalPrice = minimumFare;
  }

  return Math.max(100, Math.round(totalPrice));
}

// -----------------------------------------------------------------------------
// 3. CRIAÇÃO DE CORRIDA E RETENÇÃO DE ESCROW
// -----------------------------------------------------------------------------
export async function createRideAndInitiateEscrow(
  passengerId: string,
  data: {
    originLat: number;
    originLng: number;
    destinationLat: number;
    destinationLng: number;
    requestedVehicleType: VehicleType;
    serviceType?: ServiceType;
    paymentMethod?: PaymentMethod;
    originAddress?: string;
    destinationAddress?: string;
    stops?: Prisma.InputJsonValue;
    customPriceXof?: number;
    idempotencyKey?: string;
  }
) {
  const { distanceKm, durationMin } = await calculateRouteAndDistance(
    data.originLat,
    data.originLng,
    data.destinationLat,
    data.destinationLng
  );

  let priceXof = data.customPriceXof;
  if (!priceXof || priceXof <= 0) {
    priceXof = await calculateRidePrice(
      distanceKm,
      durationMin,
      data.requestedVehicleType,
      data.serviceType || ServiceType.RIDE
    );
  }

  return await prisma.$transaction(async (tx) => {
    const ride = await tx.ride.create({
      data: {
        passengerId,
        originLat: data.originLat,
        originLng: data.originLng,
        destinationLat: data.destinationLat,
        destinationLng: data.destinationLng,
        originAddress: data.originAddress || 'Origem',
        destinationAddress: data.destinationAddress || 'Destino',
        requestedVehicleType: data.requestedVehicleType,
        serviceType: data.serviceType || ServiceType.RIDE,
        paymentMethod: data.paymentMethod || PaymentMethod.ORANGE_MONEY,
        priceXof,
        distanceKm,
        status: 'SEARCHING',
        stops: data.stops ?? Prisma.JsonNull,
      },
    });

    const transaction = await tx.transaction.create({
      data: {
        rideId: ride.id,
        passengerId,
        type: TransactionType.RIDE_PAYMENT,
        status: TransactionStatus.HELD_IN_ESCROW,
        paymentMethod: data.paymentMethod || PaymentMethod.ORANGE_MONEY,
        amount: priceXof,
        reference: `ESCROW-${ride.id.slice(0, 8)}-${Date.now()}`,
        idempotencyKey: data.idempotencyKey,
        description: `Bloqueio de caução em Escrow para corrida #${ride.id.slice(0, 8)}`,
      },
    });

    return { ride, transaction };
  });
}

// -----------------------------------------------------------------------------
// 4. ACEITE DE CORRIDA ATÔMICO
// -----------------------------------------------------------------------------
export async function acceptRideLogic(rideId: string, driverId: string) {
  return await prisma.$transaction(async (tx) => {
    // 1. Reserva o motorista atomicamente
    const driverLock = await tx.driver.updateMany({
      where: { id: driverId, isOnline: true, currentRideId: null, status: DriverStatus.APPROVED },
      data: { currentRideId: rideId, isAvailable: false },
    });

    if (driverLock.count === 0) {
      throw new Error('MOTORISTA_OCUPADO_OU_OFFLINE');
    }

    const startOtp = Math.floor(1000 + Math.random() * 9000).toString();

    // 2. Atribui a corrida atomicamente garantindo que status ainda seja SEARCHING
    const updatedRideCount = await tx.ride.updateMany({
      where: { id: rideId, status: 'SEARCHING' },
      data: {
        driverId,
        status: 'ACCEPTED',
        acceptedAt: new Date(),
        startOtp,
      },
    });

    if (updatedRideCount.count === 0) {
      throw new Error('CORRIDA_NAO_DISPONIVEL');
    }

    const ride = await tx.ride.findUnique({
      where: { id: rideId },
      include: { passenger: true, driver: true },
    });

    if (!ride) throw new Error('CORRIDA_NAO_ENCONTRADA');

    await tx.passenger.update({
      where: { id: ride.passengerId },
      data: { currentRideId: rideId },
    });

    return ride;
  });
}

// -----------------------------------------------------------------------------
// 5. NOTIFICAÇÃO DE CHEGADA E INÍCIO DE CORRIDA
// -----------------------------------------------------------------------------
export async function driverArrivedLogic(rideId: string, driverId: string) {
  return await prisma.$transaction(async (tx) => {
    const updatedRideCount = await tx.ride.updateMany({
      where: { id: rideId, driverId, status: 'ACCEPTED' },
      data: { status: 'ARRIVED', arrivedAt: new Date() },
    });

    if (updatedRideCount.count === 0) {
      throw new Error('TRANSICAO_INVALIDA: A corrida não está em estado de aceite por este motorista.');
    }

    return await tx.ride.findUnique({
      where: { id: rideId },
      include: { passenger: true, driver: true },
    });
  });
}

export async function startRideLogic(rideId: string, driverId: string, otpInput: string) {
  return await prisma.$transaction(async (tx) => {
    const ride = await tx.ride.findUnique({ where: { id: rideId } });
    if (!ride || ride.driverId !== driverId || ride.status !== 'ARRIVED') {
      throw new Error('CORRIDA_NAO_PRONTA: Motorista precisa marcar chegada primeiro.');
    }

    const cleanOtp = String(otpInput || '').trim();
    if (ride.startOtp && ride.startOtp !== cleanOtp) {
      throw new Error('OTP_INVALIDO: O código digitado não confere com o do passageiro.');
    }

    const updatedRideCount = await tx.ride.updateMany({
      where: { id: rideId, driverId, status: 'ARRIVED' },
      data: { status: 'IN_PROGRESS', startedAt: new Date() },
    });

    if (updatedRideCount.count === 0) {
      throw new Error('STATE_CONFLICT: Transição de estado inválida.');
    }

    return await tx.ride.findUnique({
      where: { id: rideId },
      include: { passenger: true, driver: true },
    });
  });
}

// -----------------------------------------------------------------------------
// 6. FINALIZAÇÃO E REPASSE VIA ESCROW
// -----------------------------------------------------------------------------
export async function finalizeRideAndCharge(rideId: string, finalLat: number, finalLng: number) {
  if (!isValidCoordinate(finalLat, finalLng)) {
    throw new Error('INVALID_COORDINATES: Coordenadas finais de destino inválidas.');
  }

  const ride = await prisma.ride.findUnique({
    where: { id: rideId },
    include: { passenger: true, driver: true },
  });

  if (!ride || !ride.driver || !ride.passenger) throw new Error('DADOS_CORRIDA_INCOMPLETOS');
  if (['COMPLETED', 'CANCELLED'].includes(ride.status)) throw new Error('CORRIDA_JA_FINALIZADA');

  const tariff = await prisma.tariffConfig
    .findFirst({
      where: {
        vehicleType: ride.requestedVehicleType,
        serviceType: ride.serviceType,
        isActive: true,
      },
    })
    .catch(() => null);

  const commissionRate = Number(tariff?.commissionRate || 15);
  const calculatedFare = Math.max(0, Math.round(Number(ride.priceXof || 0)));
  const platformFee = Math.round((calculatedFare * commissionRate) / 100);
  const driverEarnings = Math.max(0, calculatedFare - platformFee);

  const distanceKm = calculateDistance(
    Number(ride.originLat || 0),
    Number(ride.originLng || 0),
    Number(finalLat),
    Number(finalLng)
  );

  return await prisma.$transaction(async (tx) => {
    // 1. Finaliza a corrida atomicamente
    const updateCount = await tx.ride.updateMany({
      where: { id: ride.id, status: { in: ['ACCEPTED', 'ARRIVED', 'IN_PROGRESS'] } },
      data: {
        status: 'COMPLETED',
        finishedAt: new Date(),
        destinationLat: Number(finalLat),
        destinationLng: Number(finalLng),
        distanceKm,
        platformFee,
        driverEarnings,
      },
    });

    if (updateCount.count === 0) {
      throw new Error('CONCURRENCY_ERROR: A corrida já foi finalizada por outra operação.');
    }

    // 2. Libera o passageiro
    await tx.passenger.update({ where: { id: ride.passengerId }, data: { currentRideId: null } });

    // 3. Libera a disponibilidade do motorista
    await tx.driver.update({
      where: { id: ride.driverId! },
      data: { currentRideId: null, isAvailable: true },
    });

    // 4. Converte a transação de Escrow (HELD_IN_ESCROW) em Liquidada (COMPLETED)
    await tx.transaction.updateMany({
      where: { rideId: ride.id, status: TransactionStatus.HELD_IN_ESCROW },
      data: { status: TransactionStatus.COMPLETED },
    });

    // 5. Registra o ganho da empresa na Wallet Geral
    await tx.companyWallet.upsert({
      where: { id: 'bai245-main-wallet' },
      update: { balance: { increment: platformFee }, totalCollected: { increment: calculatedFare } },
      create: { id: 'bai245-main-wallet', balance: platformFee, totalCollected: calculatedFare },
    });

    // 6. Registra a comissão da empresa
    await tx.transaction.create({
      data: {
        rideId: ride.id,
        passengerId: ride.passengerId,
        driverId: ride.driverId,
        type: TransactionType.COMMISSION_FEE,
        status: TransactionStatus.COMPLETED,
        amount: platformFee,
        reference: `FEE-${ride.id.slice(0, 8)}-${Date.now()}`,
        description: 'Taxa de serviço da plataforma BAI 245',
      },
    });

    // 7. Registra a pendência de Payout para o motorista
    const payoutTx = await tx.transaction.create({
      data: {
        rideId: ride.id,
        driverId: ride.driverId,
        type: TransactionType.DRIVER_PAYOUT,
        status: TransactionStatus.PENDING,
        amount: driverEarnings,
        reference: `EARN-${ride.id.slice(0, 8)}-${Date.now()}`,
        description: 'Repasse de corrida para chave Mobile Money do motorista',
      },
    });

    const completedRide = await tx.ride.findUnique({ where: { id: ride.id } });
    return {
      success: true,
      ride: completedRide,
      fareXOF: calculatedFare,
      distanceKm,
      payoutTransactionId: payoutTx.id,
      driverEarnings,
      platformFee,
    };
  });
}

// -----------------------------------------------------------------------------
// 7. CANCELAMENTO SEGURO VIA ESCROW
// -----------------------------------------------------------------------------
export async function cancelRideLogic(
  rideId: string,
  userId: string,
  userType: UserType,
  reason?: string
) {
  const ride = await prisma.ride.findUnique({
    where: { id: rideId },
    include: { passenger: true, driver: true },
  });

  if (!ride) throw new Error('Corrida não encontrada.');
  if (['COMPLETED', 'CANCELLED'].includes(ride.status)) {
    throw new Error('Esta corrida já foi finalizada ou cancelada.');
  }

  let applyPenalty = false;

  // Avalia direito à penalidade de cancelamento tardio pelo passageiro
  if (
    userType === UserType.PASSENGER &&
    (ride.status === 'ARRIVED' || (ride.status === 'ACCEPTED' && ride.acceptedAt))
  ) {
    if (ride.status === 'ARRIVED') {
      applyPenalty = true;
    } else if (ride.acceptedAt) {
      const diffInMinutes = (new Date().getTime() - new Date(ride.acceptedAt).getTime()) / (1000 * 60);
      if (diffInMinutes > FREE_CANCELLATION_MINUTES) applyPenalty = true;
    }
  }

  const ridePrice = Number(ride.priceXof || 0);
  const penaltyAmount = applyPenalty ? Math.min(CANCELLATION_FEE_XOF, ridePrice) : 0;
  const driverCompensation = Math.round(penaltyAmount * DRIVER_PENALTY_SHARE);
  const platformFee = Math.max(0, penaltyAmount - driverCompensation);
  const refundToPassenger = Math.max(0, ridePrice - penaltyAmount);

  return await prisma.$transaction(async (tx) => {
    // 1. Atualiza status da corrida para CANCELLED
    const updatedRide = await tx.ride.updateMany({
      where: { id: rideId, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      data: {
        status: 'CANCELLED',
        cancellationReason: reason || 'Cancelado pelo usuário',
        cancelledBy: userType,
        cancelledById: userId,
        cancelledAt: new Date(),
      },
    });

    if (updatedRide.count === 0) {
      throw new Error('STATE_CONFLICT: A corrida já foi alterada por outra transação.');
    }

    // 2. Libera o passageiro
    await tx.passenger.update({
      where: { id: ride.passengerId },
      data: { currentRideId: null },
    });

    // 3. Libera o motorista
    if (ride.driverId) {
      await tx.driver.update({
        where: { id: ride.driverId },
        data: { currentRideId: null, isAvailable: true },
      });
    }

    // 4. Trata a retenção do Escrow
    const escrowTx = await tx.transaction.findFirst({
      where: { rideId: ride.id, status: TransactionStatus.HELD_IN_ESCROW },
    });

    if (escrowTx) {
      // Fecha a transação de Escrow original como REVERSED
      await tx.transaction.update({
        where: { id: escrowTx.id },
        data: { status: TransactionStatus.REVERSED },
      });

      // A) Se houver reembolso ao passageiro
      if (refundToPassenger > 0) {
        await tx.transaction.create({
          data: {
            passengerId: ride.passengerId,
            rideId: ride.id,
            type: TransactionType.REFUND,
            paymentMethod: ride.paymentMethod,
            amount: refundToPassenger,
            status: TransactionStatus.PENDING,
            reference: `REFUND-${ride.id.slice(0, 8)}-${Date.now()}`,
            description: 'Estorno do Escrow de corrida cancelada',
          },
        });
      }

      // B) Se houve penalidade e o motorista tem direito à compensação
      if (applyPenalty && ride.driverId && driverCompensation > 0) {
        await tx.transaction.create({
          data: {
            driverId: ride.driverId,
            rideId: ride.id,
            type: TransactionType.DRIVER_PAYOUT,
            amount: driverCompensation,
            status: TransactionStatus.PENDING,
            reference: `PENALTY-COMP-${ride.id.slice(0, 8)}-${Date.now()}`,
            description: 'Compensação por cancelamento tardio do passageiro',
          },
        });
      }

      // C) Se houver taxa para a plataforma
      if (platformFee > 0) {
        await tx.companyWallet.upsert({
          where: { id: 'bai245-main-wallet' },
          update: { balance: { increment: platformFee } },
          create: { id: 'bai245-main-wallet', balance: platformFee, totalCollected: platformFee },
        });
      }
    }

    return {
      success: true,
      appliedPenalty: applyPenalty,
      penaltyAmount,
      refundAmount: refundToPassenger,
      driverCompensation,
    };
  });
}