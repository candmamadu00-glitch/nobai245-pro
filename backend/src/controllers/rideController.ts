import { Request, Response } from 'express';
import { getIo } from '../server';
import { prisma } from '../lib/prisma';
import { 
  getRouteDistanceAndDuration, 
  calculateRidePrice, 
  createRideAndInitiateEscrow,
  acceptRideLogic,
  driverArrivedLogic,
  startRideLogic,
  finalizeRideAndCharge,
  cancelRideLogic,
  submitRatingLogic
} from '../services/rideService';
import { sendPushNotification, PUSH_CHANNELS } from '../services/pushNotifications';

// -----------------------------------------------------------------------------
// HELPERS DE VALIDAÇÃO E SANITIZAÇÃO
// -----------------------------------------------------------------------------

const isValidCoordinate = (lat: any, lng: any): boolean => {
  if (lat === null || lng === null || typeof lat === 'boolean' || typeof lng === 'boolean') return false;
  const l = Number(lat);
  const lg = Number(lng);
  return Number.isFinite(l) && Number.isFinite(lg) && l >= -90 && l <= 90 && lg >= -180 && lg <= 180;
};

const sanitizeText = (input: any, maxLength = 255): string => {
  if (typeof input !== 'string') return '';
  return input.trim().slice(0, maxLength);
};

const getDistanceFromLatLonInKm = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371; 
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180); 
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2); 
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); 
  return R * c; 
};

const sanitizeRide = <T extends Record<string, any>>(ride: T): T => {
  if (!ride) return ride;
  const sanitized = JSON.parse(JSON.stringify(ride));

  if (sanitized.passenger) {
    delete sanitized.passenger.phone;
    delete sanitized.passenger.phoneNumber;
  }
  if (sanitized.driver) {
    delete sanitized.driver.phone;
    delete sanitized.driver.phoneNumber;
  }
  delete sanitized.passengerPhone;
  delete sanitized.driverPhone;

  return sanitized;
};

const ALLOWED_PAYMENT_METHODS = ['ORANGE_MONEY', 'MTN_MOMO', 'CASH', 'WALLET'];
const ALLOWED_VEHICLES = ['PARTICULAR', 'TAXI', 'MOTO', 'MOTO_CARRO', 'TOCA_TOCA'];

// -----------------------------------------------------------------------------
// CONTROLLER DE CORRIDAS
// -----------------------------------------------------------------------------

export const estimateRidePrice = async (req: Request, res: Response): Promise<void> => {
  try {
    const { 
      pickupLat, pickupLng, dropoffLat, dropoffLng, 
      serviceType = 'RIDE', rentalRegion = 'BISSAU'
    } = req.body;

    if (!isValidCoordinate(pickupLat, pickupLng)) {
      res.status(400).json({ success: false, error: 'Coordenadas de partida inválidas ou ausentes.' });
      return;
    }

    const pLat = Number(pickupLat);
    const pLng = Number(pickupLng);

    if (serviceType === 'RENTAL') {
      const tariff = await prisma.tariffConfig.findFirst({
        where: { serviceType: 'RENTAL', isActive: true }
      });
      
      const fixedPrice = tariff ? Math.max(0, Number(tariff.baseFare)) : 13000;
      
      res.json({
        success: true,
        serviceType: 'RENTAL',
        region: sanitizeText(rentalRegion, 50),
        estimates: [{
          vehicleType: 'PARTICULAR',
          priceXOF: fixedPrice,
          isFixed: true,
          description: 'Diária base de aluguel'
        }]
      });
      return;
    }

    if (!isValidCoordinate(dropoffLat, dropoffLng)) {
      res.status(400).json({ success: false, error: 'Coordenadas de destino inválidas ou ausentes.' });
      return;
    }

    const dLat = Number(dropoffLat);
    const dLng = Number(dropoffLng);

    const { distanceKm, durationMin } = await getRouteDistanceAndDuration(pLat, pLng, dLat, dLng);

    const activeTariffs = await prisma.tariffConfig.findMany({
      where: { serviceType, isActive: true }
    });

    if (activeTariffs.length === 0) {
      res.status(400).json({ success: false, error: 'Nenhuma tarifa configurada para este serviço no momento.' });
      return;
    }

    const estimates = await Promise.all(
      activeTariffs.map(async (tariff) => {
        const { totalPrice } = await calculateRidePrice(distanceKm, durationMin, tariff.vehicleType, serviceType);
        return { 
          vehicleType: tariff.vehicleType, 
          priceXOF: Math.max(0, Math.round(totalPrice))
        };
      })
    );

    res.json({
      success: true,
      distanceKm: Number(distanceKm.toFixed(2)),
      durationMin: Math.ceil(durationMin),
      estimates
    });
  } catch (error: any) {
    console.error(`❌ [ESTIMATIVA] Erro: ${error?.message || error}`);
    res.status(500).json({ success: false, error: 'Erro interno ao estimar preço. Tente novamente em instantes.' });
  }
};

export const requestRide = async (req: Request, res: Response): Promise<void> => {
  try {
    const passengerId = (req as any).user?.id;
    if (!passengerId) {
      res.status(401).json({ success: false, error: 'Sessão expirada ou não autorizada.' });
      return;
    }

    const { 
      pickupLat, pickupLng, dropoffLat, dropoffLng, 
      vehicleType, serviceType = 'RIDE', paymentMethod = 'ORANGE_MONEY',
      originAddress, destinationAddress, rentalRegion = 'BISSAU',
      idempotencyKey, stops = [], estimatedPrice
    } = req.body;

    const cleanIdempotencyKey = sanitizeText(idempotencyKey, 100);

    if (cleanIdempotencyKey) {
      const existingTransaction = await prisma.transaction.findFirst({
        where: { idempotencyKey: cleanIdempotencyKey }
      });
      if (existingTransaction && existingTransaction.rideId) {
        const existingRide = await prisma.ride.findUnique({ where: { id: existingTransaction.rideId } });
        if (existingRide) {
          res.status(200).json({ success: true, ride: sanitizeRide(existingRide), message: 'Corrida recuperada via chave de idempotência.' });
          return;
        }
      }
    }

    const ongoing = await prisma.ride.findFirst({
      where: { 
        passengerId, 
        status: { in: ['PENDING', 'SEARCHING', 'AWAITING_PAYMENT', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS'] } 
      }
    });
    
    if (ongoing) {
      res.status(409).json({ success: false, error: 'Você já possui uma corrida em andamento.', rideId: ongoing.id });
      return;
    }

    if (!isValidCoordinate(pickupLat, pickupLng)) {
      res.status(400).json({ success: false, error: 'Coordenada de partida inválida.' });
      return;
    }

    const pLat = Number(pickupLat);
    const pLng = Number(pickupLng);
    const isRental = serviceType === 'RENTAL';
    
    const dLat = isRental ? pLat : Number(dropoffLat);
    const dLng = isRental ? pLng : Number(dropoffLng);

    if (!isRental && !isValidCoordinate(dropoffLat, dropoffLng)) {
      res.status(400).json({ success: false, error: 'Coordenadas de destino inválidas ou ausentes.' });
      return;
    }

    let finalVehicleType = String(isRental ? (vehicleType || 'PARTICULAR') : vehicleType).toUpperCase();
    if (finalVehicleType === 'MOTO_CAR') finalVehicleType = 'MOTO_CARRO';
    
    if (!ALLOWED_VEHICLES.includes(finalVehicleType)) {
      res.status(400).json({ success: false, error: 'Tipo de veículo não suportado pelo sistema.' });
      return;
    }

    if (!ALLOWED_PAYMENT_METHODS.includes(paymentMethod)) {
      res.status(400).json({ success: false, error: 'Método de pagamento inválido.' });
      return;
    }

    const sanitizedStops = Array.isArray(stops) 
      ? stops.slice(0, 5).filter((s: any) => isValidCoordinate(s.lat, s.lng)).map((s: any) => ({
          address: sanitizeText(s.address, 150),
          lat: Number(s.lat),
          lng: Number(s.lng),
          status: 'PENDING'
        }))
      : [];

    const cleanOriginAddress = sanitizeText(originAddress, 200);
    const cleanDestinationAddress = isRental 
      ? sanitizeText(destinationAddress || `Aluguel (${rentalRegion})`, 200) 
      : sanitizeText(destinationAddress, 200);

    const parsedEstPrice = Number(estimatedPrice);
    const cleanEstimatedPrice = (!isNaN(parsedEstPrice) && parsedEstPrice > 0) ? parsedEstPrice : undefined;

    const result = await createRideAndInitiateEscrow(passengerId, {
      originLat: pLat, 
      originLng: pLng, 
      destinationLat: dLat, 
      destinationLng: dLng,
      requestedVehicleType: finalVehicleType, 
      serviceType, 
      paymentMethod,
      originAddress: cleanOriginAddress, 
      destinationAddress: cleanDestinationAddress,
      stops: sanitizedStops,
      idempotencyKey: cleanIdempotencyKey || undefined,
      estimatedPrice: cleanEstimatedPrice
    });

    if (result.ride && result.ride.status === 'SEARCHING') {
      const latDelta = 0.045;
      const lngDelta = 0.045;

      const availableDrivers = await prisma.driver.findMany({
        where: { 
          isOnline: true, 
          isAvailable: true, 
          vehicleType: finalVehicleType as any, 
          status: 'APPROVED',
          lastLat: { gte: pLat - latDelta, lte: pLat + latDelta },
          lastLng: { gte: pLng - lngDelta, lte: pLng + lngDelta }
        },
        select: { id: true, lastLat: true, lastLng: true, deviceToken: true, walletBalance: true }
      });

      const nearbyDrivers = availableDrivers.filter(d => {
        if (d.lastLat === null || d.lastLng === null) return false;
        if (paymentMethod === 'CASH' && Number(d.walletBalance || 0) < -2000) return false;
        return getDistanceFromLatLonInKm(pLat, pLng, Number(d.lastLat), Number(d.lastLng)) <= 5.0;
      });

      const rideStops = (result.ride.stops as any[]) && (result.ride.stops as any[]).length > 0 
        ? result.ride.stops 
        : (req.body.extraStopAddress ? [{ address: req.body.extraStopAddress, lat: req.body.extraStopLat, lng: req.body.extraStopLng }] : []);

      const passengerData = (result.ride as any).passenger;

      const payload = {
        rideId: result.ride.id,
        passengerId: result.ride.passengerId,
        passengerName: passengerData?.fullName || 'Passageiro',
        passengerRating: Number(passengerData?.ratingAverage || 5.0),
        passengerPhoto: passengerData?.profilePicture || null,
        pickupLat: result.ride.originLat,
        pickupLng: result.ride.originLng,
        originAddress: result.ride.originAddress,
        destinationLat: result.ride.destinationLat,
        destinationLng: result.ride.destinationLng,
        destinationAddress: result.ride.destinationAddress,
        stops: rideStops,
        extraStopAddress: req.body.extraStopAddress || ((rideStops as any[])[0]?.address || null),
        fareXOF: Number(result.ride.priceXof),
        priceXof: Number(result.ride.priceXof),
        vehicleType: result.ride.requestedVehicleType,
        serviceType: result.ride.serviceType,
        paymentMethod: result.ride.paymentMethod
      };

      try {
        const io = getIo();
        if (io) {
          nearbyDrivers.forEach(driver => {
            io.to(driver.id).to(`driver_${driver.id}`).emit('ride:new_request', payload);
          });
        }

        Promise.allSettled(
          nearbyDrivers
            .filter(d => Boolean(d.deviceToken))
            .map(driver =>
              sendPushNotification(
                driver.deviceToken!,
                "🔔 Nova Corrida Próxima!",
                `Ganho estimado: ${result.ride.priceXof} XOF (${paymentMethod === 'CASH' ? 'Dinheiro' : 'Mobile Money'}). Toque para aceitar.`,
                { ...payload, type: 'NEW_RIDE_REQUEST', rideId: result.ride.id },
                PUSH_CHANNELS.NEW_RIDE_ALARM
              )
            )
        ).catch(err => console.warn('⚠️ [PUSH_BATCH] Erro no envio de notificações:', err?.message || err));

      } catch (wsErr: any) {
        console.warn(`⚠️ [SOCKET/PUSH] Falha ao notificar motoristas: ${wsErr?.message || wsErr}`);
      }
    }

    res.status(201).json({ success: true, ride: sanitizeRide(result.ride), pendingVerification: result.pendingVerification });
  } catch (error: any) {
    console.error(`❌ [SOLICITAR_CORRIDA] Erro: ${error?.message || error}`);
    res.status(400).json({ success: false, error: error?.message || 'Falha ao processar solicitação de corrida.' });
  }
};

export const acceptRide = async (req: Request, res: Response): Promise<void> => {
  try {
    const driverId = (req as any).user?.id;
    const { rideId } = req.body;

    if (!driverId) {
      res.status(401).json({ success: false, error: 'Sessão expirada ou não autorizada.' });
      return;
    }

    if (!rideId) {
      res.status(400).json({ success: false, error: 'ID da corrida é obrigatório.' });
      return;
    }

    const updatedRide = await acceptRideLogic(String(rideId), driverId);
    const sanitizedRide = sanitizeRide(updatedRide);

    try {
      const io = getIo();
      if (io) {
        io.to(sanitizedRide.id).emit('ride:accepted', { ride: sanitizedRide });
        io.to(`passenger_${sanitizedRide.passengerId}`).emit('ride:accepted', { ride: sanitizedRide });
      }
    } catch (wsErr) {
      console.warn('⚠️ [SOCKET] Erro ao emitir aceite de corrida:', wsErr);
    }

    res.json({ success: true, ride: sanitizedRide });
  } catch (error: any) {
    console.error(`❌ [ACEITAR_CORRIDA] Erro: ${error?.message || error}`);
    
    if (error?.message?.includes('INSUFFICIENT_DRIVER_BALANCE')) {
      res.status(402).json({ 
        success: false, 
        error: 'Seu saldo de comissões está negativo. Recarregue via Mobile Money para aceitar corridas em dinheiro.' 
      });
      return;
    }

    res.status(400).json({ success: false, error: error?.message || 'Não foi possível aceitar a corrida.' });
  }
};

export const driverArrived = async (req: Request, res: Response): Promise<void> => {
  try {
    const driverId = (req as any).user?.id;
    const { rideId } = req.params;

    if (!driverId) {
      res.status(401).json({ success: false, error: 'Não autorizado.' });
      return;
    }

    const updatedRide = await driverArrivedLogic(String(rideId), driverId);
    const sanitizedRide = sanitizeRide(updatedRide);

    try {
      const io = getIo();
      if (io) {
        io.to(sanitizedRide.id).emit('ride:arrived', { rideId: sanitizedRide.id });
        io.to(`passenger_${sanitizedRide.passengerId}`).emit('ride:arrived', { rideId: sanitizedRide.id });
      }
    } catch (wsErr) {
      console.warn('⚠️ [SOCKET] Erro ao emitir chegada do motorista:', wsErr);
    }

    res.json({ success: true, ride: sanitizedRide });
  } catch (error: any) {
    console.error(`❌ [MOTORISTA_CHEGOU] Erro: ${error?.message || error}`);
    res.status(400).json({ success: false, error: error?.message || 'Falha ao registrar chegada.' });
  }
};

export const startRide = async (req: Request, res: Response): Promise<void> => {
  try {
    const driverId = (req as any).user?.id;
    const { rideId } = req.params;
    const { otp } = req.body;

    if (!driverId) {
      res.status(401).json({ success: false, error: 'Não autorizado.' });
      return;
    }

    if (!otp) {
      res.status(400).json({ success: false, error: 'Código OTP é obrigatório para iniciar a corrida.' });
      return;
    }

    const updatedRide = await startRideLogic(String(rideId), driverId, String(otp));
    const sanitizedRide = sanitizeRide(updatedRide);

    try {
      const io = getIo();
      if (io) {
        io.to(sanitizedRide.id).emit('ride:started', { rideId: sanitizedRide.id, status: 'IN_PROGRESS' });
        io.to(`passenger_${sanitizedRide.passengerId}`).emit('ride:started', { rideId: sanitizedRide.id, status: 'IN_PROGRESS' });
      }
    } catch (wsErr) {
      console.warn('⚠️ [SOCKET] Erro ao emitir início de corrida:', wsErr);
    }

    res.json({ success: true, ride: sanitizedRide });
  } catch (error: any) {
    console.error(`❌ [INICIAR_CORRIDA] Erro: ${error?.message || error}`);
    res.status(400).json({ success: false, error: error?.message || 'Falha ao iniciar a corrida.' });
  }
};

export const finishRide = async (req: Request, res: Response): Promise<void> => {
  try {
    const driverId = (req as any).user?.id;
    const { rideId } = req.params;
    const { finalLat, finalLng } = req.body;

    if (!driverId) {
      res.status(401).json({ success: false, error: 'Não autorizado.' });
      return;
    }

    if (!isValidCoordinate(finalLat, finalLng)) {
      res.status(400).json({ success: false, error: 'Coordenadas de finalização inválidas.' });
      return;
    }

    const currentRide = await prisma.ride.findUnique({
      where: { id: String(rideId) },
      select: { id: true, driverId: true, status: true, passenger: { select: { deviceToken: true } } }
    });

    if (!currentRide) {
      res.status(404).json({ success: false, error: 'Corrida não encontrada.' });
      return;
    }

    if (currentRide.driverId !== driverId) {
      res.status(403).json({ success: false, error: 'Você não tem autorização para finalizar esta corrida.' });
      return;
    }

    const result = await finalizeRideAndCharge(currentRide.id, Number(finalLat), Number(finalLng));

    try {
      const io = getIo();
      if (io) {
        const finishedPayload = { rideId: currentRide.id, fareXOF: result.fareXOF, distanceKm: result.distanceKm };
        io.to(currentRide.id).emit('ride:finished', finishedPayload);
        io.to(currentRide.id).emit('ride:completed', finishedPayload);
        io.to('admin_dashboard').emit('admin:ride_update', { rideId: currentRide.id, status: 'FINISHED' });
      }

      if (currentRide.passenger?.deviceToken) {
        sendPushNotification(
          currentRide.passenger.deviceToken,
          "🏁 Corrida Concluída!",
          `Sua viagem foi finalizada. Valor total: ${result.fareXOF} XOF. Obrigado por viajar com a BAI 245!`,
          { type: 'RIDE_COMPLETED', rideId: currentRide.id, fareXOF: result.fareXOF },
          PUSH_CHANNELS.RIDE_UPDATE
        ).catch(pErr => console.warn('⚠️ [PUSH] Erro de notificação do passageiro:', pErr?.message || pErr));
      }
    } catch (wsErr) {
      console.warn('⚠️ [SOCKET/PUSH] Erro ao notificar fim da corrida:', wsErr);
    }

    res.json({ success: true, message: 'Corrida finalizada com sucesso!', data: result });
  } catch (error: any) {
    console.error(`❌ [FINALIZAR_CORRIDA] Erro: ${error?.message || error}`);
    res.status(400).json({ success: false, error: error?.message || 'Falha ao finalizar a corrida.' });
  }
};

export const cancelRide = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.id;
    const userRole = (req as any).user?.role === 'DRIVER' ? 'DRIVER' : 'PASSENGER';
    const { rideId, reason } = req.body;
    
    if (!userId) {
      res.status(401).json({ success: false, error: 'Sessão expirada ou não autorizada.' });
      return;
    }

    if (!rideId) {
      res.status(400).json({ success: false, error: 'ID da corrida é obrigatório.' });
      return;
    }

    const currentRide = await prisma.ride.findUnique({
      where: { id: String(rideId) },
      select: { 
        id: true, 
        passengerId: true, 
        driverId: true, 
        status: true
      }
    });

    if (!currentRide) {
      res.status(404).json({ success: false, error: 'Corrida não localizada.' });
      return;
    }

    if (userRole === 'PASSENGER' && currentRide.passengerId !== userId) {
      res.status(403).json({ success: false, error: 'Você não tem permissão para cancelar esta corrida.' });
      return;
    }

    if (userRole === 'DRIVER' && currentRide.driverId !== userId) {
      res.status(403).json({ success: false, error: 'Você não tem permissão para cancelar esta corrida.' });
      return;
    }

    const cleanReason = sanitizeText(reason || `Cancelado pelo ${userRole === 'DRIVER' ? 'motorista' : 'passageiro'}`, 200);
    const cancelResult = await cancelRideLogic(currentRide.id, userId, userRole, cleanReason);
    
    try {
      const io = getIo();
      if (io) {
        io.to(currentRide.id).emit('ride:cancelled', { rideId: currentRide.id, reason: cleanReason });
        if (currentRide.driverId) {
          io.to(`driver_${currentRide.driverId}`).emit('ride:cancelled', { rideId: currentRide.id, reason: cleanReason });
        }
        io.to(`passenger_${currentRide.passengerId}`).emit('ride:cancelled', { rideId: currentRide.id, reason: cleanReason });
      }
    } catch (wsErr: any) {
      console.warn(`⚠️ [SOCKET] Falha ao notificar cancelamento: ${wsErr?.message || wsErr}`);
    }
    
    res.json({ 
      success: true, 
      message: 'Corrida cancelada com sucesso.', 
      penaltyApplied: cancelResult?.appliedPenalty || false 
    });
  } catch (error: any) {
    console.error(`❌ [CANCELAR_CORRIDA] Erro: ${error?.message || error}`);
    res.status(500).json({ success: false, error: error?.message || 'Erro crítico ao cancelar a corrida.' });
  }
};

export const getRideChatHistory = async (req: Request, res: Response): Promise<void> => {
  try {
    const { rideId } = req.params;
    const userId = (req as any).user?.id;

    if (!userId) {
      res.status(401).json({ success: false, error: 'Sessão não autorizada.' });
      return;
    }

    const ride = await prisma.ride.findUnique({
      where: { id: String(rideId) },
      select: { passengerId: true, driverId: true }
    });

    if (!ride) {
      res.status(404).json({ success: false, error: 'Corrida não encontrada.' });
      return;
    }

    if (ride.passengerId !== userId && ride.driverId !== userId) {
      res.status(403).json({ success: false, error: 'Acesso negado às mensagens desta viagem.' });
      return;
    }

    const messages = await prisma.rideChatMessage.findMany({
      where: { rideId: String(rideId) },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        senderType: true,
        message: true,
        createdAt: true,
      }
    });

    res.status(200).json({ success: true, messages });
  } catch (error: any) {
    console.error('❌ Erro ao buscar chat da corrida:', error?.message || error);
    res.status(500).json({ success: false, error: 'Erro ao carregar histórico do chat.' });
  }
};

export const uploadChatAudio = async (req: Request, res: Response): Promise<void> => {
  try {
    const { rideId } = req.params;
    const file = (req as any).file;
    const senderId = (req as any).user?.id;
    const senderType = (req as any).user?.role === 'DRIVER' ? 'DRIVER' : 'PASSENGER';

    if (!senderId) {
      res.status(401).json({ success: false, error: 'Não autorizado.' });
      return;
    }

    if (!file) {
      res.status(400).json({ success: false, error: 'Nenhum arquivo de áudio enviado.' });
      return;
    }

    const ride = await prisma.ride.findUnique({
      where: { id: String(rideId) },
      select: { 
        passengerId: true, 
        driverId: true,
        passenger: { select: { deviceToken: true } },
        driver: { select: { deviceToken: true } }
      }
    });

    if (!ride || (ride.passengerId !== senderId && ride.driverId !== senderId)) {
      res.status(403).json({ success: false, error: 'Não autorizado a enviar mensagens nesta corrida.' });
      return;
    }

    const baseUrl = process.env.APP_URL ? process.env.APP_URL.replace(/\/$/, '') : `${req.protocol}://${req.get('host')}`;
    const safeFilename = encodeURIComponent(file.filename);
    const audioUrl = `${baseUrl}/uploads/${safeFilename}`;
    const formattedMessage = `[AUDIO]${audioUrl}`;

    const chatMessage = await prisma.rideChatMessage.create({
      data: {
        rideId: String(rideId),
        senderId,
        senderType,
        message: formattedMessage,
      },
    });

    try {
      const io = getIo();
      if (io) {
        const messagePayload = {
          id: chatMessage.id,
          sender: senderType.toLowerCase(),
          text: chatMessage.message,
          senderPhoto: null,
          createdAt: chatMessage.createdAt.toISOString()
        };
        io.to(String(rideId)).emit('chat:receive_message', messagePayload);
      }
    } catch (wsErr) {
      console.warn('⚠️ [SOCKET] Erro ao emitir mensagem de áudio:', wsErr);
    }

    try {
      const recipientToken = senderType === 'DRIVER' 
        ? ride.passenger?.deviceToken 
        : ride.driver?.deviceToken;

      if (recipientToken) {
        sendPushNotification(
          recipientToken,
          "🎙️ Nova Mensagem de Áudio",
          `Você recebeu um áudio no chat da corrida de ${senderType === 'DRIVER' ? 'seu motorista' : 'seu passageiro'}.`,
          { type: 'CHAT_MESSAGE', rideId: String(rideId) },
          PUSH_CHANNELS.CHAT
        ).catch(err => console.warn('⚠️ [PUSH] Erro no envio de notificação do chat:', err));
      }
    } catch (pushErr) {
      console.warn('⚠️ Erro no envio de Push do chat:', pushErr);
    }

    res.status(201).json({ success: true, chatMessage });
  } catch (error: any) {
    console.error('❌ Erro no upload de áudio do chat:', error?.message || error);
    res.status(500).json({ success: false, error: 'Falha ao processar áudio do chat.' });
  }
};

export const rateRide = async (req: Request, res: Response): Promise<void> => {
  try {
    const reviewerId = (req as any).user?.id;
    const reviewerType = (req as any).user?.role === 'DRIVER' ? 'DRIVER' : 'PASSENGER';
    const { rideId, receiverId, stars, tags, comment } = req.body;

    if (!reviewerId) {
      res.status(401).json({ success: false, error: 'Sessão expirada.' });
      return;
    }

    if (!rideId || !receiverId || stars === undefined || stars === null) {
      res.status(400).json({ success: false, error: 'Campos obrigatórios ausentes para avaliação.' });
      return;
    }

    const numericStars = Math.round(Number(stars));
    if (isNaN(numericStars) || numericStars < 1 || numericStars > 5) {
      res.status(400).json({ success: false, error: 'A avaliação deve ser um número inteiro entre 1 e 5 estrelas.' });
      return;
    }

    const rating = await submitRatingLogic({
      rideId: String(rideId),
      reviewerId,
      reviewerType,
      receiverId: String(receiverId),
      stars: numericStars,
      tags,
      comment
    });

    res.json({ success: true, message: 'Avaliação enviada com sucesso!', rating });
  } catch (error: any) {
    console.error('❌ Erro ao enviar avaliação:', error?.message || error);
    res.status(400).json({ success: false, error: error?.message || 'Falha ao registrar avaliação.' });
  }
};