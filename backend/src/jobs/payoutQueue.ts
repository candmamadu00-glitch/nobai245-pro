import { Queue, Worker, Job, ConnectionOptions, UnrecoverableError } from 'bullmq';
import { TransactionStatus } from '@prisma/client';
import { prisma } from '../config/prisma'; 
import { getIo } from '../server';
import { payoutToDriverMobileMoney, refundPassengerMobileMoney, verifyTransactionStatus } from '../services/mobileMoneyService';

export interface PayoutJobData {
  transactionId: string;
  rideId: string;
  driverId: string;
  amountXOF: number;
  phone: string;
  provider: 'ORANGE_MONEY' | 'MTN_MOMO' | string;
}

export interface RefundJobData {
  transactionId: string;
  rideId: string;
  passengerId: string;
  phone: string;
  amountXOF: number;
  provider: 'ORANGE_MONEY' | 'MTN_MOMO' | string;
}

const redisConnection: ConnectionOptions = process.env.REDIS_URL
  ? {
      url: process.env.REDIS_URL,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    }
  : {
      host: process.env.REDIS_HOST || 'nobai245-redis',
      port: Number(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    };

const defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 5000,
  },
  removeOnComplete: {
    age: 24 * 3600,
    count: 1000,
  },
  removeOnFail: {
    age: 7 * 24 * 3600,
    count: 5000,
  },
};

export const orangePayoutQueue = new Queue<PayoutJobData>('orange-payout', { connection: redisConnection, defaultJobOptions });
export const mtnPayoutQueue = new Queue<PayoutJobData>('mtn-payout', { connection: redisConnection, defaultJobOptions });
export const refundQueue = new Queue<RefundJobData>('refund-queue', { connection: redisConnection, defaultJobOptions });

// -----------------------------------------------------------------------------
// 1. PROCESSADOR BLINDADO DE REPASSE (PAYOUT DO MOTORISTA VIA USSD)
// -----------------------------------------------------------------------------
const processPayoutBlindado = async (job: Job<PayoutJobData>) => {
  const { transactionId, rideId, driverId, amountXOF, phone, provider } = job.data || {};

  console.log(`💸 [JOB PAYOUT INICIADO] Tx: ${transactionId} | Motorista: ${driverId} | Valor: ${amountXOF} XOF`);

  if (!transactionId || !driverId || !amountXOF || !phone || !provider) {
    throw new UnrecoverableError('DADOS_JOB_INVALIDOS: Parâmetros de repasse ausentes.');
  }

  const currentTx = await prisma.transaction.findUnique({ where: { id: transactionId } });
  if (!currentTx) throw new UnrecoverableError(`TRANSACTION_NOT_FOUND: Tx ${transactionId}`);

  if (currentTx.status === TransactionStatus.COMPLETED) {
    return { success: true, cached: true, driverId, amountXOF, provider, ref: currentTx.externalRef };
  }
  if (currentTx.status === TransactionStatus.FAILED_MANUAL_REVIEW) {
    return { success: false, reason: 'REVISE_MANUALMENTE', driverId, amountXOF, provider };
  }

  const lockResult = await prisma.transaction.updateMany({
    where: { id: transactionId, status: { in: [TransactionStatus.PENDING, TransactionStatus.PENDING_VERIFICATION, TransactionStatus.FAILED] } },
    data: { status: TransactionStatus.PROCESSING },
  });

  if (lockResult.count === 0) {
    const recheckTx = await prisma.transaction.findUnique({ where: { id: transactionId } });
    if (recheckTx?.status === TransactionStatus.COMPLETED) return { success: true, cached: true, driverId, amountXOF, provider };
    throw new Error('CONCURRENT_PROCESSING: Transação em processamento.');
  }

  try {
    console.log(`📡 [JOB PAYOUT DISPARANDO USSD]: Destino: ${phone} | Valor: ${amountXOF} XOF...`);
    const result = await payoutToDriverMobileMoney({ provider, phone, amount: amountXOF, rideId, transactionId });

    if (!result.success) {
      await prisma.transaction.update({
        where: { id: transactionId },
        data: { status: TransactionStatus.FAILED_MANUAL_REVIEW, failureReason: result.details || result.error || 'Recusado' },
      });
      throw new UnrecoverableError(`REJEITADO_OPERADORA: ${result.details || result.error}`);
    }

    await prisma.transaction.update({
      where: { id: transactionId },
      data: { status: TransactionStatus.COMPLETED, externalRef: result.providerRef, failureReason: null },
    });

    return { success: true, driverId, amountXOF, provider, providerRef: result.providerRef, ussdCommand: result.ussdCommand };
  } catch (error: any) {
    if (error instanceof UnrecoverableError) throw error;
    await prisma.transaction.update({ where: { id: transactionId }, data: { status: TransactionStatus.PENDING_VERIFICATION } });
    throw error;
  }
};

// -----------------------------------------------------------------------------
// 2. PROCESSADOR BLINDADO DE ESTORNO (REFUND DO PASSAGEIRO VIA USSD)
// -----------------------------------------------------------------------------
const processRefundBlindado = async (job: Job<RefundJobData>) => {
  const { transactionId, rideId, passengerId, phone, amountXOF, provider } = job.data || {};

  console.log(`🔄 [JOB REFUND INICIADO] Tx: ${transactionId} | Passageiro: ${passengerId} | Valor: ${amountXOF} XOF`);

  if (!transactionId || !passengerId || !amountXOF || !phone || !provider) {
    throw new UnrecoverableError('DADOS_JOB_INVALIDOS: Parâmetros de estorno ausentes.');
  }

  const currentTx = await prisma.transaction.findUnique({ where: { id: transactionId } });
  if (!currentTx) throw new UnrecoverableError(`TRANSACTION_NOT_FOUND: Tx ${transactionId}`);

  if (currentTx.status === TransactionStatus.COMPLETED) {
    return { success: true, cached: true, passengerId, amountXOF, provider, ref: currentTx.externalRef };
  }

  await prisma.transaction.updateMany({
    where: { id: transactionId, status: { in: [TransactionStatus.PENDING, TransactionStatus.PENDING_VERIFICATION] } },
    data: { status: TransactionStatus.PROCESSING },
  });

  try {
    const result = await refundPassengerMobileMoney({
      provider,
      phone,
      amount: amountXOF,
      rideId,
      transactionId
    });

    if (!result.success) {
      await prisma.transaction.update({
        where: { id: transactionId },
        data: { status: TransactionStatus.FAILED_MANUAL_REVIEW, failureReason: result.error },
      });
      throw new UnrecoverableError(`ESTORNO_RECUSADO: ${result.error}`);
    }

    await prisma.transaction.update({
      where: { id: transactionId },
      data: { status: TransactionStatus.COMPLETED, externalRef: result.providerRef, failureReason: null },
    });

    return { success: true, passengerId, amountXOF, provider, providerRef: result.providerRef, ussdCommand: result.ussdCommand };
  } catch (error: any) {
    if (error instanceof UnrecoverableError) throw error;
    await prisma.transaction.update({ where: { id: transactionId }, data: { status: TransactionStatus.PENDING_VERIFICATION } });
    throw error;
  }
};

// -----------------------------------------------------------------------------
// 3. WORKERS E EVENTOS WEBSOCKET
// -----------------------------------------------------------------------------
export const orangePayoutWorker = new Worker<PayoutJobData>('orange-payout', processPayoutBlindado, {
  connection: redisConnection,
  concurrency: 2,
  limiter: { max: 5, duration: 1000 },
});

export const mtnPayoutWorker = new Worker<PayoutJobData>('mtn-payout', processPayoutBlindado, {
  connection: redisConnection,
  concurrency: 2,
  limiter: { max: 5, duration: 1000 },
});

export const refundWorker = new Worker<RefundJobData>('refund-queue', processRefundBlindado, {
  connection: redisConnection,
  concurrency: 2,
  limiter: { max: 5, duration: 1000 },
});

const configureWorkerEvents = (worker: Worker<any>, queueName: string, type: 'PAYOUT' | 'REFUND') => {
  worker.on('completed', (job: Job, returnvalue: any) => {
    console.log(`✅ [WORKER ${queueName}] Job ${job.id} concluído com sucesso.`);

    if (!returnvalue || !returnvalue.success || returnvalue.cached) return;

    try {
      const io = getIo();
      if (!io) return;

      if (type === 'PAYOUT' && returnvalue.driverId) {
        io.to(returnvalue.driverId).to(`driver_${returnvalue.driverId}`).emit('payment:payout_success', {
          transactionId: job.data?.transactionId,
          amount: returnvalue.amountXOF,
          provider: returnvalue.provider,
          message: `Transferência realizada! ${returnvalue.amountXOF} XOF enviados à sua conta Mobile Money.`,
        });
      } else if (type === 'REFUND' && returnvalue.passengerId) {
        io.to(returnvalue.passengerId).to(`passenger_${returnvalue.passengerId}`).emit('payment:refund_success', {
          transactionId: job.data?.transactionId,
          amount: returnvalue.amountXOF,
          provider: returnvalue.provider,
          message: `Reembolso efetuado! ${returnvalue.amountXOF} XOF devolvidos à sua conta.`,
        });
      }
    } catch (err) {
      console.warn(`⚠️ [WORKER ${queueName}] Falha ao emitir notificação WebSocket:`, err);
    }
  });

  worker.on('failed', async (job: Job | undefined, err: Error) => {
    const txId = job?.data?.transactionId;
    console.error(`❌ [WORKER ${queueName}] Job ${job?.id || 'desconhecido'} falhou:`, err.message);

    if (!txId) return;

    await prisma.transaction.update({
      where: { id: txId },
      data: {
        status: TransactionStatus.FAILED_MANUAL_REVIEW,
        failureReason: `[FALHA_FINAL] ${err.message}`,
      },
    }).catch((dbErr) => console.error('Erro ao atualizar falha na transação:', dbErr));
  });

  worker.on('error', (err) => {
    console.error(`🔴 [WORKER ${queueName}] Erro no cliente Redis:`, err);
  });
};

configureWorkerEvents(orangePayoutWorker, 'orange-payout', 'PAYOUT');
configureWorkerEvents(mtnPayoutWorker, 'mtn-payout', 'PAYOUT');
configureWorkerEvents(refundWorker, 'refund-queue', 'REFUND');

export async function enqueuePayoutJob(data: PayoutJobData) {
  const provider = (data.provider || '').toUpperCase();
  const queue = provider === 'MTN_MOMO' ? mtnPayoutQueue : orangePayoutQueue;

  return await queue.add(`payout-${data.transactionId}`, data, {
    jobId: `payout-${data.transactionId}`,
  });
}

export async function enqueueRefundJob(data: RefundJobData) {
  return await refundQueue.add(`refund-${data.transactionId}`, data, {
    jobId: `refund-${data.transactionId}`,
  });
}

export async function closePayoutQueues() {
  await Promise.all([
    orangePayoutWorker.close(),
    mtnPayoutWorker.close(),
    refundWorker.close(),
    orangePayoutQueue.close(),
    mtnPayoutQueue.close(),
    refundQueue.close(),
  ]);
}