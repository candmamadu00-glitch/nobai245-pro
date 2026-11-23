import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import { SosStatus } from '@prisma/client';
import { prisma } from '../config/prisma';

const JWT_SECRET = process.env.JWT_SECRET || 'nobai245_secret_key_change_in_prod';

export async function buildAndBroadcastSos(io: any, sosId: string) {
  const fullSos = await prisma.sosAlert.findUnique({
    where: { id: sosId },
    include: {
      passenger: { select: { id: true, fullName: true, phone: true, profilePicture: true } },
      driver: {
        select: {
          id: true,
          fullName: true,
          phone: true,
          vehiclePlate: true,
          vehicleBrand: true,
          vehicleColor: true,
          vehicleType: true,
        },
      },
      ride: {
        select: {
          id: true,
          originAddress: true,
          destinationAddress: true,
          status: true,
          driverId: true,
          driver: {
            select: {
              id: true,
              fullName: true,
              phone: true,
              vehiclePlate: true,
              vehicleBrand: true,
              vehicleColor: true,
              vehicleType: true,
            },
          },
        },
      },
    },
  });

  if (!fullSos) return null;

  const resolvedDriver = fullSos.driver || fullSos.ride?.driver || null;
  const resolvedDriverId = fullSos.driverId || fullSos.ride?.driverId || resolvedDriver?.id || null;

  if (!fullSos.driverId && resolvedDriverId) {
    await prisma.sosAlert.update({
      where: { id: fullSos.id },
      data: { driverId: resolvedDriverId },
    }).catch(() => {});
  }

  const payload = {
    ...fullSos,
    sosId: fullSos.id,
    driverId: resolvedDriverId,
    driver: resolvedDriver,
    driverName: resolvedDriver?.fullName || null,
    vehiclePlate: resolvedDriver?.vehiclePlate || null,
    vehicleModel: resolvedDriver?.vehicleBrand || null,
    vehicleColor: resolvedDriver?.vehicleColor || null,
    passengerName: fullSos.passenger?.fullName || null,
    phone: fullSos.passenger?.phone || resolvedDriver?.phone || null,
    latitude: fullSos.lat,
    longitude: fullSos.lng,
  };

  if (io) {
    io.to('admin_dashboard').emit('admin:sos_alert', payload);
    io.to('emergency_agencies').emit('admin:sos_alert', payload);
  }

  return payload;
}

export class AdminSosController {
  static async triggerSos(req: Request, res: Response) {
    try {
      const { rideId, driverId, passengerId, lat, lng, latitude, longitude, audioBase64 } = req.body;
      const finalLat = Number(lat ?? latitude ?? 0);
      const finalLng = Number(lng ?? longitude ?? 0);

      let audioUrl: string | null = null;
      if (audioBase64 && typeof audioBase64 === 'string') {
        const uploadDir = path.join(process.cwd(), 'uploads', 'audios');
        if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir, { recursive: true });
        }
        const fileName = `sos-${Date.now()}-${Math.floor(Math.random() * 1000)}.m4a`;
        const filePath = path.join(uploadDir, fileName);
        const cleanBase64 = audioBase64.replace(/^data:audio\/\w+;base64,/, '');
        await fs.promises.writeFile(filePath, Buffer.from(cleanBase64, 'base64'));
        audioUrl = `/uploads/audios/${fileName}`;
      }

      let resolvedRideId = rideId ? String(rideId) : null;
      let resolvedDriverId = driverId ? String(driverId) : null;

      if (!resolvedRideId && (passengerId || resolvedDriverId)) {
        const activeRide = await prisma.ride.findFirst({
          where: {
            status: { in: ['ACCEPTED', 'ARRIVED', 'IN_PROGRESS'] },
            ...(passengerId ? { passengerId: String(passengerId) } : { driverId: String(resolvedDriverId) }),
          },
          orderBy: { createdAt: 'desc' },
          select: { id: true, driverId: true },
        });
        if (activeRide) {
          resolvedRideId = activeRide.id;
          if (!resolvedDriverId && activeRide.driverId) resolvedDriverId = activeRide.driverId;
        }
      }

      const sos = await prisma.sosAlert.create({
        data: {
          rideId: resolvedRideId,
          driverId: resolvedDriverId,
          passengerId: passengerId ? String(passengerId) : null,
          userType: driverId && !passengerId ? 'DRIVER' : 'PASSENGER',
          lat: finalLat,
          lng: finalLng,
          audioUrl,
          status: 'ACTIVE',
        },
      });

      const io = req.app.get('io');
      await buildAndBroadcastSos(io, sos.id);

      return res.json({ success: true, sosId: sos.id, audioUrl });
    } catch (error) {
      console.error('Erro ao registrar emergencia SOS:', error);
      return res.status(500).json({ error: 'Erro interno ao processar alerta de emergencia.' });
    }
  }

  static async listSosAlerts(req: Request, res: Response) {
    try {
      const { status } = req.query;

      const sosAlerts = await prisma.sosAlert.findMany({
        where: status ? { status: status as SosStatus } : undefined,
        include: {
          passenger: { select: { id: true, fullName: true, phone: true, profilePicture: true } },
          driver: {
            select: {
              id: true,
              fullName: true,
              phone: true,
              vehiclePlate: true,
              vehicleBrand: true,
              vehicleColor: true,
              vehicleType: true,
            },
          },
          ride: {
            select: {
              id: true,
              originAddress: true,
              destinationAddress: true,
              status: true,
              driverId: true,
              driver: {
                select: {
                  id: true,
                  fullName: true,
                  phone: true,
                  vehiclePlate: true,
                  vehicleBrand: true,
                  vehicleColor: true,
                  vehicleType: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      });

      const enriched = sosAlerts.map((item) => {
        const drv = item.driver || item.ride?.driver || null;
        return {
          ...item,
          driverId: item.driverId || item.ride?.driverId || drv?.id || null,
          driver: drv,
        };
      });

      return res.json(enriched);
    } catch (error) {
      console.error('Erro ao listar alertas SOS:', error);
      return res.status(500).json({ error: 'Erro interno ao carregar alertas.' });
    }
  }

  static async updateSosStatus(req: Request, res: Response) {
    try {
      const { sosId } = req.params;
      const { status } = req.body;

      const updatedSos = await prisma.sosAlert.update({
        where: { id: String(sosId) },
        data: { status: status as SosStatus },
      });

      const io = req.app.get('io');
      if (io) {
        const evt = {
          sosId: updatedSos.id,
          driverId: updatedSos.driverId || null,
          status: updatedSos.status,
        };
        io.to('admin_dashboard').emit('admin:sos_resolved', evt);
        io.to('emergency_agencies').emit('admin:sos_resolved', evt);
      }

      return res.json(updatedSos);
    } catch (error) {
      console.error('Erro ao atualizar SOS:', error);
      return res.status(500).json({ error: 'Erro ao atualizar status do incidente.' });
    }
  }

  static async generateAgencyAccess(req: Request, res: Response) {
    try {
      const { agencyName, agencyType, expiresInHours } = req.body || {};
      const cleanName = String(agencyName || 'Policia POP / Hospital Central').trim().slice(0, 80);
      const cleanType = agencyType === 'HOSPITAL' ? 'HOSPITAL' : 'POLICE';
      const hours = Math.min(720, Math.max(1, Number(expiresInHours || 168)));

      const agencyToken = jwt.sign(
        {
          id: `agency-${cleanType.toLowerCase()}-${Date.now()}`,
          role: 'EMERGENCY_AGENCY',
          agencyName: cleanName,
          agencyType: cleanType,
        },
        JWT_SECRET,
        { algorithm: 'HS256', expiresIn: `${hours}h` }
      );

      const frontendBase = (process.env.ADMIN_PANEL_URL || 'https://nobai245.com').replace(/\/$/, '');
      const accessUrl = `${frontendBase}/emergencia?token=${encodeURIComponent(agencyToken)}`;

      return res.status(201).json({
        success: true,
        agencyName: cleanName,
        agencyType: cleanType,
        expiresInHours: hours,
        token: agencyToken,
        accessUrl,
      });
    } catch (error) {
      console.error('Erro ao gerar credencial de emergencia:', error);
      return res.status(500).json({ error: 'Falha ao gerar acesso para Policia/Hospital.' });
    }
  }
}
