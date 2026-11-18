import cron from 'node-cron';
import { prisma } from '../lib/prisma';
import { enqueueRefundJob } from '../jobs/payoutQueue';
import { safeRedis } from '../server';

let isOutboxRunning = false;

export const startOutboxWorker = (): void => {
  // Roda a cada 1 minuto processando a fila transacional do Outbox
  cron.schedule('* * * * *', async () => {
    if (isOutboxRunning) return;
    isOutboxRunning = true;

    try {
      const pendingEvents = await prisma.outboxEvent.findMany({
        where: { isProcessed: false },
        take: 25,
        orderBy: { createdAt: 'asc' },
      });

      if (pendingEvents.length > 0) {
        console.log(`📦 [OUTBOX] Processando ${pendingEvents.length} eventos pendentes...`);
      }

      for (const event of pendingEvents) {
        const lockKey = `outbox:lock:${event.id}`;
        const acquired = await safeRedis.set(lockKey, '1', { NX: true, EX: 120 }).catch(() => 'OK');
        if (acquired === null) continue;

        try {
          const payload = (event.payload || {}) as Record<string, any>;

          if (event.eventType === 'PROCESS_REFUND') {
            let targetPhone = String(payload.phone || '').trim();

            if (!targetPhone && payload.passengerId) {
              const passenger = await prisma.passenger.findUnique({
                where: { id: String(payload.passengerId) },
                select: { paymentAccountNumber: true, phone: true },
              });
              targetPhone = String(passenger?.paymentAccountNumber || passenger?.phone || '').trim();
            }

            const amountXOF = Math.round(Number(payload.amountXOF || 0));

            if (!payload.transactionId || !payload.passengerId || amountXOF <= 0 || !targetPhone) {
              console.warn(`⚠️ [OUTBOX] Evento de estorno ${event.id} com dados insuficientes (phone=${targetPhone}, amount=${amountXOF}).`);
              if (payload.transactionId) {
                await prisma.transaction.updateMany({
                  where: { id: String(payload.transactionId), status: 'PENDING' },
                  data: {
                    status: 'FAILED',
                    failureReason: 'Telefone de destino ausente ou valor inválido para estorno automático.',
                  },
                }).catch(() => {});
              }
              await prisma.outboxEvent.update({
                where: { id: event.id },
                data: { isProcessed: true },
              });
              continue;
            }

            console.log(
              `💸 [OUTBOX ESTORNO] Enfileirando devolução de ${amountXOF} XOF para ${targetPhone}...`
            );

            await enqueueRefundJob({
              transactionId: String(payload.transactionId),
              rideId: String(payload.rideId || ''),
              passengerId: String(payload.passengerId),
              phone: targetPhone,
              amountXOF,
              provider: payload.provider || 'ORANGE_MONEY',
            });

            await prisma.outboxEvent.update({
              where: { id: event.id },
              data: { isProcessed: true },
            });

            console.log(`✅ [OUTBOX] Evento de estorno ${payload.transactionId} enfileirado no BullMQ.`);
          } else {
            console.warn(`⚠️ [OUTBOX] Tipo de evento desconhecido ignorado: ${event.eventType}`);
            await prisma.outboxEvent.update({
              where: { id: event.id },
              data: { isProcessed: true },
            });
          }
        } catch (error: any) {
          console.error(
            `❌ [OUTBOX] Erro ao processar evento ${event.id} (será reprocessado no próximo ciclo):`,
            error?.message || error
          );
        } finally {
          await safeRedis.del(lockKey).catch(() => {});
        }
      }
    } catch (error) {
      console.error('❌ [OUTBOX] Falha crítica no worker:', error);
    } finally {
      isOutboxRunning = false;
    }
  });
};
