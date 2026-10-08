import { Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { TransactionType, TransactionStatus } from '@prisma/client';

export class AdminFinanceController {
  
  // 💰 1. DASHBOARD FINANCEIRO: Consultas Paralelas e Otimizadas
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
          where: { type: TransactionType.COMMISSION_FEE, status: TransactionStatus.COMPLETED }
        }),
        prisma.transaction.aggregate({
          _sum: { amount: true },
          where: { type: TransactionType.DRIVER_PAYOUT, status: TransactionStatus.PENDING }
        })
      ]);

      const totalCollected = Number(commissionAggregation._sum.amount || 0);
      const totalPending = Number(pendingWithdrawals._sum.amount || 0);

      return res.status(200).json({
        wallet: { 
          balance: totalCollected, 
          totalCollected, 
          pendingWithdrawalsAmount: totalPending 
        },
        transactions
      });
    } catch (error) {
      console.error('❌ [FINANCE DASHBOARD CRITICAL ERROR]:', error);
      return res.status(500).json({ error: 'Falha interna ao processar métricas financeiras.' });
    }
  }

  // 💸 2. RECARGA MANUAL: Transações Atômicas (ACID)
  async manualRecharge(req: Request, res: Response): Promise<Response> {
    try {
      const { userType, userId, amount, reason, description } = req.body;
      const numericAmount = Number(amount);

      if (!userId || isNaN(numericAmount) || numericAmount <= 0) {
        return res.status(400).json({ error: 'Payload inválido: ID ausente ou valor incorreto.' });
      }

      if (!['PASSENGER', 'DRIVER'].includes(userType)) {
        return res.status(400).json({ error: 'Tipo de usuário não reconhecido pelo sistema.' });
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
        message: 'Ativo financeiro creditado com sucesso.', 
        transaction: newTx 
      });
    } catch (error: any) {
      if (error.message === 'USER_NOT_FOUND') {
        return res.status(404).json({ error: 'Usuário não localizado na base de dados.' });
      }
      console.error('❌ [FINANCE RECHARGE ERROR]:', error);
      return res.status(500).json({ error: 'Erro de processamento no motor financeiro.' });
    }
  }

  // 📊 3. EXPORTAÇÃO: Otimizada para baixo consumo de memória
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
          createdAt: true,
          passenger: { select: { fullName: true } },
          driver: { select: { fullName: true } }
        }
      });

      return res.status(200).json(transactions);
    } catch (error) {
      console.error('❌ [FINANCE EXPORT ERROR]:', error);
      return res.status(500).json({ error: 'Falha ao processar o relatório de exportação.' });
    }
  }

  // 🔄 4. TENTAR NOVAMENTE: Reprocessar falhas de saque/pagamento
  async retryTransaction(req: Request, res: Response): Promise<Response> {
    try {
      const { id } = req.params;

      const transaction = await prisma.transaction.findUnique({
        where: { id: String(id) }
      });

      if (!transaction) {
        return res.status(404).json({ error: 'Transação não encontrada.' });
      }

      if (transaction.status !== TransactionStatus.FAILED && transaction.status !== TransactionStatus.FAILED_MANUAL_REVIEW) {
        return res.status(400).json({ error: 'Apenas transações com falha podem ser reprocessadas.' });
      }

      const updatedTx = await prisma.transaction.update({
        where: { id: String(id) },
        data: {
          status: TransactionStatus.PENDING,
          description: transaction.description ? `${transaction.description} | Reenviado pelo Admin` : 'Reenviado pelo Admin'
        }
      });

      return res.status(200).json({
        message: 'Transação reenviada para a fila de processamento.',
        transaction: updatedTx
      });
    } catch (error) {
      console.error('❌ [FINANCE RETRY ERROR]:', error);
      return res.status(500).json({ error: 'Falha ao tentar reenviar a transação.' });
    }
  }
}

export default new AdminFinanceController();