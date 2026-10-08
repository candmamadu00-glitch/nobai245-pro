import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import { prisma } from '../config/prisma';
import { refundPassengerMobileMoney } from '../services/mobileMoneyService'; // Supondo que você tem ou vai criar essa função

const redisConnection = { 
  host: process.env.REDIS_HOST || '127.0.0.1', 
  port: Number(process.env.REDIS_PORT) || 6379,
  maxRetriesPerRequest: null
};

// Cria a Fila de Estornos
export const refundQueue = new Queue('passenger-refund', { connection: redisConnection });

const processRefundJob = async (job: Job) => {
  const { transactionId, rideId, passengerId, amountXOF, phone, provider } = job.data;
  console.log(`♻️ [REFUND] Iniciando devolução de ${amountXOF} XOF para passageiro ${passengerId}`);

  // Bloqueio Atômico Anti-Duplicidade
  const lockedTx = await prisma.transaction.updateMany({
    where: { 
      id: transactionId, 
      status: 'PENDING' 
    },
    data: { status: 'PROCESSING' }
  });

  if (lockedTx.count === 0) {
    console.log(`⚠️ Refund Ignorado: Transação ${transactionId} já processada.`);
    return { success: true, cached: true };
  }

  try {
    // Chama a API de Refund da Orange/MTN
    const result = await refundPassengerMobileMoney({
      provider, 
      phone, 
      amount: amountXOF, 
      rideId, 
      refundId: transactionId
    });

    if (!result.success) {
      if (result.error === 'TIMEOUT_REQUIRES_RECONCILIATION') throw new Error('TIMEOUT_REQUIRES_RECONCILIATION');
      throw new Error(`FALHA_LOGICA: ${result.error}`);
    }

    // Sucesso na devolução
    await prisma.transaction.update({
      where: { id: transactionId },
      data: { status: 'COMPLETED', externalRef: result.providerRef, description: 'Estorno efetuado com sucesso', completedAt: new Date() }
    });

    return { success: true, passengerId, amountXOF };

  } catch (error: any) {
    if (error.message.includes('FALHA_LOGICA')) {
      await prisma.transaction.update({
        where: { id: transactionId },
        data: { status: 'FAILED_MANUAL_REVIEW', description: error.message }
      });
      return { success: false, reason: 'Falha na operadora.' };
    }
    // Reverte para PENDING se for erro de rede, para o BullMQ tentar de novo
    await prisma.transaction.update({ where: { id: transactionId }, data: { status: 'PENDING' }});
    throw error; 
  }
};

export const refundWorker = new Worker('passenger-refund', processRefundJob, { 
  connection: redisConnection, 
  limiter: { max: 5, duration: 1000 } // Máx 5 estornos por segundo
});