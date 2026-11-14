import { Request, Response } from 'express';
import { safeRedis, getIo } from '../server';
import { prisma } from '../config/prisma';
import {  
  calculateRidePrice, 
  createRideAndInitiateEscrow,
  acceptRideLogic,
  driverArrivedLogic,
  startRideLogic,
  finalizeRideAndCharge,
  cancelRideLogic,
  calculateDistance
} from '../services/rideService';
import { sendPushNotification, PUSH_CHANNELS } from '../services/pushNotifications';
import { getRouteDistanceAndDuration, submitRatingLogic } from '../services/rideService';
import { refundPassengerOnCancellation } from '../services/mobileMoneyService';

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

const ALLOWED_PAYMENT_METHODS = ['CASH', 'ORANGE_MONEY', 'MTN_MOMO', 'TELECEL', 'TELECEL_MOMO', 'WALLET'];
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

    let appliedRuleLabel: string | null = null;
    const estimates = await Promise.all(
      activeTariffs.map(async (tariff) => {
        const calc: any = await calculateRidePrice(
          distanceKm,
          durationMin,
          tariff.vehicleType as any,
          serviceType as any,
          { originLat: pLat, originLng: pLng, destinationLat: dLat, destinationLng: dLng }
        );
        if (calc?.appliedRuleLabel) appliedRuleLabel = calc.appliedRuleLabel;
        return { 
          vehicleType: tariff.vehicleType, 
          priceXOF: Math.max(0, Math.round(Number(calc?.totalPrice ?? calc))),
          appliedRuleLabel: calc?.appliedRuleLabel || null
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
      vehicleType, serviceType = 'RIDE', paymentMethod = 'CASH', payerPhone,
      originAddress, destinationAddress, rentalRegion = 'BISSAU',
      idempotencyKey, stops = []
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
        status: { in: ['PENDING', 'SEARCHING', 'AWAITING_PAYMENT', 'ACCEPTED', 'QUEUED', 'ARRIVED', 'IN_PROGRESS'] as any[] }
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

    const result = await createRideAndInitiateEscrow(passengerId, {
      originLat: pLat, 
      originLng: pLng, 
      destinationLat: dLat, 
      destinationLng: dLng,
      requestedVehicleType: finalVehicleType as any, 
      serviceType, 
      paymentMethod,
      payerPhone: payerPhone ? sanitizeText(payerPhone, 30) : undefined,
      originAddress: cleanOriginAddress, 
      destinationAddress: cleanDestinationAddress,
      stops: sanitizedStops,
      estimatedPrice: req.body.estimatedPrice ? Number(req.body.estimatedPrice) : undefined,
      distanceKm: req.body.distanceKm ? Number(req.body.distanceKm) : undefined,
      durationMin: req.body.durationMin ? Number(req.body.durationMin) : undefined,
      couponCode: req.body.couponCode ? sanitizeText(req.body.couponCode, 40) : undefined,
      useCorporateAccount: Boolean(req.body.useCorporateAccount),
      idempotencyKey: cleanIdempotencyKey || undefined,
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

      // 🟢 VALIDAÇÃO DE SALDO MÍNIMO DO MOTORISTA (CASH ONLY)
      // Bloqueia motoristas com carteira digital zero ou negativa (walletBalance <= 0)
      const nearbyDrivers = availableDrivers.filter(d => {
        if (d.lastLat === null || d.lastLng === null) return false;
        if (Number(d.walletBalance || 0) <= 0) return false;
        return calculateDistance(pLat, pLng, Number(d.lastLat), Number(d.lastLng)) <= 5.0;
      });

      const rideStops = (result.ride.stops as any[]) && (result.ride.stops as any[]).length > 0 
        ? result.ride.stops 
        : (req.body.extraStopAddress ? [{ address: req.body.extraStopAddress, lat: req.body.extraStopLat, lng: req.body.extraStopLng }] : []);

      const passengerData = await prisma.passenger.findUnique({
        where: { id: passengerId },
        select: { fullName: true, ratingAverage: true, profilePicture: true }
      });

      const payload = {
        rideId: result.ride.id,
        passengerId: result.ride.passengerId,
        passengerName: passengerData?.fullName || 'Passageiro',
        passengerRating: Number(passengerData?.ratingAverage || 5.0),
        passengerPhoto: passengerData?.profilePicture || null,
        pickupLat: Number(result.ride.originLat),
        pickupLng: Number(result.ride.originLng),
        originAddress: result.ride.originAddress,
        destinationLat: Number(result.ride.destinationLat),
        destinationLng: Number(result.ride.destinationLng),
        destinationAddress: result.ride.destinationAddress,
        stops: rideStops,
        extraStopAddress: req.body.extraStopAddress || ((rideStops as any[])[0]?.address || null),
        fareXOF: Math.round(Number(result.ride.priceXof || 0)),
        priceXof: Math.round(Number(result.ride.priceXof || 0)),
        estimatedPrice: Math.round(Number(result.ride.priceXof || 0)),
        distanceKm: Number(Number(result.ride.distanceKm || 0).toFixed(2)),
        durationMin: Number(result.ride.durationMin || 0),
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
                `Valor total: ${result.ride.priceXof} XOF (${result.ride.paymentMethod === 'CASH' ? 'Dinheiro' : result.ride.paymentMethod === 'ORANGE_MONEY' ? 'Orange Money' : 'Telecel / MTN'}). Toque para aceitar.`,
                { ...payload, type: 'NEW_RIDE_REQUEST', rideId: result.ride.id },
                PUSH_CHANNELS.NEW_RIDE_ALARM
              )
            )
        ).catch(err => console.warn('⚠️ [PUSH_BATCH] Erro no envio de notificações:', err?.message || err));

      } catch (wsErr: any) {
        console.warn(`⚠️ [SOCKET/PUSH] Falha ao notificar motoristas: ${wsErr?.message || wsErr}`);
      }
    }

    res.status(201).json({ success: true, paymentRequired: Boolean(result.pendingVerification), payment: (result as any).payment || null, ride: sanitizeRide(result.ride) });
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
        error: 'Seu saldo na carteira digital está zerado ou negativo. Recarregue para aceitar corridas.' 
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
    
    if (!updatedRide) {
      res.status(400).json({ success: false, error: 'Corrida não encontrada.' });
      return;
    }

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

    if (!updatedRide) {
      res.status(400).json({ success: false, error: 'Corrida não encontrada ou OTP inválido.' });
      return;
    }

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
    const { finalLat, finalLng, finishOtp, otp } = req.body;

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

    const otpInput = finishOtp || otp;
    
    // Finaliza a corrida e deduz a comissão da plataforma da carteira digital do motorista
    const result: any = await (finalizeRideAndCharge as any)(
      currentRide.id, 
      Number(finalLat), 
      Number(finalLng),
      otpInput
    );

    // Limpeza no Redis
    await safeRedis.del(`active_ride:${currentRide.id}`).catch(() => null);

    if (result?.hasQueuedRide && result?.nextRideId) {
      console.log(`🔄 [REDIS QUEUE] Promovendo próxima corrida na fila: ${result.nextRideId}`);
      await safeRedis.set(`driver_active_ride:${driverId}`, result.nextRideId).catch(() => null);
    } else {
      await safeRedis.del(`driver_active_ride:${driverId}`).catch(() => null);
      if (isValidCoordinate(Number(finalLat), Number(finalLng))) {
        await safeRedis.geoAdd('drivers:locations', {
          longitude: Number(finalLng),
          latitude: Number(finalLat),
          member: driverId
        }).catch(() => null);
      }
    }

    try {
      const io = getIo();
      if (io) {
        const finishedPayload = { rideId: currentRide.id, fareXOF: result.fareXOF, distanceKm: result.distanceKm };
        io.to(currentRide.id).emit('ride:finished', finishedPayload);
        io.to(currentRide.id).emit('ride:completed', finishedPayload);
        io.to('admin_dashboard').emit('admin:ride_update', { rideId: currentRide.id, status: 'FINISHED' });

        const driverSockets = await io.in(driverId).fetchSockets();
        for (const s of driverSockets) {
          s.leave(currentRide.id);
          if (!result?.hasQueuedRide) {
            s.join('available_drivers');
          } else if (result?.nextRideId) {
            s.join(result.nextRideId);
          }
        }
      }

      if (currentRide.passenger?.deviceToken) {
        const isDigital = result.paymentMethod === 'ORANGE_MONEY' || result.paymentMethod === 'MTN_MOMO';
        const paymentText = isDigital
          ? `Pagamento de ${result.fareXOF} XOF via ${result.paymentMethod === 'ORANGE_MONEY' ? 'Orange Money' : 'Telecel / MTN'} já liquidado!`
          : `Pague ${result.fareXOF} XOF em dinheiro ao motorista.`;
        sendPushNotification(
          currentRide.passenger.deviceToken,
          "🏁 Corrida Concluída!",
          `Sua viagem foi finalizada. ${paymentText} Obrigado por viajar com o Nô Bai 245!`,
          { type: 'RIDE_COMPLETED', rideId: currentRide.id, fareXOF: result.fareXOF, paymentMethod: result.paymentMethod },
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
    
    const cancelResult = await cancelRideLogic(currentRide.id, userId, userRole as any, cleanReason);
    const refundResult = { success: Boolean((cancelResult as any)?.refundTxId) };

    try {
      const io = getIo();
      await safeRedis.del(`active_ride:${currentRide.id}`);
      if (currentRide.driverId) {
        await safeRedis.del(`driver_active_ride:${currentRide.driverId}`);
      }
      const cancelPayload = {
        rideId: currentRide.id,
        status: 'CANCELLED',
        cancelledBy: userRole,
        reason: cleanReason
      };
      if (io) {
        io.to(currentRide.id).emit('ride:cancelled', cancelPayload);
        if (currentRide.driverId) {
          io.to(`driver_${currentRide.driverId}`).emit('ride:cancelled', cancelPayload);
        }
        io.to(`passenger_${currentRide.passengerId}`).emit('ride:cancelled', cancelPayload);
        if (currentRide.status === 'SEARCHING') {
          io.to('available_drivers').emit('ride:cancelled_by_passenger', { rideId: currentRide.id });
        }
      }
      const fullRide = await prisma.ride.findUnique({
        where: { id: currentRide.id },
        include: { passenger: true, driver: true }
      });
      const pushToken = userRole === 'DRIVER' ? fullRide?.passenger?.deviceToken : fullRide?.driver?.deviceToken;
      if (pushToken) {
        sendPushNotification(
          pushToken,
          '⚠️ Corrida Cancelada',
          userRole === 'DRIVER' ? 'O motorista cancelou a viagem.' : 'O passageiro cancelou a viagem.',
          { rideId: currentRide.id, type: 'RIDE_CANCELLED' },
          PUSH_CHANNELS.RIDE_UPDATE
        ).catch(() => {});
      }
    } catch (wsErr: any) {
      console.warn(`⚠️ [SOCKET] Falha ao notificar cancelamento: ${wsErr?.message || wsErr}`);
    }
    
    res.json({ 
      success: true, 
      message: 'Corrida cancelada com sucesso.', 
      penaltyApplied: cancelResult?.appliedPenalty || false,
      refundExecuted: refundResult?.success || false
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
        isRead: true,
        createdAt: true,
      }
    });

    const formattedMessages = messages.map((m: any) => {
      const raw = String(m.message || '');
      if (raw.startsWith('[AUDIO]')) {
        const parts = raw.replace('[AUDIO]', '').split('|');
        return {
          ...m,
          message: '',
          text: '',
          audioUrl: parts[0] || null,
          audioDuration: Number(parts[1] || 0),
        };
      }
      return m;
    });

    res.status(200).json({ success: true, messages: formattedMessages });
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
        senderType: senderType as any,
        message: formattedMessage,
        isRead: false
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
      reviewerType: reviewerType as any,
      receiverId: String(receiverId),
      stars: numericStars,
      tags: Array.isArray(tags) ? tags.map(t => String(t).slice(0, 50)) : [],
      comment: sanitizeText(comment, 500)
    });

    res.json({ success: true, message: 'Avaliação enviada com sucesso!', rating });
  } catch (error: any) {
    console.error('❌ Erro ao enviar avaliação:', error?.message || error);
    res.status(400).json({ success: false, error: error?.message || 'Falha ao registrar avaliação.' });
  }
}; 

// -----------------------------------------------------------------------------
// 🔄 OBTER CORRIDA ATIVA DO MOTORISTA (SINCRONIZAÇÃO APÓS MINIMIZAR/REABRIR APP)
// -----------------------------------------------------------------------------
export const getDriverActiveRide = async (req: any, res: any) => {
  try {
    const driverId = req.user?.id;
    if (!driverId) {
      return res.status(401).json({ error: 'Motorista não autenticado.' });
    }

    const activeRide = await prisma.ride.findFirst({
      where: {
        driverId,
        status: { in: ['ACCEPTED', 'ARRIVED', 'IN_PROGRESS'] },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        passenger: {
          select: {
            id: true,
            fullName: true,
            phone: true,
            profilePicture: true,
            ratingAverage: true,
          },
        },
      },
    });

    return res.json({ ride: activeRide || null });
  } catch (error: any) {
    console.error('❌ [GET_DRIVER_ACTIVE_RIDE_ERROR]:', error?.message);
    return res.status(500).json({ error: 'Erro ao buscar corrida ativa do motorista.' });
  }
};

export const getRidePaymentStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { rideId } = req.params;
    const ride = await prisma.ride.findUnique({
      where: { id: String(rideId) },
      select: { id: true, status: true, paymentMethod: true, priceXof: true },
    });
    if (!ride) { res.status(404).json({ success: false, error: 'Corrida não encontrada.' }); return; }
    const intent = await prisma.paymentIntent.findFirst({
      where: { rideId: ride.id },
      orderBy: { createdAt: 'desc' },
      select: { id: true, status: true, provider: true, reference: true, failureReason: true },
    });
    res.json({
      success: true, rideId: ride.id, rideStatus: ride.status, paymentMethod: ride.paymentMethod,
      amountXOF: Number(ride.priceXof), paymentStatus: intent?.status || (ride.paymentMethod === 'CASH' ? 'NOT_APPLICABLE' : 'PENDING'),
      provider: intent?.provider || ride.paymentMethod, reference: intent?.reference || null, failureReason: intent?.failureReason || null,
    });
  } catch {
    res.status(500).json({ success: false, error: 'Erro ao verificar status do pagamento.' });
  }
};
