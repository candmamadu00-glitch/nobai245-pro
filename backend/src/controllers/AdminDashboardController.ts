import crypto from 'crypto';
import { getIo } from '../server';
import { cancelRideLogic } from '../services/rideService';
import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';

export class AdminDashboardController {
  
  // 📊 MÉTRICAS DO DASHBOARD EXEC
  static async getMetrics(req: Request, res: Response): Promise<Response> {
    try {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);

      const [
        todayRides,
        completedRides,
        cancelledRides,
        revenueAgg,
        onlineDrivers,
        activePassengers,
        totalRides,
        totalRevenue
      ] = await Promise.all([
        prisma.ride.count({ where: { createdAt: { gte: startOfDay } } }),
        prisma.ride.count({ where: { status: 'COMPLETED', createdAt: { gte: startOfDay } } }),
        prisma.ride.count({ where: { status: 'CANCELLED', createdAt: { gte: startOfDay } } }),
        prisma.ride.aggregate({
          _sum: { priceXof: true },
          where: { status: 'COMPLETED', createdAt: { gte: startOfDay } }
        }),
        prisma.driver.count({ where: { isOnline: true, deletedAt: null } }),
        prisma.passenger.count({ where: { status: 'ACTIVE', deletedAt: null } }),
        prisma.ride.count(),
        prisma.ride.aggregate({
          _sum: { priceXof: true },
          where: { status: 'COMPLETED' }
        })
      ]);

      const hojeLucro = Number(revenueAgg._sum.priceXof || 0);
      const geralLucro = Number(totalRevenue._sum.priceXof || 0);

      const [
        activeRidesCount,
        pendingDriversCount,
        pendingChangeReqCount,
        openTicketsCount,
        activeSosCount
      ] = await Promise.all([
        prisma.ride.count({
          where: { status: { in: ['SEARCHING', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS'] } }
        }).catch(() => 0),
        prisma.driver.count({
          where: { status: 'PENDING_APPROVAL', deletedAt: null }
        }).catch(() => 0),
        prisma.driverChangeRequest.count({
          where: { status: 'PENDING' }
        }).catch(() => 0),
        prisma.ticket.count({
          where: { status: { notIn: ['CLOSED', 'RESOLVED'] as any } }
        }).catch(() => 0),
        prisma.sosAlert.count({
          where: { status: { notIn: ['RESOLVED', 'CLOSED', 'FALSE_ALARM'] as any } }
        }).catch(() => 0)
      ]);

      return res.status(200).json({
        lucroHoje: hojeLucro > 0 ? hojeLucro : geralLucro,
        corridasHoje: todayRides > 0 ? todayRides : totalRides,
        corridasCompletas: completedRides,
        corridasCanceladas: cancelledRides,
        corridasEmAndamento: activeRidesCount,
        motoristasOnline: onlineDrivers,
        passageirosAtivos: activePassengers,
        motoristasPendentes: pendingDriversCount + pendingChangeReqCount,
        ticketsAbertos: openTicketsCount,
        alertasSosAtivos: activeSosCount
      });
    } catch (error) {
      console.error("❌ [ADMIN METRICS ERROR]:", error);
      return res.status(500).json({ 
        error: "Falha ao carregar métricas do dashboard.",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // 🚗 LISTAGEM DE MOTORISTAS (FILTRANDO DELETED_AT)
  static async getDrivers(req: Request, res: Response): Promise<Response> {
    try {
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.max(1, Number(req.query.limit) || 20);
      const search = (req.query.search as string) || '';
      const skip = (page - 1) * limit;

      const whereClause: any = {
        deletedAt: null // 🛡️ Oculta contas excluídas/desativadas
      };

      if (search.trim()) {
        const searchTerm = search.trim();
        whereClause.OR = [
          { fullName: { contains: searchTerm, mode: 'insensitive' } },
          { phone: { contains: searchTerm, mode: 'insensitive' } },
          { vehiclePlate: { contains: searchTerm, mode: 'insensitive' } },
          { documentNumber: { contains: searchTerm, mode: 'insensitive' } }
        ];
      }

      const [drivers, totalRecords] = await Promise.all([
        prisma.driver.findMany({
          where: whereClause,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' }
        }),
        prisma.driver.count({ where: whereClause })
      ]);

      return res.status(200).json({
        data: drivers,
        meta: {
          total: totalRecords,
          page,
          limit,
          totalPages: Math.ceil(totalRecords / limit) || 1
        }
      });
    } catch (error) {
      console.error("❌ [ADMIN GET DRIVERS ERROR]:", error);
      return res.status(500).json({ error: "Falha ao buscar motoristas." });
    }
  }

  // 🗑️ EXCLUSÃO / DESATIVAÇÃO DE MOTORISTA PELO PAINEL ADMIN
  static async deleteDriver(req: Request, res: Response): Promise<Response> {
    try {
      const { id } = req.params;
      const driver = await prisma.driver.findUnique({
        where: { id: String(id) },
        include: { rides: { take: 1 }, transactions: { take: 1 } }
      });

      if (!driver) {
        return res.status(404).json({ success: false, error: 'Motorista não encontrado.' });
      }

      const hasHistory = driver.rides.length > 0 || driver.transactions.length > 0;

      if (!hasHistory) {
        // Sem histórico: Remoção física direta do banco
        await prisma.driver.delete({ where: { id: String(id) } });
      } else {
        // Com histórico: Anonimiza credenciais para LIBERAR telefone/placa/documento
        const stamp = Date.now().toString().slice(-8);
        await prisma.driver.update({
          where: { id: String(id) },
          data: {
            phone: `d_${stamp}`,
            vehiclePlate: `p_${stamp}`,
            documentNumber: `doc_${stamp}`,
            orangeNumber: null,
            mtnNumber: null,
            paymentAccountNumber: null,
            status: 'SUSPENDED',
            isOnline: false,
            isAvailable: false,
            deletedAt: new Date(),
            deviceToken: null,
            refreshTokenHash: null
          }
        });
      }

      return res.status(200).json({ success: true, message: 'Motorista excluído e dados liberados com sucesso.' });
    } catch (error) {
      console.error("❌ [ADMIN DELETE DRIVER ERROR]:", error);
      return res.status(500).json({ error: "Falha ao excluir motorista." });
    }
  }

  // 👤 LISTAGEM DE PASSAGEIROS (FILTRANDO DELETED_AT)
  static async getPassengers(req: Request, res: Response): Promise<Response> {
    try {
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.max(1, Number(req.query.limit) || 20);
      const search = (req.query.search as string) || '';
      const skip = (page - 1) * limit;

      const whereClause: any = {
        deletedAt: null // 🛡️ Oculta contas excluídas/desativadas
      };

      if (search.trim()) {
        const searchTerm = search.trim();
        whereClause.OR = [
          { fullName: { contains: searchTerm, mode: 'insensitive' } },
          { phone: { contains: searchTerm, mode: 'insensitive' } },
          { email: { contains: searchTerm, mode: 'insensitive' } }
        ];
      }

      const [passengers, totalRecords] = await Promise.all([
        prisma.passenger.findMany({
          where: whereClause,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' }
        }),
        prisma.passenger.count({ where: whereClause })
      ]);

      return res.status(200).json({
        data: passengers,
        meta: {
          total: totalRecords,
          page,
          limit,
          totalPages: Math.ceil(totalRecords / limit) || 1
        }
      });
    } catch (error) {
      console.error("❌ [ADMIN GET PASSENGERS ERROR]:", error);
      return res.status(500).json({ error: "Falha ao buscar passageiros." });
    }
  }

  // 🗑️ EXCLUSÃO / DESATIVAÇÃO DE PASSAGEIRO PELO PAINEL ADMIN
  static async deletePassenger(req: Request, res: Response): Promise<Response> {
    try {
      const { id } = req.params;
      const passenger = await prisma.passenger.findUnique({
        where: { id: String(id) },
        include: { rides: { take: 1 }, transactions: { take: 1 } }
      });

      if (!passenger) {
        return res.status(404).json({ success: false, error: 'Passageiro não encontrado.' });
      }

      const hasHistory = passenger.rides.length > 0 || passenger.transactions.length > 0;

      if (!hasHistory) {
        // Sem histórico: Exclusão direta do banco
        await prisma.passenger.delete({ where: { id: String(id) } });
      } else {
        // Com histórico: Anonimiza telefone e e-mail
        const stamp = Date.now().toString().slice(-8);
        const rand = Math.floor(100 + Math.random() * 900);
        await prisma.passenger.update({
          where: { id: String(id) },
          data: {
            fullName: 'Passageiro Anônimo',
            phone: `p_${stamp}_${rand}`,
            email: `del_${stamp}_${rand}@anon.com`,
            documentNumber: null,
            paymentAccountNumber: null,
            status: 'SUSPENDED',
            deletedAt: new Date(),
            deviceToken: null,
            refreshTokenHash: null
          }
        });
      }

      return res.status(200).json({ success: true, message: 'Passageiro excluído e telefone liberado com sucesso.' });
    } catch (error) {
      console.error("❌ [ADMIN DELETE PASSENGER ERROR]:", error);
      return res.status(500).json({ error: "Falha ao excluir passageiro." });
    }
  }

  // 🚗 HISTÓRICO DE CORRIDAS
  static async getRides(req: Request, res: Response): Promise<Response> {
    try {
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.max(1, Number(req.query.limit) || 20);
      const search = (req.query.search as string) || '';
      const status = (req.query.status as string) || 'ALL';
      const driverId = (req.query.driverId as string) || '';

      const whereClause: any = {};
      
      if (status && status !== 'ALL') {
        whereClause.status = status;
      }

      if (driverId.trim()) {
        whereClause.driverId = driverId.trim();
      }

      if (search.trim()) {
        const searchTerm = search.trim();
        whereClause.OR = [
          { passenger: { fullName: { contains: searchTerm, mode: 'insensitive' } } },
          { driver: { fullName: { contains: searchTerm, mode: 'insensitive' } } },
          { driver: { vehiclePlate: { contains: searchTerm, mode: 'insensitive' } } },
          { originAddress: { contains: searchTerm, mode: 'insensitive' } },
          { destinationAddress: { contains: searchTerm, mode: 'insensitive' } }
        ];
      }

      const skip = (page - 1) * limit;

      const [rides, totalRecords] = await Promise.all([
        prisma.ride.findMany({
          where: whereClause,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            passenger: { select: { id: true, fullName: true, phone: true } },
            driver: { select: { id: true, fullName: true, vehiclePlate: true, phone: true } },
            ratings: {
              where: { reviewerType: 'PASSENGER' },
              select: { stars: true }
            }
          }
        }),
        prisma.ride.count({ where: whereClause })
      ]);

      const [completedCount, cancelledCount, revenueAgg] = await Promise.all([
        prisma.ride.count({ where: { ...whereClause, status: 'COMPLETED' } }),
        prisma.ride.count({ where: { ...whereClause, status: 'CANCELLED' } }),
        prisma.ride.aggregate({
          _sum: { priceXof: true },
          where: { ...whereClause, status: 'COMPLETED' }
        })
      ]);

      const formattedRides = rides.map((ride) => {
        const passengerRating = (ride as any).ratings && (ride as any).ratings.length > 0 
          ? (ride as any).ratings[0].stars 
          : ((ride as any).rating ?? null);

        return {
          id: ride.id,
          passengerName: ride.passenger?.fullName || 'Passageiro N/A',
          driverName: ride.driver?.fullName || 'Não atribuído',
          vehiclePlate: ride.driver?.vehiclePlate || '',
          originAddress: ride.originAddress || 'Origem não informada',
          destinationAddress: ride.destinationAddress || 'Destino não informado',
          amount: Number(ride.priceXof || 0),
          price: Number(ride.priceXof || 0),
          priceXof: Number(ride.priceXof || 0),
          status: ride.status,
          createdAt: ride.createdAt,
          rating: passengerRating,
          otpCode: (ride as any).startOtp ?? (ride as any).otpCode ?? null,
          passenger: ride.passenger,
          driver: ride.driver
        };
      });

      return res.status(200).json({
        data: formattedRides,
        meta: { 
          total: totalRecords, 
          page, 
          limit, 
          totalPages: Math.ceil(totalRecords / limit) || 1 
        },
        kpis: { 
          total: totalRecords, 
          completed: completedCount, 
          cancelled: cancelledCount, 
          revenue: Number(revenueAgg._sum.priceXof || 0)
        }
      });
    } catch (error) {
      console.error("❌ [ADMIN RIDES ERROR]:", error);
      return res.status(500).json({ 
        error: "Falha ao buscar histórico de corridas.",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // 🟢 MOTORISTAS ONLINE PARA O RADAR
  static async getOnlineDrivers(req: Request, res: Response): Promise<Response> {
    try {
      const drivers = await prisma.driver.findMany({
        where: { isOnline: true, deletedAt: null },
        select: {
          id: true,
          fullName: true,
          phone: true,
          vehiclePlate: true,
          vehicleBrand: true,
          status: true,
          isAvailable: true,
          lastLat: true,
          lastLng: true,
          updatedAt: true
        }
      });

      const formattedDrivers = drivers.map((driver) => ({
        driverId: driver.id,
        fullName: driver.fullName || 'Motorista Sem Nome',
        phone: driver.phone || '',
        vehiclePlate: driver.vehiclePlate || '',
        vehicleBrand: driver.vehicleBrand || '',
        latitude: Number((driver as any).lastLat || (driver as any).currentLat || (driver as any).latitude || 11.8632),
        longitude: Number((driver as any).lastLng || (driver as any).currentLng || (driver as any).longitude || -15.5977),
        heading: (driver as any).heading ?? 0,
        status: driver.isAvailable ? 'AVAILABLE' : 'ON_RIDE',
        lastUpdate: driver.updatedAt
      }));

      return res.status(200).json(formattedDrivers);
    } catch (error) {
      console.error("❌ [GET ONLINE DRIVERS ERROR]:", error);
      return res.status(500).json({ 
        error: "Falha ao buscar motoristas online.",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // 🛰️ HISTÓRICO DE TELEMETRIA DA CORRIDA PARA REPLAY
  static async getRideTelemetry(req: Request, res: Response): Promise<Response> {
    try {
      const { rideId } = req.params;

      if (!rideId) {
        return res.status(400).json({ success: false, error: 'ID da corrida é obrigatório.' });
      }

      const ride = await prisma.ride.findUnique({
        where: { id: String(rideId) },
        include: {
          passenger: {
            select: { id: true, fullName: true, phone: true, profilePicture: true }
          },
          driver: {
            select: { id: true, fullName: true, phone: true, profilePicture: true, vehiclePlate: true, vehicleBrand: true, vehicleColor: true }
          },
          locationHistory: {
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              lat: true,
              lng: true,
              heading: true,
              speed: true,
              createdAt: true
            }
          }
        }
      });

      if (!ride) {
        return res.status(404).json({ success: false, error: 'Corrida não encontrada.' });
      }

      let telemetryPoints = ride.locationHistory;

      if (!telemetryPoints || telemetryPoints.length === 0) {
        telemetryPoints = [
          {
            id: 'origin-fallback',
            lat: ride.originLat,
            lng: ride.originLng,
            heading: 0,
            speed: 0,
            createdAt: ride.createdAt
          },
          {
            id: 'destination-fallback',
            lat: ride.destinationLat,
            lng: ride.destinationLng,
            heading: 0,
            speed: 0,
            createdAt: (ride as any).finishedAt || (ride as any).finishedAt || ride.updatedAt
          }
        ];
      }

      return res.status(200).json({
        success: true,
        ride,
        telemetry: telemetryPoints
      });
    } catch (error: any) {
      console.error('❌ [TELEMETRIA] Erro ao buscar histórico da corrida:', error?.message || error);
      return res.status(500).json({ success: false, error: 'Erro interno ao carregar telemetria da corrida.' });
    }
  }

  // 💬 AUDITORIA DE CONVERSAS E CHAT DA CORRIDA
  static async getRideChat(req: Request, res: Response): Promise<Response> {
    try {
      const { rideId } = req.params;

      const messages = await prisma.rideChatMessage.findMany({
        where: { rideId: String(rideId) },
        orderBy: { createdAt: 'asc' }
      });

      const formattedMessages = messages.map((msg) => ({
        id: msg.id,
        rideId: msg.rideId,
        sender: msg.senderType,
        senderType: msg.senderType,
        senderId: msg.senderId,
        message: msg.message,
        createdAt: msg.createdAt
      }));

      return res.status(200).json(formattedMessages);
    } catch (error) {
      console.error("❌ [ADMIN RIDE CHAT ERROR]:", error);
      return res.status(500).json({ 
        error: "Falha ao carregar chat de auditoria.",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // 🚨 DESTRAVAR CORRIDA PRESA (FORÇAR CANCELAMENTO PELO ADMIN)
  static async forceCancelRide(req: Request, res: Response): Promise<Response> {
    try {
      const { rideId } = req.params;
      const { reason } = req.body || {};

      const ride = await prisma.ride.findUnique({ where: { id: String(rideId) } });
      if (!ride) {
        return res.status(404).json({ success: false, error: 'Corrida não encontrada.' });
      }

      if (ride.status === 'COMPLETED' || ride.status === 'CANCELLED') {
        return res.status(400).json({ success: false, error: `Corrida já encerrada (${ride.status}).` });
      }

      const cleanReason = String(reason || 'Cancelado manualmente pela central de operações (Admin)').trim();
      const adminId = (req as any).user?.id || 'admin-operator';

      const result = await cancelRideLogic(
        String(rideId),
        String(adminId),
        'DRIVER',
        cleanReason,
        false
      );

      return res.status(200).json({
        success: true,
        message: 'Corrida destravada e cancelada com sucesso.',
        result
      });
    } catch (error: any) {
      console.error('❌ [FORCE CANCEL RIDE ERROR]:', error);
      return res.status(500).json({
        success: false,
        error: error?.message || 'Erro ao forçar cancelamento da corrida.'
      });
    }
  }


  // ✅ 1. FORÇAR CONCLUSÃO DE CORRIDA (QUANDO MOTORISTA PERDE SINAL NO DESTINO)
  static async forceFinishRide(req: Request, res: Response): Promise<Response> {
    try {
      const { rideId } = req.params;
      const { reason } = req.body || {};

      const ride = await prisma.ride.findUnique({
        where: { id: String(rideId) },
        include: { driver: true, passenger: true }
      });

      if (!ride) {
        return res.status(404).json({ success: false, error: 'Corrida não encontrada.' });
      }

      if (ride.status === 'COMPLETED' || ride.status === 'CANCELLED') {
        return res.status(400).json({ success: false, error: `Corrida já finalizada (${ride.status}).` });
      }

      if (!ride.driverId) {
        return res.status(400).json({
          success: false,
          error: 'Atribua um motorista antes de concluir a corrida ou utilize Forçar Cancelamento.'
        });
      }

      const gross = Math.round(Number(ride.priceXof || ride.estimatedPriceXof || 0));
      let platformFee = Number(ride.platformFee || 0);
      let driverEarnings = Number(ride.driverEarnings || 0);

      if (platformFee <= 0 && gross > 0) {
        const tariff = await prisma.tariffConfig.findFirst({
          where: {
            vehicleType: (ride.driverVehicleType || ride.requestedVehicleType) as any,
            serviceType: ride.serviceType as any
          }
        });
        const sysConfig = await prisma.systemConfig.findFirst();
        const commRate = Number(tariff?.commissionRate ?? sysConfig?.defaultCommissionRate ?? 15);
        platformFee = Math.round((gross * commRate) / 100);
        driverEarnings = Math.max(0, gross - platformFee);
      } else if (driverEarnings <= 0 && gross > 0) {
        driverEarnings = Math.max(0, gross - platformFee);
      }

      const adminId = (req as any).user?.id || 'admin-operator';
      const cleanReason = String(reason || 'Conclusão forçada pela central de operações (Admin)').trim();

      const txResult = await prisma.$transaction(async (tx) => {
        const updatedRide = await tx.ride.update({
          where: { id: ride.id },
          data: {
            status: 'COMPLETED',
            finishedAt: new Date(),
            priceXof: gross,
            platformFee,
            driverEarnings,
            version: { increment: 1 }
          }
        });

        await (tx as any).rideEventLog.create({
          data: {
            rideId: ride.id,
            status: 'COMPLETED',
            triggeredBy: 'DRIVER',
            userId: String(adminId),
            metadata: { forcedByAdmin: true, reason: cleanReason }
          }
        });

        await tx.passenger.update({
          where: { id: ride.passengerId },
          data: { currentRideId: null }
        });

        const nextQueued = await tx.ride.findFirst({
          where: {
            driverId: ride.driverId!,
            status: { in: ['ACCEPTED', 'QUEUED' as any] },
            id: { not: ride.id }
          }
        });

        let newDriverBalance = Number(ride.driver?.walletBalance || 0);

        if (ride.paymentMethod === 'CASH') {
          if (platformFee > 0) {
            const dUpd = await tx.driver.update({
              where: { id: ride.driverId! },
              data: {
                currentRideId: nextQueued ? nextQueued.id : null,
                isAvailable: !nextQueued,
                walletBalance: { decrement: platformFee }
              }
            });
            newDriverBalance = Number(dUpd.walletBalance || 0);

            await tx.transaction.create({
              data: {
                rideId: ride.id,
                driverId: ride.driverId!,
                type: 'COMMISSION_FEE',
                amount: platformFee,
                status: 'COMPLETED',
                paymentMethod: 'CASH',
                reference: `COMM-ADM-${ride.id.slice(0, 8)}-${Date.now()}`,
                description: `Comissão plataforma (Conclusão Admin #${ride.id.slice(0, 8)})`
              }
            });
          } else {
            await tx.driver.update({
              where: { id: ride.driverId! },
              data: {
                currentRideId: nextQueued ? nextQueued.id : null,
                isAvailable: !nextQueued
              }
            });
          }
        } else {
          await tx.transaction.updateMany({
            where: { rideId: ride.id, type: 'RIDE_PAYMENT', status: 'HELD_IN_ESCROW' },
            data: { status: 'COMPLETED' }
          });

          const dUpd = await tx.driver.update({
            where: { id: ride.driverId! },
            data: {
              currentRideId: nextQueued ? nextQueued.id : null,
              isAvailable: !nextQueued,
              walletBalance: { increment: driverEarnings }
            }
          });
          newDriverBalance = Number(dUpd.walletBalance || 0);

          if (driverEarnings > 0) {
            await tx.transaction.create({
              data: {
                rideId: ride.id,
                driverId: ride.driverId!,
                type: 'DRIVER_PAYOUT',
                amount: driverEarnings,
                status: 'COMPLETED',
                paymentMethod: ride.paymentMethod,
                reference: `EARN-ADM-${ride.id.slice(0, 8)}-${Date.now()}`,
                description: `Repasse líquido corrida concluída pelo Admin (#${ride.id.slice(0, 8)})`
              }
            });
          }

          if (platformFee > 0) {
            await tx.transaction.create({
              data: {
                rideId: ride.id,
                driverId: ride.driverId!,
                type: 'COMMISSION_FEE',
                amount: platformFee,
                status: 'COMPLETED',
                paymentMethod: ride.paymentMethod,
                reference: `COMM-ADM-${ride.id.slice(0, 8)}-${Date.now()}`,
                description: `Comissão plataforma (#${ride.id.slice(0, 8)})`
              }
            });
          }
        }

        return { updatedRide, newDriverBalance };
      });

      try {
        const io = getIo();
        if (io) {
          const payload = {
            rideId: ride.id,
            status: 'COMPLETED',
            priceXof: gross,
            driverEarnings,
            platformFee
          };
          io.to(ride.passengerId).to(`passenger_${ride.passengerId}`).emit('ride:completed', payload);
          io.to(ride.passengerId).to(`passenger_${ride.passengerId}`).emit('ride:finished', payload);
          io.to(ride.driverId).to(`driver_${ride.driverId}`).emit('ride:completed', payload);
          io.to(ride.driverId).to(`driver_${ride.driverId}`).emit('ride:finished', payload);
          io.to(ride.driverId).to(`driver_${ride.driverId}`).emit('wallet:updated', {
            driverId: ride.driverId,
            walletBalance: txResult.newDriverBalance
          });
        }
      } catch (sockErr) {
        console.warn('⚠️ [SOCKET FORCE FINISH]:', sockErr);
      }

      return res.status(200).json({
        success: true,
        message: `Corrida concluída com sucesso (${gross} XOF • Líquido motorista: ${driverEarnings} XOF).`,
        ride: txResult.updatedRide
      });
    } catch (error: any) {
      console.error('❌ [FORCE FINISH RIDE ERROR]:', error);
      return res.status(500).json({
        success: false,
        error: error?.message || 'Erro ao forçar conclusão da corrida.'
      });
    }
  }

  // 🔄 2. ATRIBUIR OU TROCAR MOTORISTA NA CORRIDA
  static async assignDriverToRide(req: Request, res: Response): Promise<Response> {
    try {
      const { rideId } = req.params;
      const { driverId } = req.body || {};

      if (!driverId) {
        return res.status(400).json({ success: false, error: 'Selecione um motorista válido.' });
      }

      const [ride, driver] = await Promise.all([
        prisma.ride.findUnique({ where: { id: String(rideId) }, include: { passenger: true } }),
        prisma.driver.findUnique({ where: { id: String(driverId) } })
      ]);

      if (!ride) {
        return res.status(404).json({ success: false, error: 'Corrida não encontrada.' });
      }
      if (ride.status === 'COMPLETED' || ride.status === 'CANCELLED') {
        return res.status(400).json({ success: false, error: 'Não é possível atribuir motorista a uma corrida encerrada.' });
      }
      if (!driver || driver.deletedAt) {
        return res.status(404).json({ success: false, error: 'Motorista não encontrado.' });
      }
      if (driver.status !== 'APPROVED') {
        return res.status(400).json({ success: false, error: 'Apenas motoristas aprovados podem receber corridas.' });
      }

      const previousDriverId = ride.driverId && ride.driverId !== driver.id ? ride.driverId : null;
      const adminId = (req as any).user?.id || 'admin-operator';

      const updatedRide = await prisma.$transaction(async (tx) => {
        if (previousDriverId) {
          await tx.driver.update({
            where: { id: previousDriverId },
            data: { currentRideId: null, isAvailable: true }
          });
        }

        const r = await tx.ride.update({
          where: { id: ride.id },
          data: {
            driverId: driver.id,
            status: ride.status === 'SEARCHING' ? 'ACCEPTED' : ride.status,
            acceptedAt: ride.acceptedAt || new Date(),
            driverVehiclePlate: driver.vehiclePlate,
            driverVehicleType: driver.vehicleType,
            version: { increment: 1 }
          },
          include: { driver: true, passenger: true }
        });

        await tx.driver.update({
          where: { id: driver.id },
          data: {
            currentRideId: ride.id,
            isAvailable: false,
            isOnline: true
          }
        });

        await tx.passenger.update({
          where: { id: ride.passengerId },
          data: { currentRideId: ride.id }
        });

        await (tx as any).rideEventLog.create({
          data: {
            rideId: ride.id,
            status: r.status,
            triggeredBy: 'DRIVER',
            userId: String(adminId),
            metadata: { assignedByAdmin: true, driverId: driver.id, previousDriverId }
          }
        });

        return r;
      });

      try {
        const io = getIo();
        if (io) {
          if (previousDriverId) {
            io.to(previousDriverId).to(`driver_${previousDriverId}`).emit('ride:cancelled', {
              rideId: ride.id,
              cancelledBy: 'ADMIN',
              reason: 'Corrida reatribuída pela central de operações.'
            });
          }
          io.to(ride.passengerId).to(`passenger_${ride.passengerId}`).emit('ride:accepted', {
            rideId: ride.id,
            ride: updatedRide,
            driver
          });
          io.to(driver.id).to(`driver_${driver.id}`).emit('ride:assigned', {
            rideId: ride.id,
            ride: updatedRide
          });
          io.to(driver.id).to(`driver_${driver.id}`).emit('ride:accepted', {
            rideId: ride.id,
            ride: updatedRide
          });
        }
      } catch (sockErr) {
        console.warn('⚠️ [SOCKET ASSIGN DRIVER]:', sockErr);
      }

      return res.status(200).json({
        success: true,
        message: `Motorista ${driver.fullName} (${driver.vehiclePlate}) atribuído à corrida!`,
        ride: updatedRide
      });
    } catch (error: any) {
      console.error('❌ [ASSIGN DRIVER ERROR]:', error);
      return res.status(500).json({
        success: false,
        error: error?.message || 'Erro ao atribuir motorista à corrida.'
      });
    }
  }

  // 📞 3. DESPACHO MANUAL DE CORRIDA PELA CENTRAL (CALL-CENTER)
  static async manualDispatchRide(req: Request, res: Response): Promise<Response> {
    try {
      const {
        passengerPhone,
        passengerName,
        originAddress,
        originLat,
        originLng,
        destinationAddress,
        destinationLat,
        destinationLng,
        vehicleType,
        driverId,
        priceXof
      } = req.body || {};

      const cleanPhone = String(passengerPhone || '').trim();
      const cleanOrigin = String(originAddress || '').trim();
      const cleanDest = String(destinationAddress || '').trim();

      if (!cleanPhone || !cleanOrigin || !cleanDest) {
        return res.status(400).json({
          success: false,
          error: 'Telefone do passageiro, origem e destino são obrigatórios.'
        });
      }

      let passenger = await prisma.passenger.findFirst({
        where: { phone: cleanPhone }
      });

      if (!passenger) {
        passenger = await prisma.passenger.create({
          data: {
            fullName: String(passengerName || `Cliente ${cleanPhone}`).trim(),
            phone: cleanPhone,
            passwordHash: crypto.randomBytes(24).toString('hex'),
            status: 'ACTIVE',
            isVerified: true
          }
        });
      }

      const vType = (vehicleType || 'TAXI') as any;
      const tariff = await prisma.tariffConfig.findFirst({
        where: { vehicleType: vType, serviceType: 'RIDE' }
      });
      const sysConfig = await prisma.systemConfig.findFirst();

      const oLat = Number(originLat) || 11.8636;
      const oLng = Number(originLng) || -15.5977;
      const dLat = Number(destinationLat) || 11.8810;
      const dLng = Number(destinationLng) || -15.6120;

      const gross = Math.max(
        500,
        Math.round(Number(priceXof) || Number(tariff?.minimumFare || 1000))
      );
      const commRate = Number(tariff?.commissionRate ?? sysConfig?.defaultCommissionRate ?? 15);
      const platformFee = Math.round((gross * commRate) / 100);
      const driverEarnings = Math.max(0, gross - platformFee);

      let assignedDriver: any = null;
      if (driverId) {
        assignedDriver = await prisma.driver.findUnique({ where: { id: String(driverId) } });
      }

      const adminId = (req as any).user?.id || 'admin-operator';

      const createdRide = await prisma.$transaction(async (tx) => {
        const ride = await tx.ride.create({
          data: {
            passengerId: passenger!.id,
            driverId: assignedDriver ? assignedDriver.id : null,
            serviceType: 'RIDE',
            requestedVehicleType: vType,
            paymentMethod: 'CASH',
            originAddress: cleanOrigin,
            originLat: oLat,
            originLng: oLng,
            destinationAddress: cleanDest,
            destinationLat: dLat,
            destinationLng: dLng,
            estimatedPriceXof: gross,
            priceXof: gross,
            platformFee,
            driverEarnings,
            driverVehiclePlate: assignedDriver?.vehiclePlate || null,
            driverVehicleType: assignedDriver?.vehicleType || vType,
            status: assignedDriver ? 'ACCEPTED' : 'SEARCHING',
            acceptedAt: assignedDriver ? new Date() : null
          },
          include: { passenger: true, driver: true }
        });

        await tx.passenger.update({
          where: { id: passenger!.id },
          data: { currentRideId: ride.id }
        });

        if (assignedDriver) {
          await tx.driver.update({
            where: { id: assignedDriver.id },
            data: {
              currentRideId: ride.id,
              isAvailable: false,
              isOnline: true
            }
          });
        }

        await (tx as any).rideEventLog.create({
          data: {
            rideId: ride.id,
            status: ride.status,
            triggeredBy: 'PASSENGER',
            userId: String(adminId),
            metadata: { createdByCallCenter: true }
          }
        });

        return ride;
      });

      try {
        const io = getIo();
        if (io && assignedDriver) {
          io.to(assignedDriver.id).to(`driver_${assignedDriver.id}`).emit('ride:assigned', {
            rideId: createdRide.id,
            ride: createdRide
          });
          io.to(assignedDriver.id).to(`driver_${assignedDriver.id}`).emit('ride:accepted', {
            rideId: createdRide.id,
            ride: createdRide
          });
        }
      } catch (sockErr) {
        console.warn('⚠️ [SOCKET MANUAL DISPATCH]:', sockErr);
      }

      return res.status(201).json({
        success: true,
        message: assignedDriver
          ? `Corrida criada e despachada para ${assignedDriver.fullName}!`
          : 'Corrida criada na fila de busca!',
        ride: createdRide
      });
    } catch (error: any) {
      console.error('❌ [MANUAL DISPATCH ERROR]:', error);
      return res.status(500).json({
        success: false,
        error: error?.message || 'Erro ao despachar corrida manualmente.'
      });
    }
  }

  // 🔓 4. DESTRAVAR APP DE MOTORISTA OU PASSAGEIRO
  static async unlockUserApp(req: Request, res: Response): Promise<Response> {
    try {
      const { userType, userId } = req.params;

      if (userType === 'driver') {
        const driver = await prisma.driver.update({
          where: { id: String(userId) },
          data: { currentRideId: null, isAvailable: true }
        });

        try {
          const io = getIo();
          if (io) {
            io.to(driver.id).to(`driver_${driver.id}`).emit('app:unlocked', { driverId: driver.id });
            io.to(driver.id).to(`driver_${driver.id}`).emit('ride:cancelled', {
              rideId: null,
              cancelledBy: 'ADMIN',
              reason: 'Sessão destravada pela central de suporte.'
            });
          }
        } catch {}

        return res.status(200).json({
          success: true,
          message: `Aplicativo do motorista ${driver.fullName} destravado com sucesso!`
        });
      }

      if (userType === 'passenger') {
        const passenger = await prisma.passenger.update({
          where: { id: String(userId) },
          data: { currentRideId: null }
        });

        try {
          const io = getIo();
          if (io) {
            io.to(passenger.id).to(`passenger_${passenger.id}`).emit('app:unlocked', { passengerId: passenger.id });
            io.to(passenger.id).to(`passenger_${passenger.id}`).emit('ride:cancelled', {
              rideId: null,
              cancelledBy: 'ADMIN',
              reason: 'Sessão destravada pela central de suporte.'
            });
          }
        } catch {}

        return res.status(200).json({
          success: true,
          message: `Aplicativo do passageiro ${passenger.fullName} destravado com sucesso!`
        });
      }

      return res.status(400).json({ success: false, error: 'Tipo de usuário inválido.' });
    } catch (error: any) {
      console.error('❌ [UNLOCK USER APP ERROR]:', error);
      return res.status(500).json({
        success: false,
        error: error?.message || 'Erro ao destravar aplicativo.'
      });
    }
  }

}
