import { PrismaClient } from '@prisma/client';
import { chargePassengerMobileMoney } from '../services/mobileMoneyService';
// Reutilização do cliente Prisma singleton para evitar estouro no pool de conexões
const globalForPrisma = global as unknown as { prisma: PrismaClient };
export const prisma = globalForPrisma.prisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

const CANCELLATION_FEE_XOF = 500; 
const FREE_CANCELLATION_MINUTES = 2;

// Tariff fallback padrão para resiliência caso o banco de dados não possua tarifas cadastradas
const DEFAULT_TARIFFS: Record<string, { baseFare: number; perKmFare: number; perMinuteFare: number; minimumFare: number }> = {
  MOTO: { baseFare: 300, perKmFare: 150, perMinuteFare: 25, minimumFare: 500 },
  MOTO_CARRO: { baseFare: 400, perKmFare: 200, perMinuteFare: 35, minimumFare: 600 },
  TAXI: { baseFare: 500, perKmFare: 250, perMinuteFare: 50, minimumFare: 1000 },
  PARTICULAR: { baseFare: 700, perKmFare: 350, perMinuteFare: 60, minimumFare: 1200 },
};

// -----------------------------------------------------------------------------
// 1. VALIDAÇÃO E CÁLCULO GEOGRÁFICO
// -----------------------------------------------------------------------------
export function isValidCoordinate(lat: number, lng: number): boolean {
  return typeof lat === 'number' && typeof lng === 'number' && !isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  if (!isValidCoordinate(lat1, lon1) || !isValidCoordinate(lat2, lon2)) {
    return 0.5; // Distância padrão mínima em caso de dados corrompidos
  }

  const R = 6371; 
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
    
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.max(0.1, Number((R * c).toFixed(2)));
}

// -----------------------------------------------------------------------------
// 2. CÁLCULO DE TARIFA BLINDADO
// -----------------------------------------------------------------------------
export async function calculateRidePrice(
  distanceKm: number,
  durationMin: number,
  vehicleType: 'MOTO' | 'MOTO_CARRO' | 'TAXI' | 'PARTICULAR',
  serviceType: 'RIDE' | 'DELIVERY'
): Promise<number> {
  const safeDist = Math.max(0, isNaN(distanceKm) ? 0 : distanceKm);
  const safeDur = Math.max(0, isNaN(durationMin) ? 0 : durationMin);

  const tariff = await prisma.tariffConfig.findFirst({
    where: { vehicleType, serviceType, isActive: true },
  }).catch(() => null);

  const fallback = DEFAULT_TARIFFS[vehicleType] || DEFAULT_TARIFFS.PARTICULAR;

  const baseFare = tariff ? Number(tariff.baseFare) : fallback.baseFare;
  const perKmFare = tariff ? Number(tariff.perKmFare) : fallback.perKmFare;
  const perMinuteFare = tariff ? Number(tariff.perMinuteFare) : fallback.perMinuteFare;
  const minimumFare = tariff ? Number(tariff.minimumFare) : fallback.minimumFare;

  let totalPrice = baseFare + (safeDist * perKmFare) + (safeDur * perMinuteFare);

  if (serviceType === 'DELIVERY') {
    totalPrice *= 1.20; // 20% adicional para entregas
  }

  if (totalPrice < minimumFare) {
    totalPrice = minimumFare;
  }

  return Math.round(totalPrice);
}

// -----------------------------------------------------------------------------
// 3. ACEITE DE CORRIDA ATÔMICO (LOCK DE ESTADO CONTRA RACE CONDITION)
// -----------------------------------------------------------------------------
export async function acceptRideLogic(rideId: string, driverId: string) {
  return await prisma.$transaction(async (tx) => {
    // 1. Reserva o motorista atomicamente
    const driverLock = await tx.driver.updateMany({
      where: { id: driverId, isOnline: true, currentRideId: null, status: 'APPROVED' },
      data: { currentRideId: rideId, isAvailable: false }
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
      }
    });

    // Se outro motorista aceitou antes, lança erro para desfazer o lock do motorista
    if (updatedRideCount.count === 0) {
      throw new Error('CORRIDA_NAO_DISPONIVEL');
    }

    const ride = await tx.ride.findUnique({
      where: { id: rideId },
      include: { passenger: true, driver: true }
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
// 4. NOTIFICAÇÃO DE CHEGADA
// -----------------------------------------------------------------------------
export async function driverArrivedLogic(rideId: string, driverId: string) {
  return await prisma.$transaction(async (tx) => {
    const ride = await tx.ride.findUnique({ where: { id: rideId } });

    if (!ride || ride.driverId !== driverId || ride.status !== 'ACCEPTED') {
      throw new Error('TRANSICAO_INVALIDA');
    }

    return await tx.ride.update({
      where: { id: rideId },
      data: { status: 'ARRIVED', arrivedAt: new Date() },
      include: { passenger: true, driver: true }
    });
  });
}

// -----------------------------------------------------------------------------
// 5. INÍCIO DA CORRIDA COM OTP
// -----------------------------------------------------------------------------
export async function startRideLogic(rideId: string, driverId: string, otpInput: string) {
  return await prisma.$transaction(async (tx) => {
    const ride = await tx.ride.findUnique({ where: { id: rideId } });

    if (!ride || ride.driverId !== driverId || ride.status !== 'ARRIVED') {
      throw new Error('CORRIDA_NAO_PRONTA');
    }

    const cleanOtp = (otpInput || '').trim();
    if (ride.startOtp && ride.startOtp !== cleanOtp) {
      throw new Error('OTP_INVALIDO');
    }

    return await tx.ride.update({
      where: { id: rideId },
      data: { status: 'IN_PROGRESS', startedAt: new Date() },
      include: { passenger: true, driver: true }
    });
  });
}

// -----------------------------------------------------------------------------
// 6. FINALIZAÇÃO E COBRANÇA (EXCLUSIVO MOBILE MONEY)
// -----------------------------------------------------------------------------
export async function finalizeRideAndCharge(rideId: string, finalLat: number, finalLng: number) {
  if (!isValidCoordinate(finalLat, finalLng)) {
    throw new Error('INVALID_COORDINATES: Coordenadas finais de destino inválidas.');
  }

  const ride = await prisma.ride.findUnique({
    where: { id: rideId },
    include: { passenger: true, driver: true },
  });

  if (!ride || !ride.driver || !ride.passenger) {
    throw new Error('DADOS_CORRIDA_INCOMPLETOS');
  }

  if (['COMPLETED', 'CANCELLED'].includes(ride.status)) {
    throw new Error('CORRIDA_JA_FINALIZADA');
  }

  const tariff = await prisma.tariffConfig.findFirst({
    where: {
      vehicleType: ride.requestedVehicleType || 'PARTICULAR',
      serviceType: ride.serviceType || 'RIDE',
      isActive: true
    },
  }).catch(() => null);

  const commissionRate = Number(tariff?.commissionRate || 15);
  const calculatedFare = Math.round(Number(ride.priceXof || 0));
  const platformFee = Math.round((calculatedFare * commissionRate) / 100);
  const driverEarnings = calculatedFare - platformFee;

  const distanceKm = calculateDistance(
    Number(ride.originLat || 0),
    Number(ride.originLng || 0),
    finalLat,
    finalLng
  );

  return await prisma.$transaction(async (tx) => {
    // Atualização atômica prevenindo execução dupla concorrente
    const updateCount = await tx.ride.updateMany({
      where: { id: ride.id, status: { in: ['ACCEPTED', 'ARRIVED', 'IN_PROGRESS'] } },
      data: {
        status: 'COMPLETED',
        finishedAt: new Date(),
        destinationLat: finalLat,
        destinationLng: finalLng,
        distanceKm,
        platformFee,
        driverEarnings,
      }
    });

    if (updateCount.count === 0) {
      throw new Error('CONCURRENCY_ERROR: A corrida já foi finalizada por outra operação.');
    }

    // Libera ponteiros de corrida ativa
    await tx.passenger.update({ where: { id: ride.passengerId }, data: { currentRideId: null } });
    await tx.driver.update({ where: { id: ride.driverId! }, data: { currentRideId: null, isAvailable: true } });

    // Registra a receita da plataforma
    await tx.companyWallet.upsert({
      where: { id: 'bai245-main-wallet' },
      update: { balance: { increment: platformFee }, totalCollected: { increment: calculatedFare } },
      create: { id: 'bai245-main-wallet', balance: platformFee, totalCollected: calculatedFare },
    });

    await tx.transaction.create({
      data: {
        rideId: ride.id,
        passengerId: ride.passengerId,
        driverId: ride.driverId,
        type: 'COMMISSION_FEE',
        status: 'COMPLETED',
        amount: platformFee,
        reference: `FEE-${ride.id.slice(0, 8)}-${Date.now()}`,
        description: 'Taxa de serviço da plataforma BAI 245',
      },
    });

    // Repasse Mobile Money pendente para o motorista (Orange Money / MTN Money)
    const driverPhone = ride.driver?.orangeNumber || ride.driver?.mtnNumber || ride.driver?.phone;
    await tx.transaction.create({
      data: {
        rideId: ride.id,
        driverId: ride.driverId,
        type: 'DRIVER_PAYOUT',
        status: 'PENDING',
        amount: driverEarnings,
        reference: `PAYOUT-PENDING-${ride.id.slice(0, 8)}-${Date.now()}`,
        description: `Repasse Mobile Money pendente para motorista (${driverPhone})`,
      },
    });

    const completedRide = await tx.ride.findUnique({ where: { id: ride.id } });

    return { success: true, ride: completedRide, fareXOF: calculatedFare, distanceKm };
  });
}

// -----------------------------------------------------------------------------
// 7. CANCELAMENTO SEGURO COM PENALIDADES
// -----------------------------------------------------------------------------
export async function cancelRideLogic(rideId: string, userId: string, userType: 'PASSENGER' | 'DRIVER', reason?: string) {
  const ride = await prisma.ride.findUnique({ where: { id: rideId } });
  
  if (!ride) throw new Error('Corrida não encontrada.');
  if (['COMPLETED', 'CANCELLED'].includes(ride.status)) {
    throw new Error('Esta corrida já foi finalizada ou cancelada.');
  }

  let applyPenalty = false;

  if (userType === 'PASSENGER' && (ride.status === 'ARRIVED' || (ride.status === 'ACCEPTED' && ride.acceptedAt))) {
    if (ride.status === 'ARRIVED') {
      applyPenalty = true;
    } else if (ride.acceptedAt) {
      const diffInMinutes = (new Date().getTime() - new Date(ride.acceptedAt).getTime()) / (1000 * 60);
      if (diffInMinutes > FREE_CANCELLATION_MINUTES) {
        applyPenalty = true;
      }
    }
  }

  await prisma.$transaction(async (tx) => {
    const updatedRide = await tx.ride.updateMany({
      where: { id: rideId, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
      data: { 
        status: 'CANCELLED', 
        cancellationReason: reason || 'Cancelado pelo usuário', 
        cancelledBy: userType, 
        cancelledById: userId 
      },
    });

    if (updatedRide.count === 0) {
      throw new Error('STATE_CONFLICT: A corrida já foi alterada por outra transação.');
    }

    // Desvincula ativamente a corrida do passageiro e do motorista
    await tx.passenger.update({
      where: { id: ride.passengerId },
      data: { 
        currentRideId: null, 
        ...(applyPenalty && { walletBalance: { decrement: CANCELLATION_FEE_XOF } }) 
      }
    });

    if (ride.driverId) {
      await tx.driver.update({
        where: { id: ride.driverId },
        data: { 
          currentRideId: null, 
          isAvailable: true, 
          ...(applyPenalty && { walletBalance: { increment: Math.round(CANCELLATION_FEE_XOF * 0.7) } }) 
        }
      });
    }

    if (applyPenalty && ride.driverId) {
      await tx.transaction.create({
        data: {
          passengerId: ride.passengerId,
          driverId: ride.driverId,
          rideId: ride.id,
          type: 'REFUND',
          amount: CANCELLATION_FEE_XOF,
          status: 'COMPLETED',
          reference: `FEE-CANCEL-${ride.id.slice(0, 8)}-${Date.now()}`,
          description: `Taxa de cancelamento após ${FREE_CANCELLATION_MINUTES} minutos.`
        }
      });
    }
  });

  return { success: true, appliedPenalty: applyPenalty, penaltyAmount: applyPenalty ? CANCELLATION_FEE_XOF : 0 };
}