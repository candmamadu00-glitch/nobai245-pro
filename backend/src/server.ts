import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import jwt from 'jsonwebtoken';
import path from 'path';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createClient } from 'redis';
import { prisma } from './config/prisma';
import { getRouteDistanceAndDuration } from './services/rideService';
import { passengerRoutes } from './routes/passengerRoutes'; 
import { driverRoutes } from './routes/driverRoutes'; 
import { adminRoutes } from './routes/adminRoutes';
import webhookRoutes from './routes/webhookRoutes';
import rideRoutes from './routes/rideRoutes';
import { createAdapter } from '@socket.io/redis-adapter';
import { setupTicketSocketHandlers } from './sockets/ticketSocket';
import { 
  calculateDistance, 
  calculateRidePrice, 
  acceptRideLogic, 
  driverArrivedLogic, 
  startRideLogic, 
  finalizeRideAndCharge, 
  cancelRideLogic, 
} from './services/rideRulesService';
import { createRideAndInitiateEscrow, submitRatingLogic } from './services/rideService';
import { startCronJobs } from './jobs/reconciliationJob';

declare global {
  namespace Express {
    interface Request {
      rawBody?: Buffer;
    }
  }
}

// -----------------------------------------------------------------------------
// 1. VALIDAÇÃO DE AMBIENTE CRÍTICO (BLINDAGEM FINANCEIRA)
// -----------------------------------------------------------------------------
const REQUIRED_ENVS = [
  'JWT_SECRET', 
  'JWT_REFRESH_SECRET', 
  'DATABASE_URL', 
  'ORANGE_CLIENT_ID', 
  'ORANGE_CLIENT_SECRET',
  'ORANGE_WEBHOOK_URL'
];

for (const env of REQUIRED_ENVS) {
  if (!process.env[env]) {
    console.error(`🚨 [ERRO FATAL DE SEGURANÇA]: A variável ${env} não foi definida no .env.`);
    process.exit(1); 
  }
}

const JWT_SECRET = process.env.JWT_SECRET as string;

// Inicia jobs de reconciliação financeira em segundo plano
startCronJobs();

const app = express();
const server = http.createServer(app);

// -----------------------------------------------------------------------------
// 2. MIDDLEWARES HTTP E SEGURANÇA
// -----------------------------------------------------------------------------
app.set('trust proxy', 1); // Essencial se estiver atrás de Nginx, AWS ELB ou Vercel
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()) 
  : '*'; // Em produção, force as origens do Admin Panel

app.use(cors({ 
  origin: allowedOrigins, 
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] 
}));

// 🛡️ Captura do rawBody para validar a assinatura do Webhook Orange / MTN
app.use(express.json({
  limit: '10mb',
  verify: (req: Request, _res: Response, buf: Buffer) => {
    req.rawBody = buf;
  }
}));
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));
// 🛡️ Rate Limiting Global
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 300, 
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições vindas deste IP. Tente novamente em instantes.' }
});

app.use('/api/', apiLimiter);

// Logging HTTP
app.use((req, _res, next) => {
  console.log(`📡 [${req.method}] ${req.url}`);
  next();
});

// -----------------------------------------------------------------------------
// 3. ROTAS HTTP DA APLICAÇÃO
// -----------------------------------------------------------------------------
app.use('/api/webhooks', webhookRoutes); 
app.use('/api/payments', webhookRoutes); 
app.use('/api/passengers', passengerRoutes);
app.use('/api/drivers', driverRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/rides', rideRoutes);

app.get('/health', (_req, res) => {
  res.json({
    status: 'online',
    country: 'Guiné-Bissau 🇬🇼',
    currency: 'XOF',
    paymentMethod: 'Orange Money & MTN MoMo',
    timestamp: new Date().toISOString(),
  });
});

// -----------------------------------------------------------------------------
// 4. CLIENTES REDIS (SAFE REDIS + PUBSUB PARA CLUSTER DIGITALOCEAN)
// -----------------------------------------------------------------------------
const REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const redisClient = createClient({ url: REDIS_URL });
const pubClient = createClient({ url: REDIS_URL });
const subClient = pubClient.duplicate();

redisClient.on('error', (err) => console.error('❌ [REDIS MAIN] Erro:', err));
pubClient.on('error', (err) => console.error('❌ [REDIS PUB] Erro:', err));
subClient.on('error', (err) => console.error('❌ [REDIS SUB] Erro:', err));

export const safeRedis = {
  async get(key: string): Promise<string | null> {
    if (!redisClient.isOpen) return null;
    try { return await redisClient.get(key); }
    catch (e) { console.error(`⚠️ [REDIS GET ERR] Key: ${key}`, e); return null; }
  },
  async set(key: string, val: string, options?: any): Promise<string | null> {
    if (!redisClient.isOpen) return null;
    try { return await redisClient.set(key, val, options); }
    catch (e) { console.error(`⚠️ [REDIS SET ERR] Key: ${key}`, e); return null; }
  },
  async del(key: string): Promise<number> {
    if (!redisClient.isOpen) return 0;
    try { return await redisClient.del(key); }
    catch (e) { console.error(`⚠️ [REDIS DEL ERR] Key: ${key}`, e); return 0; }
  },
  async geoAdd(key: string, data: { longitude: number; latitude: number; member: string }) {
    if (!redisClient.isOpen) return;
    try { await redisClient.geoAdd(key, data); }
    catch (e) { console.error(`⚠️ [REDIS GEOADD ERR] Key: ${key}`, e); }
  },
  async geoSearch(key: string, coord: { longitude: number; latitude: number }, options: { radius: number; unit: any }) {
    if (!redisClient.isOpen) return [];
    try { return await redisClient.geoSearch(key, coord, options); }
    catch (e) { console.error(`⚠️ [REDIS GEOSEARCH ERR] Key: ${key}`, e); return []; }
  },
  async zRem(key: string, member: string) {
    if (!redisClient.isOpen) return;
    try { await redisClient.zRem(key, member); }
    catch (e) { console.error(`⚠️ [REDIS ZREM ERR] Key: ${key}`, e); }
  }
};

// -----------------------------------------------------------------------------
// 5. SERVIDOR WEBSOCKET (SOCKET.IO)
// -----------------------------------------------------------------------------
const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'] },
  transports: ['polling', 'websocket'],
  pingTimeout: 30000,
  pingInterval: 10000,
});

// Vincula o Redis e o Adapter do Socket.IO para rodar em Cluster no DigitalOcean
Promise.all([
  redisClient.connect(),
  pubClient.connect(),
  subClient.connect()
]).then(() => {
  io.adapter(createAdapter(pubClient, subClient));
  console.log('📦 [REDIS] Conectado e operacional!');
  console.log('🔄 [SOCKET.IO] Redis Adapter ativo (Cluster Mode Ready 🚀)');
}).catch(err => {
  console.error('🚨 [REDIS] Falha ao conectar ao servidor Redis:', err);
});

export const getIo = () => {
  if (!io) throw new Error("Socket.io não foi inicializado!");
  return io;
};
// Notificações Push (Expo Push API)
async function sendPushNotification(messages: Array<{ to: string; title: string; body: string; data?: any }>) {
  if (!messages.length) return;
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(messages)
    });
  } catch (err: any) {
    console.error('⚠️ [PUSH] Falha ao disparar notificação:', err?.message || err);
  }
}

const disconnectTimers = new Map<string, NodeJS.Timeout>();

// Middleware de Autenticação JWT para Sockets
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Acesso negado. Token não fornecido.'));

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: string; role?: string; userType?: string };
    socket.data.user = decoded;
    socket.data.lastEvents = new Map<string, number[]>();
    next();
  } catch {
    return next(new Error('Token inválido ou expirado.'));
  }
});

// Helper de Rate Limit no Socket por Evento
function isSocketRateLimited(socket: Socket, eventName: string, windowMs = 1000, maxCalls = 5): boolean {
  if (!socket.data.lastEvents) socket.data.lastEvents = new Map<string, number[]>();
  
  const now = Date.now();
  const key = `${socket.id}:${eventName}`;
  const history: number[] = socket.data.lastEvents.get(key) || [];
  const validHistory = history.filter((timestamp: number) => now - timestamp < windowMs);

  if (validHistory.length >= maxCalls) return false;

  validHistory.push(now);
  socket.data.lastEvents.set(key, validHistory);

  if (socket.data.lastEvents.size > 20) {
    for (const [k, v] of socket.data.lastEvents.entries()) {
      if (v.every((t: number) => now - t >= windowMs)) socket.data.lastEvents.delete(k);
    }
  }
  return false;
}

// Helpers de validação
function isAuthorizedUser(socket: Socket, payloadUserId?: string): boolean {
  return !!payloadUserId && socket.data.user?.id === payloadUserId;
}

function isDriver(socket: Socket): boolean {
  const role = socket.data.user?.role || socket.data.user?.userType;
  return role === 'DRIVER';
}

function isPassenger(socket: Socket): boolean {
  const role = socket.data.user?.role || socket.data.user?.userType;
  return role === 'PASSENGER';
}

function isValidCoordinate(lat: number, lng: number): boolean {
  return typeof lat === 'number' && typeof lng === 'number' &&
         !isNaN(lat) && !isNaN(lng) &&
         lat >= -90 && lat <= 90 &&
         lng >= -180 && lng <= 180;
}

function isUuid(str?: string): boolean {
  if (!str || typeof str !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);
}

function handleSocketEvent(socket: Socket, eventName: string, handler: (data?: any) => Promise<void> | void) {
  socket.on(eventName, async (data?: any) => {
    try {
      await handler(data);
    } catch (error: any) {
      console.error(`❌ [SOCKET ERROR] [Event: ${eventName}] [User: ${socket.data.user?.id}]:`, error);
      socket.emit('error', { message: error?.message || 'Erro ao processar requisição em tempo real.' });
    }
  });
}

// -----------------------------------------------------------------------------
// 6. EVENTOS SOCKET.IO
// -----------------------------------------------------------------------------
io.on('connection', (socket) => {
  const userId = socket.data.user?.id;
  console.log(`[+] Cliente conectado: ${socket.id} (ID: ${userId})`);
  
  setupTicketSocketHandlers(io, socket);

  if (userId) {
    socket.join(userId);
    socket.join(`user_${userId}`);
    socket.join(`passenger_${userId}`);
  }

  handleSocketEvent(socket, 'passenger:rejoin_ride', async (data) => {
    const { rideId } = data || {};
    if (isUuid(rideId)) {
      socket.join(rideId);
      console.log(`📡 [PASSENGER REJOINED] User ${socket.data.user.id} entrou na sala ${rideId}`);
    }
  });

  // --- DESCONEXÃO (GRACE PERIOD MOTORISTA 15s E LIMPEZA DE MEMÓRIA) ---
  socket.on('disconnect', () => {
    console.log(`[-] Cliente desconectado: ${socket.id} (ID: ${socket.data.user?.id})`);

    if (socket.data.lastEvents) {
      socket.data.lastEvents.clear();
      socket.data.lastEvents = undefined;
    }

    const user = socket.data.user;
    if (user && (user.role === 'DRIVER' || user.userType === 'DRIVER')) {
      const driverId = user.id;
      
      if (disconnectTimers.has(driverId)) {
        clearTimeout(disconnectTimers.get(driverId));
      }
      
      const timer = setTimeout(async () => {
        await safeRedis.zRem('drivers_locations', driverId);
        
        const hasActiveRide = await safeRedis.get(`driver_active_ride:${driverId}`);
        if (!hasActiveRide) {
          await prisma.driver.update({ where: { id: driverId }, data: { isOnline: false } })
            .catch(e => console.warn(`⚠️ [DISCONNECT FAIL] Driver: ${driverId}`, e?.message));
        }
        disconnectTimers.delete(driverId);
      }, 15000);

      disconnectTimers.set(driverId, timer);
    }
  });

  handleSocketEvent(socket, 'driver:offline', async () => {
    if (isSocketRateLimited(socket, 'driver:offline')) return;
    if (!isDriver(socket)) return;

    const driverId = socket.data.user.id;
    socket.leave('available_drivers');

    await safeRedis.zRem('drivers_locations', driverId);
    await safeRedis.del(`driver_active_ride:${driverId}`);

    await prisma.driver.update({
      where: { id: driverId },
      data: { isOnline: false, isAvailable: false }
    });
  });

  // 🛠️ Ajuste no handler sos:triggered
handleSocketEvent(socket, 'sos:triggered', async (data) => {
  if (isSocketRateLimited(socket, 'sos:triggered', 5000, 2)) return;
  
  const { rideId, latitude, longitude, timestamp } = data || {};
  const userId = socket.data.user?.id;

  // Valida o rideId apenas se ele for enviado
  if (rideId && !isUuid(rideId)) {
    socket.emit('error', { message: 'ID de corrida inválido fornecido para o alerta SOS.' });
    return;
  }

  console.warn(`🚨 [SOS ALERTA] Usuário: ${userId} | Corrida: ${rideId || 'Sem corrida ativa'} | Coords: ${latitude}, ${longitude}`);

  io.to('admin_dashboard').emit('admin:sos_alert', {
    userId,
    rideId: rideId || null,
    latitude,
    longitude,
    timestamp: timestamp || new Date().toISOString()
  });
});
  handleSocketEvent(socket, 'driver:alert_inaccessible_location', (data) => {
    const { rideId, passengerId } = data || {};
    if (!rideId) return;

    console.log(`📢 [ALERTA] Motorista informou local inacessível. Corrida: ${rideId}, Passageiro: ${passengerId}`);
    
    io.to(rideId).to(`passenger_${passengerId}`).emit('ride:inaccessible_location', {
      title: 'Motorista com dificuldade de acesso ⚠️',
      message: 'O motorista está com dificuldades para chegar ao seu local exato. Por favor, verifique o chat ou tente se aproximar da via principal.'
    });
  });

  handleSocketEvent(socket, 'driver:online', async (data) => {
    if (isSocketRateLimited(socket, 'driver:online')) return;
    if (!isDriver(socket)) {
      socket.emit('error', { message: 'Acesso negado.' });
      return;
    }

    const driverId = socket.data.user.id;
    const { lat, lng } = data || {};

    socket.join(driverId);
    socket.join(`driver_${driverId}`);
    socket.join('available_drivers');

    const updatedDriver = await prisma.driver.update({
      where: { id: driverId },
      data: { 
        isOnline: true, 
        isAvailable: true,
        ...(isValidCoordinate(Number(lat), Number(lng)) ? { lastLat: Number(lat), lastLng: Number(lng) } : {})
      },
      select: { vehicleType: true, lastLat: true, lastLng: true }
    });

    const currentLat = Number(lat) || Number(updatedDriver.lastLat);
    const currentLng = Number(lng) || Number(updatedDriver.lastLng);

    if (isValidCoordinate(currentLat, currentLng)) {
      await safeRedis.geoAdd('drivers_locations', {
        longitude: currentLng,
        latitude: currentLat,
        member: driverId
      });
      console.log(`📍 [REDIS] Motorista ${driverId} adicionado ao Redis nas coords: ${currentLat}, ${currentLng}`);
    } else {
      console.warn(`⚠️ [REDIS] Motorista ${driverId} ficou online SEM coordenadas válidas.`);
    }

    const pendingRides = await prisma.ride.findMany({
      where: {
        status: 'SEARCHING',
        requestedVehicleType: updatedDriver.vehicleType
      },
      include: {
        passenger: { select: { fullName: true, phone: true, profilePicture: true, ratingAverage: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: 5
    });

    for (const pendingRide of pendingRides) {
      socket.emit('ride:new_request', {
        rideId: pendingRide.id,
        passengerId: pendingRide.passengerId,
        passengerName: pendingRide.passenger?.fullName || 'Passageiro',
        passengerPhone: pendingRide.passenger?.phone || null,
        passengerPhoto: pendingRide.passenger?.profilePicture || null,
        passengerRating: Number(pendingRide.passenger?.ratingAverage || 5.0),
        pickupLat: pendingRide.originLat,
        pickupLng: pendingRide.originLng,
        originAddress: pendingRide.originAddress,
        destinationLat: pendingRide.destinationLat,
        destinationLng: pendingRide.destinationLng,
        destinationAddress: pendingRide.destinationAddress,
        fareXOF: pendingRide.priceXof,
        vehicleType: pendingRide.requestedVehicleType,
        serviceType: pendingRide.serviceType,
        paymentMethod: pendingRide.paymentMethod || 'ORANGE_MONEY'
      });
    }
  });

  handleSocketEvent(socket, 'passenger:request_ride', async (rideData) => {
    console.log(`🔴 [LOG 2 - BACKEND] RECEBEU A SOLICITAÇÃO! Socket ID: ${socket.id}`, rideData);

    if (isSocketRateLimited(socket, 'passenger:request_ride', 5000, 2)) {
      console.warn('⚠️ Requisição bloqueada por Rate Limit.');
      return;
    }

    const passengerId = socket.data.user?.id;
    if (!passengerId || !isPassenger(socket)) {
      console.error(`❌ [LOG 2 - ERRO BACKEND] Não autorizado: Socket sem perfil de Passageiro válido. User:`, socket.data.user);
      socket.emit('error', { message: 'Ação não autorizada. Faça login novamente como passageiro.' });
      return;
    }

    const pLat = Number(rideData?.pickupLat);
    const pLng = Number(rideData?.pickupLng);
    const dLat = Number(rideData?.destinationLat);
    const dLng = Number(rideData?.destinationLng);

    if (!isValidCoordinate(pLat, pLng) || !isValidCoordinate(dLat, dLng)) {
      console.error('❌ Coordenadas inválidas recebidas:', { pLat, pLng, dLat, dLng });
      socket.emit('error', { message: 'Coordenadas de origem ou destino inválidas.' });
      return;
    }

    const estimatedPrice = rideData?.estimatedPrice ?? rideData?.priceXof;

    let rawStops = Array.isArray(rideData?.stops) ? rideData.stops : [];
    if (rawStops.length === 0 && rideData?.extraStopLat && rideData?.extraStopLng) {
      rawStops = [{
        address: rideData.extraStopAddress || '',
        lat: Number(rideData.extraStopLat),
        lng: Number(rideData.extraStopLng),
        status: 'PENDING'
      }];
    }

    let normalizedVehicleType = String(rideData.vehicleType || 'PARTICULAR').toUpperCase();
    if (normalizedVehicleType === 'MOTO_CAR') normalizedVehicleType = 'MOTO_CARRO';

    socket.emit('ride:payment_processing', { message: 'Iniciando retenção de fundos (Escrow)...' });

    try {
      const { pendingVerification, ride } = await createRideAndInitiateEscrow(passengerId, {
        originLat: pLat,
        originLng: pLng,
        destinationLat: dLat,
        destinationLng: dLng,
        originAddress: rideData.originAddress,
        destinationAddress: rideData.destinationAddress,
        requestedVehicleType: normalizedVehicleType,
        serviceType: rideData.serviceType || 'RIDE',
        estimatedPrice: estimatedPrice ? Number(estimatedPrice) : undefined,
        stops: rawStops
      });
      
      const isTestMode = process.env.NODE_ENV !== 'production' || process.env.TEST_MODE === 'true';

      if (pendingVerification && !isTestMode) {
        socket.emit('ride:payment_pending', { 
          message: 'Aguardando operadora (+245) confirmar o saldo...' 
        });
        return;
      }

      const rideId = ride.id;
      socket.join(rideId);

      await safeRedis.set(`active_ride:${rideId}`, JSON.stringify({
        rideId, passengerId, pickupLat: pLat, pickupLng: pLng,
        fareXOF: ride.priceXof, status: 'PENDING',
      }));

      const nearbyDriverIds: string[] = (await safeRedis.geoSearch(
        'drivers_locations', 
        { longitude: pLng, latitude: pLat }, 
        { radius: 50, unit: 'km' }
      )) as string[];

      console.log('📍 Driver IDs encontrados no Redis:', nearbyDriverIds);

      if (!nearbyDriverIds || nearbyDriverIds.length === 0) {
        console.log('⚠️ Nenhum motorista no Redis drivers_locations dentro de 50km');
        socket.emit('ride:no_drivers_found');
        socket.emit('error', { message: `Nenhum motorista disponível próximo de si.` });
        await cancelRideLogic(rideId, passengerId, 'PASSENGER', 'Sem motoristas no raio');
        return;
      }

      const matchingDrivers = await prisma.driver.findMany({
        where: { 
          id: { in: nearbyDriverIds }, 
          vehicleType: normalizedVehicleType as any,
          isOnline: true, 
          isAvailable: true, 
          status: 'APPROVED'
        },
        select: { id: true, deviceToken: true }
      });

      console.log('🚗 Motoristas elegíveis encontrados no Banco:', matchingDrivers.map(d => d.id));

      if (matchingDrivers.length === 0) {
        socket.emit('ride:no_drivers_found');
        socket.emit('error', { message: `Motoristas na categoria ${normalizedVehicleType} estão offline ou ocupados.` });
        await cancelRideLogic(rideId, passengerId, 'PASSENGER', 'Categoria ocupada');
        return;
      }

      const passengerInfo = await prisma.passenger.findUnique({
        where: { id: passengerId },
        select: { fullName: true, phone: true, profilePicture: true, ratingAverage: true }
      });

      const requestPayload = {
        rideId, 
        passengerId: ride.passengerId,
        passengerName: passengerInfo?.fullName || 'Passageiro',
        passengerPhone: passengerInfo?.phone || null,
        passengerPhoto: passengerInfo?.profilePicture || null,
        passengerRating: Number(passengerInfo?.ratingAverage || 5.0),
        pickupLat: ride.originLat, 
        pickupLng: ride.originLng, 
        originAddress: rideData.originAddress, 
        destinationLat: ride.destinationLat,
        destinationLng: ride.destinationLng, 
        destinationAddress: rideData.destinationAddress,
        stops: ride.stops || rawStops,
        referencePoint: rideData.referencePoint || null,
        fareXOF: ride.priceXof, 
        vehicleType: normalizedVehicleType,
        serviceType: ride.serviceType, 
        paymentMethod: ride.paymentMethod || 'ORANGE_MONEY'
      };

      matchingDrivers.forEach(d => io.to(d.id).emit('ride:new_request', requestPayload));

      console.log(`✅ Evento ride:new_request enviado para ${matchingDrivers.length} motorista(s).`);

      for (const d of matchingDrivers) {
        if (d.deviceToken) {
          sendPushNotification([{
            to: d.deviceToken,
            title: `🚕 Nova Corrida (Valor: ${ride.priceXof} XOF)`,
            body: `Passageiro: ${passengerInfo?.fullName || 'Passageiro'} está próximo de você!`,
            data: { rideId }
          }]);
        }
      }
    } catch (err: any) {
      console.error('❌ Erro na solicitação da corrida:', err);
      socket.emit('error', { message: 'Erro ao processar sua corrida e carteira digital.' });
    }
  });

  // --- MOTORISTA ACEITA CORRIDA (COM LOCK ATÔMICO) ---
  handleSocketEvent(socket, 'driver:accept_ride', async (data) => {
    if (isSocketRateLimited(socket, 'driver:accept_ride', 2000, 1)) return;
    if (!isDriver(socket)) {
      socket.emit('error', { message: 'Apenas motoristas.' });
      return;
    }

    const driverId = socket.data.user.id;
    const { rideId, driverLat, driverLng } = data || {};

    if (!isUuid(rideId)) {
      socket.emit('error', { message: 'ID de corrida inválido.' });
      return;
    }

    const lockKey = `lock:accept_ride:${rideId}`;
    const acquiredLock = await safeRedis.set(lockKey, driverId, { NX: true, EX: 5 });

    if (!acquiredLock && redisClient.isOpen) {
      socket.emit('error', { message: 'Corrida já foi aceita por outro colega!' });
      return;
    }

    try {
      const updatedRide = await acceptRideLogic(rideId, driverId);

      await safeRedis.set(`driver_active_ride:${driverId}`, rideId);
      
      socket.join(rideId);
      socket.leave('available_drivers');

      const publicDriverPayload = {
        rideId, 
        driverId, 
        driverLat, 
        driverLng,
        driverName: updatedRide.driver?.fullName,
        driverPhoto: updatedRide.driver?.profilePicture,
        carModel: updatedRide.driver?.vehicleBrand,
        carColor: updatedRide.driver?.vehicleColor,
        licensePlate: updatedRide.driver?.vehiclePlate,
        driverRating: Number(updatedRide.driver?.ratingAverage || 5.0)
      };

      // 🛡️ Emite para a sala pública da corrida (sem o OTP, para que o motorista não veja o PIN)
      socket.to(rideId).emit('ride:accepted', publicDriverPayload);

      // 🛡️ Emite diretamente para a sala privada do passageiro (com o OTP de validação de embarque)
      io.to(`passenger_${updatedRide.passengerId}`).emit('ride:accepted', {
        ...publicDriverPayload,
        startOtp: updatedRide.startOtp
      });

      io.to('admin_dashboard').emit('admin:ride_update', { 
        rideId, status: 'ACCEPTED', driverId, passengerId: updatedRide.passengerId 
      });

    } catch (err: any) {
      console.error('❌ Erro ao aceitar corrida:', err);
      socket.emit('error', { message: err.message || 'Erro ao atribuir corrida.' });
    } finally {
      const lockHolder = await safeRedis.get(lockKey);
      if (lockHolder === driverId) await safeRedis.del(lockKey);
    }
  });

  // --- ATUALIZAÇÃO DE LOCALIZAÇÃO DO MOTORISTA ---
  handleSocketEvent(socket, 'driver:location_update', async (coords) => {
    if (isSocketRateLimited(socket, 'driver:location_update', 1000, 1)) return; 
    if (!isDriver(socket)) return;

    const { rideId, latitude, longitude, speed, heading, durationMinutes } = coords || {};
    const driverId = socket.data.user?.id;

    if (!isValidCoordinate(Number(latitude), Number(longitude))) return;

    const safeSpeed = speed != null ? Number(speed) : null;
    const safeHeading = heading != null ? Number(heading) : 0;
    const safeDuration = durationMinutes != null ? Number(durationMinutes) : null;

    await safeRedis.geoAdd('drivers_locations', { longitude: Number(longitude), latitude: Number(latitude), member: driverId });

    if (rideId && isUuid(rideId)) {
      // 🛡️ Atualiza o mapa do passageiro em tempo real
      io.to(rideId).emit('driver:position', { 
        latitude: Number(latitude), 
        longitude: Number(longitude), 
        heading: safeHeading, 
        durationMinutes: safeDuration 
      });
    }
    
    io.to('admin_dashboard').emit('admin:map_update', { 
      driverId, 
      latitude: Number(latitude), 
      longitude: Number(longitude), 
      status: rideId ? 'ON_RIDE' : 'AVAILABLE' 
    });

    const dbKey = `last_db_sync:${driverId}`;
    const lastSync = await safeRedis.get(dbKey);
    const now = Date.now();

    if (!lastSync || now - Number(lastSync) > 10000) {
      await safeRedis.set(dbKey, String(now), { EX: 15 });

      prisma.driver.update({
        where: { id: driverId },
        data: { lastLat: latitude, lastLng: longitude, lastLocationUpdate: new Date() }
      }).catch(() => null);

      if (rideId && isUuid(rideId) && safeSpeed !== null && !isNaN(safeSpeed)) {
        prisma.rideLocationHistory.create({
          data: { rideId, lat: latitude, lng: longitude, speed: safeSpeed }
        }).catch(() => null);
      }
    }
  });

  // --- DASHBOARD ADMIN ---
  handleSocketEvent(socket, 'admin:join_dashboard', () => {
    const role = socket.data.user?.role;
    if (role && ['SUPER_ADMIN', 'OPERATOR', 'FINANCE'].includes(role)) {
      socket.join('admin_dashboard');
    } else {
      socket.emit('error', { message: 'Acesso negado.' });
    }
  });

  // --- MOTORISTA CHEGOU AO LOCAL ---
  handleSocketEvent(socket, 'driver:arrived', async (data) => { 
    if (isSocketRateLimited(socket, 'driver:arrived')) return;
    if (!isDriver(socket)) {
      socket.emit('error', { message: 'Apenas motoristas.' });
      return;
    }

    const { rideId } = data || {};
    const driverId = socket.data.user.id;
    if (!isUuid(rideId)) {
      socket.emit('error', { message: 'ID de corrida inválido.' });
      return;
    }

    const ride = await driverArrivedLogic(rideId, driverId);
    io.to(rideId).emit('ride:driver_arrived', { rideId });

    if (ride?.passenger?.deviceToken) {
      sendPushNotification([{
        to: ride.passenger.deviceToken,
        title: '📍 Motorista Chegou!',
        body: 'Seu motorista está no local aguardando você.',
        data: { rideId }
      }]);
    }
  });

  // --- INICIAR CORRIDA (VALIDAÇÃO DE OTP) ---
  handleSocketEvent(socket, 'driver:start_ride', async (data) => {
    if (isSocketRateLimited(socket, 'driver:start_ride')) return;
    if (!isDriver(socket)) {
      socket.emit('error', { message: 'Acesso negado.' });
      return;
    }

    const { rideId, otp } = data || {};
    const driverId = socket.data.user.id;

    if (!isUuid(rideId) || !otp) {
      socket.emit('error', { message: 'Código OTP obrigatório.' });
      return;
    }

    try {
      const updatedRide = await startRideLogic(rideId, driverId, otp);
      io.to(rideId).emit('ride:started', { rideId, status: 'IN_PROGRESS', startedAt: updatedRide?.startedAt });
      io.to('admin_dashboard').emit('admin:ride_update', { rideId, status: 'IN_PROGRESS', driverId });
    } catch (err: any) {
      socket.emit('error', { message: err.message || 'Falha ao validar OTP.' });
    }
  });
  
  // --- FINALIZAR CORRIDA E COBRANÇA ---
  handleSocketEvent(socket, 'driver:finish_ride', async (data) => {
    if (isSocketRateLimited(socket, 'driver:finish_ride')) return;
    if (!isDriver(socket)) {
      socket.emit('error', { message: 'Acesso negado.' });
      return;
    }

    const { rideId, dropoffLat, dropoffLng } = data || {};
    if (!isUuid(rideId) || !isValidCoordinate(Number(dropoffLat), Number(dropoffLng))) {
      socket.emit('error', { message: 'Coordenadas de destino inválidas.' });
      return;
    }

    try {
      const result = await finalizeRideAndCharge(rideId, Number(dropoffLat), Number(dropoffLng));

      await safeRedis.del(`active_ride:${rideId}`);
      await safeRedis.del(`driver_active_ride:${socket.data.user.id}`);

      io.to(rideId).emit('ride:finished', result);
      io.to('admin_dashboard').emit('admin:ride_update', { rideId, status: 'FINISHED' });
    } catch (err: any) {
      console.error(`🚨 Erro financeiro ao finalizar corrida ${rideId}:`, err);
      socket.emit('error', { message: err.message || 'Erro ao cobrar passagem no Mobile Money.' });
    }
  });
  
  // --- CHAT DA CORRIDA ---
  handleSocketEvent(socket, 'chat:send_message', async (data) => {
    if (isSocketRateLimited(socket, 'chat:send_message', 2000, 5)) return;
    const { rideId, text } = data || {};

    if (isUuid(rideId) && socket.rooms.has(rideId) && typeof text === 'string') {
      const sanitizedText = text.trim().slice(0, 500);
      if (!sanitizedText) return;

      const user = socket.data.user;
      const senderRole = String(user?.role || user?.userType).toLowerCase().includes('driver') ? 'driver' : 'passenger';
      const senderTypeDb = senderRole === 'driver' ? 'DRIVER' : 'PASSENGER'; 

      try {
        const savedMessage = await prisma.rideChatMessage.create({
          data: { rideId, senderId: user.id, senderType: senderTypeDb, message: sanitizedText }
        });

        const messagePayload = {
          id: savedMessage.id, 
          sender: senderRole, 
          text: sanitizedText,
          senderPhoto: user?.profilePicture || null, 
          createdAt: savedMessage.createdAt.toISOString(),
        };

        socket.to(rideId).emit('chat:receive_message', messagePayload);
        io.to('admin_dashboard').emit('admin:chat_monitor', { rideId, message: messagePayload });
      } catch (err) { 
        console.warn('Falha no chat:', err); 
      }
    }
  });

  // --- CANCELAMENTO DE CORRIDA ---
  handleSocketEvent(socket, 'ride:cancel', async (data) => {
    if (isSocketRateLimited(socket, 'ride:cancel')) return;
    const { rideId, userId, userType, reason } = data || {};

    if (!isUuid(rideId) || !isAuthorizedUser(socket, userId)) {
      socket.emit('error', { message: 'Ação não autorizada.' });
      return;
    }

    try {
      const rideToCancel = await prisma.ride.findUnique({ where: { id: rideId } });
      const previousStatus = rideToCancel?.status;
      
      const result = await cancelRideLogic(rideId, userId, userType as 'PASSENGER'|'DRIVER', reason);

      await safeRedis.del(`active_ride:${rideId}`);      
      if (rideToCancel?.driverId) await safeRedis.del(`driver_active_ride:${rideToCancel.driverId}`);

      io.to(rideId).emit('ride:cancelled', {
        rideId, 
        cancelledBy: userType, 
        reason,
        appliedPenalty: result?.appliedPenalty || false,
        penaltyAmount: result?.penaltyAmount || 0
      });

      if (previousStatus === 'SEARCHING') {
        io.to('available_drivers').emit('ride:cancelled_by_passenger', { rideId });
      }
      
      io.to('admin_dashboard').emit('admin:ride_update', { 
        rideId, status: 'CANCELLED', cancelledBy: userType, reason 
      });
      
      const socketsInRoom = await io.in(rideId).fetchSockets();
      socketsInRoom.forEach(s => {
        s.leave(rideId);
        if (rideToCancel?.driverId && s.data.user?.id === rideToCancel.driverId) {
          s.join('available_drivers'); 
        }
      });
    } catch (err: any) {
      socket.emit('error', { message: err.message || 'Erro ao cancelar corrida.' });
    }
  });

  // --- AVALIAÇÃO DE CORRIDA ---
  handleSocketEvent(socket, 'ride:rate', async (data) => {
    if (isSocketRateLimited(socket, 'ride:rate')) return;
    const { rideId, receiverId, stars, tags, comment, reviewerType } = data || {};
    
    if (!isUuid(rideId) || !receiverId || !stars) {
      socket.emit('error', { message: 'Dados de avaliação inválidos.' });
      return;
    }

    try {
      const finalReviewerType = reviewerType || (socket.data.user.role === 'DRIVER' ? 'DRIVER' : 'PASSENGER');
      const newRating = await submitRatingLogic({
        rideId, 
        reviewerId: socket.data.user.id, 
        reviewerType: finalReviewerType,
        receiverId, 
        stars: Number(stars), 
        tags: tags || [], 
        comment
      });

      socket.emit('ride:rated_success', { message: 'Avaliação registrada!' });
      io.to('admin_dashboard').emit('admin:new_rating', newRating);
    } catch (error) {
      socket.emit('error', { message: 'Falha ao processar a avaliação.' });
    }
  });
});

// -----------------------------------------------------------------------------
// 7. ENCERRAMENTO GRACIOSO DO SERVIDOR (SHUTDOWN)
// -----------------------------------------------------------------------------
const shutdown = async () => {
  console.log('\n🛑 [SISTEMA BAI245] Iniciando shutdown seguro...');
  
  server.close(async () => {
    try {
      if (redisClient.isOpen) {
        await redisClient.quit();
        console.log('📦 [REDIS] Conexão encerrada com segurança.');
      }
      await prisma.$disconnect();
      console.log('🗄️ [PRISMA] Pool do Banco de Dados liberado.');
      console.log('✅ Sistema desligado.');
      process.exit(0);
    } catch (err) {
      console.error('❌ Erro severo durante shutdown:', err);
      process.exit(1);
    }
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

process.on('uncaughtException', (err) => {
  console.error('💥 [ALERTA CRÍTICO] EXCEÇÃO NÃO TRATADA:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('💥 [ALERTA CRÍTICO] PROMISE REJEITADA:', reason);
});

// -----------------------------------------------------------------------------
// 8. BOOT DO SERVIDOR
// -----------------------------------------------------------------------------
const PORT = process.env.PORT || 3333;

export { app, server }; 

if (process.env.NODE_ENV !== 'test') {
  server.listen(Number(PORT), '0.0.0.0', () => {
    console.log('\n======================================================');
    console.log(`🛡️  API bai245 [CORE] OPERACIONAL EM GUINÉ-BISSAU`);
    console.log(`💳 Gateways de Pagamento: Orange Money & MTN (+245)`);
    console.log(`📡 Infraestrutura Sockets rodando em 0.0.0.0:${PORT}`);
    console.log(`🔐 Modo Criptografia e Escrow Ativos`);
    console.log('======================================================\n');
  }); 
}