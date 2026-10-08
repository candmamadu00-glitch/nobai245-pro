import cron from 'node-cron';
import { prisma } from '../lib/prisma';
import { enqueueRefundJob } from '../jobs/payoutQueue';

let isOutboxRunning = false;

export const startOutboxWorker = (): void => {
  // Roda a cada 1 minuto processando a fila do Outbox
  cron.schedule('* * * * *', async () => {
    if (isOutboxRunning) return;
    isOutboxRunning = true;

    try {
      // Busca até 20 eventos não processados (isProcessed = false)
      const pendingEvents = await prisma.outboxEvent.findMany({
        where: { isProcessed: false },
        take: 20,
        orderBy: { createdAt: 'asc' },
      });

      if (pendingEvents.length > 0) {
        console.log(`📦 [OUTBOX] Processando ${pendingEvents.length} eventos pendentes...`);
      }

      for (const event of pendingEvents) {
        try {
          const payload = event.payload as Record<string, any>;

          if (event.eventType === 'PROCESS_REFUND') {
            console.log(
              `💸 [OUTBOX ESTORNO] Enfileirando devolução de ${payload?.amountXOF} XOF para ${payload?.phone}...`
            );

            if (payload?.transactionId && payload?.passengerId && payload?.amountXOF && payload?.phone) {
              await enqueueRefundJob({
                transactionId: payload.transactionId,
                rideId: payload.rideId,
                passengerId: payload.passengerId,
                phone: payload.phone,
                amountXOF: Number(payload.amountXOF),
                provider: payload.provider || 'ORANGE_MONEY'
              });
            }

            // Marca o evento como processado
            await prisma.outboxEvent.update({
              where: { id: event.id },
              data: { isProcessed: true },
            });

            console.log(`✅ [OUTBOX] Evento de estorno ${payload?.transactionId} enfileirado no BullMQ.`);
          }
        } catch (error: any) {
          console.error(
            `❌ [OUTBOX] Erro ao processar evento ${event.id}:`,
            error?.message || error
          );
        }
      }
    } catch (error) {
      console.error('❌ [OUTBOX] Falha crítica no worker:', error);
    } finally {
      isOutboxRunning = false;
    }
  });
};