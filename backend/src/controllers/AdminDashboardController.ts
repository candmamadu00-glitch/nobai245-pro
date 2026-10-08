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

      return res.status(200).json({
        lucroHoje: hojeLucro > 0 ? hojeLucro : geralLucro,
        corridasHoje: todayRides > 0 ? todayRides : totalRides,
        corridasCompletas: completedRides,
        corridasCanceladas: cancelledRides,
        motoristasOnline: onlineDrivers,
        passageirosAtivos: activePassengers
      });
    } catch (error) {
      console.error("❌ [ADMIN METRICS ERROR]:", error);
      return res.status(500).json({ 
        error: "Falha ao carregar métricas do dashboard.",
        details: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // 🚗 HISTÓRICO DE CORRIDAS (GESTÃO DE CORRIDAS E HISTÓRICO DO MOTORISTA)
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
            createdAt: (ride as any).finishedAt || (ride as any).completedAt || ride.updatedAt
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
}