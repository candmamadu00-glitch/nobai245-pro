import { Request, Response } from 'express';
import { prisma } from '../config/prisma';

export class MobileSyncController {
  // 🎟️ Validar Cupom Promocional no App Passageiro
  async validateCoupon(req: Request, res: Response): Promise<Response> {
    try {
      const code = String(req.body.code || '').trim().toUpperCase();
      const ridePriceXof = Math.max(0, Number(req.body.ridePriceXof || 0));

      if (!code) {
        return res.status(400).json({ success: false, error: 'Informe um código de cupom.' });
      }

      const promo = await prisma.promoCode.findUnique({ where: { code } });
      if (!promo || !promo.isActive) {
        return res.status(404).json({ success: false, error: 'Cupom inválido ou inativo.' });
      }

      const now = new Date();
      if (promo.expiresAt && now > new Date(promo.expiresAt)) {
        return res.status(400).json({ success: false, error: 'Este cupom expirou.' });
      }
      if (promo.maxUsageTotal !== null && promo.currentUsage >= promo.maxUsageTotal) {
        return res.status(400).json({ success: false, error: 'Limite de utilizações deste cupom atingido.' });
      }
      if (promo.minRideAmount && ridePriceXof > 0 && ridePriceXof < Number(promo.minRideAmount)) {
        return res.status(400).json({
          success: false,
          error: `Valor mínimo da viagem para este cupom: ${Math.round(Number(promo.minRideAmount))} XOF.`
        });
      }

      let discountXof = 0;
      const isPercent = promo.discountPercentage !== null && Number(promo.discountPercentage) > 0;
      if (isPercent) {
        discountXof = Math.round((ridePriceXof * Number(promo.discountPercentage)) / 100);
        if (promo.maxDiscountAmount && discountXof > Number(promo.maxDiscountAmount)) {
          discountXof = Math.round(Number(promo.maxDiscountAmount));
        }
      } else if (promo.discountFixed !== null && Number(promo.discountFixed) > 0) {
        discountXof = Math.round(Number(promo.discountFixed));
      }

      const finalPriceXof = Math.max(0, ridePriceXof - discountXof);

      return res.status(200).json({
        success: true,
        coupon: {
          id: promo.id,
          code: promo.code,
          description: promo.description,
          discountType: isPercent ? 'PERCENT' : 'FIXED',
          discountValue: isPercent ? Number(promo.discountPercentage) : Number(promo.discountFixed || 0),
        },
        discountXof,
        finalPriceXof,
      });
    } catch (error: any) {
      console.error('❌ [VALIDATE_COUPON]:', error?.message || error);
      return res.status(500).json({ success: false, error: 'Erro ao validar cupom.' });
    }
  }

  // 🎟️ Listar Cupons Públicos Ativos para o Clube BAI 245
  async getActivePromotions(req: Request, res: Response): Promise<Response> {
    try {
      const now = new Date();
      const promos = await prisma.promoCode.findMany({
        where: {
          isActive: true,
          OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

      const availableCoupons = promos
        .filter((p) => p.maxUsageTotal === null || p.currentUsage < p.maxUsageTotal)
        .map((p) => {
          const isPercent = p.discountPercentage !== null && Number(p.discountPercentage) > 0;
          return {
            id: p.id,
            code: p.code,
            description: p.description || 'Desconto promocional Nô Bai 245',
            discountType: isPercent ? 'PERCENT' : 'FIXED',
            discountValue: isPercent ? Number(p.discountPercentage) : Number(p.discountFixed || 0),
            validUntil: p.expiresAt,
          };
        });

      return res.status(200).json({ success: true, coupons: availableCoupons });
    } catch (error: any) {
      return res.status(200).json({ success: true, coupons: [] });
    }
  }

  // 🏢 Verificar Vínculo Corporativo B2B do Passageiro
  async getCorporateStatus(req: Request, res: Response): Promise<Response> {
    try {
      const passengerId = (req as any).user?.id;
      if (!passengerId) {
        return res.status(401).json({ success: false, error: 'Não autenticado.' });
      }

      const passenger = await prisma.passenger.findUnique({
        where: { id: passengerId },
        select: { phone: true },
      });

      if (!passenger?.phone) {
        return res.status(200).json({ success: true, hasCorporate: false });
      }

      const cleanPhone = passenger.phone.replace(/\D/g, '');
      const last9 = cleanPhone.slice(-9);

      const employee = await prisma.corporateEmployee.findFirst({
        where: {
          isActive: true,
          phone: { contains: last9 || cleanPhone },
          corporate: { isActive: true },
        },
        include: { corporate: true },
      });

      if (!employee || !employee.corporate) {
        return res.status(200).json({ success: true, hasCorporate: false });
      }

      const creditLimit = Number(employee.corporate.creditLimitXof || 0);
      const currentBalance = Number(employee.corporate.currentBalanceXof || 0);
      const availableCredit = Math.max(0, creditLimit - currentBalance);

      return res.status(200).json({
        success: true,
        hasCorporate: true,
        corporate: {
          id: employee.corporate.id,
          name: employee.corporate.name,
          costCenter: employee.corporate.costCenter,
          department: employee.department,
          availableCreditXof: availableCredit,
          monthlyLimitXof: employee.monthlyLimitXof ? Number(employee.monthlyLimitXof) : null,
        },
      });
    } catch (error: any) {
      console.error('❌ [CORPORATE_STATUS]:', error?.message || error);
      return res.status(200).json({ success: true, hasCorporate: false });
    }
  }

  // 🏆 Missões Ativas, Conformidade Documental, Limite de Carteira e Frota do Motorista
  async getDriverScaleStatus(req: Request, res: Response): Promise<Response> {
    try {
      const driverId = (req as any).user?.id;
      if (!driverId) {
        return res.status(401).json({ success: false, error: 'Não autenticado.' });
      }

      const [driver, sysConfig, missions] = await Promise.all([
        prisma.driver.findUnique({
          where: { id: driverId },
          select: {
            walletBalance: true,
            licenseExpiresAt: true,
            insuranceExpiresAt: true,
            fleetPartnerLink: {
              include: { partner: true },
            },
          },
        }),
        prisma.systemConfig.findFirst().catch(() => null),
        prisma.driverMission.findMany({
          where: {
            isActive: true,
            endsAt: { gte: new Date() },
          },
          orderBy: { endsAt: 'asc' },
        }),
      ]);

      if (!driver) {
        return res.status(404).json({ success: false, error: 'Motorista não encontrado.' });
      }

      const missionsWithProgress = await Promise.all(
        missions.map(async (m) => {
          const completedRides = await prisma.ride.count({
            where: {
              driverId,
              status: 'COMPLETED',
              finishedAt: {
                gte: m.startsAt,
                lte: m.endsAt,
              },
            },
          });

          const target = Math.max(1, m.targetRides);
          const progressPercent = Math.min(100, Math.round((completedRides / target) * 100));

          return {
            id: m.id,
            title: m.title,
            description: m.description,
            targetRides: target,
            completedRides,
            progressPercent,
            isCompleted: completedRides >= target,
            rewardXof: Number(m.rewardXof),
            endsAt: m.endsAt,
          };
        })
      );

      const now = new Date();
      const warnThreshold = new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000);
      const docAlerts: Array<{ type: string; status: 'EXPIRED' | 'EXPIRING_SOON'; date: Date }> = [];

      if (driver.licenseExpiresAt) {
        if (new Date(driver.licenseExpiresAt) < now) {
          docAlerts.push({ type: 'CNH / Carta de Condução', status: 'EXPIRED', date: driver.licenseExpiresAt });
        } else if (new Date(driver.licenseExpiresAt) <= warnThreshold) {
          docAlerts.push({ type: 'CNH / Carta de Condução', status: 'EXPIRING_SOON', date: driver.licenseExpiresAt });
        }
      }

      if (driver.insuranceExpiresAt) {
        if (new Date(driver.insuranceExpiresAt) < now) {
          docAlerts.push({ type: 'Seguro do Veículo', status: 'EXPIRED', date: driver.insuranceExpiresAt });
        } else if (new Date(driver.insuranceExpiresAt) <= warnThreshold) {
          docAlerts.push({ type: 'Seguro do Veículo', status: 'EXPIRING_SOON', date: driver.insuranceExpiresAt });
        }
      }

      const minBalance = Number(sysConfig?.minDriverBalanceXof ?? 0);
      const currentBalance = Number(driver.walletBalance || 0);

      return res.status(200).json({
        success: true,
        wallet: {
          balanceXof: currentBalance,
          minAllowedXof: minBalance,
          isBlockedByDebt: currentBalance < minBalance,
        },
        compliance: {
          autoBlockExpiredDocs: Boolean(sysConfig?.autoBlockExpiredDocs),
          alerts: docAlerts,
        },
        fleetPartner: driver.fleetPartnerLink?.partner
          ? {
              ownerName: driver.fleetPartnerLink.partner.ownerName,
              ownerSharePercent: Number(driver.fleetPartnerLink.partner.ownerSharePercent),
            }
          : null,
        missions: missionsWithProgress,
      });
    } catch (error: any) {
      console.error('❌ [DRIVER_SCALE_STATUS]:', error?.message || error);
      return res.status(500).json({ success: false, error: 'Erro ao carregar metas e status operacional.' });
    }
  }
}
