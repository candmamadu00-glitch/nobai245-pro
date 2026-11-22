import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/prisma';
import { getIo } from '../server';
import {
  getRouteDistanceAndDuration,
  calculateRidePrice,
  calculateDistance,
  createRideAndInitiateEscrow,
  cancelRideLogic
} from '../services/rideService';
import { sendPushNotification, PUSH_CHANNELS } from '../services/pushNotifications';

const JWT_SECRET = process.env.JWT_SECRET as string;

export interface B2BAuthRequest extends Request {
  corporate?: {
    id: string;
    name: string;
    accountType: string;
  };
}

export const BISSAU_B2B_PRESETS = [
  {
    id: 'oxb-airport',
    name: 'Aeroporto Internacional Osvaldo Vieira (OXB)',
    category: 'AIRPORT',
    address: 'Aeroporto Internacional Osvaldo Vieira (OXB), Bissalanca, Bissau',
    lat: 11.8948,
    lng: -15.6536
  },
  {
    id: 'hotel-ledger',
    name: 'Hotel Ledger Bissau',
    category: 'HOTEL',
    address: 'Av. Pansau Na Isna, Bissau',
    lat: 11.8639,
    lng: -15.5977
  },
  {
    id: 'hotel-azalai',
    name: 'Azalaï Hotel 24 de Setembro',
    category: 'HOTEL',
    address: 'Av. 24 de Setembro, Bissau',
    lat: 11.8615,
    lng: -15.5902
  },
  {
    id: 'hotel-ceiba',
    name: 'Ceiba Hotel Bissau',
    category: 'HOTEL',
    address: 'Av. Amílcar Cabral, Bissau',
    lat: 11.8602,
    lng: -15.5844
  },
  {
    id: 'porto-bissau',
    name: 'Porto de Bissau / Zona Empresarial',
    category: 'BUSINESS',
    address: 'Av. 3 de Agosto, Porto de Bissau',
    lat: 11.8576,
    lng: -15.5789
  },
  {
    id: 'bairro-ajuda',
    name: 'Bairro da Ajuda / Zona Residencial',
    category: 'DELIVERY',
    address: 'Bairro da Ajuda, Bissau',
    lat: 11.8725,
    lng: -15.6180
  },
  {
    id: 'enterramento-alto-bandim',
    name: 'Alto Bandim / Zona Comercial',
    category: 'DELIVERY',
    address: 'Alto Bandim, Bissau',
    lat: 11.8588,
    lng: -15.6055
  },
  {
    id: 'palacio-governo',
    name: 'Palácio do Governo / Ministérios',
    category: 'DIPLOMATIC',
    address: 'Praça dos Heróis Nacionais, Bissau',
    lat: 11.8632,
    lng: -15.5848
  }
];

export const authenticateB2B = async (req: B2BAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ success: false, error: 'Token corporativo ausente.' });
      return;
    }

    const token = authHeader.slice(7);
    const decoded = jwt.verify(token, JWT_SECRET) as { corporateId?: string; role?: string } | null;

    if (!decoded || decoded.role !== 'B2B_PARTNER' || !decoded.corporateId) {
      res.status(403).json({ success: false, error: 'Acesso não autorizado ao Portal B2B.' });
      return;
    }

    const corp = await (prisma as any).corporateAccount.findUnique({
      where: { id: decoded.corporateId },
      select: { id: true, name: true, accountType: true, isActive: true }
    });

    if (!corp || !corp.isActive) {
      res.status(403).json({ success: false, error: 'Conta corporativa inativa ou suspensa.' });
      return;
    }

    req.corporate = {
      id: corp.id,
      name: corp.name,
      accountType: corp.accountType || 'CORPORATE'
    };
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Sessão expirada. Faça login novamente.' });
  }
};

export class B2BPortalController {
  static async login(req: Request, res: Response): Promise<Response> {
    try {
      const { identifier, accessCode } = req.body || {};
      const cleanId = String(identifier || '').trim();
      const cleanCode = String(accessCode || '').trim();

      if (!cleanId || !cleanCode) {
        return res.status(400).json({ success: false, error: 'Informe o telefone/e-mail da empresa e o código PIN de acesso.' });
      }

      const digits = cleanId.replace(/\D/g, '');
      const last9 = digits.length >= 7 ? digits.slice(-9) : '';

      const corporate = await (prisma as any).corporateAccount.findFirst({
        where: {
          isActive: true,
          OR: [
            { contactEmail: { equals: cleanId, mode: 'insensitive' } },
            { contactPhone: { equals: cleanId } },
            ...(last9 ? [{ contactPhone: { contains: last9 } }] : []),
            { taxId: { equals: cleanId, mode: 'insensitive' } }
          ]
        }
      });

      if (!corporate || !corporate.accessCodeHash) {
        return res.status(401).json({
          success: false,
          error: 'Credenciais inválidas ou acesso ao Portal B2B ainda não habilitado pelo administrador.'
        });
      }

      const valid = await bcrypt.compare(cleanCode, corporate.accessCodeHash);
      if (!valid) {
        return res.status(401).json({ success: false, error: 'Código PIN / Senha corporativa incorreta.' });
      }

      const token = jwt.sign(
        {
          corporateId: corporate.id,
          role: 'B2B_PARTNER',
          name: corporate.name,
          accountType: corporate.accountType || 'CORPORATE'
        },
        JWT_SECRET,
        { expiresIn: '24h' }
      );

      return res.status(200).json({
        success: true,
        token,
        corporate: {
          id: corporate.id,
          name: corporate.name,
          accountType: corporate.accountType || 'CORPORATE',
          contactName: corporate.contactName,
          contactPhone: corporate.contactPhone,
          contactEmail: corporate.contactEmail,
          costCenter: corporate.costCenter,
          creditLimitXof: Number(corporate.creditLimitXof || 0),
          currentBalanceXof: Number(corporate.currentBalanceXof || 0),
          availableCreditXof: Math.max(0, Number(corporate.creditLimitXof || 0) - Number(corporate.currentBalanceXof || 0)),
          defaultPickupAddress: corporate.defaultPickupAddress || null,
          defaultPickupLat: corporate.defaultPickupLat ? Number(corporate.defaultPickupLat) : null,
          defaultPickupLng: corporate.defaultPickupLng ? Number(corporate.defaultPickupLng) : null
        }
      });
    } catch (error) {
      console.error('❌ [B2B_LOGIN_ERROR]:', error);
      return res.status(500).json({ success: false, error: 'Erro interno ao autenticar parceiro B2B.' });
    }
  }

  static async getMe(req: B2BAuthRequest, res: Response): Promise<Response> {
    try {
      const corpId = req.corporate!.id;
      const corporate = await (prisma as any).corporateAccount.findUnique({
        where: { id: corpId },
        include: {
          employees: { orderBy: { createdAt: 'desc' } }
        }
      });

      if (!corporate) {
        return res.status(404).json({ success: false, error: 'Conta corporativa não encontrada.' });
      }

      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const [activeCount, monthRides] = await Promise.all([
        (prisma as any).corporateRide.count({
          where: { corporateId: corpId, status: 'ACTIVE' }
        }),
        (prisma as any).corporateRide.findMany({
          where: { corporateId: corpId, createdAt: { gte: startOfMonth }, status: { not: 'CANCELLED' } },
          select: { fareXof: true }
        })
      ]);

      const monthSpendXof = monthRides.reduce((acc: number, r: any) => acc + Number(r.fareXof || 0), 0);

      let syncedPresets = [...BISSAU_B2B_PRESETS];
      try {
        const [adminPlaces, adminNeighborhoods] = await Promise.all([
          (prisma as any).customPlace.findMany({
            where: { isActive: true },
            include: { neighborhood: { select: { name: true, city: true } } },
            orderBy: { name: 'asc' }
          }),
          (prisma as any).neighborhood.findMany({
            where: { isActive: true, centerLat: { not: null }, centerLng: { not: null } },
            orderBy: { name: 'asc' }
          })
        ]);

        const mappedPlaces = (adminPlaces || []).map((p: any) => {
          const nbName = p.neighborhood?.name || 'Bissau';
          const city = p.neighborhood?.city || 'Bissau';
          const alias = p.popularName ? ` (${p.popularName})` : '';
          const ref = p.referenceNotes ? ` - ${p.referenceNotes}` : '';
          return {
            id: `place-${p.id}`,
            name: `${p.name}${alias} — ${nbName}`,
            category: 'ADMIN_PLACE',
            address: `${p.name}, ${nbName}, ${city}${ref}`,
            lat: Number(p.latitude),
            lng: Number(p.longitude)
          };
        });

        const mappedNeighborhoods = (adminNeighborhoods || []).map((n: any) => ({
          id: `nb-${n.id}`,
          name: `Bairro ${n.name} (${n.city || 'Bissau'})`,
          category: 'ADMIN_NEIGHBORHOOD',
          address: `Bairro ${n.name}, ${n.city || 'Bissau'}`,
          lat: Number(n.centerLat),
          lng: Number(n.centerLng)
        }));

        syncedPresets = [...BISSAU_B2B_PRESETS, ...mappedPlaces, ...mappedNeighborhoods];
      } catch (syncErr) {
        console.warn('⚠️ [B2B_PRESETS_SYNC_FALLBACK]:', syncErr);
      }

      return res.status(200).json({
        success: true,
        corporate: {
          id: corporate.id,
          name: corporate.name,
          accountType: corporate.accountType || 'CORPORATE',
          taxId: corporate.taxId,
          contactName: corporate.contactName,
          contactPhone: corporate.contactPhone,
          contactEmail: corporate.contactEmail,
          costCenter: corporate.costCenter,
          creditLimitXof: Number(corporate.creditLimitXof || 0),
          currentBalanceXof: Number(corporate.currentBalanceXof || 0),
          availableCreditXof: Math.max(0, Number(corporate.creditLimitXof || 0) - Number(corporate.currentBalanceXof || 0)),
          defaultPickupAddress: corporate.defaultPickupAddress || null,
          defaultPickupLat: corporate.defaultPickupLat ? Number(corporate.defaultPickupLat) : null,
          defaultPickupLng: corporate.defaultPickupLng ? Number(corporate.defaultPickupLng) : null
        },
        employees: Array.isArray(corporate.employees) ? corporate.employees : [],
        stats: {
          activeCount,
          monthRidesCount: monthRides.length,
          monthSpendXof: Math.round(monthSpendXof)
        },
        presets: syncedPresets
      });
    } catch (error) {
      console.error('❌ [B2B_ME_ERROR]:', error);
      return res.status(500).json({ success: false, error: 'Erro ao carregar dados corporativos.' });
    }
  }

  static async addEmployee(req: B2BAuthRequest, res: Response): Promise<Response> {
    try {
      const corpId = req.corporate!.id;
      const { fullName, phone, department, monthlyLimitXof } = req.body || {};
      if (!fullName || !phone) {
        return res.status(400).json({ success: false, error: 'Nome e telefone do colaborador são obrigatórios.' });
      }

      const created = await (prisma as any).corporateEmployee.create({
        data: {
          corporateId: corpId,
          fullName: String(fullName).trim(),
          phone: String(phone).trim(),
          department: department ? String(department).trim() : null,
          monthlyLimitXof: monthlyLimitXof ? Number(monthlyLimitXof) : null,
          isActive: true
        }
      });

      return res.status(201).json({
        success: true,
        message: `Colaborador ${created.fullName} autorizado a pedir viagens no app!`,
        data: created
      });
    } catch (error) {
      console.error('❌ [B2B_ADD_EMPLOYEE_ERROR]:', error);
      return res.status(400).json({ success: false, error: 'Não foi possível adicionar colaborador (telefone já vinculado).' });
    }
  }

  static async removeEmployee(req: B2BAuthRequest, res: Response): Promise<Response> {
    try {
      const corpId = req.corporate!.id;
      const { empId } = req.params;
      const emp = await (prisma as any).corporateEmployee.findFirst({
        where: { id: String(empId), corporateId: corpId }
      });
      if (!emp) {
        return res.status(404).json({ success: false, error: 'Colaborador não encontrado.' });
      }
      await (prisma as any).corporateEmployee.delete({ where: { id: emp.id } });
      return res.status(200).json({ success: true, message: 'Colaborador removido com sucesso.' });
    } catch {
      return res.status(500).json({ success: false, error: 'Erro ao remover colaborador.' });
    }
  }

  static async estimate(req: B2BAuthRequest, res: Response): Promise<Response> {
    try {
      const {
        originLat,
        originLng,
        destinationLat,
        destinationLng,
        serviceType = 'RIDE'
      } = req.body || {};

      const oLat = Number(originLat);
      const oLng = Number(originLng);
      const rawSvc = String(serviceType).toUpperCase();
      const isRental = rawSvc === 'RENTAL';
      const isDelivery = rawSvc === 'DELIVERY';
      const resolvedSvc = isRental ? 'RENTAL' : isDelivery ? 'DELIVERY' : 'RIDE';

      const dLat = isRental ? oLat : Number(destinationLat);
      const dLng = isRental ? oLng : Number(destinationLng);

      if (isNaN(oLat) || isNaN(oLng) || isNaN(dLat) || isNaN(dLng)) {
        return res.status(400).json({ success: false, error: 'Coordenadas de origem ou destino inválidas.' });
      }

      const routeInfo = isRental
        ? { distanceKm: 15, durationMin: 60 }
        : await getRouteDistanceAndDuration(oLat, oLng, dLat, dLng);

      let tariffs = await prisma.tariffConfig.findMany({
        where: {
          isActive: true,
          serviceType: resolvedSvc as any
        }
      });

      if (tariffs.length === 0) {
        tariffs = await prisma.tariffConfig.findMany({
          where: { isActive: true, serviceType: 'RIDE' as any }
        });
      }

      const estimates = await Promise.all(
        tariffs.map(async (t) => {
          const calc: any = await calculateRidePrice(
            routeInfo.distanceKm,
            routeInfo.durationMin,
            t.vehicleType as any,
            resolvedSvc as any,
            { originLat: oLat, originLng: oLng, destinationLat: dLat, destinationLng: dLng }
          );
          return {
            vehicleType: t.vehicleType,
            priceXOF: Math.max(0, Math.round(Number(calc?.totalPrice ?? calc))),
            appliedRuleLabel: calc?.appliedRuleLabel || null
          };
        })
      );

      return res.status(200).json({
        success: true,
        distanceKm: Number(routeInfo.distanceKm.toFixed(2)),
        durationMin: Math.ceil(routeInfo.durationMin),
        estimates
      });
    } catch (error) {
      console.error('❌ [B2B_ESTIMATE_ERROR]:', error);
      return res.status(500).json({ success: false, error: 'Erro ao calcular estimativa corporativa.' });
    }
  }

  static async dispatchRide(req: B2BAuthRequest, res: Response): Promise<Response> {
    try {
      const corpId = req.corporate!.id;
      const {
        guestName,
        guestPhone,
        roomNumber,
        flightNumber,
        tripCategory = 'CITY_RIDE',
        requestedBy,
        notes,
        originAddress,
        originLat,
        originLng,
        destinationAddress,
        destinationLat,
        destinationLng,
        vehicleType = 'PARTICULAR',
        serviceType = 'RIDE'
      } = req.body || {};

      const cleanGuestName = String(guestName || '').trim();
      if (!cleanGuestName) {
        return res.status(400).json({ success: false, error: 'Informe o nome do hóspede, colaborador ou destinatário.' });
      }

      const oLat = Number(originLat);
      const oLng = Number(originLng);
      const rawSvc = String(serviceType).toUpperCase();
      const isRental = rawSvc === 'RENTAL' || tripCategory === 'HOURLY_CHARTER';
      const isDelivery = rawSvc === 'DELIVERY' || tripCategory === 'EXPRESS_DELIVERY';

      const dLat = isRental ? oLat : Number(destinationLat);
      const dLng = isRental ? oLng : Number(destinationLng);

      if (isNaN(oLat) || isNaN(oLng) || isNaN(dLat) || isNaN(dLng)) {
        return res.status(400).json({ success: false, error: 'Selecione um local de embarque/coleta e destino válidos.' });
      }

      const corporate = await (prisma as any).corporateAccount.findUnique({
        where: { id: corpId }
      });

      if (!corporate || !corporate.isActive) {
        return res.status(403).json({ success: false, error: 'Conta corporativa inativa.' });
      }

      const techPhone = `B2B-${corporate.id.replace(/-/g, '').slice(0, 14)}`;
      let shadowPassenger = await prisma.passenger.findFirst({
        where: { phone: techPhone }
      });

      if (!shadowPassenger) {
        const lockedHash = await bcrypt.hash(`B2B_LOCKED_${corporate.id}_${Date.now()}`, 8);
        shadowPassenger = await prisma.passenger.create({
          data: {
            fullName: `${corporate.name} (Portal B2B)`,
            phone: techPhone,
            passwordHash: lockedHash,
            status: 'ACTIVE'
          }
        });
      } else if (shadowPassenger.currentRideId) {
        await prisma.passenger.update({
          where: { id: shadowPassenger.id },
          data: { currentRideId: null }
        });
      }

      const finalVehicleType = String(vehicleType || (isDelivery ? 'MOTO' : 'PARTICULAR')).toUpperCase();
      const finalServiceType = isRental ? 'RENTAL' : isDelivery ? 'DELIVERY' : 'RIDE';

      const flightTag = flightNumber ? ` | Voo: ${String(flightNumber).trim().toUpperCase()}` : '';
      const roomTag = roomNumber ? ` | Ref/Quarto: ${String(roomNumber).trim()}` : '';
      const phoneTag = guestPhone ? ` | Tel: ${String(guestPhone).trim()}` : '';
      const labelRole = isDelivery ? 'Destinatário' : 'Passageiro';
      const refSummary = `[B2B: ${corporate.name}] ${labelRole}: ${cleanGuestName}${phoneTag}${roomTag}${flightTag}${notes ? ` (${String(notes).trim()})` : ''}`.slice(0, 240);

      const result = await createRideAndInitiateEscrow(shadowPassenger.id, {
        originLat: oLat,
        originLng: oLng,
        destinationLat: dLat,
        destinationLng: dLng,
        requestedVehicleType: finalVehicleType,
        serviceType: finalServiceType,
        paymentMethod: 'CASH',
        originAddress: String(originAddress || corporate.defaultPickupAddress || 'Bissau').trim().slice(0, 200),
        destinationAddress: String(destinationAddress || (isRental ? 'Carro à Disposição (Hora/Diária)' : 'Destino Bissau')).trim().slice(0, 200),
        referencePoint: refSummary
      });

      const fareXof = Math.max(0, Math.round(Number(result.ride.priceXof || 0)));

      const creditLimit = Number(corporate.creditLimitXof || 0);
      const currentBalance = Number(corporate.currentBalanceXof || 0);
      const availableCredit = Math.max(0, creditLimit - currentBalance);

      if (availableCredit < fareXof) {
        await cancelRideLogic(result.ride.id, shadowPassenger.id, 'PASSENGER', 'Limite de crédito corporativo insuficiente').catch(() => null);
        return res.status(402).json({
          success: false,
          error: `Crédito corporativo insuficiente (${availableCredit} XOF disponíveis para corrida de ${fareXof} XOF). Solicite reforço de limite ao financeiro.`
        });
      }

      await prisma.$transaction([
        (prisma as any).corporateAccount.update({
          where: { id: corporate.id },
          data: { currentBalanceXof: { increment: fareXof } }
        }),
        (prisma as any).corporateRide.create({
          data: {
            corporateId: corporate.id,
            rideId: result.ride.id,
            guestName: cleanGuestName.slice(0, 120),
            guestPhone: guestPhone ? String(guestPhone).trim().slice(0, 30) : null,
            roomNumber: roomNumber ? String(roomNumber).trim().slice(0, 40) : null,
            flightNumber: flightNumber ? String(flightNumber).trim().toUpperCase().slice(0, 40) : null,
            tripCategory: String(tripCategory || 'CITY_RIDE').slice(0, 40),
            requestedBy: requestedBy ? String(requestedBy).trim().slice(0, 100) : null,
            notes: notes ? String(notes).trim().slice(0, 255) : null,
            fareXof,
            status: 'ACTIVE'
          }
        })
      ]);

      if (result.ride && result.ride.status === 'SEARCHING') {
        const latDelta = 0.055;
        const lngDelta = 0.055;

        const availableDrivers = await prisma.driver.findMany({
          where: {
            isOnline: true,
            isAvailable: true,
            vehicleType: finalVehicleType as any,
            status: 'APPROVED',
            lastLat: { gte: oLat - latDelta, lte: oLat + latDelta },
            lastLng: { gte: oLng - lngDelta, lte: oLng + lngDelta }
          },
          select: { id: true, lastLat: true, lastLng: true, deviceToken: true }
        });

        const nearbyDrivers = availableDrivers.filter((d) => {
          if (d.lastLat === null || d.lastLng === null) return false;
          return calculateDistance(oLat, oLng, Number(d.lastLat), Number(d.lastLng)) <= 6.0;
        });

        const displayPassengerName = isDelivery
          ? `📦 Delivery ${corporate.name} → ${cleanGuestName}`
          : `${corporate.name} • ${cleanGuestName}`;

        const payload = {
          rideId: result.ride.id,
          passengerId: result.ride.passengerId,
          passengerName: displayPassengerName,
          passengerRating: 5.0,
          passengerPhoto: null,
          pickupLat: Number(result.ride.originLat),
          pickupLng: Number(result.ride.originLng),
          originAddress: result.ride.originAddress,
          destinationLat: Number(result.ride.destinationLat),
          destinationLng: Number(result.ride.destinationLng),
          destinationAddress: result.ride.destinationAddress,
          stops: [],
          extraStopAddress: null,
          fareXOF: fareXof,
          priceXof: fareXof,
          estimatedPrice: fareXof,
          distanceKm: Number(Number(result.ride.distanceKm || 0).toFixed(2)),
          durationMin: Number(result.ride.durationMin || 0),
          vehicleType: result.ride.requestedVehicleType,
          serviceType: result.ride.serviceType,
          paymentMethod: 'CORPORATE_B2B',
          isCorporateB2B: true,
          corporateName: corporate.name,
          guestName: cleanGuestName,
          flightNumber: flightNumber || null
        };

        try {
          const io = getIo();
          if (io) {
            nearbyDrivers.forEach((driver) => {
              io.to(driver.id).to(`driver_${driver.id}`).emit('ride:new_request', payload);
            });
          }

          const pushTitle = isDelivery
            ? `📦 Entrega Expressa B2B (${corporate.name})`
            : `🏨 Viagem Executiva B2B (${corporate.name})`;
          const pushBody = isDelivery
            ? `Entregar para: ${cleanGuestName} • ${fareXof} XOF (Pago pela loja — não cobrar taxa).`
            : `Passageiro: ${cleanGuestName} • ${fareXof} XOF (Faturado pela empresa — não cobrar).`;

          Promise.allSettled(
            nearbyDrivers
              .filter((d) => Boolean(d.deviceToken))
              .map((driver) =>
                sendPushNotification(
                  driver.deviceToken!,
                  pushTitle,
                  pushBody,
                  { ...payload, type: 'NEW_RIDE_REQUEST', rideId: result.ride.id },
                  PUSH_CHANNELS.NEW_RIDE_ALARM
                )
              )
          ).catch(() => null);
        } catch (wsErr) {
          console.warn('⚠️ [B2B_SOCKET_WARN]:', wsErr);
        }
      }

      return res.status(201).json({
        success: true,
        message: isDelivery
          ? `Entregador acionado para levar pedido a ${cleanGuestName}!`
          : `Solicitação enviada! Procurando motorista executivo para ${cleanGuestName}.`,
        ride: {
          id: result.ride.id,
          status: result.ride.status,
          startOtp: result.ride.startOtp,
          fareXof,
          originAddress: result.ride.originAddress,
          destinationAddress: result.ride.destinationAddress,
          distanceKm: Number(result.ride.distanceKm || 0),
          durationMin: Number(result.ride.durationMin || 0)
        }
      });
    } catch (error: any) {
      console.error('❌ [B2B_DISPATCH_ERROR]:', error);
      return res.status(400).json({
        success: false,
        error: error?.message || 'Não foi possível despachar a corrida corporativa.'
      });
    }
  }

  static async listRides(req: B2BAuthRequest, res: Response): Promise<Response> {
    try {
      const corpId = req.corporate!.id;
      const corpRides = await (prisma as any).corporateRide.findMany({
        where: { corporateId: corpId },
        orderBy: { createdAt: 'desc' },
        take: 150
      });

      const rideIds = corpRides.map((cr: any) => cr.rideId);
      const rides = rideIds.length > 0
        ? await prisma.ride.findMany({
            where: { id: { in: rideIds } },
            include: {
              driver: {
                select: {
                  id: true,
                  fullName: true,
                  phone: true,
                  vehiclePlate: true,
                  vehicleModel: true,
                  vehicleColor: true,
                  profilePicture: true,
                  lastLat: true,
                  lastLng: true,
                  ratingAverage: true
                }
              }
            }
          })
        : [];

      const rideMap = new Map(rides.map((r) => [r.id, r]));

      const enriched = corpRides.map((cr: any) => {
        const r = rideMap.get(cr.rideId);
        return {
          id: cr.id,
          rideId: cr.rideId,
          guestName: cr.guestName,
          guestPhone: cr.guestPhone,
          roomNumber: cr.roomNumber,
          flightNumber: cr.flightNumber,
          tripCategory: cr.tripCategory,
          requestedBy: cr.requestedBy,
          notes: cr.notes,
          fareXof: Math.round(Number(r?.priceXof || cr.fareXof || 0)),
          corporateStatus: cr.status,
          rideStatus: r?.status || cr.status,
          startOtp: r?.startOtp || null,
          originAddress: r?.originAddress || '',
          destinationAddress: r?.destinationAddress || '',
          distanceKm: Number(r?.distanceKm || 0),
          durationMin: Number(r?.durationMin || 0),
          vehicleType: r?.requestedVehicleType || 'PARTICULAR',
          createdAt: cr.createdAt,
          finishedAt: r?.finishedAt || null,
          driver: r?.driver
            ? {
                id: r.driver.id,
                fullName: r.driver.fullName,
                phone: r.driver.phone,
                vehiclePlate: r.driver.vehiclePlate,
                vehicleModel: r.driver.vehicleModel,
                vehicleColor: r.driver.vehicleColor,
                profilePicture: r.driver.profilePicture,
                ratingAverage: Number(r.driver.ratingAverage || 5.0),
                lastLat: r.driver.lastLat ? Number(r.driver.lastLat) : null,
                lastLng: r.driver.lastLng ? Number(r.driver.lastLng) : null
              }
            : null
        };
      });

      return res.status(200).json({ success: true, data: enriched });
    } catch (error) {
      console.error('❌ [B2B_LIST_RIDES_ERROR]:', error);
      return res.status(500).json({ success: false, error: 'Erro ao carregar corridas da empresa.' });
    }
  }

  static async cancelRide(req: B2BAuthRequest, res: Response): Promise<Response> {
    try {
      const corpId = req.corporate!.id;
      const { rideId } = req.params;

      const corpRide = await (prisma as any).corporateRide.findFirst({
        where: { corporateId: corpId, rideId: String(rideId) }
      });

      if (!corpRide) {
        return res.status(404).json({ success: false, error: 'Corrida corporativa não encontrada.' });
      }

      const ride = await prisma.ride.findUnique({ where: { id: String(rideId) } });
      if (!ride) {
        return res.status(404).json({ success: false, error: 'Corrida não encontrada.' });
      }

      await cancelRideLogic(ride.id, ride.passengerId, 'PASSENGER', `Cancelado pela central B2B (${req.corporate!.name})`);

      return res.status(200).json({
        success: true,
        message: 'Solicitação cancelada e crédito corporativo estornado automaticamente.'
      });
    } catch (error: any) {
      console.error('❌ [B2B_CANCEL_ERROR]:', error);
      return res.status(400).json({ success: false, error: error?.message || 'Não foi possível cancelar esta corrida.' });
    }
  }
}
