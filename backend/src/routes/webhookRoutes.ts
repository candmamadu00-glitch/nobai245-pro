import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { prisma } from '../config/prisma';
import { getIo } from '../server';
import { processWebhookConfirmation } from '../services/mobileMoneyService';
import { notifyDriversNewRide } from '../services/rideService';

const router = Router();

const ORANGE_WEBHOOK_SECRET = process.env.ORANGE_WEBHOOK_SECRET || '';
const MTN_WEBHOOK_SECRET = process.env.MTN_WEBHOOK_SECRET || '';

const ALLOWED_IPS = (process.env.ALLOWED_WEBHOOK_IPS || '127.0.0.1,192.168.1.1')
  .split(',')
  .map((ip) => ip.trim());

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

/**
 * 🛡️ Emissão de eventos via Socket.io e disparo de Push Alarme para motoristas
 */
async function emitSuccessSockets(rideId?: string | null, passengerId?: string | null) {
  const io = getIo();

  if (rideId) {
    const updateResult = await prisma.ride.updateMany({
      where: { id: rideId, status: 'AWAITING_PAYMENT' },
      data: { status: 'SEARCHING' }
    });

    if (updateResult.count > 0) {
      if (io) {
        io.to(rideId).emit('payment:confirmed', {
          rideId,
          message: 'Pagamento confirmado! Buscando motoristas próximos...'
        });
      }

      // 🔔 Notifica motoristas próximos via Socket e PUSH Alarme
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
// WEBHOOK ORANGE MONEY
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
    
    const result = await processWebhookConfirmation(
      order_id, 
      isSuccess ? 'SUCCESS' : 'FAILED', 
      String(txnid), 
      req.body,
      'ORANGE_MONEY'
    );

    if (result.alreadyProcessed) {
      return res.status(200).send('OK - Evento duplicado ignorado de forma segura.');
    }

    const resAny = result as any;
    const io = getIo();

    if (resAny.success) {
      await emitSuccessSockets(resAny.rideId, resAny.passengerId);
    } else {
      if (io && resAny.rideId) io.to(resAny.rideId).emit('payment:failed', { message: 'Pagamento falhou ou foi cancelado.' });
      if (io && resAny.passengerId) io.to(resAny.passengerId).to(`passenger_${resAny.passengerId}`).emit('wallet:payment_failed', { message: 'Transação recusada pela Orange Money.' });
    }

    return res.status(200).send('OK');

  } catch (error: any) {
    console.error('❌ [WEBHOOK ORANGE] Erro interno:', error);
    return res.status(500).send('Erro interno do servidor');
  }
});

// -----------------------------------------------------------------------------
// WEBHOOK MTN MOMO
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

    const result = await processWebhookConfirmation(
      refId, 
      isSuccess ? 'SUCCESS' : 'FAILED', 
      String(eventId), 
      req.body,
      'MTN_MOMO'
    );

    if (result.alreadyProcessed) {
      return res.status(200).send('OK - Evento duplicado ignorado de forma segura.');
    }

    const resAny = result as any;
    const io = getIo();

    if (resAny.success) {
      await emitSuccessSockets(resAny.rideId, resAny.passengerId);
    } else {
      if (io && resAny.rideId) io.to(resAny.rideId).emit('payment:failed', { message: 'Pagamento falhou ou foi cancelado.' });
      if (io && resAny.passengerId) io.to(resAny.passengerId).to(`passenger_${resAny.passengerId}`).emit('wallet:payment_failed', { message: 'Transação recusada pelo MTN MoMo.' });
    }

    return res.status(200).send('OK');

  } catch (error: any) {
    console.error('❌ [WEBHOOK MTN] Erro interno:', error);
    return res.status(500).send('Erro interno do servidor');
  }
});

export { router as webhookRoutes };
export default router;