import cron from 'node-cron';
import { RideStatus, TransactionStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { redis } from '../lib/redis';
import { getIo } from '../server';
import { sendPushNotification, PUSH_CHANNELS } from '../services/pushNotifications';

const PAYMENT_TIMEOUT_MINUTES = 5;
const SEARCHING_TIMEOUT_MINUTES = 15;
const ABANDONED_RIDE_TIMEOUT_MINUTES = 45;
const STATIONARY_CHECK_MINUTES = 5;
const SAFETY_ALERT_COOLDOWN_SECONDS = 900; // 15 minutos entre alertas de segurança

// -----------------------------------------------------------------------------
// 1. VARREDURA DE CORRIDAS COM PAGAMENTO EXPIRADO, SEARCHING OU ABANDONADAS
// -----------------------------------------------------------------------------
export async function sweepStuckRides() {
  const now = Date.now();
  const paymentThreshold = new Date(now - PAYMENT_TIMEOUT_MINUTES * 60 * 1000);
  const searchingThreshold = new Date(now - SEARCHING_TIMEOUT_MINUTES * 60 * 1000);
  const abandonedThreshold = new Date(now - ABANDONED_RIDE_TIMEOUT_MINUTES * 60 * 1000);

  // A. Expiração de Pagamentos (AWAITING_PAYMENT)
  const paymentStuckRides = await prisma.ride.findMany({
    where: {
      status: RideStatus.AWAITING_PAYMENT,
      createdAt: { lte: paymentThreshold }
    },
    select: { id: true, passengerId: true }
  });

  for (const ride of paymentStuckRides) {
    try {
      const wasCancelled = await prisma.$transaction(async (tx) => {
        const updated = await tx.ride.updateMany({
          where: { id: ride.id, status: RideStatus.AWAITING_PAYMENT },
          data: { 
            status: RideStatus.CANCELLED, 
            cancellationReason: 'PAYMENT_TIMEOUT',
            version: { increment: 1 } 
          }
        });

        if (updated.count > 0) {
          await tx.passenger.update({
            where: { id: ride.passengerId },
            data: { currentRideId: null }
          });

          await tx.transaction.updateMany({
            where: { 
              rideId: ride.id, 
              status: { in: [TransactionStatus.PENDING, TransactionStatus.PENDING_VERIFICATION] } 
            },
            data: { status: TransactionStatus.FAILED, failureReason: 'PAYMENT_TIMEOUT' }
          });

          return true;
        }
        return false;
      });

      if (wasCancelled) {
        notifyAndCleanUp(ride.id, ride.passengerId, null, 'TIMEOUT_EXPIRED', 'Tempo limite para confirmação de pagamento expirou.');
      }
    } catch (error) {
      console.error(`⚠️ [WORKER] Erro ao expirar pagamento da corrida ${ride.id}:`, error);
    }
  }

  // B. Expiração de Busca sem Motorista (SEARCHING > 15 min)
  const searchingStuckRides = await prisma.ride.findMany({
    where: {
      status: RideStatus.SEARCHING,
      createdAt: { lte: searchingThreshold }
    },
    select: { id: true, passengerId: true }
  });

  for (const ride of searchingStuckRides) {
    try {
      const wasCancelled = await prisma.$transaction(async (tx) => {
        const updated = await tx.ride.updateMany({
          where: { id: ride.id, status: RideStatus.SEARCHING },
          data: { 
            status: RideStatus.CANCELLED, 
            cancellationReason: 'SEARCH_TIMEOUT_NO_DRIVERS',
            version: { increment: 1 } 
          }
        });

        if (updated.count > 0) {
          await tx.passenger.update({
            where: { id: ride.passengerId },
            data: { currentRideId: null }
          });
          return true;
        }
        return false;
      });

      if (wasCancelled) {
        notifyAndCleanUp(ride.id, ride.passengerId, null, 'SEARCH_TIMEOUT', 'Nenhum motorista encontrado. Tente novamente em alguns minutos.');
      }
    } catch (error) {
      console.error(`⚠️ [WORKER] Erro ao cancelar busca expirada ${ride.id}:`, error);
    }
  }

  // C. Limpeza de Corridas Órfãs/Abandonadas (ACCEPTED ou ARRIVED > 45 min)
  const abandonedRides = await prisma.ride.findMany({
    where: {
      status: { in: [RideStatus.ACCEPTED, RideStatus.ARRIVED] },
      updatedAt: { lte: abandonedThreshold }
    },
    select: { id: true, passengerId: true, driverId: true }
  });

  for (const ride of abandonedRides) {
    try {
      const wasCancelled = await prisma.$transaction(async (tx) => {
        const updated = await tx.ride.updateMany({
          where: { id: ride.id, status: { in: [RideStatus.ACCEPTED, RideStatus.ARRIVED] } },
          data: { 
            status: RideStatus.CANCELLED, 
            cancellationReason: 'ABANDONED_STALE_RIDE',
            version: { increment: 1 } 
          }
        });

        if (updated.count > 0) {
          await tx.passenger.update({
            where: { id: ride.passengerId },
            data: { currentRideId: null }
          });

          if (ride.driverId) {
            await tx.driver.update({
              where: { id: ride.driverId },
              data: { currentRideId: null, isAvailable: true }
            });
          }
          return true;
        }
        return false;
      });

      if (wasCancelled) {
        notifyAndCleanUp(ride.id, ride.passengerId, ride.driverId, 'RIDE_ABANDONED', 'Corrida cancelada automaticamente por inatividade prolongada.');
      }
    } catch (error) {
      console.error(`⚠️ [WORKER] Erro ao limpar corrida abandonada ${ride.id}:`, error);
    }
  }
}

// -----------------------------------------------------------------------------
// HELPER AUXILIAR PARA PURGA DE CACHE E NOTIFICAÇÕES MULTI-SALAS
// -----------------------------------------------------------------------------
async function notifyAndCleanUp(rideId: string, passengerId: string, driverId: string | null, reasonCode: string, userMsg: string) {
  try {
    const io = getIo();
    if (io) {
      const rooms = [
        rideId,
        passengerId,
        `passenger_${passengerId}`,
        `passenger:${passengerId}`,
        `user_${passengerId}`
      ];

      if (driverId) {
        rooms.push(driverId, `driver_${driverId}`, `driver:${driverId}`, `user_${driverId}`);
      }

      rooms.forEach(room => {
        io.to(room).emit('ride:cancelled', {
          rideId,
          reason: reasonCode,
          message: userMsg
        });
      });
    }
  } catch (wsErr) {
    console.warn(`⚠️ Erro ao emitir Sockets de cancelamento para corrida ${rideId}:`, wsErr);
  }

  try {
    if (redis) {
      await redis.del(`active_ride:${rideId}`).catch(() => null);
      await redis.del(`lock:accept_ride:${rideId}`).catch(() => null);
      if (driverId) {
        await redis.del(`driver_active_ride:${driverId}`).catch(() => null);
      }
    }
  } catch (redisErr) {
    console.warn(`⚠️ Erro ao purgar Redis para corrida ${rideId}:`, redisErr);
  }
}

// -----------------------------------------------------------------------------
// 2. CHECAGEM DE SEGURANÇA: VEÍCULO PARADO HÁ MAIS DE 5 MINUTOS (COM DEDUPLICAÇÃO)
// -----------------------------------------------------------------------------
export async function checkStationaryRides() {
  try {
    const stationaryThreshold = new Date(Date.now() - STATIONARY_CHECK_MINUTES * 60 * 1000);

    const stationaryRides = await prisma.ride.findMany({
      where: {
        status: RideStatus.IN_PROGRESS,
        updatedAt: { lte: stationaryThreshold }
      },
      include: { passenger: { select: { id: true, deviceToken: true } } }
    });

    for (const ride of stationaryRides) {
      // 🛡️ TRAVA DE IDEMPOTÊNCIA NO REDIS: Evita spammed alerts a cada 60s
      const alertLockKey = `safety_alert:${ride.id}`;
      const hasRecentAlert = await redis.get(alertLockKey).catch(() => null);

      if (hasRecentAlert) {
        continue;
      }

      console.log(`🛡️ [SAFETY CHECK] Veículo estático na corrida ${ride.id}. Disparando alerta de segurança...`);
      await redis.set(alertLockKey, '1', 'EX', SAFETY_ALERT_COOLDOWN_SECONDS).catch(() => null);

      // 1. Socket Multi-Salas para Tempo Real
      try {
        const io = getIo();
        if (io) {
          const rooms = [
            ride.id,
            ride.passengerId,
            `passenger_${ride.passengerId}`,
            `passenger:${ride.passengerId}`,
            `user_${ride.passengerId}`
          ];

          rooms.forEach(room => {
            io.to(room).emit('ride:safety_check', {
              rideId: ride.id,
              message: 'Notamos que seu veículo está parado há algum tempo. Está tudo bem com você?'
            });
          });
        }
      } catch (err) {
        console.warn(`⚠️ Erro ao emitir Socket Safety Check:`, err);
      }

      // 2. Push Notification em Segundo Plano
      if (ride.passenger?.deviceToken) {
        sendPushNotification(
          ride.passenger.deviceToken,
          '🛡️ Checagem de Segurança Nô Bai 245',
          'Notamos que seu veículo está parado há algum tempo. Está tudo bem com você?',
          { type: 'SAFETY_CHECK', rideId: ride.id },
          PUSH_CHANNELS.RIDE_UPDATE
        ).catch(() => null);
      }
    }
  } catch (error) {
    console.error('❌ Erro na varredura de veículos parados:', error);
  }
}

// Agendamento cron com isolamento de erros
cron.schedule('* * * * *', async () => {
  try {
    await sweepStuckRides();
    await checkStationaryRides();
  } catch (cronErr) {
    console.error('❌ [CRON JOB ERROR] Falha na execução da rotina de limpeza:', cronErr);
  }
});