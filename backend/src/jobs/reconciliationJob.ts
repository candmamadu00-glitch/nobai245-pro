import cron from 'node-cron';
import { TransactionType, TransactionStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { getIo } from '../server';
import { verifyTransactionStatus } from '../services/mobileMoneyService';

const RECONCILE_BATCH_SIZE = 50;
const SEARCH_TIMEOUT_MINUTES = 3;
const PAYMENT_TIMEOUT_MINUTES = 3;
const PROCESSING_TIMEOUT_MINUTES = 30;

let isReconciliationRunning = false;
let isEscrowRunning = false;

export const startCronJobs = (): void => {
  // CRON DE RECONCILIAÇÃO (A cada 10 minutos)
  cron.schedule('*/10 * * * *', async () => {
    if (isReconciliationRunning) return;
    isReconciliationRunning = true;

    console.log('🔄 [RECONCILIAÇÃO] Iniciando varredura de transações pendentes...');

    try {
      const now = Date.now();
      const minAge = new Date(now - 2 * 60 * 1000);
      const maxAge = new Date(now - 24 * 60 * 60 * 1000);
      const zombieThreshold = new Date(now - PROCESSING_TIMEOUT_MINUTES * 60 * 1000);

      // Desbloqueia transações presas em PROCESSING há muito tempo
      await prisma.transaction.updateMany({
        where: {
          status: TransactionStatus.PROCESSING,
          updatedAt: { lte: zombieThreshold },
        },
        data: {
          status: TransactionStatus.PENDING_VERIFICATION,
          updatedAt: new Date(),
        },
      });

      const doubtfulTransactions = await prisma.transaction.findMany({
        where: {
          status: { in: [TransactionStatus.PENDING, TransactionStatus.PENDING_VERIFICATION] },
          createdAt: { lte: minAge, gte: maxAge },
        },
        include: { passenger: true },
        take: RECONCILE_BATCH_SIZE,
        orderBy: { updatedAt: 'asc' },
      });

      for (const tx of doubtfulTransactions) {
        try {
          const lock = await prisma.transaction.updateMany({
            where: { id: tx.id, status: tx.status },
            data: { status: TransactionStatus.PROCESSING },
          });

          if (lock.count === 0) continue;

          const realStatus = await verifyTransactionStatus(tx.id);

          if (realStatus.status === 'SUCCESS') {
            const { updatedRide, needsRefund } = await prisma.$transaction(async (txDB) => {
              // 🛡️ Regra de Ouro: Pagamento de corrida vai para HELD_IN_ESCROW.
              const finalStatus =
                tx.type === TransactionType.RIDE_PAYMENT
                  ? TransactionStatus.HELD_IN_ESCROW
                  : TransactionStatus.COMPLETED;

              await txDB.transaction.update({
                where: { id: tx.id },
                data: {
                  status: finalStatus,
                  externalRef: realStatus.ref,
                  failureReason: null,
                },
              });

              if (!tx.rideId) return { updatedRide: null, needsRefund: false };

              const rideUpdate = await txDB.ride.updateMany({
                where: { id: tx.rideId, status: 'AWAITING_PAYMENT' },
                data: { status: 'SEARCHING' },
              });

              if (rideUpdate.count === 0) {
                const ride = await txDB.ride.findUnique({
                  where: { id: tx.rideId },
                  include: { passenger: true },
                });

                if (ride) {
                  const refund = await txDB.transaction.create({
                    data: {
                      rideId: ride.id,
                      passengerId: ride.passengerId,
                      type: TransactionType.REFUND,
                      status: TransactionStatus.PENDING,
                      amount: Number(ride.priceXof),
                      paymentMethod: tx.paymentMethod,
                      reference: `REFUND-REC-${ride.id.slice(-6)}-${Date.now()}`,
                      description: 'Estorno: Pagamento confirmado após cancelamento',
                    },
                  });

                  await txDB.outboxEvent.create({
                    data: {
                      eventType: 'PROCESS_REFUND',
                      payload: {
                        transactionId: refund.id,
                        rideId: ride.id,
                        passengerId: ride.passengerId,
                        phone:
                          ride.passenger?.paymentAccountNumber ||
                          tx.passenger?.paymentAccountNumber ||
                          '',
                        amountXOF: Number(ride.priceXof),
                        provider: tx.paymentMethod || 'ORANGE_MONEY',
                        originalRef: realStatus.ref,
                      },
                    },
                  });
                }
                return { updatedRide: null, needsRefund: true };
              }

              const ride = await txDB.ride.findUnique({ where: { id: tx.rideId } });
              return { updatedRide: ride, needsRefund: false };
            });

            if (needsRefund) {
              console.warn(
                `🚨 [RECONCILIAÇÃO] Pagamento confirmado tarde demais (Corrida ${tx.rideId}). Estorno registrado no Outbox.`
              );
            }

            if (updatedRide) {
              const io = getIo();
              if (io) {
                io.to(updatedRide.id).emit('ride:payment_success', {
                  message: 'Pagamento confirmado!',
                });
                io.to(`passenger_${updatedRide.passengerId}`).emit('ride:payment_success', {
                  message: 'Pagamento confirmado!',
                });
                io.to('available_drivers').emit('ride:new_request', {
                  rideId: updatedRide.id,
                  passengerId: updatedRide.passengerId,
                  pickupLat: updatedRide.originLat,
                  pickupLng: updatedRide.originLng,
                  originAddress: updatedRide.originAddress,
                  destinationLat: updatedRide.destinationLat,
                  destinationLng: updatedRide.destinationLng,
                  destinationAddress: updatedRide.destinationAddress,
                  fareXOF: Number(updatedRide.priceXof),
                  vehicleType: updatedRide.requestedVehicleType,
                });
              }
            }
          } else if (realStatus.status === 'FAILED') {
            await prisma.$transaction(async (txDB) => {
              await txDB.transaction.update({
                where: { id: tx.id },
                data: {
                  status: TransactionStatus.FAILED,
                  failureReason: 'Recusado na reconciliação de operadora.',
                },
              });

              if (tx.rideId) {
                await txDB.ride.updateMany({
                  where: { id: tx.rideId, status: { in: ['AWAITING_PAYMENT', 'SEARCHING'] } },
                  data: {
                    status: 'CANCELLED',
                    cancellationReason: 'Pagamento recusado na reconciliação.',
                  },
                });

                if (tx.passengerId) {
                  await txDB.passenger.update({
                    where: { id: tx.passengerId },
                    data: { currentRideId: null },
                  });
                }
              }
            });

            if (tx.rideId) {
              const io = getIo();
              if (io) {
                io.to(tx.rideId).emit('ride:payment_failed', {
                  message: 'Pagamento recusado na verificação.',
                });
                if (tx.passengerId) {
                  io.to(`passenger_${tx.passengerId}`).emit('ride:payment_failed', {
                    message: 'Pagamento recusado na verificação.',
                  });
                }
              }
            }
          } else {
            await prisma.transaction
              .update({
                where: { id: tx.id },
                data: { status: TransactionStatus.PENDING_VERIFICATION, updatedAt: new Date() },
              })
              .catch(() => {});
          }
        } catch (err) {
          console.error(`❌ [RECONCILIAÇÃO] Erro transação ${tx.id}:`, err);
        }
      }
    } catch (error) {
      console.error('❌ [RECONCILIAÇÃO] Falha crítica no job:', error);
    } finally {
      isReconciliationRunning = false;
    }
  });

  // CRON DE TIMEOUT DE CORRIDAS E ESCROW (A cada 1 minuto)
  cron.schedule('* * * * *', async () => {
    if (isEscrowRunning) return;
    isEscrowRunning = true;

    try {
      const searchTimeoutThreshold = new Date(Date.now() - SEARCH_TIMEOUT_MINUTES * 60 * 1000);
      const paymentTimeoutThreshold = new Date(Date.now() - PAYMENT_TIMEOUT_MINUTES * 60 * 1000);

      // 1. Processa corridas presas em SEARCHING
      const stuckRides = await prisma.ride.findMany({
        where: { status: 'SEARCHING', updatedAt: { lte: searchTimeoutThreshold } },
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

          const newRefundTx = await prisma.$transaction(async (tx) => {
            const updated = await tx.ride.updateMany({
              where: { id: ride.id, status: 'SEARCHING' },
              data: { status: 'CANCELLED', cancellationReason: 'Tempo de busca expirado' },
            });

            if (updated.count === 0) return null;

            await tx.passenger.update({
              where: { id: ride.passengerId },
              data: { currentRideId: null },
            });

            if (!originalTx) return null;

            // Altera o status da transação original para REVERSED
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
                amount: Number(ride.priceXof),
                paymentMethod: originalTx.paymentMethod,
                reference: `REFUND-${ride.id.slice(-6)}-${Date.now()}`,
                description: 'Devolução de corrida não aceita',
              },
            });

            await tx.outboxEvent.create({
              data: {
                eventType: 'PROCESS_REFUND',
                payload: {
                  transactionId: refund.id,
                  rideId: ride.id,
                  passengerId: ride.passengerId,
                  phone: ride.passenger?.paymentAccountNumber || '',
                  amountXOF: Number(ride.priceXof),
                  provider: originalTx.paymentMethod || 'ORANGE_MONEY',
                  originalRef: originalTx.externalRef,
                },
              },
            });

            return refund;
          });

          if (newRefundTx && originalTx) {
            const io = getIo();
            if (io) {
              io.to(ride.id).emit('ride:timeout', {
                message: 'Nenhum motorista aceitou. Estorno iniciado automaticamente.',
              });
              io.to(`passenger_${ride.passengerId}`).emit('ride:timeout', {
                message: 'Nenhum motorista aceitou. Estorno iniciado automaticamente.',
              });
            }
          }
        } catch (err) {
          console.error(`❌ [ESCROW] Erro ao processar estorno da corrida ${ride.id}:`, err);
        }
      }

      // 2. Processa corridas presas em AWAITING_PAYMENT
      const unpaidRides = await prisma.ride.findMany({
        where: { status: 'AWAITING_PAYMENT', updatedAt: { lte: paymentTimeoutThreshold } },
      });

      for (const ride of unpaidRides) {
        try {
          const wasCancelled = await prisma.$transaction(async (tx) => {
            const updated = await tx.ride.updateMany({
              where: { id: ride.id, status: 'AWAITING_PAYMENT' },
              data: { status: 'CANCELLED', cancellationReason: 'Tempo limite do PIN expirou' },
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
                failureReason: 'Passageiro não digitou o PIN no tempo limite',
              },
            });

            return true;
          });

          if (wasCancelled) {
            const io = getIo();
            if (io) {
              io.to(ride.id).emit('ride:timeout', {
                message: 'O tempo limite para aprovar o pagamento expirou.',
              });
              io.to(`passenger_${ride.passengerId}`).emit('ride:timeout', {
                message: 'O tempo limite para aprovar o pagamento expirou.',
              });
            }
          }
        } catch (err) {
          console.error(`❌ [ESCROW] Erro ao cancelar corrida ${ride.id}:`, err);
        }
      }
    } catch (error) {
      console.error('❌ [ESCROW] Falha crítica no job:', error);
    } finally {
      isEscrowRunning = false;
    }
  });
};