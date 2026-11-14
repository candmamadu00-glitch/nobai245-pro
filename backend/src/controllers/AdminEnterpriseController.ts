import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { sendPushNotification, PUSH_CHANNELS } from '../services/pushNotifications';
import { getIo } from '../server';

export class AdminEnterpriseController {
  // ==========================================
  // 🛡️ 1. TRILHA DE AUDITORIA DE COLABORADORES
  // ==========================================
  static async listAuditLogs(req: Request, res: Response): Promise<Response> {
    try {
      const limit = Math.min(200, Math.max(10, Number(req.query.limit) || 80));
      const search = String(req.query.search || '').trim();

      const whereClause: any = {};
      if (search) {
        whereClause.OR = [
          { action: { contains: search, mode: 'insensitive' } },
          { targetType: { contains: search, mode: 'insensitive' } },
          { targetId: { contains: search, mode: 'insensitive' } },
          { admin: { name: { contains: search, mode: 'insensitive' } } },
          { admin: { email: { contains: search, mode: 'insensitive' } } }
        ];
      }

      const logs = await prisma.adminAuditLog.findMany({
        where: whereClause,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          admin: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true
            }
          }
        }
      });

      return res.status(200).json({ success: true, data: logs });
    } catch (error) {
      console.error('❌ [AUDIT LOGS ERROR]:', error);
      return res.status(500).json({ success: false, error: 'Erro ao carregar trilha de auditoria.' });
    }
  }

  // ==========================================
  // 🎟️ 2. GESTOR DE CUPONS PROMOCIONAIS
  // ==========================================
  static async listPromoCodes(req: Request, res: Response): Promise<Response> {
    try {
      const promos = await prisma.promoCode.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          _count: {
            select: { rides: true, usedBy: true }
          }
        }
      });

      const discountAgg = await prisma.ride.aggregate({
        _sum: { discountAmount: true },
        where: { promoCodeId: { not: null }, status: 'COMPLETED' }
      });

      const formatted = promos.map((p) => ({
        ...p,
        discountPercentage: p.discountPercentage !== null ? Number(p.discountPercentage) : null,
        discountFixed: p.discountFixed !== null ? Number(p.discountFixed) : null,
        maxDiscountAmount: p.maxDiscountAmount !== null ? Number(p.maxDiscountAmount) : null,
        minRideAmount: Number(p.minRideAmount || 0)
      }));

      return res.status(200).json({
        success: true,
        summary: {
          totalPromos: formatted.length,
          activePromos: formatted.filter((p) => p.isActive).length,
          totalRedemptions: formatted.reduce((acc, p) => acc + Number(p.currentUsage || 0), 0),
          totalDiscountGrantedXof: Number(discountAgg._sum.discountAmount || 0)
        },
        data: formatted
      });
    } catch (error) {
      console.error('❌ [LIST PROMOS ERROR]:', error);
      return res.status(500).json({ success: false, error: 'Erro ao listar cupons promocionais.' });
    }
  }

  static async createPromoCode(req: Request, res: Response): Promise<Response> {
    try {
      const {
        code,
        description,
        discountType,
        discountValue,
        maxDiscountAmount,
        minRideAmount,
        maxUsageTotal,
        maxUsagePerUser,
        expiresAt
      } = req.body || {};

      const cleanCode = String(code || '').trim().toUpperCase().replace(/\s+/g, '');
      if (!cleanCode || cleanCode.length < 3) {
        return res.status(400).json({ success: false, error: 'Informe um código promocional válido (mínimo 3 caracteres).' });
      }

      const numVal = Number(discountValue);
      if (!numVal || numVal <= 0) {
        return res.status(400).json({ success: false, error: 'Informe um valor de desconto positivo.' });
      }

      if (discountType === 'PERCENTAGE' && numVal > 100) {
        return res.status(400).json({ success: false, error: 'O desconto percentual não pode ultrapassar 100%.' });
      }

      const existing = await prisma.promoCode.findUnique({ where: { code: cleanCode } });
      if (existing) {
        return res.status(409).json({ success: false, error: `O cupom ${cleanCode} já existe.` });
      }

      const created = await prisma.promoCode.create({
        data: {
          code: cleanCode,
          description: description ? String(description).trim() : null,
          discountPercentage: discountType === 'PERCENTAGE' ? numVal : null,
          discountFixed: discountType === 'FIXED' ? Math.round(numVal) : null,
          maxDiscountAmount: maxDiscountAmount ? Math.round(Number(maxDiscountAmount)) : null,
          minRideAmount: minRideAmount ? Math.round(Number(minRideAmount)) : 0,
          maxUsageTotal: maxUsageTotal ? Number(maxUsageTotal) : null,
          maxUsagePerUser: maxUsagePerUser ? Math.max(1, Number(maxUsagePerUser)) : 1,
          expiresAt: expiresAt ? new Date(expiresAt) : null,
          isActive: true
        }
      });

      return res.status(201).json({
        success: true,
        message: `Cupom ${cleanCode} criado com sucesso!`,
        promo: created
      });
    } catch (error) {
      console.error('❌ [CREATE PROMO ERROR]:', error);
      return res.status(500).json({ success: false, error: 'Erro ao criar cupom promocional.' });
    }
  }

  static async togglePromoCode(req: Request, res: Response): Promise<Response> {
    try {
      const { id } = req.params;
      const promo = await prisma.promoCode.findUnique({ where: { id: String(id) } });
      if (!promo) {
        return res.status(404).json({ success: false, error: 'Cupom não encontrado.' });
      }

      const updated = await prisma.promoCode.update({
        where: { id: String(id) },
        data: { isActive: !promo.isActive }
      });

      return res.status(200).json({
        success: true,
        message: `Cupom ${updated.code} ${updated.isActive ? 'ativado' : 'pausado'}.`,
        promo: updated
      });
    } catch (error) {
      console.error('❌ [TOGGLE PROMO ERROR]:', error);
      return res.status(500).json({ success: false, error: 'Erro ao atualizar status do cupom.' });
    }
  }

  static async deletePromoCode(req: Request, res: Response): Promise<Response> {
    try {
      const { id } = req.params;
      const promo = await prisma.promoCode.findUnique({ where: { id: String(id) } });
      if (!promo) {
        return res.status(404).json({ success: false, error: 'Cupom não encontrado.' });
      }

      if (promo.currentUsage > 0) {
        await prisma.promoCode.update({
          where: { id: String(id) },
          data: { isActive: false }
        });
        return res.status(200).json({
          success: true,
          message: `Cupom ${promo.code} já possui histórico de uso e foi desativado permanentemente.`
        });
      }

      await prisma.promoCode.delete({ where: { id: String(id) } });
      return res.status(200).json({
        success: true,
        message: `Cupom ${promo.code} removido com sucesso.`
      });
    } catch (error) {
      console.error('❌ [DELETE PROMO ERROR]:', error);
      return res.status(500).json({ success: false, error: 'Erro ao excluir cupom.' });
    }
  }

  // ==========================================
  // 📣 3. CENTRAL DE COMUNICAÇÃO & PUSH EM MASSA
  // ==========================================
  static async sendBroadcastPush(req: Request, res: Response): Promise<Response> {
    try {
      const { targetGroup, title, body } = req.body || {};
      const cleanTitle = String(title || '').trim();
      const cleanBody = String(body || '').trim();

      if (!cleanTitle || !cleanBody) {
        return res.status(400).json({ success: false, error: 'Título e mensagem são obrigatórios.' });
      }

      const group = String(targetGroup || 'ALL_DRIVERS');
      const tokens: string[] = [];
      let audienceCount = 0;

      if (group === 'ALL_DRIVERS' || group === 'ONLINE_DRIVERS' || group === 'LOW_BALANCE_DRIVERS' || group === 'ALL_USERS') {
        const driverWhere: any = { deletedAt: null, status: 'APPROVED' };
        if (group === 'ONLINE_DRIVERS') driverWhere.isOnline = true;
        if (group === 'LOW_BALANCE_DRIVERS') driverWhere.walletBalance = { lte: 500 };

        const drivers = await prisma.driver.findMany({
          where: driverWhere,
          select: { id: true, deviceToken: true }
        });

        audienceCount += drivers.length;
        for (const d of drivers) {
          if (d.deviceToken) tokens.push(d.deviceToken);
        }
      }

      if (group === 'ALL_PASSENGERS' || group === 'ALL_USERS') {
        const passengers = await prisma.passenger.findMany({
          where: { deletedAt: null, status: 'ACTIVE' }
        });

        audienceCount += passengers.length;
        for (const p of passengers as any[]) {
          const tok = p.deviceToken || p.pushToken || p.fcmToken;
          if (tok) tokens.push(tok);
        }
      }

      const uniqueTokens = Array.from(new Set(tokens));

      if (uniqueTokens.length > 0) {
        const payloads = uniqueTokens.map((token) => ({
          to: token,
          title: cleanTitle,
          body: cleanBody,
          data: { type: 'ADMIN_BROADCAST', targetGroup: group },
          channelId: PUSH_CHANNELS.RIDE_UPDATE
        }));

        sendPushNotification(payloads).catch((err) =>
          console.error('❌ [BROADCAST PUSH DELIVERY ERR]:', err)
        );
      }

      try {
        const io = getIo();
        if (io) {
          io.emit('system:announcement', {
            title: cleanTitle,
            body: cleanBody,
            targetGroup: group,
            sentAt: new Date().toISOString()
          });
        }
      } catch {}

      return res.status(200).json({
        success: true,
        message: `Comunicado enviado! Público alcançado: ${audienceCount} usuário(s) (${uniqueTokens.length} dispositivos com Push ativo).`,
        stats: { audienceCount, pushDevices: uniqueTokens.length }
      });
    } catch (error) {
      console.error('❌ [BROADCAST PUSH ERROR]:', error);
      return res.status(500).json({ success: false, error: 'Erro ao disparar comunicado em massa.' });
    }
  }

  // ==========================================
  // 📈 4. INTELIGÊNCIA OPERACIONAL & CANCELAMENTOS (BI)
  // ==========================================
  static async getOperationalAnalytics(req: Request, res: Response): Promise<Response> {
    try {
      const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
      const since = new Date();
      since.setDate(since.getDate() - days);

      const rides = await prisma.ride.findMany({
        where: { createdAt: { gte: since } },
        select: {
          id: true,
          status: true,
          cancelledBy: true,
          cancellationReason: true,
          paymentMethod: true,
          requestedVehicleType: true,
          priceXof: true,
          platformFee: true,
          driverEarnings: true,
          originAddress: true,
          destinationAddress: true,
          createdAt: true
        }
      });

      const total = rides.length;
      const completed = rides.filter((r) => r.status === 'COMPLETED');
      const cancelled = rides.filter((r) => r.status === 'CANCELLED');
      const active = rides.filter((r) => !['COMPLETED', 'CANCELLED'].includes(r.status));

      const grossRevenue = completed.reduce((s, r) => s + Number(r.priceXof || 0), 0);
      const platformRevenue = completed.reduce((s, r) => s + Number(r.platformFee || 0), 0);
      const driverNetTotal = completed.reduce((s, r) => s + Number(r.driverEarnings || 0), 0);
      const avgTicket = completed.length > 0 ? Math.round(grossRevenue / completed.length) : 0;
      const completionRate = total > 0 ? Number(((completed.length / total) * 100).toFixed(1)) : 0;

      // Quebra de cancelamentos por responsável
      const cancelByActor: Record<string, number> = {
        PASSENGER: 0,
        DRIVER: 0,
        SYSTEM_OR_UNASSIGNED: 0
      };
      const reasonCounts = new Map<string, number>();

      for (const c of cancelled) {
        if (c.cancelledBy === 'PASSENGER') cancelByActor.PASSENGER += 1;
        else if (c.cancelledBy === 'DRIVER') cancelByActor.DRIVER += 1;
        else cancelByActor.SYSTEM_OR_UNASSIGNED += 1;

        const reasonLabel = (c.cancellationReason || 'Sem motivo registrado').trim();
        reasonCounts.set(reasonLabel, (reasonCounts.get(reasonLabel) || 0) + 1);
      }

      const topCancelReasons = Array.from(reasonCounts.entries())
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6);

      // Receita por método de pagamento
      const paymentBreakdown: Record<string, { rides: number; revenue: number }> = {
        CASH: { rides: 0, revenue: 0 },
        ORANGE_MONEY: { rides: 0, revenue: 0 },
        MTN_MOMO: { rides: 0, revenue: 0 }
      };

      // Receita por categoria de veículo
      const vehicleBreakdown: Record<string, { rides: number; revenue: number }> = {};

      // Corredores mais demandados
      const routeCounts = new Map<string, { origin: string; destination: string; total: number; completed: number }>();

      for (const r of rides) {
        const key = `${r.originAddress} → ${r.destinationAddress}`;
        if (!routeCounts.has(key)) {
          routeCounts.set(key, {
            origin: r.originAddress,
            destination: r.destinationAddress,
            total: 0,
            completed: 0
          });
        }
        const entry = routeCounts.get(key)!;
        entry.total += 1;
        if (r.status === 'COMPLETED') entry.completed += 1;
      }

      for (const r of completed) {
        const pm = String(r.paymentMethod || 'CASH');
        if (!paymentBreakdown[pm]) paymentBreakdown[pm] = { rides: 0, revenue: 0 };
        paymentBreakdown[pm].rides += 1;
        paymentBreakdown[pm].revenue += Number(r.priceXof || 0);

        const vt = String(r.requestedVehicleType || 'TAXI');
        if (!vehicleBreakdown[vt]) vehicleBreakdown[vt] = { rides: 0, revenue: 0 };
        vehicleBreakdown[vt].rides += 1;
        vehicleBreakdown[vt].revenue += Number(r.priceXof || 0);
      }

      const topRoutes = Array.from(routeCounts.values())
        .sort((a, b) => b.total - a.total)
        .slice(0, 6);

      return res.status(200).json({
        success: true,
        periodDays: days,
        kpis: {
          totalRides: total,
          completedRides: completed.length,
          cancelledRides: cancelled.length,
          activeRides: active.length,
          completionRate,
          grossRevenue,
          platformRevenue,
          driverNetTotal,
          avgTicket
        },
        cancelByActor,
        topCancelReasons,
        paymentBreakdown,
        vehicleBreakdown,
        topRoutes
      });
    } catch (error) {
      console.error('❌ [OPERATIONAL ANALYTICS ERROR]:', error);
      return res.status(500).json({ success: false, error: 'Erro ao calcular inteligência operacional.' });
    }
  }
}
