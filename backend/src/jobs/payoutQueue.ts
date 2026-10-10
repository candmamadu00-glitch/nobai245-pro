import { Queue, Worker, Job, ConnectionOptions, UnrecoverableError } from 'bullmq';
import { prisma } from '../lib/prisma'; 
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
      host: process.env.REDIS_HOST || '127.0.0.1',
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

const processPayoutBlindado = async (job: Job<PayoutJobData>) => {
  const { transactionId, rideId, driverId, amountXOF, phone, provider } = job.data || {};

  console.log(`💸 [JOB PAYOUT INICIADO] Tx: ${transactionId} | Motorista: ${driverId} | Valor: ${amountXOF} XOF | Provider: ${provider}`);

  if (!transactionId || !driverId || !amountXOF || !phone || !provider) {
    console.error('❌ [JOB PAYOUT ERRO]: Parâmetros obrigatórios de repasse ausentes.');
    throw new UnrecoverableError('DADOS_JOB_INVALIDOS: Parâmetros obrigatórios de repasse ausentes.');
  }

  const currentTx = await prisma.transaction.findUnique({ where: { id: transactionId } });
  if (!currentTx) {
    console.error(`❌ [JOB PAYOUT ERRO]: Transação ${transactionId} não encontrada no banco.`);
    throw new UnrecoverableError(`TRANSACTION_NOT_FOUND: Tx ${transactionId}`);
  }

  if (currentTx.status === 'COMPLETED') {
    console.log(`ℹ️ [JOB PAYOUT SKIPPED]: Transação ${transactionId} já estava COMPLETED.`);
    return { success: true, cached: true, driverId, amountXOF, provider, ref: currentTx.externalRef };
  }
  if (currentTx.status === 'FAILED_MANUAL_REVIEW') {
    console.warn(`⚠️ [JOB PAYOUT WARN]: Transação ${transactionId} marcada para revisão manual.`);
    return { success: false, reason: 'REVISE_MANUALMENTE', driverId, amountXOF, provider };
  }

  // Reconciliação passiva se houver tentativas anteriores
  if (job.attemptsMade > 0 || currentTx.status === 'PENDING_VERIFICATION' || currentTx.status === 'PROCESSING') {
    try {
      console.log(`🔍 [JOB PAYOUT RECONCILIAÇÃO]: Verificando status da Tx ${transactionId}...`);
      const verification = await verifyTransactionStatus(transactionId);
      
      if (verification.status === 'SUCCESS') {
        await prisma.$transaction([
          prisma.transaction.update({
            where: { id: transactionId },
            data: { status: 'COMPLETED', externalRef: verification.ref || currentTx.externalRef, failureReason: null },
          }),
          prisma.driver.update({
            where: { id: driverId },
            data: { pendingBalance: { decrement: amountXOF } }
          })
        ]);
        console.log(`✅ [JOB PAYOUT RECONCILIADO COM SUCESSO]: Tx ${transactionId}`);
        return { success: true, recovered: true, driverId, amountXOF, provider, ref: verification.ref };
      }
      
      if (verification.status === 'PENDING') {
        await prisma.transaction.update({
          where: { id: transactionId },
          data: { status: 'PENDING_VERIFICATION' },
        });
        console.log(`⏳ [JOB PAYOUT RECONCILIÇÃO]: Transação ainda pendente na operadora.`);
        throw new Error('TIMEOUT_REQUIRES_RECONCILIATION');
      }

      if (verification.status === 'FAILED') {
        await prisma.transaction.update({
          where: { id: transactionId },
          data: { status: 'FAILED_MANUAL_REVIEW', failureReason: 'Transação confirmada como com falha pela operadora' },
        });
        console.error(`❌ [JOB PAYOUT RECONCILIÇÃO FALHOU]: Confirmada falha pela operadora.`);
        throw new UnrecoverableError('REJEITADO_OPERADORA: Confirmado falha na reconciliação.');
      }
    } catch (verifErr: any) {
      if (verifErr instanceof UnrecoverableError || verifErr.message === 'TIMEOUT_REQUIRES_RECONCILIATION') {
        throw verifErr;
      }
    }
  }

  const lockResult = await prisma.transaction.updateMany({
    where: { id: transactionId, status: { in: ['PENDING', 'PENDING_VERIFICATION', 'FAILED'] } },
    data: { status: 'PROCESSING' },
  });

  if (lockResult.count === 0) {
    const recheckTx = await prisma.transaction.findUnique({ where: { id: transactionId } });
    if (recheckTx?.status === 'COMPLETED') return { success: true, cached: true, driverId, amountXOF, provider };
    throw new Error('CONCURRENT_PROCESSING: Transação em processamento ou com estado inválido.');
  }

  try {
    console.log(`📡 [JOB PAYOUT ENVIANDO A OPERADORA]: Destino: ${phone} | Valor: ${amountXOF} XOF...`);
    const result = await payoutToDriverMobileMoney({ provider, phone, amount: amountXOF, rideId, payoutId: transactionId });

    if (!result.success) {
      console.error(`❌ [JOB PAYOUT RESPOSTA DA OPERADORA FALHOU]:`, result);
      
      if (result.error === 'TIMEOUT_REQUIRES_RECONCILIATION') {
        await prisma.transaction.update({
          where: { id: transactionId },
          data: { status: 'PENDING_VERIFICATION', failureReason: 'Timeout na API da operadora' },
        });
        throw new Error('TIMEOUT_REQUIRES_RECONCILIATION');
      }

      await prisma.transaction.update({
        where: { id: transactionId },
        data: { status: 'FAILED_MANUAL_REVIEW', failureReason: result.details || result.error || 'Recusado pela operadora' },
      });
      throw new UnrecoverableError(`REJEITADO_OPERADORA: ${result.details || result.error}`);
    }

    console.log(`✅ [JOB PAYOUT CONCLUÍDO COM SUCESSO]: Ref Operadora: ${result.providerRef}`);

    await prisma.$transaction([
      prisma.transaction.update({
        where: { id: transactionId },
        data: { status: 'COMPLETED', externalRef: result.providerRef, failureReason: null },
      }),
      prisma.driver.update({
        where: { id: driverId },
        data: { pendingBalance: { decrement: amountXOF } }
      })
    ]);

    return { success: true, driverId, amountXOF, provider, providerRef: result.providerRef };
  } catch (error: any) {
    if (error instanceof UnrecoverableError || error.message === 'TIMEOUT_REQUIRES_RECONCILIATION') throw error;
    
    console.error(`❌ [JOB PAYOUT ERRO INESPERADO]:`, error?.message || error);
    await prisma.transaction.update({ where: { id: transactionId }, data: { status: 'PENDING_VERIFICATION' } });
    throw error;
  }
};

const processRefundBlindado = async (job: Job<RefundJobData>) => {
  const { transactionId, rideId, passengerId, phone, amountXOF, provider } = job.data || {};

  console.log(`🔄 [JOB REFUND INICIADO] Tx: ${transactionId} | Passageiro: ${passengerId} | Valor: ${amountXOF} XOF`);

  if (!transactionId || !passengerId || !amountXOF || !phone || !provider) {
    throw new UnrecoverableError('DADOS_JOB_INVALIDOS: Parâmetros obrigatórios de estorno ausentes.');
  }

  const currentTx = await prisma.transaction.findUnique({ where: { id: transactionId } });
  if (!currentTx) throw new UnrecoverableError(`TRANSACTION_NOT_FOUND: Tx ${transactionId}`);

  if (currentTx.status === 'COMPLETED') {
    return { success: true, cached: true, passengerId, amountXOF, provider, ref: currentTx.externalRef };
  }
  if (currentTx.status === 'FAILED_MANUAL_REVIEW') {
    return { success: false, reason: 'REVISE_MANUALMENTE', passengerId, amountXOF, provider };
  }

  if (job.attemptsMade > 0 || currentTx.status === 'PENDING_VERIFICATION' || currentTx.status === 'PROCESSING') {
    try {
      const verification = await verifyTransactionStatus(transactionId);
      if (verification.status === 'SUCCESS') {
        await prisma.transaction.update({
          where: { id: transactionId },
          data: { status: 'COMPLETED', externalRef: verification.ref || currentTx.externalRef, failureReason: null },
        });
        return { success: true, recovered: true, passengerId, amountXOF, provider, ref: verification.ref };
      }
      if (verification.status === 'PENDING') {
        await prisma.transaction.update({
          where: { id: transactionId },
          data: { status: 'PENDING_VERIFICATION' },
        });
        throw new Error('TIMEOUT_REQUIRES_RECONCILIATION');
      }
      if (verification.status === 'FAILED') {
        await prisma.transaction.update({
          where: { id: transactionId },
          data: { status: 'FAILED_MANUAL_REVIEW', failureReason: 'Estorno confirmado como com falha pela operadora' },
        });
        throw new UnrecoverableError('ESTORNO_RECUSADO: Confirmado falha na reconciliação.');
      }
    } catch (verifErr: any) {
      if (verifErr instanceof UnrecoverableError || verifErr.message === 'TIMEOUT_REQUIRES_RECONCILIATION') {
        throw verifErr;
      }
    }
  }

  const lockResult = await prisma.transaction.updateMany({
    where: { id: transactionId, status: { in: ['PENDING', 'PENDING_VERIFICATION', 'FAILED'] } },
    data: { status: 'PROCESSING' },
  });

  if (lockResult.count === 0) {
    const recheckTx = await prisma.transaction.findUnique({ where: { id: transactionId } });
    if (recheckTx?.status === 'COMPLETED') return { success: true, cached: true, passengerId, amountXOF, provider };
    throw new Error('CONCURRENT_PROCESSING: Transação em processamento ou com estado inválido.');
  }

  try {
    const result = await refundPassengerMobileMoney({
      provider,
      phone,
      amount: amountXOF,
      rideId,
      refundId: transactionId
    });

    if (!result.success) {
      if (result.error === 'TIMEOUT_REQUIRES_RECONCILIATION') {
        await prisma.transaction.update({
          where: { id: transactionId },
          data: { status: 'PENDING_VERIFICATION', failureReason: 'Timeout na API de estorno' },
        });
        throw new Error('TIMEOUT_REQUIRES_RECONCILIATION');
      }

      await prisma.transaction.update({
        where: { id: transactionId },
        data: { status: 'FAILED_MANUAL_REVIEW', failureReason: result.error || 'Estorno recusado pela operadora' },
      });
      throw new UnrecoverableError(`ESTORNO_RECUSADO: ${result.error}`);
    }

    await prisma.transaction.update({
      where: { id: transactionId },
      data: { status: 'COMPLETED', externalRef: result.providerRef, failureReason: null },
    });

    return { success: true, passengerId, amountXOF, provider, providerRef: result.providerRef };
  } catch (error: any) {
    if (error instanceof UnrecoverableError || error.message === 'TIMEOUT_REQUIRES_RECONCILIATION') throw error;
    
    await prisma.transaction.update({ where: { id: transactionId }, data: { status: 'PENDING_VERIFICATION' } });
    throw error;
  }
};

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
          message: `Recebido! ${returnvalue.amountXOF} XOF foram transferidos para sua conta Mobile Money.`,
        });
      } else if (type === 'REFUND' && returnvalue.passengerId) {
        io.to(returnvalue.passengerId).to(`passenger_${returnvalue.passengerId}`).emit('payment:refund_success', {
          transactionId: job.data?.transactionId,
          amount: returnvalue.amountXOF,
          provider: returnvalue.provider,
          message: `Reembolso efetuado! ${returnvalue.amountXOF} XOF foram devolvidos à sua conta Mobile Money.`,
        });
      }
    } catch (err) {
      console.warn(`⚠️ [WORKER ${queueName}] Falha ao emitir notificação WebSocket:`, err);
    }
  });

  worker.on('failed', async (job: Job | undefined, err: Error) => {
    const txId = job?.data?.transactionId;
    console.error(`❌ [WORKER ${queueName}] Job ${job?.id || 'desconhecido'} falhou (Tentativa ${job?.attemptsMade || 0}):`, err.message);

    if (!txId) return;

    const isUnrecoverable = err instanceof UnrecoverableError || err.name === 'UnrecoverableError';
    const isTimeout = err.message.includes('TIMEOUT_REQUIRES_RECONCILIATION');
    const isMaxAttempts = (job?.attemptsMade || 0) >= (job?.opts?.attempts || 3);

    if (isMaxAttempts || isUnrecoverable) {
      try {
        await prisma.transaction.update({
          where: { id: txId },
          data: {
            status: isTimeout ? 'PENDING_VERIFICATION' : 'FAILED_MANUAL_REVIEW',
            failureReason: `[FALHA_FINAL] ${err.message}`,
          },
        }).catch((dbErr) => console.error('Erro ao atualizar status de falha na transação:', dbErr));

        const io = getIo();
        if (io && job?.data) {
          if (type === 'PAYOUT' && job.data.driverId) {
            io.to(job.data.driverId).to(`driver_${job.data.driverId}`).emit('payment:payout_failed', {
              transactionId: txId,
              reason: 'Sua conta de Mobile Money recusou o depósito. Atualize seu número no perfil ou contate o suporte.'
            });
          }

          io.to('admin_dashboard').emit('admin:payout_alert', {
            transactionId: txId,
            driverId: job.data.driverId,
            amount: job.data.amountXOF,
            provider: job.data.provider,
            reason: err.message
          });
        }
      } catch (e) {
        console.error('Falha geral ao registrar erro no banco:', e);
      }
    }
  });

  worker.on('error', (err) => {
    console.error(`🔴 [WORKER ${queueName}] Erro no cliente Redis do Worker:`, err);
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
  console.log('🔄 Encerrando workers e filas de pagamentos...');
  await Promise.all([
    orangePayoutWorker.close(),
    mtnPayoutWorker.close(),
    refundWorker.close(),
    orangePayoutQueue.close(),
    mtnPayoutQueue.close(),
    refundQueue.close(),
  ]);
  console.log('🛑 Filas de pagamentos encerradas com segurança.');
}