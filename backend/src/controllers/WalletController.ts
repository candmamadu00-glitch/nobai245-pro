import { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { getIo } from '../server';

// GET: Obter Saldo do Motorista
export async function getDriverWalletBalance(req: Request, res: Response) {
  try {
    const driverId = (req as any).user?.id;
    if (!driverId) {
      return res.status(401).json({ error: 'Não autorizado.' });
    }

    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      select: {
        walletBalance: true,
        pendingBalance: true,
        status: true,
      },
    });

    if (!driver) {
      return res.status(404).json({ error: 'Motorista não encontrado.' });
    }

    const balance = Number(driver.walletBalance || 0);
    const minThreshold = -500;

    return res.json({
      balance,
      pendingBalance: Number(driver.pendingBalance || 0),
      isBlocked: balance < minThreshold,
      minThreshold,
      currency: 'XOF',
    });
  } catch (error) {
    console.error('Erro ao buscar saldo da carteira:', error);
    return res.status(500).json({ error: 'Erro interno ao consultar carteira.' });
  }
}

// GET: Extrato de Transações do Motorista
export async function getDriverTransactions(req: Request, res: Response) {
  try {
    const driverId = (req as any).user?.id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 30;

    const transactions = await prisma.transaction.findMany({
      where: { driverId },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return res.json({ transactions });
  } catch (error) {
    console.error('Erro ao buscar extrato de transações:', error);
    return res.status(500).json({ error: 'Erro ao carregar extrato.' });
  }
}

// POST: Webhook do Leitor de SMS (App Android Gateway da Empresa)
export async function handleSmsGatewayWebhook(req: Request, res: Response) {
  try {
    const { secretKey, smsBody, transactionRef } = req.body;
    
    // Suporte flexível para segredo enviado no body ou headers
    const incomingSecret = secretKey || req.body.secret || req.headers['x-secret'] || req.headers['authorization'];
    const envSecret = process.env.SMS_GATEWAY_SECRET || 'nobai245-secret-key';

    if (!incomingSecret || incomingSecret !== envSecret) {
      return res.status(401).json({ error: 'Secret Key inválida ou ausente.' });
    }

    if (!smsBody) {
      return res.status(400).json({ error: 'Corpo do SMS ausente.' });
    }

    const cleanSms = smsBody.replace(/,/g, '');

    // Parser dos padrões Orange Money / MTN MoMo da Guiné-Bissau
    const amountMatch = cleanSms.match(/(?:recebeu|montant|valor)[:\s]*(\d+)\s*(?:fcfa|xof)?/i) || cleanSms.match(/(\d+)\s*(?:fcfa|xof)/i);
    const phoneMatch = cleanSms.match(/(?:de|from)[:\s]*(?:245)?(9[56]\d{7})/i) || cleanSms.match(/(9[56]\d{7})/);
    const refMatch = cleanSms.match(/(?:id|ref|transacao|txid)[:\s]*([a-zA-Z0-9]+)/i);

    if (!amountMatch || !phoneMatch) {
      return res.status(200).json({ message: 'SMS recebido, mas sem valor/telefone reconhecível.' });
    }

    const amount = parseFloat(amountMatch[1]);
    const rawPhone = phoneMatch[1];
    const cleanPhone = rawPhone.replace(/^245/, '');
    const externalRef = refMatch ? refMatch[1] : (transactionRef || `SMS-${Date.now()}`);

    // Prevenção de duplicidade
    const existingTx = await prisma.transaction.findUnique({
      where: { externalRef },
    });

    if (existingTx) {
      return res.status(200).json({ message: 'Transação já processada.' });
    }

    // Busca motorista pelo número de telefone cadastrado
    const driver = await prisma.driver.findFirst({
      where: {
        deletedAt: null,
        OR: [
          { orangeNumber: cleanPhone },
          { orangeNumber: `245${cleanPhone}` },
          { mtnNumber: cleanPhone },
          { mtnNumber: `245${cleanPhone}` },
          { phone: cleanPhone },
          { phone: `245${cleanPhone}` },
        ],
      },
    });

    if (!driver) {
      // Salva como PENDING_VERIFICATION para permitir resgate via TxID pelo motorista
      await prisma.transaction.create({
        data: {
          type: 'MANUAL_RECHARGE',
          status: 'PENDING_VERIFICATION',
          amount,
          reference: `REC-${Date.now()}`,
          externalRef,
          description: `Depósito de ${amount} XOF de telefone não cadastrado: ${cleanPhone}`,
          failureReason: 'Número remetente não associado a nenhum motorista ativo.',
        },
      });
      return res.status(200).json({ message: 'Telefone não encontrado. Transação mantida aguardando código de resgate.' });
    }

    // Atualização do Saldo
    const updatedDriver = await prisma.$transaction(async (tx) => {
      const balanceBefore = driver.walletBalance;
      const newBalance = Number(balanceBefore) + amount;

      const updated = await tx.driver.update({
        where: { id: driver.id },
        data: {
          walletBalance: newBalance,
          version: { increment: 1 },
        },
      });

      await tx.transaction.create({
        data: {
          driverId: driver.id,
          type: 'DEPOSIT',
          status: 'COMPLETED',
          paymentMethod: cleanPhone.startsWith('95') ? 'ORANGE_MONEY' : 'MTN_MOMO',
          amount,
          balanceBefore,
          balanceAfter: newBalance,
          reference: `REC-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`,
          externalRef,
          description: `Recarga via ${cleanPhone.startsWith('95') ? 'Orange Money' : 'MTN MoMo'}`,
        },
      });

      return updated;
    });

    // Emissão no Socket.io para atualização instantânea da UI
    const io = getIo();
    if (io) {
      io.to(`driver:${driver.id}`).emit('wallet:updated', {
        balance: Number(updatedDriver.walletBalance),
        message: `Sua recarga de ${amount.toLocaleString('pt-GW')} XOF foi confirmada!`,
      });

      io.to(`driver:${driver.id}`).emit('wallet:recharge_status', {
        reference: externalRef,
        status: 'COMPLETED',
        message: `Sua recarga de ${amount.toLocaleString('pt-GW')} XOF foi confirmada!`,
      });
    }

    return res.status(200).json({
      success: true,
      driverId: driver.id,
      newBalance: updatedDriver.walletBalance,
    });
  } catch (error) {
    console.error('Erro na Webhook SMS:', error);
    return res.status(500).json({ error: 'Erro ao processar recarga SMS.' });
  }
}

// POST: Resgatar recarga feita por outro número usando a Referência/TxID da operadora
export async function claimRechargeByTxId(req: Request, res: Response) {
  try {
    const driverId = (req as any).user?.id;
    const { txId } = req.body;

    if (!driverId) {
      return res.status(401).json({ success: false, error: 'Não autorizado.' });
    }

    if (!txId || typeof txId !== 'string') {
      return res.status(400).json({ success: false, error: 'Informe a referência ou ID da transação.' });
    }

    const cleanTxId = txId.trim();

    // Busca insensível a maiúsculas/minúsculas para evitar erros de digitação do motorista
    const pendingTransaction = await prisma.transaction.findFirst({
      where: {
        externalRef: { contains: cleanTxId, mode: 'insensitive' },
        status: 'PENDING_VERIFICATION',
        driverId: null,
      },
    });

    if (!pendingTransaction) {
      return res.status(404).json({
        success: false,
        error: 'Transação não encontrada ou já resgatada. Verifique o código e tente novamente.',
      });
    }

    const driver = await prisma.driver.findUnique({ where: { id: driverId } });
    if (!driver) {
      return res.status(404).json({ success: false, error: 'Motorista não encontrado.' });
    }

    // Transação atômica: Vincula o motorista e atualiza o saldo
    const updatedDriver = await prisma.$transaction(async (tx) => {
      const currentBalance = Number(driver.walletBalance || 0);
      const amount = Number(pendingTransaction.amount);
      const newBalance = currentBalance + amount;

      const updated = await tx.driver.update({
        where: { id: driver.id },
        data: { walletBalance: newBalance },
      });

      await tx.transaction.update({
        where: { id: pendingTransaction.id },
        data: {
          driverId: driver.id,
          status: 'COMPLETED',
          balanceBefore: currentBalance,
          balanceAfter: newBalance,
          description: `Recarga resgatada por ID (${cleanTxId}) de telefone terceiro`,
        },
      });

      return updated;
    });

    // Notifica a interface via Socket.io em tempo real
    const io = getIo();
    if (io) {
      io.to(`driver:${driver.id}`)
        .to(driver.id)
        .emit('wallet:updated', {
          balance: Number(updatedDriver.walletBalance),
          message: `Recarga de ${pendingTransaction.amount} XOF resgatada com sucesso!`,
        });
    }

    return res.status(200).json({
      success: true,
      message: 'Recarga identificada e creditada no seu saldo com sucesso!',
      newBalance: Number(updatedDriver.walletBalance),
    });
  } catch (error: any) {
    console.error('❌ Erro ao resgatar recarga por TxID:', error);
    return res.status(500).json({ success: false, error: 'Erro ao validar o código da recarga.' });
  }
}