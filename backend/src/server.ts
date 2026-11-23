import { buildAndBroadcastSos } from './controllers/AdminSosController';
import fs from 'fs';
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
import { passengerRoutes } from './routes/passengerRoutes';
import { driverRoutes } from './routes/driverRoutes';
import { adminRoutes } from './routes/adminRoutes';
import webhookRoutes from './routes/webhookRoutes';
import rideRoutes from './routes/rideRoutes';
import b2bRoutes from './routes/b2bRoutes';
import { createAdapter } from '@socket.io/redis-adapter';
import { setupTicketSocketHandlers } from './sockets/ticketSocket';
import { sendPushNotification, PUSH_CHANNELS } from './services/pushNotifications';
import {
  getRouteDistanceAndDuration,
  isWithinGuineaBissau,
  calculateDistance,
  calculateRidePrice,
  acceptRideLogic,
  driverArrivedLogic,
  startRideLogic,
  finalizeRideAndCharge,
  cancelRideLogic,
  createRideAndInitiateEscrow,
  submitRatingLogic,
} from './services/rideService';
import { startCronJobs } from './jobs/reconciliationJob';
import { startOutboxWorker } from './services/outboxWorker';
import locationRoutes from './routes/location.routes';

declare global {
  namespace Express {
    interface Request {
      rawBody?: Buffer;
    }
  }
}

// -----------------------------------------------------------------------------
// HELPERS AUXILIARES DE SANITIZAÇÃO E VALIDAÇÃO GEOGRÁFICA
// -----------------------------------------------------------------------------
function sanitizeHtmlText(str?: string | null): string {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function isValidCoordinate(lat: number, lng: number): boolean {
  return typeof lat === 'number' && typeof lng === 'number' && !isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
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

// Inicia jobs de reconciliação financeira e consumidor do Transactional Outbox em segundo plano
startCronJobs();
startOutboxWorker();

const app = express();
const server = http.createServer(app);

// -----------------------------------------------------------------------------
// 2. MIDDLEWARES HTTP E SEGURANÇA
// -----------------------------------------------------------------------------
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));

const rawOrigins = process.env.ALLOWED_ORIGINS || '*';
const allowedOrigins = rawOrigins
  .replace(/["']/g, '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin) || origin === 'https://app.nobai245.com' || origin === 'https://admin.nobai245.com') {
      callback(null, true);
    } else {
      callback(null, false);
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true,
  optionsSuccessStatus: 200
}));

app.use(express.json({
  limit: '25mb',
  verify: (req: Request, _res: Response, buf: Buffer) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true }));

// 🛡️ MIDDLEWARE DE BLINDAGEM: Intercepta payloads URL-Encoded enviados com Content-Type JSON incorreto pelo SMS Gateway
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  if (err instanceof SyntaxError && (err as any).status === 400 && 'body' in err) {
    console.warn(`⚠️ [PARSER_WARNING] Payload malformatado em ${req.url}. Recuperando via rawBody...`);
    if (req.rawBody) {
      req.body = req.rawBody.toString('utf-8');
    }
    return next();
  }
  next(err);
});
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  if (err && (err.name === 'MulterError' || err.code === 'LIMIT_FILE_SIZE' || String(err.message || '').includes('Formato inválido'))) {
    const msg = err.code === 'LIMIT_FILE_SIZE'
      ? 'Uma das imagens enviadas é muito grande (máximo 10MB por foto).'
      : (err.message || 'Erro no envio dos arquivos.');
    return res.status(400).json({ success: false, error: msg });
  }
  next(err);
});

const staticUploadsMiddleware = express.static(path.join(process.cwd(), 'uploads'));
app.use('/uploads', (req, res, next) => {
  console.log(`📸 [FOTO_DEBUG] Acessando arquivo estático: /uploads${req.url}`);
  next();
}, staticUploadsMiddleware);
app.use('/api/uploads', (req, res, next) => {
  console.log(`📸 [FOTO_DEBUG] Acessando arquivo estático via /api: /api/uploads${req.url}`);
  next();
}, staticUploadsMiddleware);

let isShuttingDown = false;

function extractBearerUserId(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try {
    const decoded = jwt.decode(authHeader.slice(7)) as { id?: string } | null;
    return decoded && typeof decoded.id === 'string' && decoded.id.length > 0 ? decoded.id : null;
  } catch {
    return null;
  }
}

// 🛡️ CAMADA 1: Teto amplo por IP (compatível com CGNAT das operadoras Orange/MTN na Guiné-Bissau)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2500,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith('/webhooks') || req.path.startsWith('/payments') || req.path === '/health',
  message: { error: 'Tráfego elevado na rede. Tente novamente em instantes.' }
});

// 🛡️ CAMADA 2: Limite granular por userId autenticado (isola abusos por conta sem afetar outros usuários)
const userAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 450,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  skip: (req) => req.path.startsWith('/webhooks') || req.path.startsWith('/payments') || !extractBearerUserId(req),
  keyGenerator: (req) => `user:${extractBearerUserId(req)}`,
  message: { error: 'Muitas requisições nesta conta. Aguarde alguns instantes.' }
});

// 🛡️ CAMADA 3: Proteção contra força bruta e SMS bombing chaveada por telefone/e-mail (CGNAT-safe)
const authBruteForceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { keyGeneratorIpFallback: false },
  keyGenerator: (req) => {
    const rawPhone = typeof req.body?.phone === 'string' ? req.body.phone.replace(/\D/g, '') : '';
    const rawEmail = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const rawIdent = typeof req.body?.identifier === 'string' ? req.body.identifier.trim().toLowerCase() : '';
    const identifier = rawPhone || rawEmail || rawIdent;
    return identifier ? `auth:${identifier}` : `auth-ip:${req.ip || 'unknown'}`;
  },
  message: { error: 'Muitas tentativas para esta conta. Aguarde 15 minutos e tente novamente.' }
});

app.use('/api/admin/login', authBruteForceLimiter);
app.use('/api/admin/register', authBruteForceLimiter);
app.use('/api/drivers/login', authBruteForceLimiter);
app.use('/api/drivers/register', authBruteForceLimiter);
app.use('/api/drivers/forgot-password', authBruteForceLimiter);
app.use('/api/drivers/reset-password', authBruteForceLimiter);
app.use('/api/passengers/login', authBruteForceLimiter);
app.use('/api/passengers/register', authBruteForceLimiter);
app.use('/api/passengers/request-otp', authBruteForceLimiter);
app.use('/api/passengers/forgot-password', authBruteForceLimiter);
app.use('/api/passengers/verify-otp', authBruteForceLimiter);
app.use('/api/b2b/login', authBruteForceLimiter);

app.use('/api/', apiLimiter);
app.use('/api/', userAccountLimiter);

app.use((req, _res, next) => {
  console.log(`📡 [API_DEBUG] [${req.method}] ${req.url} | IP: ${req.ip}`);
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
app.use('/api/b2b', b2bRoutes);
app.use('/api', locationRoutes);

const deepHealthHandler = async (_req: Request, res: Response) => {
  if (isShuttingDown) {
    return res.status(503).json({
      status: 'shutting_down',
      timestamp: new Date().toISOString(),
    });
  }

  const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('HEALTHCHECK_TIMEOUT')), ms);
      promise
        .then((val) => { clearTimeout(timer); resolve(val); })
        .catch((err) => { clearTimeout(timer); reject(err); });
    });

  let dbOk = false;
  let dbLatencyMs = -1;
  const dbStart = Date.now();
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, 2500);
    dbOk = true;
    dbLatencyMs = Date.now() - dbStart;
  } catch {
    dbOk = false;
    dbLatencyMs = Date.now() - dbStart;
  }

  let redisOk = false;
  let redisLatencyMs = -1;
  const redisStart = Date.now();
  try {
    if (redisClient?.isOpen) {
      const pong = await withTimeout(redisClient.ping(), 1500);
      redisOk = pong === 'PONG';
    }
    redisLatencyMs = Date.now() - redisStart;
  } catch {
    redisOk = false;
    redisLatencyMs = Date.now() - redisStart;
  }

  const httpStatus = dbOk ? 200 : 503;
  return res.status(httpStatus).json({
    status: !dbOk ? 'degraded' : redisOk ? 'online' : 'degraded_cache',
    uptimeSec: Math.round(process.uptime()),
    country: 'Guiné-Bissau 🇬🇼',
    currency: 'XOF',
    checks: {
      database: { status: dbOk ? 'up' : 'down', latencyMs: dbLatencyMs },
      redis: { status: redisOk ? 'up' : 'degraded', latencyMs: redisLatencyMs },
    },
    timestamp: new Date().toISOString(),
  });
};

app.get('/health', deepHealthHandler);
app.get('/api/health', deepHealthHandler);

// -----------------------------------------------------------------------------
// 4. CLIENTES REDIS (SAFE REDIS + PUBSUB PARA CLUSTER)
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
  async geoSearch(key: string, coord: { longitude: number; latitude: number }, options: { radius: number; unit: 'm' | 'km' | 'mi' | 'ft' }): Promise<string[]> {
    if (!redisClient.isOpen) return [];
    try { return (await redisClient.geoSearch(key, coord, options)) as string[]; }
    catch (e) { console.error(`⚠️ [REDIS GEOSEARCH ERR] Key: ${key}`, e); return []; }
  },
  async geoPos(key: string, member: string) {
    if (!redisClient.isOpen) return null;
    try { return await redisClient.geoPos(key, member); }
    catch (e) { console.error(`⚠️ [REDIS GEOPOS ERR] Key: ${key}, Member: ${member}`, e); return null; }
  },
  async zRem(key: string, member: string) {
    if (!redisClient.isOpen) return;
    try { await redisClient.zRem(key, member); }
    catch (e) { console.error(`⚠️ [REDIS ZREM ERR] Key: ${key}`, e); return; }
  }
};

app.get('/api/passengers/drivers/nearby', async (req: Request, res: Response) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);

    console.log(`📡 [API_DEBUG] Busca de motoristas próximos em Lat: ${lat}, Lng: ${lng}`);

    if (!isValidCoordinate(lat, lng)) {
      return res.status(400).json({ error: 'Coordenadas geográficas inválidas' });
    }

    const nearbyDriverIds = await safeRedis.geoSearch(
      'drivers:locations',
      { longitude: lng, latitude: lat },
      { radius: 5, unit: 'km' }
    );

    if (!nearbyDriverIds || nearbyDriverIds.length === 0) {
      return res.json({ drivers: [] });
    }

    const dbDrivers = await prisma.driver.findMany({
      where: {
        id: { in: nearbyDriverIds },
        status: 'APPROVED',
        isOnline: true,
        isAvailable: true,
        deletedAt: null,
      },
      select: {
        id: true,
        vehicleType: true,
        vehicleColor: true,
        currentHeading: true,
      },
    });
    const driverMetaMap = new Map(dbDrivers.map((d) => [d.id, d]));

    const drivers = await Promise.all(
      nearbyDriverIds.map(async (driverId) => {
        const meta = driverMetaMap.get(driverId);
        if (!meta) return null;

        const pos = await safeRedis.geoPos('drivers:locations', driverId);
        if (pos && pos[0]) {
          const resolvedColor = meta.vehicleColor || (meta.vehicleType === 'TAXI' ? 'Amarelo' : 'Branco');
          return {
            id: driverId,
            lng: Number(pos[0].longitude),
            lat: Number(pos[0].latitude),
            heading: Number(meta.currentHeading || 0),
            vehicleType: meta.vehicleType || 'PARTICULAR',
            carColor: resolvedColor,
            vehicleColor: resolvedColor,
          };
        }
        return null;
      })
    );

    return res.json({ drivers: drivers.filter(Boolean) });

  } catch (error) {
    console.error('❌ Erro ao buscar motoristas próximos:', error);
    return res.status(500).json({ error: 'Erro interno ao buscar motoristas' });
  }
});

// =============================================================================
// 🌐 API JSON DE DADOS EM TEMPO REAL DO RASTREAMENTO
// =============================================================================
function computeHaversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

app.get('/track/:rideId/data', async (req: Request, res: Response) => {
  try {
    const rideId = String(req.params.rideId);
    if (!rideId || rideId.length < 5) {
      return res.status(400).json({ error: 'Identificador de corrida inválido' });
    }

    const ride = await prisma.ride.findUnique({
      where: { id: rideId },
      include: { driver: true },
    });

    if (!ride) return res.status(404).json({ error: 'Corrida não encontrada' });

    let driverLat = Number(ride.driver?.lastLat || ride.originLat || 11.8633);
    let driverLng = Number(ride.driver?.lastLng || ride.originLng || -15.5833);

    if (ride.driverId) {
      try {
        const redisPos = await safeRedis.geoPos('drivers:locations', ride.driverId);
        if (redisPos && redisPos[0]) {
          driverLng = Number(redisPos[0].longitude);
          driverLat = Number(redisPos[0].latitude);
        }
      } catch {}
    }

    const originLat = Number(ride.originLat || driverLat);
    const originLng = Number(ride.originLng || driverLng);
    const destinationLat = Number(ride.destinationLat || driverLat);
    const destinationLng = Number(ride.destinationLng || driverLng);

    const isHeadingToPickup = ['ACCEPTED', 'ARRIVED'].includes(ride.status);
    const targetLat = isHeadingToPickup ? originLat : destinationLat;
    const targetLng = isHeadingToPickup ? originLng : destinationLng;
    const straightKm = computeHaversineKm(driverLat, driverLng, targetLat, targetLng);
    const roadKm = Number((straightKm * 1.25).toFixed(1));
    const etaMinutes = Math.max(1, Math.round((roadKm / 28) * 60));

    return res.json({
      rideId: ride.id,
      status: ride.status || 'IN_PROGRESS',
      driverLat,
      driverLng,
      heading: Number(ride.driver?.currentHeading || 0),
      vehicleType: ride.driver?.vehicleType || 'PARTICULAR',
      vehicleColor: ride.driver?.vehicleColor || 'Amarelo',
      originLat,
      originLng,
      destinationLat,
      destinationLng,
      distanceKm: roadKm,
      etaMinutes,
    });
  } catch (error) {
    console.error('❌ Erro na API de dados de rastreamento:', error);
    return res.status(500).json({ error: 'Erro ao buscar dados do rastreamento' });
  }
});

// =============================================================================
// 🌐 ROTA PÚBLICA DE RASTREAMENTO WEB DA VIAGEM (TEMPO REAL + FALLBACK MAPA)
// =============================================================================
app.get('/track/:rideId', async (req: Request, res: Response) => {
  try {
    const rideId = String(req.params.rideId);

    const ride = await prisma.ride.findUnique({
      where: { id: rideId },
      include: {
        driver: true,
        passenger: true,
      },
    });

    if (!ride) {
      return res.status(404).send(`
        <!DOCTYPE html>
        <html lang="pt">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Viagem Não Encontrada - Nô Bai 245</title>
          <style>
            body { background: #0F172A; color: white; font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; text-align: center; padding: 20px; }
            .card { background: #1E293B; padding: 30px; border-radius: 20px; border: 1px solid #334155; max-width: 400px; }
            h2 { color: #EAB308; margin-bottom: 8px; }
            p { color: #94A3B8; line-height: 1.5; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>⚠️ Viagem não encontrada</h2>
            <p>Esta corrida não existe ou o link de acompanhamento expirou.</p>
          </div>
        </body>
        </html>
      `);
    }

    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self' https: data: blob: 'unsafe-inline' 'unsafe-eval'; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://api.mapbox.com https://unpkg.com https://cdn.socket.io; " +
      "worker-src 'self' blob:; " +
      "child-src 'self' blob:; " +
      "style-src 'self' 'unsafe-inline' https://api.mapbox.com https://unpkg.com; " +
      "connect-src 'self' wss: ws: https: http:; " +
      "img-src 'self' blob: data: https: http:;"
    );

    let driverLat = Number(ride.driver?.lastLat || ride.originLat || 11.8633);
    let driverLng = Number(ride.driver?.lastLng || ride.originLng || -15.5833);
    if (ride.driverId) {
      try {
        const redisPos = await safeRedis.geoPos('drivers:locations', ride.driverId);
        if (redisPos && redisPos[0]) {
          driverLng = Number(redisPos[0].longitude);
          driverLat = Number(redisPos[0].latitude);
        }
      } catch {}
    }

    const originLat = Number(ride.originLat || driverLat);
    const originLng = Number(ride.originLng || driverLng);
    const destLat = Number(ride.destinationLat || driverLat);
    const destLng = Number(ride.destinationLng || driverLng);
    const initialHeading = Number(ride.driver?.currentHeading || 0);

    const isHeadingToPickup = ['ACCEPTED', 'ARRIVED'].includes(ride.status);
    const initialKm = Number((computeHaversineKm(driverLat, driverLng, isHeadingToPickup ? originLat : destLat, isHeadingToPickup ? originLng : destLng) * 1.25).toFixed(1));
    const initialEta = Math.max(1, Math.round((initialKm / 28) * 60));

    const driverName = sanitizeHtmlText(ride.driver?.fullName || 'Motorista Nô Bai');
    const driverPhoto = sanitizeHtmlText(ride.driver?.profilePicture || '');
    const carModel = sanitizeHtmlText(ride.driver?.vehicleBrand || 'Veículo');
    const carColor = sanitizeHtmlText(ride.driver?.vehicleColor || 'Amarelo');
    const vehicleType = sanitizeHtmlText(ride.driver?.vehicleType || 'PARTICULAR');
    const licensePlate = sanitizeHtmlText(ride.driver?.vehiclePlate || 'N/A');
    const originAddress = sanitizeHtmlText(ride.originAddress || 'Ponto de embarque');
    const destinationAddress = sanitizeHtmlText(ride.destinationAddress || 'Endereço de destino');

    const mapboxToken =
      process.env.EXPO_PUBLIC_MAPBOX_TOKEN ||
      process.env.MAPBOX_ACCESS_TOKEN ||
      'pk.eyJ1IjoibWFtYWR1Y2FuZGUiLCJhIjoiY211ZGpkMnVtMDMzdDJ4c2U0NHd3dHBtZiJ9.mT0BfmoFsPTgWFzNnblCZg';

    res.send(`
      <!DOCTYPE html>
      <html lang="pt">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <title>Acompanhamento ao Vivo - Nô Bai 245</title>
        <link href="https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl.css" rel="stylesheet" />
        <script src="https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl.js"></script>
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <script src="/socket.io/socket.io.js"></script>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          html, body { height: 100%; width: 100%; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0F172A; color: #FFFFFF; }
          body { display: flex; flex-direction: column; }
          #mapWrap { position: relative; flex: 1; width: 100%; min-height: 45%; background: #1E293B; }
          #map, #leafletMap { position: absolute; inset: 0; width: 100%; height: 100%; }
          #leafletMap { display: none; z-index: 2; }

          .live-pill {
            position: absolute; top: 14px; left: 14px; z-index: 20;
            background: rgba(15, 23, 42, 0.92); backdrop-filter: blur(8px);
            border: 1px solid rgba(234, 179, 8, 0.45);
            border-radius: 999px; padding: 7px 14px;
            display: flex; align-items: center; gap: 8px;
            font-size: 12px; font-weight: 700; color: #F8FAFC;
            box-shadow: 0 6px 20px rgba(0,0,0,0.35);
          }
          .live-dot { width: 9px; height: 9px; border-radius: 50%; background: #22C55E; box-shadow: 0 0 0 4px rgba(34,197,94,0.25); animation: pulse 1.6s infinite; }
          @keyframes pulse { 0% { transform: scale(0.95); opacity: 1; } 70% { transform: scale(1.2); opacity: 0.6; } 100% { transform: scale(0.95); opacity: 1; } }

          .recenter-btn {
            position: absolute; right: 14px; bottom: 16px; z-index: 20;
            background: #0F172A; color: #EAB308; border: 1px solid #334155;
            border-radius: 12px; padding: 10px 14px; font-size: 12px; font-weight: 800;
            cursor: pointer; box-shadow: 0 6px 18px rgba(0,0,0,0.4);
          }

          .info-card {
            background: linear-gradient(180deg, #1E293B 0%, #0F172A 100%);
            padding: 18px 20px 22px; border-top-left-radius: 24px; border-top-right-radius: 24px;
            border-top: 1px solid #334155; z-index: 25; box-shadow: 0 -10px 30px rgba(0,0,0,0.55);
          }
          .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
          .title { font-size: 18px; font-weight: 900; color: #EAB308; display: flex; align-items: center; gap: 8px; letter-spacing: 0.3px; }
          .badge { background: rgba(16, 185, 129, 0.14); color: #34D399; font-weight: 800; font-size: 11px; padding: 5px 11px; border-radius: 999px; border: 1px solid rgba(16, 185, 129, 0.4); letter-spacing: 0.4px; }
          .badge.cancelled { background: rgba(239, 68, 68, 0.14); color: #F87171; border-color: rgba(239, 68, 68, 0.4); }
          .badge.completed { background: rgba(59, 130, 246, 0.14); color: #60A5FA; border-color: rgba(59, 130, 246, 0.4); }

          .metrics-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; background: rgba(15, 23, 42, 0.85); padding: 11px; border-radius: 14px; margin-bottom: 14px; border: 1px solid #334155; }
          .metric-box { text-align: center; }
          .metric-label { font-size: 10px; color: #94A3B8; text-transform: uppercase; font-weight: 700; letter-spacing: 0.5px; margin-bottom: 3px; }
          .metric-value { font-size: 17px; font-weight: 900; color: #F8FAFC; }

          .driver-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; background: rgba(30, 41, 59, 0.65); border: 1px solid #334155; border-radius: 14px; padding: 10px 12px; margin-bottom: 12px; }
          .driver-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
          .driver-avatar { width: 42px; height: 42px; border-radius: 50%; object-fit: cover; border: 2px solid #EAB308; background: #0F172A; display: flex; align-items: center; justify-content: center; font-weight: 800; color: #EAB308; flex-shrink: 0; }
          .driver-name { font-size: 14px; font-weight: 800; color: #F8FAFC; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .driver-car { font-size: 12px; color: #94A3B8; }
          .plate-pill { background: #EAB308; color: #0F172A; font-family: monospace; font-weight: 900; font-size: 12px; padding: 4px 9px; border-radius: 8px; letter-spacing: 0.6px; flex-shrink: 0; }

          .route-box { display: flex; flex-direction: column; gap: 7px; font-size: 12px; color: #CBD5E1; }
          .route-line { display: flex; align-items: flex-start; gap: 8px; }
          .dot-origin { width: 9px; height: 9px; border-radius: 50%; background: #22C55E; margin-top: 4px; flex-shrink: 0; }
          .dot-dest { width: 9px; height: 9px; border-radius: 2px; background: #EAB308; margin-top: 4px; flex-shrink: 0; }

          .vehicle-marker-wrap {
            width: 52px; height: 52px; display: flex; align-items: center; justify-content: center;
            transition: transform 0.45s linear; transform-origin: center center;
          }
          .vehicle-halo {
            position: absolute; width: 46px; height: 46px; border-radius: 50%;
            background: rgba(234, 179, 8, 0.22); border: 1.5px solid rgba(234, 179, 8, 0.55);
          }
        </style>
      </head>
      <body>
        <div id="mapWrap">
          <div class="live-pill">
            <span class="live-dot" id="liveDot"></span>
            <span id="liveText">Rastreamento ao vivo</span>
          </div>
          <div id="map"></div>
          <div id="leafletMap"></div>
          <button class="recenter-btn" id="recenterBtn" type="button">🎯 Centralizar veículo</button>
        </div>

        <div class="info-card">
          <div class="header">
            <div class="title">🚕 Nô Bai 245</div>
            <div id="statusBadge" class="badge ${ride.status === 'CANCELLED' ? 'cancelled' : (ride.status === 'COMPLETED' ? 'completed' : '')}">
              ${ride.status === 'ACCEPTED' ? 'MOTORISTA A CAMINHO' : ride.status === 'ARRIVED' ? 'NO LOCAL DE EMBARQUE' : ride.status === 'IN_PROGRESS' ? 'EM VIAGEM' : ride.status === 'COMPLETED' ? 'VIAGEM CONCLUÍDA' : ride.status === 'CANCELLED' ? 'CANCELADA' : sanitizeHtmlText(ride.status)}
            </div>
          </div>

          <div class="metrics-grid">
            <div class="metric-box">
              <div class="metric-label">Tempo Estimado</div>
              <div id="etaValue" class="metric-value">${ride.status === 'COMPLETED' ? 'Chegou' : initialEta + ' min'}</div>
            </div>
            <div class="metric-box">
              <div class="metric-label">Distância Restante</div>
              <div id="distValue" class="metric-value">${ride.status === 'COMPLETED' ? '0.0 km' : initialKm + ' km'}</div>
            </div>
          </div>

          <div class="driver-row">
            <div class="driver-left">
              ${driverPhoto ? `<img src="${driverPhoto}" class="driver-avatar" alt="Motorista" />` : `<div class="driver-avatar">${driverName.charAt(0).toUpperCase()}</div>`}
              <div style="min-width:0">
                <div class="driver-name">${driverName}</div>
                <div class="driver-car">${carModel} • ${carColor}</div>
              </div>
            </div>
            <div class="plate-pill">${licensePlate}</div>
          </div>

          <div class="route-box">
            <div class="route-line"><span class="dot-origin"></span><span><strong>Embarque:</strong> ${originAddress}</span></div>
            <div class="route-line"><span class="dot-dest"></span><span><strong>Destino:</strong> ${destinationAddress}</span></div>
          </div>
        </div>

        <script>
          const RIDE_ID = '${rideId}';
          const MAPBOX_TOKEN = '${mapboxToken}';
          const VEHICLE_TYPE = '${vehicleType}';
          const origin = [${originLng}, ${originLat}];
          const destination = [${destLng}, ${destLat}];
          let lastPos = [${driverLng}, ${driverLat}];
          let currentHeading = ${initialHeading};
          let currentStatus = '${ride.status}';
          let followVehicle = true;
          let usingLeaflet = false;
          let map = null;
          let driverMarker = null;
          let leafletMap = null;
          let leafletCarMarker = null;
          let leafletRouteLine = null;

          function statusLabel(st) {
            if (st === 'ACCEPTED') return 'MOTORISTA A CAMINHO';
            if (st === 'ARRIVED') return 'NO LOCAL DE EMBARQUE';
            if (st === 'IN_PROGRESS') return 'EM VIAGEM';
            if (st === 'COMPLETED') return 'VIAGEM CONCLUÍDA';
            if (st === 'CANCELLED') return 'CANCELADA';
            return st || 'EM ANDAMENTO';
          }

          function buildTopDownVehicleSvg(vType) {
            const isMoto = String(vType).toUpperCase().includes('MOTO');
            const isTaxi = String(vType).toUpperCase().includes('TAXI');
            if (isMoto) {
              return \`
                <svg width="42" height="42" viewBox="0 0 64 64" fill="none">
                  <ellipse cx="32" cy="34" rx="10" ry="22" fill="rgba(0,0,0,0.35)"/>
                  <rect x="29" y="8" width="6" height="12" rx="3" fill="#1E293B"/>
                  <rect x="28" y="44" width="8" height="12" rx="3" fill="#1E293B"/>
                  <path d="M24 22C24 17 40 17 40 22L38 44C38 48 26 48 26 44L24 22Z" fill="#EAB308" stroke="#0F172A" stroke-width="2"/>
                  <rect x="21" y="21" width="22" height="3.5" rx="1.7" fill="#0F172A"/>
                  <circle cx="32" cy="31" r="6" fill="#F8FAFC" stroke="#0F172A" stroke-width="2"/>
                  <circle cx="32" cy="11" r="2.2" fill="#FEF08A"/>
                </svg>\`;
            }
            const bodyFill = isTaxi ? '#FACC15' : '#F8FAFC';
            const roofFill = isTaxi ? '#FEF08A' : '#E2E8F0';
            return \`
              <svg width="44" height="44" viewBox="0 0 64 64" fill="none">
                <ellipse cx="32" cy="34" rx="16" ry="25" fill="rgba(0,0,0,0.4)"/>
                <rect x="14" y="15" width="4" height="9" rx="2" fill="#0F172A"/>
                <rect x="46" y="15" width="4" height="9" rx="2" fill="#0F172A"/>
                <rect x="14" y="40" width="4" height="9" rx="2" fill="#0F172A"/>
                <rect x="46" y="40" width="4" height="9" rx="2" fill="#0F172A"/>
                <rect x="17" y="8" width="30" height="48" rx="11" fill="\${bodyFill}" stroke="#0F172A" stroke-width="2.2"/>
                <path d="M21 17C21 14 43 14 43 17L41 24H23L21 17Z" fill="#1E293B"/>
                <path d="M23 42H41L42 48C42 50 22 50 22 48L23 42Z" fill="#1E293B"/>
                <rect x="22" y="24" width="20" height="18" rx="5" fill="\${roofFill}" stroke="#94A3B8" stroke-width="1"/>
                \${isTaxi ? '<rect x="26" y="30" width="12" height="5" rx="2" fill="#0F172A"/><rect x="28" y="31" width="8" height="3" rx="1" fill="#FACC15"/>' : ''}
                <rect x="20" y="9" width="6" height="2.5" rx="1.2" fill="#FEF9C3"/>
                <rect x="38" y="9" width="6" height="2.5" rx="1.2" fill="#FEF9C3"/>
                <rect x="20" y="53" width="6" height="2" rx="1" fill="#EF4444"/>
                <rect x="38" y="53" width="6" height="2" rx="1" fill="#EF4444"/>
              </svg>\`;
          }

          function calculateBearing(lat1, lng1, lat2, lng2) {
            const toRad = (d) => d * Math.PI / 180;
            const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2));
            const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
                      Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1));
            return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
          }

          function haversineKm(lat1, lng1, lat2, lng2) {
            const toRad = (v) => v * Math.PI / 180;
            const R = 6371;
            const dLat = toRad(lat2 - lat1);
            const dLng = toRad(lng2 - lng1);
            const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
            return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          }

          const carEl = document.createElement('div');
          carEl.className = 'vehicle-marker-wrap';
          carEl.style.transform = 'rotate(' + currentHeading + 'deg)';
          carEl.innerHTML = '<div class="vehicle-halo"></div>' + buildTopDownVehicleSvg(VEHICLE_TYPE);

          function activateLeafletFallback() {
            if (usingLeaflet || typeof L === 'undefined') return;
            usingLeaflet = true;
            document.getElementById('map').style.display = 'none';
            const lDiv = document.getElementById('leafletMap');
            lDiv.style.display = 'block';

            leafletMap = L.map('leafletMap', { zoomControl: false }).setView([lastPos[1], lastPos[0]], 15);
            L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
              maxZoom: 19,
              attribution: '&copy; OpenStreetMap'
            }).addTo(leafletMap);

            const carIcon = L.divIcon({
              html: '<div id="lCarRot" style="width:48px;height:48px;display:flex;align-items:center;justify-content:center;transform:rotate(' + currentHeading + 'deg);transition:transform 0.45s linear;">' + buildTopDownVehicleSvg(VEHICLE_TYPE) + '</div>',
              className: '',
              iconSize: [48, 48],
              iconAnchor: [24, 24]
            });
            leafletCarMarker = L.marker([lastPos[1], lastPos[0]], { icon: carIcon }).addTo(leafletMap);

            L.circleMarker([origin[1], origin[0]], { radius: 7, color: '#16A34A', fillColor: '#22C55E', fillOpacity: 1 }).addTo(leafletMap);
            L.circleMarker([destination[1], destination[0]], { radius: 7, color: '#0F172A', fillColor: '#EAB308', fillOpacity: 1 }).addTo(leafletMap);
            leafletRouteLine = L.polyline([[lastPos[1], lastPos[0]], [destination[1], destination[0]]], { color: '#EAB308', weight: 5, opacity: 0.9 }).addTo(leafletMap);
            leafletMap.fitBounds([[origin[1], origin[0]], [destination[1], destination[0]], [lastPos[1], lastPos[0]]], { padding: [50, 50] });
          }

          async function updateRouteAndMetrics(pos, status) {
            const isPickup = status === 'ACCEPTED' || status === 'ARRIVED';
            const target = isPickup ? origin : destination;

            if (status === 'COMPLETED') {
              document.getElementById('etaValue').innerText = 'Chegou';
              document.getElementById('distValue').innerText = '0.0 km';
              return;
            }

            const fallbackKm = Math.max(0.1, haversineKm(pos[1], pos[0], target[1], target[0]) * 1.25);
            const fallbackMin = Math.max(1, Math.round((fallbackKm / 28) * 60));

            try {
              const url = \`https://api.mapbox.com/directions/v5/mapbox/driving/\${pos[0]},\${pos[1]};\${target[0]},\${target[1]}?geometries=geojson&overview=full&access_token=\${MAPBOX_TOKEN}\`;
              const resp = await fetch(url);
              const json = await resp.json();
              if (json.routes && json.routes[0]) {
                const r = json.routes[0];
                const mins = Math.max(1, Math.round(r.duration / 60));
                const kms = (r.distance / 1000).toFixed(1);
                document.getElementById('etaValue').innerText = mins + ' min';
                document.getElementById('distValue').innerText = kms + ' km';

                const coords = r.geometry.coordinates;
                if (!usingLeaflet && map && map.isStyleLoaded()) {
                  if (map.getSource('route')) {
                    map.getSource('route').setData({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });
                  } else {
                    map.addSource('route', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } } });
                    map.addLayer({ id: 'routeLine', type: 'line', source: 'route', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#EAB308', 'line-width': 5, 'line-opacity': 0.92 } });
                  }
                } else if (usingLeaflet && leafletRouteLine) {
                  leafletRouteLine.setLatLngs(coords.map((c) => [c[1], c[0]]));
                }
                return;
              }
            } catch {}

            document.getElementById('etaValue').innerText = fallbackMin + ' min';
            document.getElementById('distValue').innerText = fallbackKm.toFixed(1) + ' km';
          }

          function applyLiveUpdate(newLat, newLng, incomingHeading, newStatus) {
            if (newStatus) {
              currentStatus = newStatus;
              const badge = document.getElementById('statusBadge');
              if (badge) {
                badge.innerText = statusLabel(newStatus);
                badge.className = 'badge' + (newStatus === 'CANCELLED' ? ' cancelled' : newStatus === 'COMPLETED' ? ' completed' : '');
              }
              if (newStatus === 'COMPLETED' || newStatus === 'CANCELLED') {
                document.getElementById('liveText').innerText = newStatus === 'COMPLETED' ? 'Viagem encerrada' : 'Corrida cancelada';
                document.getElementById('liveDot').style.background = newStatus === 'COMPLETED' ? '#3B82F6' : '#EF4444';
              }
            }

            if (Number.isFinite(newLat) && Number.isFinite(newLng) && newLat !== 0 && newLng !== 0) {
              const nextPos = [newLng, newLat];
              const movedMeters = haversineKm(lastPos[1], lastPos[0], newLat, newLng) * 1000;

              if (movedMeters > 1.5) {
                currentHeading = calculateBearing(lastPos[1], lastPos[0], newLat, newLng);
              } else if (typeof incomingHeading === 'number' && incomingHeading > 0) {
                currentHeading = incomingHeading;
              }

              lastPos = nextPos;

              if (!usingLeaflet && driverMarker) {
                carEl.style.transform = 'rotate(' + Math.round(currentHeading) + 'deg)';
                driverMarker.setLngLat(nextPos);
                if (followVehicle && map) {
                  map.easeTo({ center: nextPos, duration: 700 });
                }
              } else if (usingLeaflet && leafletCarMarker) {
                leafletCarMarker.setLatLng([newLat, newLng]);
                const rotNode = document.getElementById('lCarRot');
                if (rotNode) rotNode.style.transform = 'rotate(' + Math.round(currentHeading) + 'deg)';
                if (followVehicle && leafletMap) {
                  leafletMap.panTo([newLat, newLng]);
                }
              }

              updateRouteAndMetrics(nextPos, currentStatus);
            }
          }

          // Inicialização do Mapa Mapbox com fallback automático para Leaflet se falhar em 5s
          let mapboxLoaded = false;
          try {
            if (typeof mapboxgl !== 'undefined' && MAPBOX_TOKEN) {
              mapboxgl.accessToken = MAPBOX_TOKEN;
              map = new mapboxgl.Map({
                container: 'map',
                style: 'mapbox://styles/mapbox/streets-v12',
                center: lastPos,
                zoom: 15
              });

              map.on('dragstart', () => { followVehicle = false; });

              driverMarker = new mapboxgl.Marker({ element: carEl, anchor: 'center' }).setLngLat(lastPos).addTo(map);

              const originEl = document.createElement('div');
              originEl.style.cssText = 'width:16px;height:16px;border-radius:50%;background:#22C55E;border:3px solid #FFF;box-shadow:0 2px 6px rgba(0,0,0,0.4);';
              new mapboxgl.Marker({ element: originEl }).setLngLat(origin).addTo(map);

              const destEl = document.createElement('div');
              destEl.style.cssText = 'width:18px;height:18px;border-radius:4px;background:#0F172A;border:3px solid #EAB308;box-shadow:0 2px 6px rgba(0,0,0,0.4);';
              new mapboxgl.Marker({ element: destEl }).setLngLat(destination).addTo(map);

              map.on('load', async () => {
                mapboxLoaded = true;
                map.resize();
                const bounds = new mapboxgl.LngLatBounds();
                bounds.extend(origin);
                bounds.extend(destination);
                bounds.extend(lastPos);
                map.fitBounds(bounds, { padding: 65, maxZoom: 16 });
                await updateRouteAndMetrics(lastPos, currentStatus);
              });

              map.on('error', () => {
                if (!mapboxLoaded) activateLeafletFallback();
              });
            } else {
              activateLeafletFallback();
            }
          } catch {
            activateLeafletFallback();
          }

          setTimeout(() => {
            if (!mapboxLoaded && !usingLeaflet) {
              activateLeafletFallback();
              updateRouteAndMetrics(lastPos, currentStatus);
            }
          }, 4500);

          document.getElementById('recenterBtn').addEventListener('click', () => {
            followVehicle = true;
            if (!usingLeaflet && map) {
              map.flyTo({ center: lastPos, zoom: 16, duration: 900 });
            } else if (usingLeaflet && leafletMap) {
              leafletMap.setView([lastPos[1], lastPos[0]], 16);
            }
          });

          // Tempo real via Socket.IO
          try {
            if (typeof io !== 'undefined') {
              const sock = io({ transports: ['websocket', 'polling'] });
              sock.on('connect', () => {
                sock.emit('join_ride', RIDE_ID);
                sock.emit('ride:join', { rideId: RIDE_ID });
              });
              sock.on('driver:position', (p) => {
                if (p && Number.isFinite(Number(p.latitude)) && Number.isFinite(Number(p.longitude))) {
                  applyLiveUpdate(Number(p.latitude), Number(p.longitude), Number(p.heading || 0), currentStatus);
                }
              });
              sock.on('ride:accepted', () => applyLiveUpdate(lastPos[1], lastPos[0], currentHeading, 'ACCEPTED'));
              sock.on('ride:arrived', () => applyLiveUpdate(lastPos[1], lastPos[0], currentHeading, 'ARRIVED'));
              sock.on('ride:started', () => applyLiveUpdate(lastPos[1], lastPos[0], currentHeading, 'IN_PROGRESS'));
              sock.on('ride:finished', () => applyLiveUpdate(lastPos[1], lastPos[0], currentHeading, 'COMPLETED'));
              sock.on('ride:completed', () => applyLiveUpdate(lastPos[1], lastPos[0], currentHeading, 'COMPLETED'));
              sock.on('ride:cancelled', () => applyLiveUpdate(lastPos[1], lastPos[0], currentHeading, 'CANCELLED'));
            }
          } catch {}

          // Polling de redundância a cada 3 segundos
          setInterval(async () => {
            try {
              const res = await fetch('/track/' + encodeURIComponent(RIDE_ID) + '/data');
              if (!res.ok) return;
              const data = await res.json();
              applyLiveUpdate(
                Number(data.driverLat),
                Number(data.driverLng),
                Number(data.heading || 0),
                data.status
              );
            } catch {}
          }, 3000);
        </script>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('❌ Erro no rastreamento público:', error);
    res.status(500).send('Erro interno ao carregar página de rastreamento.');
  }
});

// -----------------------------------------------------------------------------
// 5. SERVIDOR WEBSOCKET (SOCKET.IO)
// -----------------------------------------------------------------------------
const io = new (Server as any)(server, {
  maxHttpBufferSize: 15 * 1024 * 1024,
  cors: { origin: allowedOrigins, methods: ['GET', 'POST'] },
  transports: ['polling', 'websocket'],
  pingTimeout: 30000,
  pingInterval: 10000,
});

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

const disconnectTimers = new Map<string, NodeJS.Timeout>();

io.use((socket: any, next: any) => {
  const token = socket.handshake.auth?.token;

  if (!token) return next(new Error('Acesso negado. Token não fornecido.'));

  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as { id: string; role?: string; userType?: string };
    socket.data.user = decoded;
    socket.data.lastEvents = new Map<string, number[]>();
    next();
  } catch {
    return next(new Error('Token inválido ou expirado.'));
  }
});

function isSocketRateLimited(socket: Socket, eventName: string, windowMs = 1000, maxCalls = 5): boolean {
  if (!socket.data.lastEvents) socket.data.lastEvents = new Map<string, number[]>();

  const now = Date.now();
  const key = `${socket.id}:${eventName}`;
  const history: number[] = socket.data.lastEvents.get(key) || [];
  const validHistory = history.filter((timestamp: number) => now - timestamp < windowMs);

  if (validHistory.length >= maxCalls) {
    console.warn(`⚠️ [RATE LIMIT] Evento '${eventName}' limitado para o socket ${socket.id}`);
    return true;
  }

  validHistory.push(now);
  socket.data.lastEvents.set(key, validHistory);

  if (socket.data.lastEvents.size > 20) {
    for (const [k, v] of socket.data.lastEvents.entries()) {
      if (v.every((t: number) => now - t >= windowMs)) socket.data.lastEvents.delete(k);
    }
  }
  return false;
}

// -----------------------------------------------------------------------------
// HELPERS AUXILIARES DE VALIDAÇÃO E EVENTOS
// -----------------------------------------------------------------------------
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

function isUuid(str?: string): boolean {
  if (!str || typeof str !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);
}

function handleSocketEvent(socket: Socket, eventName: string, handler: (data?: any, ...args: any[]) => Promise<void> | void) {
  socket.on(eventName, async (data?: any, ...args: any[]) => {
    const maybeAck = args.length > 0 && typeof args[args.length - 1] === 'function' ? args[args.length - 1] : undefined;
    try {
      await handler(data, ...args);
    } catch (error: any) {
      const errorMessage = error?.message || 'Erro ao processar requisição em tempo real.';
      console.error(`❌ [SOCKET ERROR] [Event: ${eventName}] [User: ${socket.data.user?.id}]:`, error);
      socket.emit('error', { message: errorMessage });
      if (maybeAck) {
        try { maybeAck({ error: true, message: errorMessage }); } catch {}
      }
    }
  });
}


// -----------------------------------------------------------------------------
// 6. EVENTOS WEBSOCKET (SOCKET.IO ENGINE)
// -----------------------------------------------------------------------------
io.on('connection', (socket: any) => {
  const userId = socket.data.user?.id;
  const userRole = socket.data.user?.role || socket.data.user?.userType;
  console.log(`[+] Cliente conectado: ${socket.id} (ID: ${userId} | Role: ${userRole})`);

  setupTicketSocketHandlers(io, socket);

  if (userId) {
    socket.join(userId);
    socket.join(`user_${userId}`);

    if (userRole === 'DRIVER') {
      socket.join(`driver_${userId}`);
      socket.join(`driver:${userId}`);
    } else {
      socket.join(`passenger_${userId}`);
      socket.join(`passenger:${userId}`);
    }
  }

  // [AUTO_JOIN_ACTIVE_RIDE] Reingresso automático em corrida ativa ao reconectar
  if (userId) {
    (async () => {
      try {
        const activeRide = await prisma.ride.findFirst({
          where: {
            status: { in: ['ACCEPTED', 'ARRIVED', 'IN_PROGRESS'] },
            ...(userRole === 'DRIVER' ? { driverId: userId } : { passengerId: userId })
          },
          select: { id: true }
        });
        if (activeRide?.id) {
          socket.join(activeRide.id);
          socket.join(`ride_${activeRide.id}`);
          console.log(`🔄 [AUTO_JOIN] User ${userId} (${userRole}) reingressou na sala da corrida ${activeRide.id}`);
        }
      } catch (e) {}
    })();
  }

  socket.on('join_room', async (roomName: string) => {
    if (!roomName || typeof roomName !== 'string' || !userId) return;
    const cleanRoom = roomName.trim();
    const isAdminUser = ['SUPER_ADMIN', 'OPERATOR', 'FINANCE'].includes(String(userRole));

    // Bloqueia entrada em salas administrativas ou de outros usuários
    if (cleanRoom === 'admin_dashboard' && !isAdminUser) return;
    if (cleanRoom.startsWith('driver_') || cleanRoom.startsWith('driver:') || cleanRoom.startsWith('passenger_') || cleanRoom.startsWith('passenger:') || cleanRoom.startsWith('user_')) {
      if (!cleanRoom.endsWith(userId) && !isAdminUser) return;
    }

    // Se for UUID de corrida ou ride_<uuid>, valida se o usuário pertence à corrida
    const extractedId = cleanRoom.startsWith('ride_') ? cleanRoom.slice(5) : cleanRoom;
    if (isUuid(extractedId) && extractedId !== userId && !isAdminUser) {
      const rideParticipant = await prisma.ride.findFirst({
        where: { id: extractedId, OR: [{ passengerId: userId }, { driverId: userId }] },
        select: { id: true }
      }).catch(() => null);
      if (!rideParticipant) return;
    }

    socket.join(cleanRoom);
    console.log(`📡 [SOCKET ROOM] Cliente ${socket.id} (User: ${userId}) entrou na sala: ${cleanRoom}`);
  });

  // 📌 ATUALIZAÇÃO DO DEVICE TOKEN DO PASSAGEIRO
  handleSocketEvent(socket, 'passenger:update_device_token', async (data) => {
    const { deviceToken } = data || {};
    const userId = socket.data.user?.id;

    if (userId && deviceToken && typeof deviceToken === 'string') {
      await prisma.passenger.update({
        where: { id: userId },
        data: { deviceToken }
      }).catch(err => console.error('⚠️ [PUSH TOKEN ERR] Falha ao atualizar token do passageiro:', err?.message));
      console.log(`📱 [PUSH TOKEN] deviceToken atualizado para o Passageiro ID: ${userId}`);
    }
  });

  // 📌 ATUALIZAÇÃO DO DEVICE TOKEN DO MOTORISTA
  handleSocketEvent(socket, 'driver:update_device_token', async (data) => {
    const { deviceToken } = data || {};
    const userId = socket.data.user?.id;

    if (userId && deviceToken && typeof deviceToken === 'string') {
      await prisma.driver.update({
        where: { id: userId },
        data: { deviceToken }
      }).catch(err => console.error('⚠️ [PUSH TOKEN ERR] Falha ao atualizar token do motorista:', err?.message));
      console.log(`📱 [PUSH_DEBUG] deviceToken de Push Notificação atualizado para o Motorista ID: ${userId}`);
    }
  });

  // 📌 REINGRESSO GARANTIDO EM SALAS DA CORRIDA E DO PASSAGEIRO
  handleSocketEvent(socket, 'passenger:rejoin_ride', async (data) => {
    const { rideId } = data || {};
    const userId = socket.data.user?.id;

    if (userId) {
      socket.join(userId);
      socket.join(`user_${userId}`);
      socket.join(`passenger_${userId}`);
      socket.join(`passenger:${userId}`);
    }

    if (rideId && isUuid(rideId)) {
      socket.join(rideId);
      console.log(`📡 [SOCKET_DEBUG] Passageiro ${userId} reingressou com sucesso na sala da corrida ID: ${rideId}`);
    }
  });

  // 📌 REINGRESSO GARANTIDO EM SALAS DA CORRIDA DO MOTORISTA
  handleSocketEvent(socket, 'driver:rejoin_ride', async (data) => {
    const { rideId } = data || {};
    const userId = socket.data.user?.id;

    if (userId) {
      socket.join(userId);
      socket.join(`user_${userId}`);
      socket.join(`driver_${userId}`);
      socket.join(`driver:${userId}`);
    }

    if (rideId && isUuid(rideId)) {
      socket.join(rideId);
      console.log(`📡 [SOCKET_DEBUG] Motorista ${userId} reingressou com sucesso na sala da corrida ID: ${rideId}`);
    }
  });

// 📞 CHAMADA DE VOZ INTERNA SEGURA (NÚMEROS OCULTOS + AUDITORIA RideCallLog)
handleSocketEvent(socket, 'call:initiate', async (data, ackCallback) => {
  if (isSocketRateLimited(socket, 'call:initiate', 4000, 1)) return;
  const { rideId, callerRole } = data || {};
  const callerId = socket.data.user?.id;
  if (!rideId || !isUuid(rideId) || !callerId) {
    if (typeof ackCallback === 'function') ackCallback({ error: true, message: 'Corrida inválida para chamada.' });
    return;
  }

  const ride = await prisma.ride.findUnique({
    where: { id: rideId },
    include: {
      driver: { select: { id: true, fullName: true, profilePicture: true } },
      passenger: { select: { id: true, fullName: true, profilePicture: true } },
    },
  });

  if (!ride || !['ACCEPTED', 'ARRIVED', 'IN_PROGRESS'].includes(ride.status)) {
    if (typeof ackCallback === 'function') ackCallback({ error: true, message: 'Chamada disponível apenas durante corrida ativa.' });
    return;
  }

  const isDriverCaller = ride.driverId === callerId || String(callerRole).toLowerCase() === 'driver';
  const isPassengerCaller = ride.passengerId === callerId || String(callerRole).toLowerCase() === 'passenger';
  if (!isDriverCaller && !isPassengerCaller) {
    if (typeof ackCallback === 'function') ackCallback({ error: true, message: 'Acesso negado à chamada desta corrida.' });
    return;
  }

  const receiverId = isDriverCaller ? ride.passengerId : ride.driverId;
  if (!receiverId) {
    if (typeof ackCallback === 'function') ackCallback({ error: true, message: 'Destinatário ainda não conectado.' });
    return;
  }

  socket.join(rideId);
  socket.join(`ride_${rideId}`);

  const callLog = await prisma.rideCallLog.create({
    data: {
      rideId,
      callerId,
      callerType: isDriverCaller ? 'DRIVER' : 'PASSENGER',
      receiverId,
    },
  });

  const incomingPayload = {
    rideId,
    callLogId: callLog.id,
    callerRole: isDriverCaller ? 'driver' : 'passenger',
    callerName: isDriverCaller ? (ride.driver?.fullName || 'Motorista') : (ride.passenger?.fullName || 'Passageiro'),
    callerPhoto: isDriverCaller ? (ride.driver?.profilePicture || null) : (ride.passenger?.profilePicture || null),
  };

  if (isDriverCaller) {
    io.to(receiverId).to(`passenger_${receiverId}`).to(`passenger:${receiverId}`).emit('call:incoming', incomingPayload);
  } else {
    io.to(receiverId).to(`driver_${receiverId}`).to(`driver:${receiverId}`).emit('call:incoming', incomingPayload);
  }

  if (typeof ackCallback === 'function') {
    ackCallback({ ok: true, callLogId: callLog.id });
  }
});

const emitCallEventToParticipants = async (rideId: string, eventName: string, payload: Record<string, any>) => {
  const rooms = new Set<string>([rideId, `ride_${rideId}`]);
  const rideUsers = await prisma.ride.findUnique({
    where: { id: rideId },
    select: { passengerId: true, driverId: true },
  }).catch(() => null);

  if (rideUsers?.passengerId) {
    rooms.add(rideUsers.passengerId);
    rooms.add(`passenger_${rideUsers.passengerId}`);
    rooms.add(`passenger:${rideUsers.passengerId}`);
    rooms.add(`user_${rideUsers.passengerId}`);
  }
  if (rideUsers?.driverId) {
    rooms.add(rideUsers.driverId);
    rooms.add(`driver_${rideUsers.driverId}`);
    rooms.add(`driver:${rideUsers.driverId}`);
    rooms.add(`user_${rideUsers.driverId}`);
  }
  rooms.forEach((room) => {
    io.to(room).emit(eventName, payload);
  });
};

handleSocketEvent(socket, 'call:accept', async (data) => {
  const { rideId, callLogId, accepterRole } = data || {};
  if (!rideId || !isUuid(rideId)) return;
  socket.join(rideId);
  socket.join(`ride_${rideId}`);
  const payload = { rideId, callLogId: callLogId || null, accepterRole };
  await emitCallEventToParticipants(rideId, 'call:accepted', payload);
});

handleSocketEvent(socket, 'call:reject', async (data) => {
  const { rideId, callLogId, rejecterRole } = data || {};
  if (!rideId || !isUuid(rideId)) return;
  if (callLogId && isUuid(callLogId)) {
    await prisma.rideCallLog.updateMany({
      where: { id: callLogId },
      data: { durationSec: 0 },
    }).catch(() => {});
  }
  await emitCallEventToParticipants(rideId, 'call:rejected', {
    rideId,
    callLogId: callLogId || null,
    rejecterRole,
  });
});

handleSocketEvent(socket, 'call:end', async (data) => {
  const { rideId, callLogId, durationSec, endedBy } = data || {};
  if (!rideId || !isUuid(rideId)) return;
  if (callLogId && isUuid(callLogId)) {
    await prisma.rideCallLog.updateMany({
      where: { id: callLogId },
      data: { durationSec: Math.max(0, Math.round(Number(durationSec || 0))) },
    }).catch(() => {});
  }
  await emitCallEventToParticipants(rideId, 'call:ended', {
    rideId,
    callLogId: callLogId || null,
    durationSec: Math.max(0, Math.round(Number(durationSec || 0))),
    endedBy,
  });
});

const activeVoiceCallCache = new Map<string, { driverId: string | null; passengerId: string | null; expiresAt: number }>();

handleSocketEvent(socket, 'call:voice_chunk', async (data) => {
  const { rideId, audioBase64, seq } = data || {};
  const senderId = socket.data.user?.id;
  if (!rideId || !isUuid(rideId) || !senderId || !audioBase64 || typeof audioBase64 !== 'string') return;
  if (audioBase64.length > 1500000) return;

  const now = Date.now();
  let participants = activeVoiceCallCache.get(rideId);

  if (!participants || participants.expiresAt <= now) {
    const ride = await prisma.ride.findUnique({
      where: { id: rideId },
      select: { driverId: true, passengerId: true, status: true },
    });
    if (!ride || !['ACCEPTED', 'ARRIVED', 'IN_PROGRESS'].includes(ride.status)) {
      activeVoiceCallCache.delete(rideId);
      return;
    }
    participants = {
      driverId: ride.driverId,
      passengerId: ride.passengerId,
      expiresAt: now + 15000,
    };
    activeVoiceCallCache.set(rideId, participants);
  }

  if (participants.driverId !== senderId && participants.passengerId !== senderId) return;

  const isDriverSender = participants.driverId === senderId;
  const targetId = isDriverSender ? participants.passengerId : participants.driverId;
  if (!targetId) return;

  const chunkPayload = {
    rideId,
    senderRole: isDriverSender ? 'driver' : 'passenger',
    seq: typeof seq === 'number' && Number.isFinite(seq) ? seq : undefined,
    ts: now,
    audioBase64,
  };

  if (isDriverSender) {
    io.to(targetId).to(`passenger_${targetId}`).to(`passenger:${targetId}`).emit('call:voice_chunk', chunkPayload);
  } else {
    io.to(targetId).to(`driver_${targetId}`).to(`driver:${targetId}`).emit('call:voice_chunk', chunkPayload);
  }
});

  socket.on('disconnect', () => {
    console.log(`[-] [SOCKET_DEBUG] Cliente desconectado: ${socket.id} (ID: ${socket.data.user?.id})`);

    if (socket.data.lastEvents) {
      socket.data.lastEvents.clear();
      socket.data.lastEvents = undefined;
    }

    const user = socket.data.user;
    if (user && (user.role === 'DRIVER' || user.userType === 'DRIVER')) {
      const driverId = user.id;
      console.log(`⏳ [OFFLINE_DEBUG] Iniciando tolerância de reconexão de 15s para o motorista ID: ${driverId}`);

      if (disconnectTimers.has(driverId)) {
        clearTimeout(disconnectTimers.get(driverId)!);
      }

      const timer = setTimeout(async () => {
        const activeDriverSockets = await io.in(`driver_${driverId}`).fetchSockets().catch(() => []);
        if (activeDriverSockets.length > 0) {
          console.log(`🟢 [OFFLINE_DEBUG] Motorista ${driverId} já reconectou (${activeDriverSockets.length} socket(s)). Cancelando remoção.`);
          disconnectTimers.delete(driverId);
          return;
        }

        console.log(`🔴 [OFFLINE_DEBUG] Tempo esgotado! Removendo motorista ${driverId} da lista de localização/disponíveis.`);
        await safeRedis.zRem('drivers:locations', driverId);


        const hasActiveRide = await safeRedis.get(`driver_active_ride:${driverId}`);
        if (!hasActiveRide) {
          await prisma.driver.update({ where: { id: driverId }, data: { isOnline: false } })
            .catch(e => console.warn(`⚠️ [DISCONNECT FAIL] Motorista: ${driverId}`, e?.message));
          console.log(`🚫 [OFFLINE_DEBUG] Motorista ID: ${driverId} marcado como Offline no Banco de Dados.`);
        } else {
          console.log(`ℹ️ [OFFLINE_DEBUG] Motorista mantido em corrida ativa ID: ${hasActiveRide}`);
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
    console.log(`🔴 [OFFLINE_DEBUG] Solicitação manual de status Offline do motorista ID: ${driverId}`);

    socket.leave('available_drivers');

    await safeRedis.zRem('drivers:locations', driverId);
    await safeRedis.del(`driver_active_ride:${driverId}`);

    await prisma.driver.update({
      where: { id: driverId },
      data: { isOnline: false, isAvailable: false }
    }).catch(() => null);

    console.log(`✅ [OFFLINE_DEBUG] Motorista ${driverId} removido com sucesso do Redis e salas Socket.`);
  });

  // --- LOCAL INACESSÍVEL ---
  handleSocketEvent(socket, 'driver:alert_inaccessible_location', (data) => {
    const { rideId, passengerId } = data || {};
    if (!rideId || !isUuid(rideId)) return;

    console.log(`📢 [ALERT_DEBUG] Motorista reportou dificuldade de acesso ao local na corrida ${rideId} (Passageiro: ${passengerId})`);

    const targetRooms = [
      rideId,
      passengerId,
      `passenger_${passengerId}`,
      `passenger:${passengerId}`,
      `user_${passengerId}`
    ].filter(Boolean);

    targetRooms.forEach(room => {
      io.to(room).emit('ride:inaccessible_location', {
        rideId,
        title: 'Motorista com dificuldade de acesso ⚠️',
        message: 'O motorista está com dificuldades para chegar ao seu local exato. Por favor, verifique o chat ou tente se aproximar da via principal.'
      });
    });
  });

  // --- ALERTA SOS (SCHEMA V3.0 - Tabela SosAlert) ---
  handleSocketEvent(socket, 'sos:triggered', async (data) => {
    if (isSocketRateLimited(socket, 'sos:triggered', 5000, 2)) return;

    const { rideId, latitude, longitude, timestamp } = data || {};
    const userId = socket.data.user?.id;
    const userRole = socket.data.user?.role || socket.data.user?.userType;

    if (rideId && !isUuid(rideId)) {
      socket.emit('error', { message: 'ID de corrida inválido fornecido para o alerta SOS.' });
      return;
    }

    const latNum = Number(latitude);
    const lngNum = Number(longitude);

    if (!isValidCoordinate(latNum, lngNum)) {
      socket.emit('error', { message: 'Coordenadas inválidas fornecidas para o alerta SOS.' });
      return;
    }

    const isDrv = userRole === 'DRIVER';
    const userTypeEnum = isDrv ? 'DRIVER' : 'PASSENGER';

    const sosAlert = await prisma.sosAlert.create({
      data: {
        rideId: rideId && isUuid(rideId) ? rideId : null,
        userType: userTypeEnum as any,
        passengerId: !isDrv && userId ? userId : null,
        driverId: isDrv && userId ? userId : null,
        lat: latNum,
        lng: lngNum,
        status: 'ACTIVE'
      }
    }).catch(err => {
      console.error('❌ [ERRO_SOS_DB] Falha ao registrar SosAlert no banco:', err);
      return null;
    });

    console.warn(`🚨 [SOS_DEBUG] ALERTA DISPARADO! Usuário: ${userId} (${userTypeEnum}) | SOS ID: ${sosAlert?.id || 'N/A'} | Coords: ${latNum}, ${lngNum}`);

    if (sosAlert?.id) {
      await buildAndBroadcastSos(io, sosAlert.id);
    } else {
      const fallbackSos = {
        id: `sos-${Date.now()}`,
        sosId: `sos-${Date.now()}`,
        userId,
        userType: userTypeEnum,
        driverId: isDrv ? userId : null,
        passengerId: !isDrv ? userId : null,
        rideId: rideId || null,
        lat: latNum,
        lng: lngNum,
        latitude: latNum,
        longitude: lngNum,
        status: 'ACTIVE',
        createdAt: timestamp || new Date().toISOString(),
      };
      io.to('admin_dashboard').emit('admin:sos_alert', fallbackSos);
      io.to('emergency_agencies').emit('admin:sos_alert', fallbackSos);
    }
  });

  // --- MOTORISTA FICA ONLINE (COM TRAVA DE SALDO MÍNIMO DE 1.000 XOF NA CARTEIRA) ---
  handleSocketEvent(socket, 'driver:online', async (data) => {
    if (isSocketRateLimited(socket, 'driver:online')) return;
    if (!isDriver(socket)) {
      socket.emit('error', { message: 'Acesso negado.' });
      return;
    }

    const driverId = socket.data.user.id;
    const { lat, lng } = data || {};

    console.log(`🟢 [ONLINE_DEBUG] Solicitação de status Online recebida para Motorista ID: ${driverId} | Coords: ${lat}, ${lng}`);

    const driver = await prisma.driver.findUnique({
      where: { id: driverId },
      select: {
        id: true,
        status: true,
        walletBalance: true,
        vehicleType: true,
        lastLat: true,
        lastLng: true
      }
    });

    if (!driver || driver.status !== 'APPROVED') {
      socket.emit('error', { message: 'Sua conta ainda está em análise ou não foi aprovada.' });
      return;
    }

    // 🛑 TRAVA DE SEGURANÇA: Saldo mínimo de 1.000 XOF na carteira digital para ficar online
    const sysCfgOnline = await prisma.systemConfig.findFirst().catch(() => null);
    const MIN_REQUIRED_BALANCE = Math.max(1000, Number((sysCfgOnline as any)?.minDriverBalanceXof ?? 0));
    const currentBalance = Number(driver.walletBalance || 0);

    if (currentBalance < MIN_REQUIRED_BALANCE) {
      console.warn(`🛑 [ONLINE_DEBUG] Recusado: Motorista ${driverId} possui saldo insuficiente (${currentBalance} XOF < ${MIN_REQUIRED_BALANCE} XOF)`);

      await prisma.driver.update({
        where: { id: driverId },
        data: { isOnline: false, isAvailable: false }
      }).catch(() => null);

      const errorMessage = `Saldo insuficiente (${currentBalance.toLocaleString('pt-GW')} XOF). É necessário ter no mínimo 1.000 XOF na carteira digital para ficar online.`;

      socket.emit('driver:online_failed', {
        reason: 'INSUFFICIENT_BALANCE',
        currentBalance,
        minRequired: MIN_REQUIRED_BALANCE,
        message: errorMessage
      });
      socket.emit('error', { message: errorMessage });
      return;
    }

    socket.join(driverId);
    socket.join(`driver_${driverId}`);
    socket.join(`driver:${driverId}`);
    socket.join('available_drivers');

    if (disconnectTimers.has(driverId)) {
      console.log(`🔄 [ONLINE_DEBUG] Cancelando timer de desconexão pendente para motorista: ${driverId}`);
      clearTimeout(disconnectTimers.get(driverId)!);
      disconnectTimers.delete(driverId);
    }

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
      await safeRedis.geoAdd('drivers:locations', {
        longitude: currentLng,
        latitude: currentLat,
        member: driverId
      });
      console.log(`📍 [REDIS_GEO] Motorista ${driverId} cadastrado na chave 'drivers:locations' em [${currentLat}, ${currentLng}]`);
    } else {
      console.warn(`⚠️ [REDIS_GEO_WARN] Motorista ${driverId} ficou online SEM coordenadas geográficas válidas.`);
    }

    socket.emit('driver:online_success', {
      message: 'Você está online e visível para chamadas!',
      walletBalance: currentBalance
    });

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

    console.log(`🔎 [ONLINE_DEBUG] Encontradas ${pendingRides.length} corridas aguardando motorista na categoria ${updatedDriver.vehicleType}`);

    for (const pendingRide of pendingRides) {
      console.log(`📸 [FOTO_DEBUG] Enviando oferta de corrida para novo motorista online - Foto Passageiro: "${pendingRide.passenger?.profilePicture || 'SEM_FOTO'}"`);
      socket.emit('ride:new_request', {
        rideId: pendingRide.id,
        passengerId: pendingRide.passengerId,
        passengerName: pendingRide.passenger?.fullName || 'Passageiro',
        passengerPhone: null,
        passengerPhoto: pendingRide.passenger?.profilePicture || null,
        passengerRating: Number(pendingRide.passenger?.ratingAverage || 5.0),
        pickupLat: Number(pendingRide.originLat),
        pickupLng: Number(pendingRide.originLng),
        originLat: Number(pendingRide.originLat),
        originLng: Number(pendingRide.originLng),
        originAddress: pendingRide.originAddress,
        destinationLat: Number(pendingRide.destinationLat),
        destinationLng: Number(pendingRide.destinationLng),
        destinationAddress: pendingRide.destinationAddress,
        referencePoint: pendingRide.referencePoint || '',
        pickupReferencePoint: pendingRide.referencePoint || '',
        fareXOF: Math.round(Number(pendingRide.priceXof || 0)),
        priceXof: Math.round(Number(pendingRide.priceXof || 0)),
        estimatedPrice: Math.round(Number(pendingRide.priceXof || 0)),
        distanceKm: Number(Number(pendingRide.distanceKm || 0).toFixed(2)),
        durationMin: Number(pendingRide.durationMin || 0),
        vehicleType: pendingRide.requestedVehicleType,
        serviceType: pendingRide.serviceType,
        paymentMethod: pendingRide.paymentMethod || 'CASH'
      });
    }
  });

  // --- PASSAGEIRO SOLICITA CORRIDA (PADRÃO 100% DINHEIRO) ---
  handleSocketEvent(socket, 'passenger:request_ride', async (rideData) => {
    console.log(`🚕 [RIDE_REQUEST_DEBUG] Nova solicitação de corrida recebida do Socket ID ${socket.id}:`, rideData);

    if (isSocketRateLimited(socket, 'passenger:request_ride', 5000, 2)) return;

    const passengerId = socket.data.user?.id;
    if (!passengerId || !isPassenger(socket)) {
      socket.emit('error', { message: 'Ação não autorizada. Faça login novamente como passageiro.' });
      return;
    }

    const pLat = Number(rideData?.pickupLat || rideData?.originLat);
    const pLng = Number(rideData?.pickupLng || rideData?.originLng);
    const dLat = Number(rideData?.destinationLat);
    const dLng = Number(rideData?.destinationLng);

    if (!isValidCoordinate(pLat, pLng) || !isValidCoordinate(dLat, dLng)) {
      socket.emit('error', { message: 'Coordenadas de origem ou destino inválidas.' });
      return;
    }

    if (!isWithinGuineaBissau(pLat, pLng)) {
      console.warn(`🛑 [COBERTURA_WARN] Coordenadas de origem [${pLat}, ${pLng}] fora do território da Guiné-Bissau.`);
      socket.emit('error', {
        message: '📍 Fora da área de cobertura. O Nô Bai 245 opera exclusivamente na Guiné-Bissau.'
      });
      return;
    }

    const estimatedPrice = rideData?.estimatedPrice ?? rideData?.priceXof;
    const incomingDistanceKm = rideData?.distanceKm ?? rideData?.estimatedDistanceKm;
    const incomingDurationMin = rideData?.durationMin ?? rideData?.estimatedDurationMin;
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

    try {
      const creationResult = await createRideAndInitiateEscrow(passengerId, {
        originLat: pLat,
        originLng: pLng,
        destinationLat: dLat,
        destinationLng: dLng,
        originAddress: rideData.originAddress,
        destinationAddress: rideData.destinationAddress,
        referencePoint: rideData.referencePoint || rideData.pickupReferencePoint || undefined,
        pickupReferencePoint: rideData.pickupReferencePoint || undefined,
        dropoffReferencePoint: rideData.dropoffReferencePoint || undefined,
        requestedVehicleType: normalizedVehicleType,
        serviceType: rideData.serviceType || 'RIDE',
        paymentMethod: rideData.paymentMethod || 'CASH',
        payerPhone: rideData.payerPhone || undefined,
        estimatedPrice: estimatedPrice ? Number(estimatedPrice) : undefined,
        couponCode: rideData.couponCode || undefined,
        useCorporateAccount: Boolean(rideData.useCorporateAccount),
        distanceKm: incomingDistanceKm ? Number(incomingDistanceKm) : undefined,
        durationMin: incomingDurationMin ? Number(incomingDurationMin) : undefined,
        stops: rawStops
      });

      const ride = creationResult.ride;
      const rideId = ride.id;
      socket.join(rideId);

      console.log(`✅ [RIDE_REQUEST_SUCCESS] Corrida criada ID: ${rideId} | Status: ${ride.status} | Método: ${ride.paymentMethod} | Valor: ${ride.priceXof} XOF`);

      await safeRedis.set(`active_ride:${rideId}`, JSON.stringify({
        rideId, passengerId, pickupLat: pLat, pickupLng: pLng,
        fareXOF: Number(ride.priceXof), status: ride.status,
      }));

      if (ride.status === 'AWAITING_PAYMENT') {
        socket.emit('ride:awaiting_payment', { rideId, ride, payment: (creationResult as any).payment || null });
        return;
      }

      const DISPATCH_RADIUS_KM = 12;
      const nearbyDriverIds = await safeRedis.geoSearch(
        'drivers:locations',
        { longitude: pLng, latitude: pLat },
        { radius: DISPATCH_RADIUS_KM, unit: 'km' }
      );

      console.log(`🔍 [RIDE_REQUEST_DEBUG] Redis encontrou ${nearbyDriverIds?.length || 0} motoristas em um raio de ${DISPATCH_RADIUS_KM}km`);

      const driverSelectFields: any = {
        id: true,
        deviceToken: true,
        isAvailable: true,
        currentRideId: true,
        lastLat: true,
        lastLng: true,
        rides: {
          where: { status: { in: ['ACCEPTED', 'ARRIVED', 'IN_PROGRESS'] } },
          select: { id: true }
        }
      };

      // 🟢 Busca primária no raio Redis + Fallback direto no PostgreSQL se o Redis estiver vazio/desatualizado
      let candidateDrivers = (nearbyDriverIds && nearbyDriverIds.length > 0)
        ? await prisma.driver.findMany({
            where: {
              id: { in: nearbyDriverIds },
              vehicleType: normalizedVehicleType as any,
              isOnline: true,
              status: 'APPROVED',
              walletBalance: { gte: 0 }
            },
            select: driverSelectFields
          })
        : [];

      if (candidateDrivers.length === 0) {
        console.warn(`⚠️ [RIDE_REQUEST_FALLBACK] Redis sem candidatos para ${normalizedVehicleType}. Consultando motoristas online no PostgreSQL (raio ${DISPATCH_RADIUS_KM}km)...`);
        const allOnlineDrivers = await prisma.driver.findMany({
          where: {
            vehicleType: normalizedVehicleType as any,
            isOnline: true,
            status: 'APPROVED',
            walletBalance: { gte: 0 }
          },
          select: driverSelectFields
        });

        candidateDrivers = allOnlineDrivers.filter((drv: any) => {
          const dLat = Number(drv.lastLat);
          const dLng = Number(drv.lastLng);
          if (!isValidCoordinate(dLat, dLng)) return false;
          const toRad = (v: number) => (v * Math.PI) / 180;
          const dLatRad = toRad(dLat - pLat);
          const dLngRad = toRad(dLng - pLng);
          const a =
            Math.sin(dLatRad / 2) * Math.sin(dLatRad / 2) +
            Math.cos(toRad(pLat)) * Math.cos(toRad(dLat)) *
            Math.sin(dLngRad / 2) * Math.sin(dLngRad / 2);
          const distKm = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          return distKm <= DISPATCH_RADIUS_KM;
        });

        for (const fallbackDrv of candidateDrivers) {
          const fLat = Number(fallbackDrv.lastLat);
          const fLng = Number(fallbackDrv.lastLng);
          if (isValidCoordinate(fLat, fLng)) {
            await safeRedis.geoAdd('drivers:locations', {
              longitude: fLng,
              latitude: fLat,
              member: String((fallbackDrv as any).id)
            }).catch(() => null);
          }
        }
      }

      if (candidateDrivers.length === 0 && process.env.ALLOW_REMOTE_TEST_DISPATCH === 'true') {
        console.warn(`🧪 [REMOTE_TEST_DISPATCH] Nenhum motorista em 12km de Bissau. Buscando motoristas aprovados online para teste remoto (${normalizedVehicleType})...`);
        candidateDrivers = await prisma.driver.findMany({
          where: {
            vehicleType: normalizedVehicleType as any,
            isOnline: true,
            status: 'APPROVED',
            walletBalance: { gte: 0 }
          },
          select: driverSelectFields
        });
      }

      const matchingDrivers: any[] = candidateDrivers.filter((driver: any) => {
        if (driver.isAvailable || !driver.currentRideId) return true;
        const activeRidesCount = Array.isArray(driver.rides) ? driver.rides.length : 0;
        return activeRidesCount <= 1;
      });

      console.log(`🎯 [RIDE_REQUEST_DEBUG] ${matchingDrivers.length} de ${candidateDrivers.length} motoristas qualificados aptos a receber a oferta`);

      if (matchingDrivers.length === 0) {
        socket.emit('ride:no_drivers_found');
        socket.emit('error', { message: `Nenhum motorista disponível na categoria ${normalizedVehicleType} no momento.` });
        await cancelRideLogic(rideId, passengerId, 'PASSENGER', 'Sem motoristas qualificados');
        return;
      }


      const passengerInfo = await prisma.passenger.findUnique({
        where: { id: passengerId },
        select: { fullName: true, phone: true, profilePicture: true, ratingAverage: true }
      });

      console.log(`📸 [FOTO_DEBUG] Foto do Passageiro montada para despacho da oferta: "${passengerInfo?.profilePicture || 'SEM_FOTO'}"`);

      const syncedPrice = Math.round(Number(ride.priceXof || 0));
      const syncedDistance = Number(Number(ride.distanceKm || 0).toFixed(2));
      const syncedDuration = Number(ride.durationMin || 0);
      socket.emit('ride:price_calculated', { rideId, price: syncedPrice, priceXof: syncedPrice, distance: syncedDistance, distanceKm: syncedDistance, durationMin: syncedDuration });

      const requestPayload = {
        rideId,
        passengerId: ride.passengerId,
        passengerName: passengerInfo?.fullName || 'Passageiro',
        passengerPhone: null,
        passengerPhoto: passengerInfo?.profilePicture || null,
        passengerRating: Number(passengerInfo?.ratingAverage || 5.0),
        pickupLat: pLat,
        pickupLng: pLng,
        originLat: pLat,
        originLng: pLng,
        originAddress: rideData.originAddress,
        destinationLat: dLat,
        destinationLng: dLng,
        destinationAddress: rideData.destinationAddress,
        stops: ride.stops || rawStops,
        referencePoint: ride.referencePoint || null,
        pickupReferencePoint: rideData?.pickupReferencePoint || ride.referencePoint || '',
        dropoffReferencePoint: rideData?.dropoffReferencePoint || '',
        fareXOF: syncedPrice,
        priceXof: syncedPrice,
        estimatedPrice: syncedPrice,
        distanceKm: syncedDistance,
        durationMin: syncedDuration,
        vehicleType: normalizedVehicleType,
        serviceType: ride.serviceType,
        paymentMethod: ride.paymentMethod || 'CASH'
      };

      for (const d of matchingDrivers) {
        const activeRidesCount = Array.isArray(d.rides) ? d.rides.length : 0;
        const isQueuedOffer = activeRidesCount > 0;

        await (prisma as any).rideOffer?.upsert({
          where: { rideId_driverId: { rideId, driverId: d.id } },
          update: { status: 'PENDING', expiresAt: new Date(Date.now() + 15000) },
          create: { rideId, driverId: d.id, status: 'PENDING', expiresAt: new Date(Date.now() + 15000) }
        }).catch(() => null);

        console.log(`📡 [RIDE_DISPATCH] Enviando evento "ride:new_request" para o motorista ID: ${d.id}`);

        io.to(d.id)
          .to(`driver_${d.id}`)
          .to(`driver:${d.id}`)
          .emit('ride:new_request', { ...requestPayload, isQueuedOffer });

        if (d.deviceToken) {
          sendPushNotification(
            d.deviceToken,
            `🚕 Nova Corrida (${ride.priceXof} XOF em Dinheiro)`,
            `Passageiro: ${passengerInfo?.fullName || 'Passageiro'} solicitou corrida!`,
            { type: 'NEW_RIDE_REQUEST', rideId, isQueuedOffer },
            PUSH_CHANNELS.NEW_RIDE_ALARM
          ).catch(() => null);
        }
      }
    } catch (err: any) {
      console.error('❌ Erro na solicitação da corrida:', err);
      socket.emit('error', { message: 'Erro ao processar sua solicitação de corrida.' });
    }
  });

  // --- MOTORISTA ACEITA A CORRIDA ---
  handleSocketEvent(socket, 'driver:accept_ride', async (data, ackCallback?: Function) => {
    if (isSocketRateLimited(socket, 'driver:accept_ride', 2000, 1)) return;
    if (!isDriver(socket)) {
      const errorMsg = 'Apenas motoristas podem aceitar corridas.';
      socket.emit('error', { message: errorMsg });
      socket.emit('driver:accept_ride_response', { error: true, message: errorMsg });
      if (typeof ackCallback === 'function') ackCallback({ error: true, message: errorMsg });
      return;
    }

    const driverId = socket.data.user?.id || data?.driverId;
    const { rideId, driverLat, driverLng } = data || {};

    console.log(`⚡ [RIDE_ACCEPT_DEBUG] Motorista ID: ${driverId} aceitando a corrida ID: ${rideId}`);

    if (!rideId || !driverId || !isUuid(rideId)) {
      const errorMsg = 'ID de corrida ou motorista inválido.';
      socket.emit('error', { message: errorMsg });
      socket.emit('driver:accept_ride_response', { error: true, message: errorMsg });
      if (typeof ackCallback === 'function') ackCallback({ error: true, message: errorMsg });
      return;
    }

    const lockKey = `lock:accept_ride:${rideId}`;
    const acquiredLock = await safeRedis.set(lockKey, driverId, { NX: true, EX: 5 });

    if (!acquiredLock) {
      const currentLock = await safeRedis.get(lockKey);
      if (currentLock && currentLock !== driverId) {
        console.warn(`🔒 [RIDE_ACCEPT_WARN] Race condition evitada! Corrida ${rideId} travada por outro motorista.`);
        const errorMsg = 'Corrida já foi aceita por outro colega!';
        socket.emit('error', { message: errorMsg });
        socket.emit('driver:accept_ride_response', { error: true, message: errorMsg });
        if (typeof ackCallback === 'function') ackCallback({ error: true, message: errorMsg });
        return;
      }
    }

    try {
      const ride = await prisma.ride.findUnique({
        where: { id: rideId },
        include: { passenger: true }
      });

      if (!ride || (ride.status !== 'SEARCHING' && ride.status !== 'PENDING')) {
        const errorMsg = 'Esta corrida já foi aceita por outro motorista ou cancelada.';
        socket.emit('error', { message: errorMsg });
        socket.emit('driver:accept_ride_response', { error: true, message: errorMsg });
        if (typeof ackCallback === 'function') ackCallback({ error: true, message: errorMsg });
        return;
      }

      let updatedRide;
      if (typeof acceptRideLogic === 'function') {
        updatedRide = await acceptRideLogic(rideId, driverId);
      } else {
        updatedRide = await prisma.ride.update({
          where: { id: rideId },
          data: {
            driverId: driverId,
            status: 'ACCEPTED',
            acceptedAt: new Date()
          },
          include: { passenger: true, driver: true }
        });
      }

      await (prisma as any).rideOffer?.updateMany({
        where: { rideId, driverId },
        data: { status: 'ACCEPTED' }
      }).catch(() => null);

      const competingOffers = await (prisma as any).rideOffer?.findMany({
        where: { rideId, driverId: { not: driverId }, status: 'PENDING' },
        select: { driverId: true }
      }).catch(() => []) || [];

      if (competingOffers.length > 0) {
        await (prisma as any).rideOffer?.updateMany({
          where: { rideId, driverId: { not: driverId }, status: 'PENDING' },
          data: { status: 'EXPIRED' }
        }).catch(() => null);

        for (const offer of competingOffers) {
          if (!offer?.driverId || offer.driverId === driverId) continue;
          io.to(offer.driverId)
            .to(`driver_${offer.driverId}`)
            .to(`driver:${offer.driverId}`)
            .emit('ride:taken', {
              rideId,
              winnerDriverId: driverId,
              message: 'Outro motorista aceitou esta corrida primeiro.'
            });
        }
      }

      const existingActiveRide = await safeRedis.get(`driver_active_ride:${driverId}`);
      const isQueuedRide = !!existingActiveRide && existingActiveRide !== rideId;

      if (!isQueuedRide) {
        await safeRedis.set(`driver_active_ride:${driverId}`, rideId);
        socket.leave('available_drivers');
      }

      socket.join(rideId);

      const passengerId = updatedRide.passengerId || ride.passengerId;
      const passengerUser = updatedRide.passenger || ride.passenger;
      const driverUser = updatedRide.driver || await prisma.driver.findUnique({ where: { id: driverId } });

      console.log(`📸 [FOTO_DEBUG] AcceptRide - Foto do Motorista: "${driverUser?.profilePicture || 'SEM_FOTO'}" | Passageiro: "${passengerUser?.profilePicture || 'SEM_FOTO'}"`);
       const syncedPrice = Math.round(Number(updatedRide.priceXof || ride.priceXof || 0));
      const syncedDistance = Number(Number(updatedRide.distanceKm || ride.distanceKm || 0).toFixed(2));
      const syncedDuration = Number(updatedRide.durationMin || ride.durationMin || 0);
      const acceptPayload = {
        rideId: ride.id,
        driverId: driverId,
        driverLat: Number(driverLat || (driverUser as any)?.lastLat || 0),
        driverLng: Number(driverLng || (driverUser as any)?.lastLng || 0),
        driverName: driverUser?.fullName || 'Motorista',
        driverPhoto: driverUser?.profilePicture || null,
        carModel: driverUser?.vehicleBrand || 'Veículo Padrão',
        carColor: driverUser?.vehicleColor || 'BRANCO',
        vehicleType: driverUser?.vehicleType || 'PARTICULAR',
        licensePlate: driverUser?.vehiclePlate || 'N/A',
        driverRating: Number(driverUser?.ratingAverage || 5.0),
        driverPhone: null,
        startOtp: updatedRide.startOtp || ride.startOtp || null,
        passengerName: passengerUser?.fullName || 'Passageiro',
        passengerPhone: null,
        passengerPhoto: passengerUser?.profilePicture || null,
        originAddress: updatedRide.originAddress || ride.originAddress,
        destinationAddress: updatedRide.destinationAddress || ride.destinationAddress,
        pickupLat: Number(updatedRide.originLat || ride.originLat),
        pickupLng: Number(updatedRide.originLng || ride.originLng),
        destinationLat: Number(updatedRide.destinationLat || ride.destinationLat),
        destinationLng: Number(updatedRide.destinationLng || ride.destinationLng),
        priceXof: syncedPrice,
        fareXOF: syncedPrice,
        distanceKm: syncedDistance,
        durationMin: syncedDuration,
        paymentMethod: updatedRide.paymentMethod || ride.paymentMethod || 'CASH',
        isQueuedRide
      };

      console.log(`🎉 [RIDE_ACCEPT_SUCCESS] Motorista ${driverId} assumiu a corrida ${rideId}`);

      const passengerRooms = [
        rideId,
        passengerId,
        `passenger_${passengerId}`,
        `passenger:${passengerId}`,
        `user_${passengerId}`
      ].filter(Boolean);

      passengerRooms.forEach(room => {
        io.to(room).emit('ride:accepted', acceptPayload);
      });

      socket.emit('driver:accept_ride_success', acceptPayload);
      socket.emit('driver:accept_ride_response', { success: true, rideId: ride.id, isQueuedRide });
      if (typeof ackCallback === 'function') {
        ackCallback({ success: true, rideId: ride.id, isQueuedRide });
      }

      // Push RIDE_ACCEPTED enviado de forma única por acceptRideLogic em rideService.ts


      io.to('admin_dashboard').emit('admin:ride_update', {
        rideId, status: 'ACCEPTED', driverId, passengerId, isQueuedRide
      });

    } catch (err: any) {
      console.error(`❌ [RIDE_ACCEPT_ERROR] Driver ${driverId} -> Ride ${rideId}:`, err?.message || err);
      const errorMsg = err.message || 'Erro ao atribuir corrida.';

      socket.emit('error', { message: errorMsg });
      socket.emit('driver:accept_ride_response', { error: true, message: errorMsg });
      if (typeof ackCallback === 'function') ackCallback({ error: true, message: errorMsg });

    } finally {
      const lockHolder = await safeRedis.get(lockKey);
      if (lockHolder === driverId) await safeRedis.del(lockKey);
    }
  });

  // --- ATUALIZAÇÃO DE LOCALIZAÇÃO DO MOTORISTA ---
  handleSocketEvent(socket, 'driver:location_update', async (coords) => {
    if (isSocketRateLimited(socket, 'driver:location_update', 1000, 1)) return;
    if (!isDriver(socket)) return;

    const {
      rideId,
      latitude,
      longitude,
      speed,
      heading,
      durationMinutes,
      distanceKm,
      routeCoordinates,
      phase
    } = coords || {};
    const driverId = socket.data.user?.id;

    if (!isValidCoordinate(Number(latitude), Number(longitude))) return;

    const safeSpeed = speed != null ? Number(speed) : null;
    const safeHeading = heading != null ? Number(heading) : 0;
    const safeDuration =
      durationMinutes != null && Number.isFinite(Number(durationMinutes)) && Number(durationMinutes) > 0
        ? Math.max(1, Math.round(Number(durationMinutes)))
        : null;
    const safeDistanceKm =
      distanceKm != null && Number.isFinite(Number(distanceKm)) && Number(distanceKm) >= 0
        ? Number(Number(distanceKm).toFixed(2))
        : null;
    const safeRouteCoordinates =
      Array.isArray(routeCoordinates) &&
      routeCoordinates.length >= 2 &&
      routeCoordinates.length <= 5000 &&
      routeCoordinates.every(
        (pt: any) =>
          Array.isArray(pt) &&
          pt.length >= 2 &&
          Number.isFinite(Number(pt[0])) &&
          Number.isFinite(Number(pt[1]))
      )
        ? routeCoordinates.map((pt: any) => [Number(pt[0]), Number(pt[1])])
        : undefined;

    await safeRedis.geoAdd('drivers:locations', {
      longitude: Number(longitude),
      latitude: Number(latitude),
      member: driverId
    });
    await safeRedis.set(`driver:last_seen:${driverId}`, String(Date.now()), { EX: 300 });

    if (rideId && isUuid(rideId)) {
      const posPayload: Record<string, any> = {
        rideId,
        latitude: Number(latitude),
        longitude: Number(longitude),
        heading: safeHeading,
        durationMinutes: safeDuration,
        distanceKm: safeDistanceKm,
        phase: typeof phase === 'string' ? phase : null,
      };
      if (safeRouteCoordinates) {
        posPayload.routeCoordinates = safeRouteCoordinates;
      }
      io.to(rideId).emit('driver:position', posPayload);
      io.to(`ride_${rideId}`).emit('driver:position', posPayload);
    }


    const liveTelemetryPayload = {
      driverId,
      latitude: Number(latitude),
      longitude: Number(longitude),
      heading: safeHeading,
      speed: Number(coords?.speed || 0),
      rideId: rideId || null,
      phase: typeof phase === 'string' ? phase : null,
      status: rideId ? 'ON_RIDE' : 'AVAILABLE',
    };
    io.to('admin_dashboard').emit('admin:map_update', liveTelemetryPayload);
    io.to('emergency_agencies').emit('admin:map_update', liveTelemetryPayload);

    const dbKey = `last_db_sync:${driverId}`;
    const lastSync = await safeRedis.get(dbKey);
    const now = Date.now();

    if (!lastSync || now - Number(lastSync) > 10000) {
      await safeRedis.set(dbKey, String(now), { EX: 15 });

      prisma.driver.update({
        where: { id: driverId },
        data: {
          lastLat: Number(latitude),
          lastLng: Number(longitude),
          currentHeading: safeHeading,
          lastLocationUpdate: new Date()
        }
      }).catch(() => null);

      if (rideId && isUuid(rideId) && safeSpeed !== null && !isNaN(safeSpeed)) {
        prisma.rideLocationHistory.create({
          data: {
            rideId,
            lat: Number(latitude),
            lng: Number(longitude),
            heading: safeHeading,
            speed: safeSpeed
          }
        }).catch(() => null);
      }
    }
  });

  // --- DASHBOARD ADMIN ---
  handleSocketEvent(socket, 'admin:join_dashboard', () => {
    const role = socket.data.user?.role;
    if (role && ['SUPER_ADMIN', 'OPERATOR', 'FINANCE'].includes(role)) {
      if (socket.data.user?.role === 'EMERGENCY_AGENCY') { socket.join('emergency_agencies'); } else { socket.join('admin_dashboard'); }
      console.log(`🛡️ [ADMIN_DEBUG] Usuário ${socket.data.user?.id} (${role}) entrou na sala "admin_dashboard".`);
    } else {
      socket.emit('error', { message: 'Acesso negado.' });
    }
  });

  // --- MOTORISTA CHEGOU AO LOCAL ---
  handleSocketEvent(socket, 'driver:arrived', async (data, ackCallback?: Function) => {
    if (isSocketRateLimited(socket, 'driver:arrived')) return;
    if (!isDriver(socket)) {
      socket.emit('error', { message: 'Apenas motoristas.' });
      if (typeof ackCallback === 'function') ackCallback({ error: true, message: 'Apenas motoristas.' });
      return;
    }

    const { rideId } = data || {};
    const driverId = socket.data.user.id;
    if (!isUuid(rideId)) {
      socket.emit('error', { message: 'ID de corrida inválido.' });
      if (typeof ackCallback === 'function') ackCallback({ error: true, message: 'ID de corrida inválido.' });
      return;
    }

    console.log(`📍 [ARRIVED_DEBUG] Motorista ID: ${driverId} informou chegada no embarque da corrida ID: ${rideId}`);

    const ride = await driverArrivedLogic(rideId, driverId);
    if (typeof ackCallback === 'function') ackCallback({ success: true, rideId });


    const arrivedPayload = { rideId, status: 'ARRIVED', startOtp: ride?.startOtp };

    const targetRooms = [
      rideId,
      ride?.passengerId,
      `passenger_${ride?.passengerId}`,
      `passenger:${ride?.passengerId}`,
      `user_${ride?.passengerId}`
    ].filter(Boolean);

    targetRooms.forEach(room => {
      io.to(room).emit('ride:driver_arrived', arrivedPayload);
      io.to(room).emit('ride:arrived', arrivedPayload);
    });

    // Push DRIVER_ARRIVED enviado de forma única por driverArrivedLogic em rideService.ts
  });

  // --- INICIAR CORRIDA ---
  handleSocketEvent(socket, 'driver:start_ride', async (data, ackCallback?: Function) => {
    if (isSocketRateLimited(socket, 'driver:start_ride')) return;
    if (!isDriver(socket)) {
      socket.emit('error', { message: 'Acesso negado.' });
      if (typeof ackCallback === 'function') ackCallback({ error: true, message: 'Acesso negado.' });
      return;
    }

    const { rideId, otp } = data || {};
    const driverId = socket.data.user.id;

    console.log(`🚀 [START_RIDE_DEBUG] Motorista ID: ${driverId} iniciando corrida ID: ${rideId} com PIN/OTP: "${otp}"`);

    if (!isUuid(rideId) || !otp) {
      socket.emit('error', { message: 'Código OTP obrigatório.' });
      if (typeof ackCallback === 'function') ackCallback({ error: true, message: 'Código OTP obrigatório.' });
      return;
    }

    try {
      const updatedRide = await startRideLogic(rideId, driverId, String(otp));
      if (typeof ackCallback === 'function') ackCallback({ success: true, rideId });


      console.log(`✅ [START_RIDE_SUCCESS] Corrida ID: ${rideId} iniciada com sucesso! Status: IN_PROGRESS`);

      const startPayload = { rideId, status: 'IN_PROGRESS', startedAt: updatedRide?.startedAt };

      const targetRooms = [
        rideId,
        updatedRide?.passengerId,
        `passenger_${updatedRide?.passengerId}`,
        `passenger:${updatedRide?.passengerId}`,
        `user_${updatedRide?.passengerId}`
      ].filter(Boolean);

      targetRooms.forEach(room => {
        io.to(room).emit('ride:started', startPayload);
      });

      io.to('admin_dashboard').emit('admin:ride_update', { rideId, status: 'IN_PROGRESS', driverId });

      // Push RIDE_STARTED enviado de forma única por startRideLogic em rideService.ts
    } catch (err: any) {
      const errMsg = err?.message || 'Falha ao validar OTP.';
      console.error(`❌ [START_RIDE_ERROR] Driver ${driverId} -> Ride ${rideId}:`, errMsg);
      socket.emit('error', { message: errMsg });
      if (typeof ackCallback === 'function') ackCallback({ error: true, message: errMsg });
    }

  });

  // --- FINALIZAR CORRIDA E LIQUIDAÇÃO DA COMISSÃO ---
  handleSocketEvent(socket, 'driver:finish_ride', async (data, ackCallback?: Function) => {
    if (isSocketRateLimited(socket, 'driver:finish_ride')) return;
    if (!isDriver(socket)) {
      socket.emit('error', { message: 'Acesso negado.' });
      if (typeof ackCallback === 'function') ackCallback({ error: true, message: 'Acesso negado.' });
      return;
    }

    const { rideId, dropoffLat, dropoffLng, finishOtp } = data || {};
    const driverId = socket.data.user.id;

    console.log(`🏁 [FINALIZE_DEBUG] Tentativa de finalização: Driver: ${driverId} | Ride: ${rideId} | Coords: ${dropoffLat}, ${dropoffLng} | PIN: ${finishOtp || 'N/A'}`);

    if (!isUuid(rideId) || !isValidCoordinate(Number(dropoffLat), Number(dropoffLng))) {
      socket.emit('error', { message: 'Coordenadas de destino inválidas.' });
      if (typeof ackCallback === 'function') ackCallback({ error: true, message: 'Coordenadas de destino inválidas.' });
      return;
    }

    try {
      const result = await (finalizeRideAndCharge as (
        rideId: string,
        finalLat: number,
        finalLng: number,
        finishOtpInput?: string
      ) => Promise<any>)(
        rideId,
        Number(dropoffLat),
        Number(dropoffLng),
        finishOtp ? String(finishOtp) : undefined
      );


      console.log(`✅ [FINALIZE_SUCCESS] Corrida ID: ${rideId} finalizada! Total: ${result?.fareXOF} XOF | Ganho Motorista: ${result?.driverEarnings} XOF | Comissão: ${result?.platformFee} XOF`);

      await safeRedis.del(`active_ride:${rideId}`);

      if (result?.hasQueuedRide && result?.nextRideId) {
        await safeRedis.set(`driver_active_ride:${driverId}`, result.nextRideId, { EX: 14400 });
        console.log(`🔄 [FINALIZE_DEBUG] Motorista ${driverId} promovido para corrida em fila ID: ${result.nextRideId}`);
      } else {
        await safeRedis.del(`driver_active_ride:${driverId}`);
      }

      const dropLatNum = Number(dropoffLat);
      const dropLngNum = Number(dropoffLng);
      if (isValidCoordinate(dropLatNum, dropLngNum)) {
        await safeRedis.geoAdd('drivers:locations', {
          longitude: dropLngNum,
          latitude: dropLatNum,
          member: driverId
        });
        console.log(`📍 [REDIS_GEO] Motorista ${driverId} re-inserido em 'drivers:locations' no ponto final.`);
      }

      if (!result?.hasQueuedRide) {
        socket.join('available_drivers');
      }
      socket.join(`driver_${driverId}`);
      socket.leave(rideId);

        if (typeof ackCallback === 'function') {
          ackCallback({
            success: true,
            rideId,
            fareXOF: result?.fareXOF,
            driverEarnings: result?.driverEarnings,
            platformFee: result?.platformFee,
            distanceKm: result?.distanceKm,
            transactionId: result?.transactionId || result?.commissionTransactionId || `TRX-${rideId.slice(0, 6).toUpperCase()}`,
          });
        }

        io.to('admin_dashboard').emit('admin:ride_update', { rideId, status: 'FINISHED' });
      } catch (err: any) {
        const errMsg = err?.message || 'Erro ao finalizar a corrida e debitar comissão.';
        console.error(`🚨 [FINALIZE_ERROR] Falha ao finalizar corrida ${rideId}:`, err);
        socket.emit('error', { message: errMsg });
        if (typeof ackCallback === 'function') ackCallback({ error: true, message: errMsg });
      }

  });

 // 🟢 NO BACKEND: backend/src/server.ts (ou socket handler)
handleSocketEvent(socket, 'chat:send_message', async (data) => {
  try {
    const { rideId, text, message, audioUrl, audio, audioDuration, duration, id } = data || {};
    const senderRole = (data?.sender || data?.senderRole || 'passenger').toLowerCase();

    if (!rideId || !isUuid(rideId)) return;

    const ride = await prisma.ride.findUnique({
      where: { id: rideId },
      include: { driver: true, passenger: true }
    });

    if (!ride) return;
    socket.join(rideId);
    socket.join(`ride_${rideId}`);

    const rawText = (typeof text === 'string' && !text.startsWith('data:audio')) ? text.trim()
      : (typeof message === 'string' && !message.startsWith('data:audio')) ? message.trim() : '';
    const rawAudio = audioUrl || audio
      || (typeof text === 'string' && text.startsWith('data:audio') ? text : null)
      || (typeof message === 'string' && message.startsWith('data:audio') ? message : null);
    const finalDuration = Math.max(0, Number(audioDuration || duration || 0));

    if (!rawText && !rawAudio) return;

    let finalAudioUrl: string | null = null;
    if (rawAudio && typeof rawAudio === 'string') {
      if (rawAudio.startsWith('http://') || rawAudio.startsWith('https://')) {
        finalAudioUrl = rawAudio;
      } else {
        try {
  const uploadDir = path.join(process.cwd(), 'uploads', 'chat');

  // Usamos fs.promises para não bloquear a thread principal
  await fs.promises.mkdir(uploadDir, { recursive: true });

  const cleanBase64 = rawAudio.replace(/^data:audio\/[^;]+;base64,/, '');
  const fileName = `${rideId}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.m4a`;

  // writeFile assíncrono
  await fs.promises.writeFile(
    path.join(uploadDir, fileName),
    Buffer.from(cleanBase64, 'base64')
  );

  const baseOrigin = (process.env.APP_URL || 'https://api.nobai245.com').replace(/\/api\/?$/, '').replace(/\/$/, '');
  finalAudioUrl = `${baseOrigin}/api/uploads/chat/${fileName}`;
} catch (fileErr: any) {
  console.error('❌ [CHAT_AUDIO_SAVE_ERR]:', fileErr?.message);
  finalAudioUrl = rawAudio;
}
      }
    }

    const inlineAudioData = (rawAudio && typeof rawAudio === 'string' && rawAudio.startsWith('data:audio/')) ? rawAudio : undefined;
    const dbMessageContent = finalAudioUrl ? `[AUDIO]${finalAudioUrl}|${finalDuration}` : rawText;
    const senderTypeEnum = senderRole === 'driver' ? 'DRIVER' : 'PASSENGER';
    const senderUserId = socket.data.user?.id || (senderRole === 'driver' ? ride.driverId : ride.passengerId);

    const messagePayload = {
      id: id || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      rideId,
      sender: senderRole,
      senderType: senderTypeEnum,
      text: finalAudioUrl ? '' : rawText,
      message: finalAudioUrl ? '' : rawText,
      audioUrl: finalAudioUrl,
      audioData: inlineAudioData,
      audioDuration: finalDuration,
      createdAt: new Date().toISOString()
    };

    if (senderUserId) {
      prisma.rideChatMessage.create({
        data: {
          rideId,
          senderId: senderUserId,
          senderType: senderTypeEnum,
          message: dbMessageContent
        }
      }).catch(err => console.error('❌ [CHAT_DB_ERROR]:', err?.message));
    }

    const targetRooms = [
      rideId,
      `ride_${rideId}`,
      ride.passengerId,
      `passenger_${ride.passengerId}`,
      ride.driverId,
      `driver_${ride.driverId}`,
    ].filter(Boolean) as string[];

    targetRooms.forEach(room => {
      io.to(room).emit('chat:receive_message', messagePayload);
      io.to(room).emit('chat:message', messagePayload);
      io.to(room).emit('chat:new_message', messagePayload);
    });

    const recipientToken = senderRole === 'driver' ? ride.passenger?.deviceToken : ride.driver?.deviceToken;
    const senderName = senderRole === 'driver' ? (ride.driver?.fullName || 'Motorista') : (ride.passenger?.fullName || 'Passageiro');
    const notificationBody = finalAudioUrl ? '🎤 Mensagem de áudio recebida' : (rawText || 'Nova mensagem no chat');

    if (recipientToken) {
      sendPushNotification(
        recipientToken,
        `💬 ${senderName}`,
        notificationBody,
        {
          rideId,
          type: 'CHAT_MESSAGE',
          channelId: 'chat-messages'
        },
        PUSH_CHANNELS.CHAT
      ).catch(() => {});
    }
  } catch (err) {
    console.error('💥 [SOCKET_CHAT_ERROR]:', err);
  }
});
  // =============================================================================
  // 🛑 CANCELAMENTO DE CORRIDA SINCRONIZADO
  // =============================================================================
  handleSocketEvent(socket, 'ride:cancel', async (data, ackCallback?: Function) => {
    if (isSocketRateLimited(socket, 'ride:cancel', 2000, 2)) return;
    const { rideId, userId, userType, reason } = data || {};

    const currentUserId = userId || socket.data.user?.id;
    console.log(`❌ [CANCEL_DEBUG] Requisição de cancelamento Socket da corrida ${rideId} por ${userType || 'Desconhecido'}`);

    if (!isUuid(rideId) || !isAuthorizedUser(socket, currentUserId)) {
      socket.emit('error', { message: 'Ação não autorizada.' });
      if (typeof ackCallback === 'function') ackCallback({ error: true, message: 'Ação não autorizada.' });
      return;
    }

    try {
      const rideToCancel = await prisma.ride.findUnique({
        where: { id: rideId },
        include: { passenger: true, driver: true }
      });

      if (!rideToCancel) {
        if (typeof ackCallback === 'function') ackCallback({ success: true, rideId });
        return;
      }


      const cleanReason = typeof reason === 'string' ? reason.trim().slice(0, 250) : 'Corrida cancelada';
      const normalizedUserType = (userType || socket.data.user?.role || socket.data.user?.userType) === 'DRIVER' ? 'DRIVER' : 'PASSENGER';

      const result = await cancelRideLogic(rideId, currentUserId, normalizedUserType, cleanReason);

        if (typeof ackCallback === 'function') {
          ackCallback({
            success: true,
            rideId,
            appliedPenalty: Boolean(result?.appliedPenalty),
            penaltyAmount: Number(result?.penaltyAmount || 0)
          });
        }

      } catch (err: any) {
        const errMsg = String(err?.message || 'Erro ao cancelar corrida.');
        console.error(`❌ [CANCEL_ERROR] ID: ${rideId}:`, errMsg);
        if (!errMsg.includes('STATE_CONFLICT')) {
          socket.emit('error', { message: errMsg });
        }
        if (typeof ackCallback === 'function') ackCallback({ error: true, message: errMsg });
      }

  });

});

// -----------------------------------------------------------------------------
// 7. ENCERRAMENTO GRACIOSO DO SERVIDOR (SHUTDOWN)
// -----------------------------------------------------------------------------
const shutdown = async () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log('\n🛑 [SISTEMA BAI245] Iniciando shutdown seguro e drenagem de conexões...');

  const forceExitTimeout = setTimeout(() => {
    console.error('⚠️ [SHUTDOWN] Forçando encerramento do processo após timeout de 10s.');
    process.exit(1);
  }, 10000);

  try {
    io.emit('server:reconnecting', { reason: 'deploy_maintenance', retryAfterMs: 2000 });
    await new Promise<void>((resolve) => {
      io.close(() => resolve());
      setTimeout(resolve, 1500);
    });
    console.log('📡 [SOCKET.IO] Conexões WebSocket drenadas.');
  } catch (sockErr) {
    console.warn('⚠️ [SHUTDOWN] Aviso ao encerrar Socket.IO:', sockErr);
  }

  server.close(async () => {
    try {
      if (redisClient?.isOpen) {
        await redisClient.quit();
        console.log('📦 [REDIS MAIN] Conexão encerrada com segurança.');
      }
      if (pubClient?.isOpen) await pubClient.quit();
      if (subClient?.isOpen) await subClient.quit();

      await prisma.$disconnect();
      console.log('🗄️ [PRISMA] Pool do Banco de Dados liberado.');
      console.log('✅ Sistema desligado com sucesso.');

      clearTimeout(forceExitTimeout);
      process.exit(0);
    } catch (err) {
      console.error('❌ Erro severo durante shutdown:', err);
      clearTimeout(forceExitTimeout);
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
    console.log(`💵 Pagamento de Viagens: 100% Dinheiro (Cash Only)`);
    console.log(`💳 Recarga de Carteira: Orange Money & MTN MoMo (+245)`);
    console.log(`📡 Infraestrutura Sockets rodando em 0.0.0.0:${PORT}`);
    console.log('======================================================\n');
  });
}

// =============================================================================
// 🛡️ WATCHDOG DE PRODUÇÃO (LIMPEZA DE FANTASMAS E RECONCILIAÇÃO A CADA 60s)
// =============================================================================
setInterval(async () => {
  try {
    const now = Date.now();
    // 1. Marcar como offline motoristas sem sinal de GPS há mais de 3 minutos
    const threeMinAgo = new Date(now - 180000);
    const staleDrivers = await prisma.driver.findMany({
      where: {
        isOnline: true,
        currentRideId: null,
        OR: [
          { lastLocationUpdate: { lt: threeMinAgo } },
          { lastLocationUpdate: null }
        ]
      },
      select: { id: true }
    });
    for (const d of staleDrivers) {
      const lastSeen = await safeRedis.get(`driver:last_seen:${d.id}`).catch(() => null);
      if (!lastSeen || now - Number(lastSeen) > 180000) {
  try {
    // Verifica qual é o método real disponível na sua biblioteca do Redis (ioredis ou redis v4)
    if (typeof safeRedis.zRem === 'function') {
      await safeRedis.zRem('drivers:locations', d.id);
    } else {
      console.warn(`⚠️ [WATCHDOG_REDIS_WARN] Método para remover do geo-index não encontrado!`);
    }
  } catch (geoErr) {
    console.error(`⚠️ [WATCHDOG_REDIS_ERR] Falha ao remover motorista ${d.id} do mapa:`, geoErr);
  }

  await prisma.driver.updateMany({
    where: { id: d.id, isOnline: true, currentRideId: null },
    data: { isOnline: false }
  }).catch(() => {});
}
    }

    // 2. Expirar corridas em SEARCHING há mais de 5 minutos sem motorista e liberar passageiro
    const fiveMinAgo = new Date(now - 5 * 60 * 1000);
    const staleSearching = await prisma.ride.findMany({
      where: { status: 'SEARCHING', createdAt: { lt: fiveMinAgo } },
      select: { id: true, passengerId: true }
    });
    for (const r of staleSearching) {
      await prisma.ride.updateMany({
        where: { id: r.id, status: 'SEARCHING' },
        data: { status: 'CANCELLED', cancellationReason: 'TIMEOUT_NO_DRIVERS' }
      });
      await prisma.passenger.updateMany({
        where: { id: r.passengerId, currentRideId: r.id },
        data: { currentRideId: null }
      });
      await safeRedis.del(`active_ride:${r.id}`).catch(() => {});
      io.to(r.id).emit('ride:no_drivers_found', { rideId: r.id });
      io.to(`passenger_${r.passengerId}`).emit('ride:no_drivers_found', { rideId: r.id });
    }
  } catch (err) {
    console.error('⚠️ [WATCHDOG_ERR]:', err);
  }
}, 60000);

