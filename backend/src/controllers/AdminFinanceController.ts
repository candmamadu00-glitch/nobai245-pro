import { Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../config/prisma';
import { getIo } from '../server';
import { sendPushNotification, PUSH_CHANNELS } from '../services/pushNotifications';
import { TransactionType, TransactionStatus } from '@prisma/client';

export class AdminFinanceController {

  // ==========================================
  // 💰 1. DASHBOARD FINANCEIRO (CONSULTAS PARALELAS)
  // ==========================================
  async getDashboard(req: Request, res: Response): Promise<Response> {
    try {
      const [transactions, commissionAggregation, pendingWithdrawals] = await Promise.all([
        prisma.transaction.findMany({
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: {
            passenger: { select: { fullName: true } },
            driver: { select: { fullName: true } }
          }
        }),
        prisma.transaction.aggregate({
          _sum: { amount: true },
          where: { 
            type: TransactionType.COMMISSION_FEE, 
            status: TransactionStatus.COMPLETED 
          }
        }),
        prisma.transaction.aggregate({
          _sum: { amount: true },
          where: { 
            type: TransactionType.DRIVER_PAYOUT, 
            status: TransactionStatus.PENDING 
          }
        })
      ]);

      const totalCollected = Number(commissionAggregation._sum.amount || 0);
      const totalPending = Number(pendingWithdrawals._sum.amount || 0);

      const formattedTransactions = transactions.map(t => ({
        ...t,
        amount: Number(t.amount || 0)
      }));

      return res.status(200).json({
        success: true,
        wallet: { 
          balance: totalCollected, 
          totalCollected, 
          pendingWithdrawalsAmount: totalPending 
        },
        transactions: formattedTransactions
      });
    } catch (error) {
      console.error('❌ [FINANCE DASHBOARD ERROR]:', error);
      return res.status(500).json({ success: false, error: 'Falha interna ao processar métricas financeiras.' });
    }
  }

  // ==========================================
  // 💸 2. RECARGA MANUAL EM DINHEIRO (ACID)
  // ==========================================
  async manualRecharge(req: Request, res: Response): Promise<Response> {
    try {
      const { userType, userId, amount, reason, description } = req.body;
      const numericAmount = Math.round(Number(amount));

      if (!userId || isNaN(numericAmount) || numericAmount <= 0) {
        return res.status(400).json({ success: false, error: 'Payload inválido: ID ausente ou valor incorreto.' });
      }

      if (!['PASSENGER', 'DRIVER'].includes(userType)) {
        return res.status(400).json({ success: false, error: 'Tipo de usuário não reconhecido pelo sistema.' });
      }

      const targetPassengerId = userType === 'PASSENGER' ? String(userId) : null;
      const targetDriverId = userType === 'DRIVER' ? String(userId) : null;
      const randomRef = `FIN-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

      const newTx = await prisma.$transaction(async (tx) => {
        const updateData = { walletBalance: { increment: numericAmount } };

        if (userType === 'PASSENGER') {
          const passenger = await tx.passenger.findUnique({ where: { id: String(userId) }, select: { id: true } });
          if (!passenger) throw new Error('USER_NOT_FOUND');
          await tx.passenger.update({ where: { id: String(userId) }, data: updateData });
        } else {
          const driver = await tx.driver.findUnique({ where: { id: String(userId) }, select: { id: true } });
          if (!driver) throw new Error('USER_NOT_FOUND');
          await tx.driver.update({ where: { id: String(userId) }, data: updateData });
        }

        return await tx.transaction.create({
          data: {
            type: TransactionType.DEPOSIT,
            amount: numericAmount,
            status: TransactionStatus.COMPLETED,
            paymentMethod: 'CASH',
            passengerId: targetPassengerId,
            driverId: targetDriverId,
            description: reason || description || 'Recarga manual realizada via Admin',
            reference: randomRef
          }
        });
      });

      return res.status(200).json({ 
        success: true,
        message: 'Ativo financeiro creditado com sucesso.', 
        transaction: {
          ...newTx,
          amount: Number(newTx.amount || 0)
        } 
      });
    } catch (error: any) {
      if (error.message === 'USER_NOT_FOUND') {
        return res.status(404).json({ success: false, error: 'Usuário não localizado na base de dados.' });
      }
      console.error('❌ [FINANCE RECHARGE ERROR]:', error);
      return res.status(500).json({ success: false, error: 'Erro de processamento no motor financeiro.' });
    }
  }

  // ==========================================
  // 📊 3. EXPORTAÇÃO DE RELATÓRIO DE TRANSAÇÕES
  // ==========================================
  async exportTransactions(req: Request, res: Response): Promise<Response> {
    try {
      const { startDate, endDate } = req.query;
      let whereClause: any = {};

      if (startDate && endDate) {
        const end = new Date(endDate as string);
        end.setHours(23, 59, 59, 999);

        whereClause.createdAt = {
          gte: new Date(startDate as string),
          lte: end
        };
      }

      const transactions = await prisma.transaction.findMany({
        where: whereClause,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          type: true,
          amount: true,
          status: true,
          paymentMethod: true,
          reference: true,
          description: true,
          createdAt: true,
          passenger: { select: { fullName: true, phone: true } },
          driver: { select: { fullName: true, phone: true } }
        }
      });

      const formatted = transactions.map(t => ({
        ...t,
        amount: Number(t.amount || 0)
      }));

      return res.status(200).json({
        success: true,
        totalRecords: formatted.length,
        transactions: formatted
      });
    } catch (error) {
      console.error('❌ [FINANCE EXPORT ERROR]:', error);
      return res.status(500).json({ success: false, error: 'Falha ao processar o relatório de exportação.' });
    }
  }

  // ==========================================
  // 🔄 4. TENTAR NOVAMENTE TRANSAÇÃO COM FALHA
  // ==========================================
  async retryTransaction(req: Request, res: Response): Promise<Response> {
    try {
      const { id } = req.params;

      const transaction = await prisma.transaction.findUnique({
        where: { id: String(id) }
      });

      if (!transaction) {
        return res.status(404).json({ success: false, error: 'Transação não encontrada.' });
      }

      if (transaction.status !== TransactionStatus.FAILED && (transaction.status as string) !== 'FAILED_MANUAL_REVIEW') {
        return res.status(400).json({ success: false, error: 'Apenas transações com falha podem ser reprocessadas.' });
      }

      const updatedTx = await prisma.transaction.update({
        where: { id: String(id) },
        data: {
          status: TransactionStatus.PENDING,
          description: transaction.description ? `${transaction.description} | Reenviado pelo Admin` : 'Reenviado pelo Admin'
        }
      });

      return res.status(200).json({
        success: true,
        message: 'Transação reenviada para a fila de processamento.',
        transaction: {
          ...updatedTx,
          amount: Number(updatedTx.amount || 0)
        }
      });
    } catch (error) {
      console.error('❌ [FINANCE RETRY ERROR]:', error);
      return res.status(500).json({ success: false, error: 'Falha ao tentar reenviar a transação.' });
    }
  }

  // ==========================================
  // 👛 5. CONSULTAR CARTEIRA E EXTRATO DO MOTORISTA
  // ==========================================
  async getDriverWallet(req: Request, res: Response): Promise<Response> {
    try {
      const { driverId } = req.params;

      const driver = await prisma.driver.findUnique({
        where: { id: String(driverId) },
        select: {
          id: true,
          fullName: true,
          phone: true,
          walletBalance: true,
          status: true,
          isOnline: true,
          paymentAccountNumber: true,
          orangeNumber: true,
          mtnNumber: true
        }
      });

      if (!driver) {
        return res.status(404).json({ success: false, error: 'Motorista não encontrado.' });
      }

      const transactions = await prisma.transaction.findMany({
        where: { driverId: String(driverId) },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          type: true,
          amount: true,
          status: true,
          paymentMethod: true,
          reference: true,
          description: true,
          createdAt: true
        }
      });

      return res.status(200).json({
        success: true,
        driver: {
          ...driver,
          walletBalance: Number(driver.walletBalance || 0)
        },
        transactions: transactions.map(t => ({
          ...t,
          amount: Number(t.amount || 0)
        }))
      });
    } catch (error) {
      console.error('❌ [DRIVER WALLET GET ERROR]:', error);
      return res.status(500).json({ success: false, error: 'Erro ao consultar carteira do motorista.' });
    }
  }

  // ==========================================
  // 💳 6. AJUSTAR / RECARREGAR CARTEIRA DO MOTORISTA (ACID)
  // ==========================================
  async adjustDriverWallet(req: Request, res: Response): Promise<Response> {
    try {
      const { driverId } = req.params;
      const { mode = 'ADD', amount, reason } = req.body;

      const numericAmount = Math.round(Number(amount));
      if (isNaN(numericAmount)) {
        return res.status(400).json({ success: false, error: 'Informe um valor numérico válido em XOF.' });
      }

      if (!['ADD', 'SET'].includes(mode)) {
        return res.status(400).json({ success: false, error: 'Modo de operação inválido (use ADD ou SET).' });
      }

      if (mode === 'ADD' && numericAmount <= 0) {
        return res.status(400).json({ success: false, error: 'O valor a adicionar deve ser maior que 0 XOF.' });
      }

      const randomRef = `ADM-WAL-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

      const result = await prisma.$transaction(async (tx) => {
        const driver = await tx.driver.findUnique({
          where: { id: String(driverId) },
          select: { id: true, fullName: true, walletBalance: true }
        });

        if (!driver) {
          throw new Error('DRIVER_NOT_FOUND');
        }

        const previousBalance = Math.round(Number(driver.walletBalance || 0));
        const newBalance = mode === 'ADD' ? previousBalance + numericAmount : numericAmount;
        const delta = newBalance - previousBalance;

        const updatedDriver = await tx.driver.update({
          where: { id: String(driverId) },
          data: { walletBalance: newBalance },
          select: { id: true, fullName: true, walletBalance: true }
        });

        const baseReason = (reason && String(reason).trim())
          ? String(reason).trim()
          : (mode === 'ADD'
              ? 'Recarga manual de suporte via Painel Admin'
              : 'Ajuste direto de saldo via Painel Admin');

        const auditDescription = `${baseReason} (Saldo: ${previousBalance} -> ${newBalance} XOF)`;

        const transaction = await tx.transaction.create({
          data: {
            type: TransactionType.MANUAL_RECHARGE,
            amount: Math.abs(delta),
            status: TransactionStatus.COMPLETED,
            paymentMethod: 'CASH',
            driverId: String(driverId),
            reference: randomRef,
            description: auditDescription
          }
        });

        return {
          previousBalance,
          newBalance: Math.round(Number(updatedDriver.walletBalance || 0)),
          transaction
        };
      });

      return res.status(200).json({
        success: true,
        message: 'Carteira do motorista atualizada com sucesso.',
        previousBalance: result.previousBalance,
        newBalance: result.newBalance,
        transaction: {
          ...result.transaction,
          amount: Number(result.transaction.amount || 0)
        }
      });
    } catch (error: any) {
      if (error.message === 'DRIVER_NOT_FOUND') {
        return res.status(404).json({ success: false, error: 'Motorista não encontrado.' });
      }
      console.error('❌ [DRIVER WALLET ADJUST ERROR]:', error);
      return res.status(500).json({ success: false, error: 'Falha ao atualizar saldo da carteira do motorista.' });
    }
  }


  // ==========================================
  // 👛 7. CONSULTAR CARTEIRA E EXTRATO DO PASSAGEIRO
  // ==========================================
  async getPassengerWallet(req: Request, res: Response): Promise<Response> {
    try {
      const { passengerId } = req.params;

      const passenger = await prisma.passenger.findUnique({
        where: { id: String(passengerId) },
        select: {
          id: true,
          fullName: true,
          phone: true,
          walletBalance: true,
          status: true,
          paymentAccountNumber: true
        }
      });

      if (!passenger) {
        return res.status(404).json({ success: false, error: 'Passageiro não encontrado.' });
      }

      const transactions = await prisma.transaction.findMany({
        where: { passengerId: String(passengerId) },
        orderBy: { createdAt: 'desc' },
        take: 25,
        select: {
          id: true,
          type: true,
          amount: true,
          status: true,
          paymentMethod: true,
          description: true,
          reference: true,
          createdAt: true
        }
      });

      return res.status(200).json({
        success: true,
        passenger: {
          ...passenger,
          walletBalance: Number(passenger.walletBalance || 0)
        },
        transactions: transactions.map((t) => ({
          ...t,
          amount: Number(t.amount || 0)
        }))
      });
    } catch (error) {
      console.error('❌ [GET PASSENGER WALLET ERROR]:', error);
      return res.status(500).json({ success: false, error: 'Erro ao carregar carteira do passageiro.' });
    }
  }

  // ==========================================
  // 💳 8. REEMBOLSAR / AJUSTAR CARTEIRA DO PASSAGEIRO
  // ==========================================
  async adjustPassengerWallet(req: Request, res: Response): Promise<Response> {
    try {
      const { passengerId } = req.params;
      const { amount, type, reason } = req.body;

      const numericAmount = Math.round(Number(amount));
      if (!numericAmount || numericAmount <= 0) {
        return res.status(400).json({ success: false, error: 'Informe um valor positivo válido em XOF.' });
      }

      if (type !== 'CREDIT' && type !== 'DEBIT') {
        return res.status(400).json({ success: false, error: 'Tipo deve ser CREDIT ou DEBIT.' });
      }

      const cleanReason = String(reason || '').trim();
      if (!cleanReason) {
        return res.status(400).json({ success: false, error: 'Informe a justificativa da operação.' });
      }

      const result = await prisma.$transaction(async (tx) => {
        const passenger = await tx.passenger.findUnique({ where: { id: String(passengerId) } });
        if (!passenger) {
          throw new Error('NOT_FOUND: Passageiro não encontrado.');
        }

        const currentBalance = Number(passenger.walletBalance || 0);
        if (type === 'DEBIT' && currentBalance < numericAmount) {
          throw new Error(`INSUFFICIENT: Saldo atual (${currentBalance} XOF) menor que o débito solicitado.`);
        }

        const newBalance = type === 'CREDIT' ? currentBalance + numericAmount : currentBalance - numericAmount;

        await tx.passenger.update({
          where: { id: String(passengerId) },
          data: { walletBalance: newBalance }
        });

        const record = await tx.transaction.create({
          data: {
            passengerId: String(passengerId),
            type: type === 'CREDIT' ? TransactionType.DEPOSIT : TransactionType.WITHDRAWAL,
            amount: numericAmount,
            status: TransactionStatus.COMPLETED,
            paymentMethod: 'CASH',
            reference: `ADM-PAX-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
            description: `[Admin ${type === 'CREDIT' ? 'Reembolso/Crédito' : 'Débito'}] ${cleanReason}`
          }
        });

        return { newBalance, tx: record };
      });

      try {
        const io = getIo();
        if (io) {
          const payload = { passengerId: String(passengerId), walletBalance: result.newBalance, amount: numericAmount, type };
          io.to(String(passengerId)).to(`passenger_${passengerId}`).emit('wallet:updated', payload);
          io.to(String(passengerId)).to(`passenger_${passengerId}`).emit('passenger:wallet_updated', payload);
        }
      } catch (sockErr) {
        console.warn('⚠️ [SOCKET WALLET PASSENGER]:', sockErr);
      }

      return res.status(200).json({
        success: true,
        message: `${type === 'CREDIT' ? 'Crédito' : 'Débito'} de ${numericAmount} XOF aplicado com sucesso.`,
        newBalance: result.newBalance,
        transaction: result.tx
      });
    } catch (error: any) {
      const msg = error?.message || '';
      if (msg.startsWith('NOT_FOUND:')) {
        return res.status(404).json({ success: false, error: msg.replace('NOT_FOUND: ', '') });
      }
      if (msg.startsWith('INSUFFICIENT:')) {
        return res.status(400).json({ success: false, error: msg.replace('INSUFFICIENT: ', '') });
      }
      console.error('❌ [ADJUST PASSENGER WALLET ERROR]:', error);
      return res.status(500).json({ success: false, error: 'Falha ao atualizar saldo do passageiro.' });
    }
  }

  // ==========================================
  // ✅ 9. COMPENSAÇÃO EM 1 CLIQUE (CONFIRMAR & CREDITAR)
  // ==========================================
  async approveAndCreditTransaction(req: Request, res: Response): Promise<Response> {
    try {
      const { id } = req.params;

      const result = await prisma.$transaction(async (tx) => {
        const transaction = await tx.transaction.findUnique({ where: { id: String(id) } });
        if (!transaction) {
          throw new Error('NOT_FOUND: Transação não encontrada.');
        }

        if (transaction.status === TransactionStatus.COMPLETED) {
          throw new Error('ALREADY_DONE: Esta transação já está concluída.');
        }

        const amount = Math.round(Number(transaction.amount || 0));
        if (amount <= 0) {
          throw new Error('INVALID_AMOUNT: Valor da transação inválido para compensação.');
        }

        const updatedTx = await tx.transaction.update({
          where: { id: String(id) },
          data: {
            status: TransactionStatus.COMPLETED,
            description: transaction.description
              ? `${transaction.description} | Confirmado pelo Admin`
              : 'Compensação confirmada manualmente pelo Admin'
          }
        });

        let newDriverBalance: number | null = null;
        let newPassengerBalance: number | null = null;

        if (transaction.driverId) {
          const driver = await tx.driver.update({
            where: { id: transaction.driverId },
            data: { walletBalance: { increment: amount } }
          });
          newDriverBalance = Number(driver.walletBalance || 0);
        } else if (transaction.passengerId) {
          const passenger = await tx.passenger.update({
            where: { id: transaction.passengerId },
            data: { walletBalance: { increment: amount } }
          });
          newPassengerBalance = Number(passenger.walletBalance || 0);
        }

        return { updatedTx, amount, newDriverBalance, newPassengerBalance };
      });

      try {
        const io = getIo();
        if (io) {
          if (result.updatedTx.driverId && result.newDriverBalance !== null) {
            const payload = {
              driverId: result.updatedTx.driverId,
              walletBalance: result.newDriverBalance,
              amount: result.amount,
              type: 'CREDIT'
            };
            io.to(result.updatedTx.driverId).to(`driver_${result.updatedTx.driverId}`).emit('wallet:updated', payload);
            io.to(result.updatedTx.driverId).to(`driver_${result.updatedTx.driverId}`).emit('driver:wallet_updated', payload);
          }
          if (result.updatedTx.passengerId && result.newPassengerBalance !== null) {
            const payload = {
              passengerId: result.updatedTx.passengerId,
              walletBalance: result.newPassengerBalance,
              amount: result.amount,
              type: 'CREDIT'
            };
            io.to(result.updatedTx.passengerId).to(`passenger_${result.updatedTx.passengerId}`).emit('wallet:updated', payload);
          }
        }
      } catch (sockErr) {
        console.warn('⚠️ [SOCKET APPROVE TX]:', sockErr);
      }

      return res.status(200).json({
        success: true,
        message: `Transação de ${result.amount} XOF confirmada e creditada com sucesso!`,
        transaction: {
          ...result.updatedTx,
          amount: result.amount
        }
      });
    } catch (error: any) {
      const msg = error?.message || '';
      if (msg.startsWith('NOT_FOUND:')) {
        return res.status(404).json({ success: false, error: msg.replace('NOT_FOUND: ', '') });
      }
      if (msg.startsWith('ALREADY_DONE:') || msg.startsWith('INVALID_AMOUNT:')) {
        return res.status(400).json({ success: false, error: msg.split(': ')[1] });
      }
      console.error('❌ [APPROVE TX ERROR]:', error);
      return res.status(500).json({ success: false, error: 'Erro ao confirmar e creditar transação.' });
    }
  }


  // ==========================================
  // 📊 10. FECHAMENTO DIÁRIO POR MOTORISTA
  // ==========================================
  async getDriverDailyClosing(req: Request, res: Response): Promise<Response> {
    try {
      const rawDate = String(req.query.date || '').trim();
      const targetDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
        ? rawDate
        : new Date().toISOString().slice(0, 10);

      const startOfDay = new Date(`${targetDate}T00:00:00.000Z`);
      const endOfDay = new Date(`${targetDate}T23:59:59.999Z`);

      const completedRides = await prisma.ride.findMany({
        where: {
          status: 'COMPLETED',
          driverId: { not: null },
          OR: [
            { finishedAt: { gte: startOfDay, lte: endOfDay } },
            { finishedAt: null, createdAt: { gte: startOfDay, lte: endOfDay } }
          ]
        },
        select: {
          id: true,
          driverId: true,
          priceXof: true,
          platformFee: true,
          driverEarnings: true,
          paymentMethod: true,
          finishedAt: true,
          createdAt: true,
          driver: {
            select: {
              id: true,
              fullName: true,
              phone: true,
              vehiclePlate: true,
              walletBalance: true,
              orangeNumber: true,
              mtnNumber: true,
              paymentAccountNumber: true
            }
          }
        }
      });

      const grouped = new Map<string, any>();

      for (const ride of completedRides) {
        if (!ride.driverId || !ride.driver) continue;

        const gross = Number(ride.priceXof || 0);
        const fee = ride.platformFee !== null && ride.platformFee !== undefined
          ? Number(ride.platformFee)
          : Math.max(0, gross - Number(ride.driverEarnings || 0));
        const net = ride.driverEarnings !== null && ride.driverEarnings !== undefined
          ? Number(ride.driverEarnings)
          : Math.max(0, gross - fee);

        const isCash = ride.paymentMethod === 'CASH';

        if (!grouped.has(ride.driverId)) {
          const d = ride.driver;
          const payoutAccount = d.orangeNumber
            ? `Orange: ${d.orangeNumber}`
            : d.mtnNumber
              ? `MTN: ${d.mtnNumber}`
              : d.paymentAccountNumber || d.phone;

          grouped.set(ride.driverId, {
            driverId: d.id,
            fullName: d.fullName,
            phone: d.phone,
            vehiclePlate: d.vehiclePlate,
            payoutAccount,
            walletBalance: Number(d.walletBalance || 0),
            ridesCount: 0,
            digitalRidesCount: 0,
            cashRidesCount: 0,
            grossRevenue: 0,
            digitalRevenue: 0,
            cashRevenue: 0,
            commissionRetained: 0,
            netDriverEarnings: 0
          });
        }

        const entry = grouped.get(ride.driverId);
        entry.ridesCount += 1;
        entry.grossRevenue += gross;
        entry.commissionRetained += fee;
        entry.netDriverEarnings += net;

        if (isCash) {
          entry.cashRidesCount += 1;
          entry.cashRevenue += gross;
        } else {
          entry.digitalRidesCount += 1;
          entry.digitalRevenue += gross;
        }
      }

      const drivers = Array.from(grouped.values()).sort(
        (a, b) => b.grossRevenue - a.grossRevenue
      );

      const summary = drivers.reduce(
        (acc, d) => {
          acc.activeDrivers += 1;
          acc.totalRides += d.ridesCount;
          acc.totalGross += d.grossRevenue;
          acc.totalCommission += d.commissionRetained;
          acc.totalDriverNet += d.netDriverEarnings;
          acc.totalWalletPayable += Math.max(0, d.walletBalance);
          return acc;
        },
        {
          activeDrivers: 0,
          totalRides: 0,
          totalGross: 0,
          totalCommission: 0,
          totalDriverNet: 0,
          totalWalletPayable: 0
        }
      );

      return res.status(200).json({
        success: true,
        date: targetDate,
        summary,
        drivers
      });
    } catch (error) {
      console.error('❌ [DRIVER DAILY CLOSING ERROR]:', error);
      return res.status(500).json({
        success: false,
        error: 'Erro ao calcular o fechamento diário por motorista.'
      });
    }
  }

  // ==========================================
  // 💸 11. REGISTRAR REPASSE / LIQUIDAÇÃO AO MOTORISTA
  // ==========================================
  async settleDriverPayout(req: Request, res: Response): Promise<Response> {
    try {
      const { driverId, amount, date, referenceNote } = req.body;

      if (!driverId) {
        return res.status(400).json({ success: false, error: 'ID do motorista é obrigatório.' });
      }

      const numericAmount = Math.round(Number(amount));
      if (!numericAmount || numericAmount <= 0) {
        return res.status(400).json({ success: false, error: 'Informe um valor de repasse válido em XOF.' });
      }

      const result = await prisma.$transaction(async (tx) => {
        const driver = await tx.driver.findUnique({ where: { id: String(driverId) } });
        if (!driver) {
          throw new Error('NOT_FOUND: Motorista não encontrado.');
        }

        const currentBalance = Number(driver.walletBalance || 0);
        if (currentBalance < numericAmount) {
          throw new Error(`INSUFFICIENT: Saldo atual (${currentBalance} XOF) é menor que o repasse solicitado.`);
        }

        const newBalance = currentBalance - numericAmount;
        await tx.driver.update({
          where: { id: String(driverId) },
          data: { walletBalance: newBalance }
        });

        const method = driver.orangeNumber
          ? 'ORANGE_MONEY'
          : driver.mtnNumber
            ? 'MTN_MOMO'
            : 'CASH';

        const closingLabel = date ? `Fechamento ${date}` : 'Fechamento Diário';
        const noteSuffix = referenceNote ? ` • Ref: ${String(referenceNote).trim()}` : '';

        const record = await tx.transaction.create({
          data: {
            driverId: String(driverId),
            type: TransactionType.WITHDRAWAL,
            amount: numericAmount,
            status: TransactionStatus.COMPLETED,
            paymentMethod: method,
            reference: `PAYOUT-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
            description: `[Repasse ${closingLabel}] Liquidação ao motorista${noteSuffix}`
          }
        });

        return { newBalance, tx: record, driverName: driver.fullName };
      });

      try {
        const io = getIo();
        if (io) {
          const payload = {
            driverId: String(driverId),
            walletBalance: result.newBalance,
            amount: numericAmount,
            type: 'DEBIT'
          };
          io.to(String(driverId)).to(`driver_${driverId}`).emit('wallet:updated', payload);
          io.to(String(driverId)).to(`driver_${driverId}`).emit('driver:wallet_updated', payload);
        }
      } catch (sockErr) {
        console.warn('⚠️ [SOCKET DRIVER PAYOUT]:', sockErr);
      }

      return res.status(200).json({
        success: true,
        message: `Repasse de ${numericAmount} XOF registrado para ${result.driverName}!`,
        newBalance: result.newBalance,
        transaction: result.tx
      });
    } catch (error: any) {
      const msg = error?.message || '';
      if (msg.startsWith('NOT_FOUND:')) {
        return res.status(404).json({ success: false, error: msg.replace('NOT_FOUND: ', '') });
      }
      if (msg.startsWith('INSUFFICIENT:')) {
        return res.status(400).json({ success: false, error: msg.replace('INSUFFICIENT: ', '') });
      }
      console.error('❌ [SETTLE DRIVER PAYOUT ERROR]:', error);
      return res.status(500).json({ success: false, error: 'Falha ao registrar repasse ao motorista.' });
    }
  }

}
