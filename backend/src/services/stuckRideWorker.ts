import cron from 'node-cron';
import { RideStatus, TransactionStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { redis } from '../lib/redis';
import { getIo } from '../server';

const PAYMENT_TIMEOUT_MINUTES = 5;

export async function sweepStuckRides() {
  const expirationThreshold = new Date(Date.now() - PAYMENT_TIMEOUT_MINUTES * 60 * 1000);

  // Busca corridas que excederam a janela de tempo de pagamento
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
        // Notifica o aplicativo do passageiro sobre o timeout do pagamento
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

        // Limpa cache e travas ativas do Redis
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

// Agendamento cron para rodar a cada 1 minuto
cron.schedule('* * * * *', sweepStuckRides);