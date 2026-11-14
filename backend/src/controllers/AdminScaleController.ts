import fs from 'fs';
import path from 'path';
import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { getIo } from '../server';

export class AdminScaleController {
  // ==========================================
  // 🏢 1. CONTAS CORPORATIVAS (B2B)
  // ==========================================
  static async listCorporates(req: Request, res: Response): Promise<Response> {
    try {
      const corporates = await (prisma as any).corporateAccount.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          employees: {
            orderBy: { createdAt: 'desc' }
          }
        }
      });
      return res.status(200).json({ success: true, data: corporates });
    } catch (error) {
      console.error('❌ [LIST CORPORATES ERROR]:', error);
      return res.status(500).json({ success: false, error: 'Erro ao listar contas corporativas.' });
    }
  }

  static async createCorporate(req: Request, res: Response): Promise<Response> {
    try {
      const { name, taxId, contactName, contactPhone, contactEmail, creditLimitXof, initialBalanceXof, costCenter } = req.body || {};
      if (!name || !contactPhone) {
        return res.status(400).json({ success: false, error: 'Nome da empresa e telefone de contato são obrigatórios.' });
      }

      const created = await (prisma as any).corporateAccount.create({
        data: {
          name: String(name).trim(),
          taxId: taxId ? String(taxId).trim() : null,
          contactName: contactName ? String(contactName).trim() : null,
          contactPhone: String(contactPhone).trim(),
          contactEmail: contactEmail ? String(contactEmail).trim() : null,
          creditLimitXof: Number(creditLimitXof) || 0,
          currentBalanceXof: Number(initialBalanceXof) || 0,
          costCenter: costCenter ? String(costCenter).trim() : null,
          isActive: true
        }
      });

      return res.status(201).json({ success: true, message: `Conta corporativa ${created.name} criada!`, data: created });
    } catch (error) {
      console.error('❌ [CREATE CORPORATE ERROR]:', error);
      return res.status(500).json({ success: false, error: 'Erro ao criar conta corporativa.' });
    }
  }

  static async adjustCorporateBalance(req: Request, res: Response): Promise<Response> {
    try {
      const { id } = req.params;
      const { amountXof } = req.body || {};
      const delta = Number(amountXof);
      if (!delta || isNaN(delta)) {
        return res.status(400).json({ success: false, error: 'Informe um valor válido em XOF.' });
      }

      const updated = await (prisma as any).corporateAccount.update({
        where: { id: String(id) },
        data: { currentBalanceXof: { increment: delta } }
      });

      return res.status(200).json({
        success: true,
        message: `Saldo corporativo atualizado para ${Number(updated.currentBalanceXof)} XOF.`,
        data: updated
      });
    } catch (error) {
      console.error('❌ [ADJUST CORPORATE BALANCE ERROR]:', error);
      return res.status(500).json({ success: false, error: 'Erro ao atualizar saldo corporativo.' });
    }
  }

  static async addCorporateEmployee(req: Request, res: Response): Promise<Response> {
    try {
      const { id } = req.params;
      const { fullName, phone, department, monthlyLimitXof } = req.body || {};
      if (!fullName || !phone) {
        return res.status(400).json({ success: false, error: 'Nome e telefone do colaborador são obrigatórios.' });
      }

      const created = await (prisma as any).corporateEmployee.create({
        data: {
          corporateId: String(id),
          fullName: String(fullName).trim(),
          phone: String(phone).trim(),
          department: department ? String(department).trim() : null,
          monthlyLimitXof: monthlyLimitXof ? Number(monthlyLimitXof) : null,
          isActive: true
        }
      });

      return res.status(201).json({ success: true, message: 'Colaborador autorizado adicionado!', data: created });
    } catch (error: any) {
      console.error('❌ [ADD CORPORATE EMPLOYEE ERROR]:', error);
      return res.status(500).json({ success: false, error: 'Erro ao adicionar colaborador (verifique se o telefone já está cadastrado nesta empresa).' });
    }
  }

  static async removeCorporateEmployee(req: Request, res: Response): Promise<Response> {
    try {
      const { empId } = req.params;
      await (prisma as any).corporateEmployee.delete({ where: { id: String(empId) } });
      return res.status(200).json({ success: true, message: 'Colaborador removido.' });
    } catch (error) {
      return res.status(500).json({ success: false, error: 'Erro ao remover colaborador.' });
    }
  }

  // ==========================================
  // 🚚 2. GESTÃO DE FROTISTAS (DONOS DE VÁRIOS CARROS)
  // ==========================================
  static async listFleetPartners(req: Request, res: Response): Promise<Response> {
    try {
      const partners = await (prisma as any).fleetPartner.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          vehicles: {
            include: {
              driver: {
                select: {
                  id: true,
                  fullName: true,
                  phone: true,
                  vehiclePlate: true,
                  vehicleType: true,
                  walletBalance: true,
                  isOnline: true,
                  rides: {
                    where: { status: 'COMPLETED' },
                    select: { priceXof: true, driverEarnings: true }
                  }
                }
              }
            }
          }
        }
      });

      const formatted = partners.map((p: any) => {
        let totalGrossXof = 0;
        let totalDriverNetXof = 0;
        let totalCompletedRides = 0;

        const vehicles = (p.vehicles || []).map((v: any) => {
          const dRides = v.driver?.rides || [];
          const dGross = dRides.reduce((s: number, r: any) => s + Number(r.priceXof || 0), 0);
          const dNet = dRides.reduce((s: number, r: any) => s + Number(r.driverEarnings || 0), 0);
          totalGrossXof += dGross;
          totalDriverNetXof += dNet;
          totalCompletedRides += dRides.length;

          return {
            linkId: v.id,
            assignedAt: v.assignedAt,
            driverId: v.driver?.id,
            fullName: v.driver?.fullName,
            phone: v.driver?.phone,
            vehiclePlate: v.driver?.vehiclePlate,
            vehicleType: v.driver?.vehicleType,
            walletBalance: Number(v.driver?.walletBalance || 0),
            isOnline: Boolean(v.driver?.isOnline),
            completedRides: dRides.length,
            grossRevenueXof: dGross,
            netEarningsXof: dNet
          };
        });

        const ownerSharePct = Number(p.ownerSharePercent || 50);
        const estimatedOwnerShareXof = Math.round((totalDriverNetXof * ownerSharePct) / 100);

        return {
          ...p,
          ownerSharePercent: ownerSharePct,
          vehicles,
          summary: {
            vehicleCount: vehicles.length,
            totalCompletedRides,
            totalGrossXof,
            totalDriverNetXof,
            estimatedOwnerShareXof
          }
        };
      });

      return res.status(200).json({ success: true, data: formatted });
    } catch (error) {
      console.error('❌ [LIST FLEET PARTNERS ERROR]:', error);
      return res.status(500).json({ success: false, error: 'Erro ao listar frotistas.' });
    }
  }

  static async createFleetPartner(req: Request, res: Response): Promise<Response> {
    try {
      const { ownerName, phone, email, documentNumber, orangeNumber, mtnNumber, ownerSharePercent } = req.body || {};
      if (!ownerName || !phone) {
        return res.status(400).json({ success: false, error: 'Nome do proprietário e telefone são obrigatórios.' });
      }

      const created = await (prisma as any).fleetPartner.create({
        data: {
          ownerName: String(ownerName).trim(),
          phone: String(phone).trim(),
          email: email ? String(email).trim() : null,
          documentNumber: documentNumber ? String(documentNumber).trim() : null,
          orangeNumber: orangeNumber ? String(orangeNumber).trim() : null,
          mtnNumber: mtnNumber ? String(mtnNumber).trim() : null,
          ownerSharePercent: ownerSharePercent !== undefined ? Number(ownerSharePercent) : 50,
          isActive: true
        }
      });

      return res.status(201).json({ success: true, message: `Frotista ${created.ownerName} cadastrado!`, data: created });
    } catch (error) {
      console.error('❌ [CREATE FLEET PARTNER ERROR]:', error);
      return res.status(500).json({ success: false, error: 'Erro ao cadastrar frotista (telefone já cadastrado?).' });
    }
  }

  static async assignDriverToPartner(req: Request, res: Response): Promise<Response> {
    try {
      const { id } = req.params;
      const { driverId } = req.body || {};
      if (!driverId) {
        return res.status(400).json({ success: false, error: 'Selecione um motorista.' });
      }

      await (prisma as any).fleetPartnerDriver.upsert({
        where: { driverId: String(driverId) },
        update: { partnerId: String(id), assignedAt: new Date() },
        create: { partnerId: String(id), driverId: String(driverId) }
      });

      return res.status(200).json({ success: true, message: 'Veículo/Motorista vinculado ao frotista!' });
    } catch (error) {
      console.error('❌ [ASSIGN DRIVER TO PARTNER ERROR]:', error);
      return res.status(500).json({ success: false, error: 'Erro ao vincular motorista ao frotista.' });
    }
  }

  static async unlinkDriverFromPartner(req: Request, res: Response): Promise<Response> {
    try {
      const { linkId } = req.params;
      await (prisma as any).fleetPartnerDriver.delete({ where: { id: String(linkId) } });
      return res.status(200).json({ success: true, message: 'Vínculo removido.' });
    } catch (error) {
      return res.status(500).json({ success: false, error: 'Erro ao desvincular motorista.' });
    }
  }

  // ==========================================
  // 🛡️ 3. ANTIFRAUDE & LISTA NEGRA MULTIFATOR
  // ==========================================
  static async scanAntiFraud(req: Request, res: Response): Promise<Response> {
    try {
      const since = new Date();
      since.setDate(since.getDate() - 14);

      const recentRides = await prisma.ride.findMany({
        where: { createdAt: { gte: since } },
        select: {
          id: true,
          status: true,
          passengerId: true,
          driverId: true,
          priceXof: true,
          discountAmount: true,
          promoCodeId: true,
          distanceKm: true,
          createdAt: true,
          passenger: { select: { fullName: true, phone: true } },
          driver: { select: { fullName: true, phone: true, vehiclePlate: true } }
        }
      });

      const alerts: any[] = [];

      // 1. Detector de Conluio (mesmo motorista + passageiro >= 3 vezes em 14 dias)
      const pairMap = new Map<string, any[]>();
      for (const r of recentRides) {
        if (!r.driverId || !r.passengerId) continue;
        const key = `${r.driverId}::${r.passengerId}`;
        if (!pairMap.has(key)) pairMap.set(key, []);
        pairMap.get(key)!.push(r);
      }

      for (const [, list] of pairMap.entries()) {
        if (list.length >= 3) {
          const sample = list[0];
          alerts.push({
            type: 'COLLUSION_PATTERN',
            severity: list.length >= 5 ? 'HIGH' : 'MEDIUM',
            title: `Corridas repetidas entre mesmo par (${list.length}x em 14 dias)`,
            details: `Motorista: ${sample.driver?.fullName} (${sample.driver?.vehiclePlate}) • Passageiro: ${sample.passenger?.fullName} (${sample.passenger?.phone})`,
            targetPhone: sample.passenger?.phone,
            targetPlate: sample.driver?.vehiclePlate
          });
        }
      }

      // 2. Abuso de Cupom em corridas ultracurtas (< 0.4 km)
      for (const r of recentRides) {
        if (r.promoCodeId && Number(r.distanceKm || 0) > 0 && Number(r.distanceKm) < 0.4 && r.status === 'COMPLETED') {
          alerts.push({
            type: 'PROMO_ABUSE',
            severity: 'HIGH',
            title: `Suspeita de queima de cupom em trajeto curto (${Number(r.distanceKm).toFixed(2)} km)`,
            details: `Passageiro: ${r.passenger?.fullName} (${r.passenger?.phone}) • Desconto: ${Number(r.discountAmount || 0)} XOF`,
            targetPhone: r.passenger?.phone,
            targetPlate: r.driver?.vehiclePlate
          });
        }
      }

      const blacklist = await (prisma as any).blacklistEntry.findMany({
        orderBy: { createdAt: 'desc' }
      });

      return res.status(200).json({
        success: true,
        alerts,
        blacklist
      });
    } catch (error) {
      console.error('❌ [ANTIFRAUD SCAN ERROR]:', error);
      return res.status(500).json({ success: false, error: 'Erro ao executar varredura antifraude.' });
    }
  }

  static async addBlacklistEntry(req: Request, res: Response): Promise<Response> {
    try {
      const { identifierType, identifierValue, reason } = req.body || {};
      const cleanVal = String(identifierValue || '').trim().toUpperCase();
      if (!identifierType || !cleanVal || !reason) {
        return res.status(400).json({ success: false, error: 'Tipo, valor do identificador e motivo são obrigatórios.' });
      }

      const adminName = (req as any).user?.email || 'SUPER_ADMIN';

      const entry = await (prisma as any).blacklistEntry.upsert({
        where: {
          identifierType_identifierValue: {
            identifierType: String(identifierType),
            identifierValue: cleanVal
          }
        },
        update: {
          reason: String(reason).trim(),
          blockedBy: adminName,
          isActive: true
        },
        create: {
          identifierType: String(identifierType),
          identifierValue: cleanVal,
          reason: String(reason).trim(),
          blockedBy: adminName,
          isActive: true
        }
      });

      return res.status(201).json({ success: true, message: 'Bloqueio multifator registado!', data: entry });
    } catch (error) {
      console.error('❌ [ADD BLACKLIST ERROR]:', error);
      return res.status(500).json({ success: false, error: 'Erro ao registar bloqueio na lista negra.' });
    }
  }

  static async removeBlacklistEntry(req: Request, res: Response): Promise<Response> {
    try {
      const { id } = req.params;
      await (prisma as any).blacklistEntry.delete({ where: { id: String(id) } });
      return res.status(200).json({ success: true, message: 'Registo removido da lista negra.' });
    } catch (error) {
      return res.status(500).json({ success: false, error: 'Erro ao remover bloqueio.' });
    }
  }

  // ==========================================
  // 🗺️ 4. ZONAS TARIFÁRIAS & ROTAS FIXAS
  // ==========================================
  static async listZones(req: Request, res: Response): Promise<Response> {
    try {
      const zones = await (prisma as any).tariffZone.findMany({ orderBy: { createdAt: 'desc' } });
      return res.status(200).json({ success: true, data: zones });
    } catch (error) {
      return res.status(500).json({ success: false, error: 'Erro ao listar zonas tarifárias.' });
    }
  }

  static async createZone(req: Request, res: Response): Promise<Response> {
    try {
      const { name, zoneType, centerLat, centerLng, radiusKm, fixedPriceXof, multiplier } = req.body || {};
      if (!name) {
        return res.status(400).json({ success: false, error: 'Nome da zona/rota é obrigatório.' });
      }

      const created = await (prisma as any).tariffZone.create({
        data: {
          name: String(name).trim(),
          zoneType: String(zoneType || 'FIXED_ROUTE'),
          centerLat: centerLat ? Number(centerLat) : null,
          centerLng: centerLng ? Number(centerLng) : null,
          radiusKm: Number(radiusKm) || 2.0,
          fixedPriceXof: fixedPriceXof ? Number(fixedPriceXof) : null,
          multiplier: Number(multiplier) || 1.0,
          isActive: true
        }
      });

      return res.status(201).json({ success: true, message: `Zona "${created.name}" criada!`, data: created });
    } catch (error) {
      return res.status(500).json({ success: false, error: 'Erro ao criar zona tarifária.' });
    }
  }

  static async toggleZone(req: Request, res: Response): Promise<Response> {
    try {
      const { id } = req.params;
      const z = await (prisma as any).tariffZone.findUnique({ where: { id: String(id) } });
      if (!z) return res.status(404).json({ success: false, error: 'Zona não encontrada.' });
      const updated = await (prisma as any).tariffZone.update({
        where: { id: String(id) },
        data: { isActive: !z.isActive }
      });
      return res.status(200).json({ success: true, data: updated });
    } catch (error) {
      return res.status(500).json({ success: false, error: 'Erro ao alterar zona.' });
    }
  }

  static async deleteZone(req: Request, res: Response): Promise<Response> {
    try {
      const { id } = req.params;
      await (prisma as any).tariffZone.delete({ where: { id: String(id) } });
      return res.status(200).json({ success: true, message: 'Zona removida.' });
    } catch (error) {
      return res.status(500).json({ success: false, error: 'Erro ao remover zona.' });
    }
  }

  // ==========================================
  // 🏆 5. MISSÕES & METAS DA FROTA
  // ==========================================
  static async listMissions(req: Request, res: Response): Promise<Response> {
    try {
      const missions = await (prisma as any).driverMission.findMany({ orderBy: { createdAt: 'desc' } });
      const enriched = [];

      for (const m of missions) {
        const grouped = await prisma.ride.groupBy({
          by: ['driverId'],
          where: {
            status: 'COMPLETED',
            driverId: { not: null },
            finishedAt: {
              gte: new Date(m.startsAt),
              lte: new Date(m.endsAt)
            }
          },
          _count: { id: true }
        });

        const qualifiedDrivers = grouped.filter((g) => g._count.id >= Number(m.targetRides));
        enriched.push({
          ...m,
          rewardXof: Number(m.rewardXof || 0),
          participatingDriversCount: grouped.length,
          qualifiedDriversCount: qualifiedDrivers.length
        });
      }

      return res.status(200).json({ success: true, data: enriched });
    } catch (error) {
      console.error('❌ [LIST MISSIONS ERROR]:', error);
      return res.status(500).json({ success: false, error: 'Erro ao carregar missões.' });
    }
  }

  static async createMission(req: Request, res: Response): Promise<Response> {
    try {
      const { title, description, targetRides, rewardXof, startsAt, endsAt } = req.body || {};
      if (!title || !endsAt) {
        return res.status(400).json({ success: false, error: 'Título e data final da missão são obrigatórios.' });
      }

      const created = await (prisma as any).driverMission.create({
        data: {
          title: String(title).trim(),
          description: description ? String(description).trim() : null,
          targetRides: Math.max(1, Number(targetRides) || 10),
          rewardXof: Math.max(100, Number(rewardXof) || 2000),
          startsAt: startsAt ? new Date(startsAt) : new Date(),
          endsAt: new Date(endsAt),
          isActive: true
        }
      });

      return res.status(201).json({ success: true, message: `Missão "${created.title}" ativada!`, data: created });
    } catch (error) {
      return res.status(500).json({ success: false, error: 'Erro ao criar missão.' });
    }
  }

  static async payoutQualifiedMission(req: Request, res: Response): Promise<Response> {
    try {
      const { id } = req.params;
      const mission = await (prisma as any).driverMission.findUnique({ where: { id: String(id) } });
      if (!mission) {
        return res.status(404).json({ success: false, error: 'Missão não encontrada.' });
      }

      const grouped = await prisma.ride.groupBy({
        by: ['driverId'],
        where: {
          status: 'COMPLETED',
          driverId: { not: null },
          finishedAt: {
            gte: new Date(mission.startsAt),
            lte: new Date(mission.endsAt)
          }
        },
        _count: { id: true }
      });

      const qualified = grouped.filter((g) => g.driverId && g._count.id >= Number(mission.targetRides));
      const reward = Number(mission.rewardXof || 0);
      let paidCount = 0;

      for (const q of qualified) {
        const dId = String(q.driverId);
        const refTag = `MISSION-${mission.id.slice(0, 8)}-${dId.slice(0, 8)}`;
        const alreadyPaid = await prisma.transaction.findFirst({ where: { reference: refTag } });
        if (alreadyPaid) continue;

        const updatedDriver = await prisma.$transaction(async (tx) => {
          const d = await tx.driver.update({
            where: { id: dId },
            data: { walletBalance: { increment: reward } }
          });
          await tx.transaction.create({
            data: {
              driverId: dId,
              type: 'PROMO_CREDIT',
              amount: reward,
              status: 'COMPLETED',
              paymentMethod: 'CASH',
              reference: refTag,
              description: `Bônus Missão: ${mission.title}`
            }
          });
          return d;
        });

        try {
          const io = getIo();
          if (io) {
            io.to(dId).to(`driver_${dId}`).emit('wallet:updated', {
              driverId: dId,
              walletBalance: Number(updatedDriver.walletBalance || 0)
            });
          }
        } catch {}

        paidCount += 1;
      }

      return res.status(200).json({
        success: true,
        message: paidCount > 0
          ? `Bônus de ${reward} XOF creditado para ${paidCount} motorista(s) qualificado(s)!`
          : 'Nenhum novo motorista pendente de recebimento para esta missão.'
      });
    } catch (error) {
      console.error('❌ [PAYOUT MISSION ERROR]:', error);
      return res.status(500).json({ success: false, error: 'Erro ao processar prêmios da missão.' });
    }
  }

  // ==========================================
  // 📊 6. DRE MENSAL & SNAPSHOT DE BACKUP
  // ==========================================
  static async getMonthlyDRE(req: Request, res: Response): Promise<Response> {
    try {
      const now = new Date();
      const months: any[] = [];

      for (let i = 5; i >= 0; i--) {
        const start = new Date(now.getFullYear(), now.getMonth() - i, 1, 0, 0, 0, 0);
        const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59, 999);

        const [ridesAgg, refundsAgg] = await Promise.all([
          prisma.ride.aggregate({
            _count: { id: true },
            _sum: { priceXof: true, platformFee: true, driverEarnings: true, discountAmount: true },
            where: { status: 'COMPLETED', finishedAt: { gte: start, lte: end } }
          }),
          prisma.transaction.aggregate({
            _sum: { amount: true },
            where: { type: 'REFUND', status: 'COMPLETED', createdAt: { gte: start, lte: end } }
          })
        ]);

        const gross = Number(ridesAgg._sum.priceXof || 0);
        const commissions = Number(ridesAgg._sum.platformFee || 0);
        const discounts = Number(ridesAgg._sum.discountAmount || 0);
        const refunds = Number(refundsAgg._sum.amount || 0);
        const netPlatformProfit = commissions - discounts - refunds;

        months.push({
          monthLabel: start.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }),
          completedRides: ridesAgg._count.id || 0,
          grossVolumeXof: gross,
          commissionsXof: commissions,
          promoSubsidiesXof: discounts,
          refundsXof: refunds,
          netPlatformResultXof: netPlatformProfit
        });
      }

      return res.status(200).json({ success: true, months });
    } catch (error) {
      console.error('❌ [DRE ERROR]:', error);
      return res.status(500).json({ success: false, error: 'Erro ao gerar DRE mensal.' });
    }
  }

  static async triggerSystemSnapshot(req: Request, res: Response): Promise<Response> {
    try {
      const backupDir = path.resolve(process.cwd(), 'uploads', 'db_snapshots');
      fs.mkdirSync(backupDir, { recursive: true });

      const [driversCount, passengersCount, ridesCount, txCount, configs, tariffs, promos] = await Promise.all([
        prisma.driver.count(),
        prisma.passenger.count(),
        prisma.ride.count(),
        prisma.transaction.count(),
        prisma.systemConfig.findMany(),
        prisma.tariffConfig.findMany(),
        prisma.promoCode.findMany()
      ]);

      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const fileName = `nobai245_snapshot_${stamp}.json`;
      const fullPath = path.join(backupDir, fileName);

      fs.writeFileSync(
        fullPath,
        JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            counts: { driversCount, passengersCount, ridesCount, txCount },
            configs,
            tariffs,
            promos
          },
          null,
          2
        ),
        'utf-8'
      );

      return res.status(200).json({
        success: true,
        message: `Snapshot de segurança gerado (${fileName}) • ${ridesCount} corridas e ${txCount} transações verificadas.`
      });
    } catch (error) {
      console.error('❌ [SNAPSHOT ERROR]:', error);
      return res.status(500).json({ success: false, error: 'Erro ao gerar snapshot de segurança.' });
    }
  }
}
