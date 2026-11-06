import cron from 'node-cron';
import { TransactionType, TransactionStatus, RideStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { getIo } from '../server';
import { enqueueRefundJob } from './payoutQueue';

const SEARCH_TIMEOUT_MINUTES = 3;
const PAYMENT_TIMEOUT_MINUTES = 3;

let isEscrowRunning = false;

export const processEscrowTimeouts = async (): Promise<void> => {
  if (isEscrowRunning) return;
  isEscrowRunning = true;

  try {
    const now = Date.now();
    const searchTimeoutThreshold = new Date(now - SEARCH_TIMEOUT_MINUTES * 60 * 1000);
    const paymentTimeoutThreshold = new Date(now - PAYMENT_TIMEOUT_MINUTES * 60 * 1000);

    // 1. Corridas pagas em SEARCHING sem aceite de motorista (Dispara estorno via USSD)
    const stuckRides = await prisma.ride.findMany({
      where: {
        status: RideStatus.SEARCHING,
        updatedAt: { lte: searchTimeoutThreshold },
      },
      include: {
        passenger: true,
        transactions: {
          where: {
            status: TransactionStatus.HELD_IN_ESCROW,
            type: TransactionType.RIDE_PAYMENT,
          },
          take: 1,
        },
      },
    });

    for (const ride of stuckRides) {
      try {
        const originalTx = ride.transactions[0];
        let refundTxId = '';

        await prisma.$transaction(async (tx) => {
          const updated = await tx.ride.updateMany({
            where: { id: ride.id, status: RideStatus.SEARCHING },
            data: {
              status: RideStatus.CANCELLED,
              cancellationReason: 'Nenhum motorista aceitou no tempo limite.',
              cancelledAt: new Date(),
            },
          });

          if (updated.count === 0) return;

          await tx.passenger.update({
            where: { id: ride.passengerId },
            data: { currentRideId: null },
          });

          if (!originalTx) return;

          await tx.transaction.update({
            where: { id: originalTx.id },
            data: { status: TransactionStatus.REVERSED },
          });

          const refund = await tx.transaction.create({
            data: {
              rideId: ride.id,
              passengerId: ride.passengerId,
              type: TransactionType.REFUND,
              status: TransactionStatus.PENDING,
              amount: ride.priceXof,
              paymentMethod: originalTx.paymentMethod,
              reference: `REFUND-TIMEOUT-${ride.id.slice(0, 8)}-${Date.now()}`,
              description: 'Estorno automático: Nenhum motorista aceitou a corrida.',
            },
          });

          refundTxId = refund.id;
        });

        if (refundTxId && originalTx && ride.passenger) {
          const phone = ride.passenger.paymentAccountNumber || ride.passenger.phone;

          await enqueueRefundJob({
            transactionId: refundTxId,
            rideId: ride.id,
            passengerId: ride.passengerId,
            phone,
            amountXOF: Number(ride.priceXof),
            provider: originalTx.paymentMethod || 'ORANGE_MONEY',
          }).catch((err) => console.error(`⚠️ [ESCROW] Erro ao enfileirar estorno da corrida ${ride.id}:`, err));

          const io = getIo();
          if (io) {
            io.to(ride.id).to(`passenger_${ride.passengerId}`).emit('ride:timeout', {
              rideId: ride.id,
              message: 'Nenhum motorista aceitou a corrida. O valor foi estornado automaticamente para a sua conta.',
            });
          }
        }
      } catch (err) {
        console.error(`❌ [ESCROW] Erro ao processar timeout da corrida ${ride.id}:`, err);
      }
    }

    // 2. Corridas em AWAITING_PAYMENT sem confirmação de SMS
    const unpaidRides = await prisma.ride.findMany({
      where: {
        status: RideStatus.AWAITING_PAYMENT,
        updatedAt: { lte: paymentTimeoutThreshold },
      },
    });

    for (const ride of unpaidRides) {
      try {
        const wasCancelled = await prisma.$transaction(async (tx) => {
          const updated = await tx.ride.updateMany({
            where: { id: ride.id, status: RideStatus.AWAITING_PAYMENT },
            data: {
              status: RideStatus.CANCELLED,
              cancellationReason: 'Tempo limite de pagamento expirou.',
              cancelledAt: new Date(),
            },
          });

          if (updated.count === 0) return false;

          await tx.passenger.update({
            where: { id: ride.passengerId },
            data: { currentRideId: null },
          });

          await tx.transaction.updateMany({
            where: {
              rideId: ride.id,
              status: {
                in: [TransactionStatus.PENDING, TransactionStatus.PENDING_VERIFICATION],
              },
            },
            data: {
              status: TransactionStatus.FAILED,
              failureReason: 'Cobrança expirada sem confirmação por SMS.',
            },
          });

          return true;
        });

        if (wasCancelled) {
          const io = getIo();
          if (io) {
            io.to(ride.id).to(`passenger_${ride.passengerId}`).emit('ride:timeout', {
              rideId: ride.id,
              message: 'O tempo limite para aprovar o pagamento expirou.',
            });
          }
        }
      } catch (err) {
        console.error(`❌ [ESCROW] Erro ao expirar pagamento da corrida ${ride.id}:`, err);
      }
    }
  } catch (error) {
    console.error('❌ [ESCROW JOB] Falha geral no job:', error);
  } finally {
    isEscrowRunning = false;
  }
};

export const startEscrowCronJob = (): void => {
  cron.schedule('* * * * *', async () => {
    await processEscrowTimeouts();
  });
  console.log('⏰ [CRON JOB] Agendador de Escrow Timeout ativo (a cada 1 minuto).');
};