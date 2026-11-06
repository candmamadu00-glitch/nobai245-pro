import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { 
  RideStatus, 
  TransactionType, 
  TransactionStatus, 
  PaymentMethod 
} from '@prisma/client';
import { prisma } from '../config/prisma';
import { getIo } from '../server';
import { processWebhookConfirmation, processSmsGatewayWebhook } from '../services/mobileMoneyService';
import { notifyDriversNewRide } from '../services/rideService';

const router = Router();

const ORANGE_WEBHOOK_SECRET = process.env.ORANGE_WEBHOOK_SECRET || '';
const MTN_WEBHOOK_SECRET = process.env.MTN_WEBHOOK_SECRET || '';
const SMS_GATEWAY_SECRET = process.env.SMS_GATEWAY_SECRET || process.env.GATEWAY_SECRET_KEY || 'bai245_sms_gateway_secret_2026_key';

const ALLOWED_IPS = (process.env.ALLOWED_WEBHOOK_IPS || '127.0.0.1,192.168.1.1')
  .split(',')
  .map((ip) => ip.trim());

interface WebhookProcessResult {
  success?: boolean;
  status?: string;
  rideId?: string | null;
  passengerId?: string | null;
  transactionId?: string;
  alreadyProcessed?: boolean;
  duplicated?: boolean;
  reason?: string;
}

const ipWhitelistMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  if (process.env.NODE_ENV !== 'production' || process.env.DISABLE_WEBHOOK_IP_CHECK === 'true') {
    return next();
  }

  const forwardedFor = req.headers['x-forwarded-for'];
  const forwardedString = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  const rawIp = typeof forwardedString === 'string'
    ? forwardedString.split(',')[0].trim()
    : req.socket.remoteAddress || '';

  const cleanIp = rawIp.startsWith('::ffff:') ? rawIp.replace('::ffff:', '') : rawIp;

  if (!ALLOWED_IPS.includes(cleanIp)) {
    console.warn(`🚨 [WEBHOOK SECURITY] Acesso negado para IP: ${cleanIp}`);
    res.status(403).json({ error: 'Acesso negado. Origem não confiável.' });
    return;
  }
  next();
};

function secureCompare(a: string, b: string): boolean {
  if (!a || !b) return false;
  try {
    const aBuffer = Buffer.from(a);
    const bBuffer = Buffer.from(b);
    if (aBuffer.length !== bBuffer.length) return false;
    return crypto.timingSafeEqual(aBuffer, bBuffer);
  } catch {
    return false;
  }
}

async function emitSuccessSockets(rideId?: string | null, passengerId?: string | null) {
  const io = getIo();

  if (rideId) {
    const updateResult = await prisma.ride.updateMany({
      where: { 
        id: rideId, 
        status: { in: [RideStatus.AWAITING_PAYMENT, RideStatus.PENDING] } 
      },
      data: { status: RideStatus.SEARCHING }
    });

    if (updateResult.count > 0) {
      if (io) {
        io.to(rideId).emit('payment:confirmed', {
          rideId,
          message: 'Pagamento confirmado! Buscando motoristas próximos...'
        });
      }

      await notifyDriversNewRide(rideId).catch((err) => {
        console.warn('⚠️ [WEBHOOK] Falha ao despachar notificação para motoristas:', err?.message || err);
      });
    }
  } else if (passengerId) {
    const passenger = await prisma.passenger.findUnique({ where: { id: passengerId } });
    if (passenger && io) {
      io.to(passengerId).to(`passenger_${passengerId}`).emit('wallet:updated', {
        message: 'Recarga realizada com sucesso!',
        walletBalance: Number(passenger.walletBalance)
      });
    }
  }
}

// -----------------------------------------------------------------------------
// 🤖 GATEWAY AUTOMÁTICO: RECTIFICAÇÃO E LEITURA DE SMS (ANDROID)
// -----------------------------------------------------------------------------
router.post('/sms-gateway', async (req: Request, res: Response): Promise<any> => {
  try {
    const secret = (req.headers['x-sms-gateway-secret'] || req.headers['x-secret'] || req.headers['x-gateway-secret'] || req.body.secret || req.query.secret) as string;

    if (!secureCompare(secret, SMS_GATEWAY_SECRET)) {
      console.warn('🚨 [SMS GATEWAY] Tentativa de acesso com secret inválido.');
      return res.status(401).json({ error: 'Secret de autenticação inválido.' });
    }

    const message = req.body.message || req.body.smsText || req.body.text;
    const sender = req.body.sender || req.body.senderHeader || req.body.from;

    if (!message) {
      return res.status(400).json({ error: 'Mensagem do SMS não informada.' });
    }

    console.log(`📩 [SMS GATEWAY RECEBIDO] De: ${sender || 'Desconhecido'} | Conteúdo: "${message}"`);

    // 1. Tenta processar como Pagamento de Corrida de Passageiro
    const ridePaymentResult = await processSmsGatewayWebhook({
      smsText: message,
      senderHeader: sender,
      gatewaySecret: SMS_GATEWAY_SECRET
    }).catch((err) => {
      console.warn('⚠️ [SMS GATEWAY] Erro ao processar pagamento de corrida:', err?.message);
      return null;
    });

    if (ridePaymentResult && ridePaymentResult.success) {
      if (ridePaymentResult.duplicated) {
        return res.status(200).json({ status: 'ok', message: 'SMS duplicado já processado anteriormente.' });
      }

      if (ridePaymentResult.rideId) {
        await emitSuccessSockets(ridePaymentResult.rideId, null);
      }

      return res.status(200).json({
        success: true,
        type: 'RIDE_PAYMENT',
        rideId: ridePaymentResult.rideId,
        amount: ridePaymentResult.amount
      });
    }

    // 2. Tenta processar como Recarga de Carteira do Motorista
    const amountMatch = message.match(/(\d+[\d\.]*)\s*(?:XOF|FCFA|CFA)/i) || message.match(/(\d+[\d\.]*)/);
    const phoneMatch = message.match(/(?:de|from)\s+(\d{7,12})/i);

    if (!amountMatch) {
      console.warn('⚠️ [SMS GATEWAY] Valor em XOF não encontrado no texto do SMS.');
      return res.status(200).json({ status: 'ignored', reason: 'Valor XOF não identificado' });
    }

    const amountXOF = Number(amountMatch[1].replace(/\./g, ''));
    let driverPhone = phoneMatch ? phoneMatch[1].replace(/\D/g, '') : '';

    if (!driverPhone && sender) {
      driverPhone = String(sender).replace(/\D/g, '');
    }

    if (!driverPhone) {
      return res.status(400).json({ error: 'Não foi possível identificar o telefone do remetente.' });
    }

    const last8Digits = driverPhone.slice(-8);

    const driver = await prisma.driver.findFirst({
      where: {
        phone: { contains: last8Digits }
      }
    });

    if (!driver) {
      console.warn(`⚠️ [SMS GATEWAY] Nenhum motorista ou corrida encontrada para o telefone contendo: ${last8Digits}`);
      return res.status(404).json({ error: 'Nenhum motorista ou corrida pendente localizada.' });
    }

    const result = await prisma.$transaction(async (tx) => {
      const currentBalance = Number(driver.walletBalance || 0);
      const newBalance = currentBalance + amountXOF;

      await tx.driver.update({
        where: { id: driver.id },
        data: { walletBalance: newBalance }
      });

      await tx.transaction.create({
        data: {
          driverId: driver.id,
          type: TransactionType.MANUAL_RECHARGE,
          status: TransactionStatus.COMPLETED,
          amount: amountXOF,
          balanceBefore: currentBalance,
          balanceAfter: newBalance,
          paymentMethod: PaymentMethod.ORANGE_MONEY,
          reference: `SMS-AUTO-${Date.now()}-${driver.id.substring(0, 4)}`,
          description: `Recarga automática por SMS de ${amountXOF} XOF`
        }
      });

      return { driverId: driver.id, newBalance, fullName: driver.fullName, currentBalance };
    });

    console.log(`✅ [RECARGA MOTORISTA CONCLUÍDA] Motorista: ${result.fullName} | Saldo Anterior: ${result.currentBalance} XOF -> Novo Saldo: ${result.newBalance} XOF`);

    const io = getIo();
    if (io) {
      io.to(driver.id)
        .to(`driver_${driver.id}`)
        .to(`driver:${driver.id}`)
        .emit('wallet:updated', {
          message: `Recarga de ${amountXOF} XOF confirmada com sucesso!`,
          walletBalance: result.newBalance
        });
    }

    return res.status(200).json({
      success: true,
      type: 'DRIVER_RECHARGE',
      message: 'Recarga do motorista processada com sucesso!',
      driverName: result.fullName,
      creditedAmount: amountXOF,
      newBalance: result.newBalance
    });

  } catch (error: any) {
    console.error('❌ [SMS GATEWAY ERR]:', error);
    return res.status(500).json({ error: 'Erro interno ao processar SMS no Gateway.' });
  }
});

// -----------------------------------------------------------------------------
// WEBHOOK ORANGE MONEY (OFICIAL)
// -----------------------------------------------------------------------------
router.post('/orange', ipWhitelistMiddleware, async (req: Request, res: Response): Promise<any> => {
  try {
    const requestSecret = (req.query.secret || req.headers['x-webhook-secret']) as string;
    
    if (!ORANGE_WEBHOOK_SECRET || !secureCompare(requestSecret, ORANGE_WEBHOOK_SECRET)) {
      console.warn('🚨 [WEBHOOK ORANGE] Tentativa de acesso com chave secreta inválida.');
      return res.status(401).json({ error: 'Não autorizado. Assinatura inválida.' });
    }

    const { order_id, txnid, amount } = req.body;
    const rawStatus = req.body.status || req.body.txstat || '';

    if (!order_id || !txnid || amount === undefined) {
      return res.status(400).json({ error: 'Payload incompleto.' });
    }

    const normalizedStatus = String(rawStatus).toUpperCase();
    const isSuccess = ['SUCCESS', 'COMPLETED', 'SUCCESSFUL', 'SUCCESS_TRANSACTION'].includes(normalizedStatus);
    
    const result: WebhookProcessResult = await processWebhookConfirmation(
      order_id, 
      isSuccess ? 'SUCCESS' : 'FAILED', 
      String(txnid), 
      req.body,
      'ORANGE_MONEY'
    );

    if (result.alreadyProcessed) {
      return res.status(200).send('OK - Evento duplicado ignorado de forma segura.');
    }

    const io = getIo();

    if (result.success) {
      await emitSuccessSockets(result.rideId, result.passengerId);
    } else {
      if (io && result.rideId) {
        io.to(result.rideId).emit('payment:failed', { message: 'Pagamento falhou ou foi cancelado.' });
      }
      if (io && result.passengerId) {
        io.to(result.passengerId).to(`passenger_${result.passengerId}`).emit('wallet:payment_failed', { message: 'Transação recusada pela Orange Money.' });
      }
    }

    return res.status(200).send('OK');

  } catch (error: any) {
    console.error('❌ [WEBHOOK ORANGE] Erro interno:', error);
    return res.status(500).send('Erro interno do servidor');
  }
});

// -----------------------------------------------------------------------------
// WEBHOOK MTN MOMO (OFICIAL)
// -----------------------------------------------------------------------------
router.post('/mtn', ipWhitelistMiddleware, async (req: Request, res: Response): Promise<any> => {
  try {
    const requestSecret = (req.query.secret || req.headers['x-webhook-secret']) as string;

    if (!MTN_WEBHOOK_SECRET || !secureCompare(requestSecret, MTN_WEBHOOK_SECRET)) {
      console.warn('🚨 [WEBHOOK MTN] Tentativa de acesso com chave secreta inválida.');
      return res.status(401).json({ error: 'Não autorizado. Assinatura inválida.' });
    }

    const { financialTransactionId, externalId, status, amount } = req.body;
    const refId = externalId || (req.headers['x-reference-id'] as string);
    const eventId = financialTransactionId || refId;

    if (!refId || amount === undefined) {
      return res.status(400).json({ error: 'Payload incompleto.' });
    }

    const normalizedStatus = String(status || '').toUpperCase();
    const isSuccess = normalizedStatus === 'SUCCESSFUL';

    const result: WebhookProcessResult = await processWebhookConfirmation(
      refId, 
      isSuccess ? 'SUCCESS' : 'FAILED', 
      String(eventId), 
      req.body,
      'MTN_MOMO'
    );

    if (result.alreadyProcessed) {
      return res.status(200).send('OK - Evento duplicado ignorado de forma segura.');
    }

    const io = getIo();

    if (result.success) {
      await emitSuccessSockets(result.rideId, result.passengerId);
    } else {
      if (io && result.rideId) {
        io.to(result.rideId).emit('payment:failed', { message: 'Pagamento falhou ou foi cancelado.' });
      }
      if (io && result.passengerId) {
        io.to(result.passengerId).to(`passenger_${result.passengerId}`).emit('wallet:payment_failed', { message: 'Transação recusada pelo MTN MoMo.' });
      }
    }

    return res.status(200).send('OK');

  } catch (error: any) {
    console.error('❌ [WEBHOOK MTN] Erro interno:', error);
    return res.status(500).send('Erro interno do servidor');
  }
});

export { router as webhookRoutes };
export default router;