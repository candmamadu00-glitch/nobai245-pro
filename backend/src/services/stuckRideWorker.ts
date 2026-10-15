import cron from 'node-cron';
import { RideStatus, TransactionStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { getIo } from '../server';
import { sendPushNotification, PUSH_CHANNELS } from '../services/pushNotifications';

const PAYMENT_TIMEOUT_MINUTES = 5;
const STATIONARY_CHECK_MINUTES = 5;

// -----------------------------------------------------------------------------
// 1. VARREDURA DE CORRIDAS COM PAGAMENTO EXPIRADO
// -----------------------------------------------------------------------------
export async function sweepStuckRides() {
  const expirationThreshold = new Date(Date.now() - PAYMENT_TIMEOUT_MINUTES * 60 * 1000);

  const stuckRides = await prisma.ride.findMany({
    where: {
      status: RideStatus.AWAITING_PAYMENT,
      createdAt: { lte: expirationThreshold }
    },
    select: { id: true, passengerId: true }
  });

  if (stuckRides.length === 0) return;

  for (const ride of stuckRides) {
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
        try {
          const io = getIo();
          if (io) {
            io.to(ride.id).to(`passenger_${ride.passengerId}`).emit('ride:timeout', {
              rideId: ride.id,
              message: 'Tempo limite para confirmação de pagamento expirou.'
            });
          }
        } catch (wsErr) {
          console.warn(`⚠️ Erro ao emitir Socket para corrida ${ride.id}:`, wsErr);
        }

        try {
          if (redis) {
            await redis.del(`active_ride:${ride.id}`);
            await redis.del(`lock:accept_ride:${ride.id}`);
          }
        } catch (redisErr) {
          console.warn(`⚠️ Erro ao limpar cache Redis para corrida ${ride.id}:`, redisErr);
        }
      }
    } catch (error) {
      console.error(`⚠️ Erro ao expirar corrida ${ride.id}:`, error);
    }
  }
}

// -----------------------------------------------------------------------------
// 2. CHECAGEM DE SEGURANÇA: VEÍCULO PARADO HÁ MAIS DE 5 MINUTOS
// -----------------------------------------------------------------------------
export async function checkStationaryRides() {
  try {
    const stationaryThreshold = new Date(Date.now() - STATIONARY_CHECK_MINUTES * 60 * 1000);

    // Busca corridas em andamento sem atualização recente de localização
    const stationaryRides = await prisma.ride.findMany({
      where: {
        status: RideStatus.IN_PROGRESS,
        updatedAt: { lte: stationaryThreshold }
      },
      include: { passenger: { select: { id: true, deviceToken: true } } }
    });

    for (const ride of stationaryRides) {
      console.log(`🛡️ [SAFETY CHECK] Veículo estático na corrida ${ride.id}. Disparando alerta de segurança...`);

      // 1. Socket no App em Tempo Real
      try {
        const io = getIo();
        if (io) {
          io.to(`passenger_${ride.passengerId}`).emit('ride:safety_check', {
            rideId: ride.id,
            message: 'Notamos que seu veículo está parado há algum tempo. Está tudo bem com você?'
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

// Agendamento cron para rodar ambas as varreduras a cada 1 minuto
cron.schedule('* * * * *', async () => {
  await sweepStuckRides();
  await checkStationaryRides();
});