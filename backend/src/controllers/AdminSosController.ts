import { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { SosStatus } from '@prisma/client';
import fs from 'fs';
import path from 'path';

export class AdminSosController {
  static async uploadSosAudio(req: Request, res: Response) {
    try {
      const { rideId, driverId, passengerId, lat, lng, audioBase64, latitude, longitude } = req.body;

      const finalLat = parseFloat(lat || latitude || '0');
      const finalLng = parseFloat(lng || longitude || '0');

      let audioUrl = null;

      // Se o app enviou o áudio em Base64
      if (audioBase64) {
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

      const sos = await prisma.sosAlert.create({
        data: {
          rideId: rideId ? String(rideId) : null,
          driverId: driverId ? String(driverId) : null,
          passengerId: passengerId ? String(passengerId) : null,
          userType: driverId ? 'DRIVER' : 'PASSENGER',
          lat: finalLat,
          lng: finalLng,
          audioUrl,
          status: SosStatus.ACTIVE,
        },
        include: {
          driver: { select: { fullName: true, phone: true, vehiclePlate: true } },
          passenger: { select: { fullName: true, phone: true } },
        },
      });

      // Notifica o painel Admin em tempo real via Socket
      const io = req.app.get('io');
      if (io) {
        io.emit('admin:sos_alert', sos);
      }

      return res.json({ success: true, sosId: sos.id, audioUrl });
    } catch (error) {
      console.error('Erro ao registrar emergência SOS:', error);
      return res.status(500).json({ error: 'Erro interno ao processar alerta de emergência.' });
    }
  }

  static async listSosAlerts(req: Request, res: Response) {
    try {
      const { status } = req.query;

      const sosAlerts = await prisma.sosAlert.findMany({
        where: status ? { status: status as SosStatus } : undefined,
        include: {
          passenger: { select: { id: true, fullName: true, phone: true, profilePicture: true } },
          driver: { select: { id: true, fullName: true, phone: true, vehiclePlate: true, vehicleBrand: true } },
          ride: { select: { id: true, originAddress: true, destinationAddress: true, status: true } },
        },
        orderBy: { createdAt: 'desc' },
      });

      return res.json(sosAlerts);
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

      return res.json(updatedSos);
    } catch (error) {
      console.error('Erro ao atualizar SOS:', error);
      return res.status(500).json({ error: 'Erro ao atualizar status do SOS.' });
    }
  }
}