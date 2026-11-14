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

// Inicia jobs de reconciliação financeira em segundo plano
startCronJobs();

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
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
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
  limit: '10mb',
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
app.use('/uploads', (req, res, next) => {
  console.log(`📸 [FOTO_DEBUG] Acessando arquivo estático: /uploads${req.url}`);
  next();
}, express.static(path.join(process.cwd(), 'uploads')));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith('/webhooks') || req.path.startsWith('/payments'),
  message: { error: 'Muitas requisições vindas deste IP. Tente novamente em instantes.' }
});

// 🛡️ PROTEÇÃO CONTRA FORÇA BRUTA E ROBÔS DE SMS/OTP (15 tentativas / 15 min por IP)
const authBruteForceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de autenticação ou código. Aguarde 15 minutos e tente novamente.' }
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

app.use('/api/', apiLimiter);

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
app.use('/api', locationRoutes);

app.get('/health', (_req, res) => {
  res.json({
    status: 'online',
    country: 'Guiné-Bissau 🇬🇼',
    currency: 'XOF',
    ridePayment: 'Dinheiro (Cash Only)',
    walletRecharge: 'Orange Money & MTN MoMo',
    timestamp: new Date().toISOString(),
  });
});

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
app.get('/track/:rideId/data', async (req: Request, res: Response) => {
  try {
    const rideId = String(req.params.rideId);
    if (!rideId || rideId.length < 5) {
      return res.status(400).json({ error: 'Identificador de corrida inválido' });
    }

    const ride = await prisma.ride.findUnique({
      where: { id: rideId },
      include: { driver: true }
    });

    if (!ride) return res.status(404).json({ error: 'Corrida não encontrada' });

    const driverLat = Number(ride.driver?.lastLat || ride.originLat || 11.8633);
    const driverLng = Number(ride.driver?.lastLng || ride.originLng || -15.5833);

    return res.json({
      rideId: ride.id,
      status: ride.status || 'IN_PROGRESS',
      driverLat,
      driverLng,
      originLat: Number(ride.originLat),
      originLng: Number(ride.originLng),
      destinationLat: Number(ride.destinationLat),
      destinationLng: Number(ride.destinationLng),
    });
  } catch (error) {
    console.error('❌ Erro na API de dados de rastreamento:', error);
    return res.status(500).json({ error: 'Erro ao buscar dados do rastreamento' });
  }
});

// =============================================================================
// 🌐 ROTA PÚBLICA DE RASTREAMENTO WEB DA VIAGEM
// =============================================================================
app.get('/track/:rideId', async (req: Request, res: Response) => {
  try {
    const rideId = String(req.params.rideId);

    const ride = await prisma.ride.findUnique({
      where: { id: rideId },
      include: {
        driver: true,
        passenger: true
      }
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
            body { background: #0F172A; color: white; font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; text-align: center; }
            .card { background: #1E293B; padding: 30px; border-radius: 20px; border: 1px solid #334155; }
            h2 { color: #EAB308; margin-bottom: 8px; }
            p { color: #94A3B8; }
          </style>
        </head>
        <body>
          <div class="card">
            <h2>⚠️ Viagem não encontrada</h2>
            <p>Esta corrida não existe ou já foi finalizada.</p>
          </div>
        </body>
        </html>
      `);
    }

    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self' https: data: blob: 'unsafe-inline' 'unsafe-eval'; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://api.mapbox.com; " +
      "worker-src 'self' blob:; " +
      "child-src 'self' blob:; " +
      "style-src 'self' 'unsafe-inline' https://api.mapbox.com; " +
      "connect-src 'self' https://*.mapbox.com https://api.mapbox.com; " +
      "img-src 'self' blob: data: https://*.mapbox.com;"
    );

    const driverLat = Number(ride.driver?.lastLat || ride.originLat || 11.8633);
    const driverLng = Number(ride.driver?.lastLng || ride.originLng || -15.5833);
    const originLat = Number(ride.originLat || driverLat);
    const originLng = Number(ride.originLng || driverLng);
    const destLat = Number(ride.destinationLat || driverLat);
    const destLng = Number(ride.destinationLng || driverLng);

    const driverName = sanitizeHtmlText(ride.driver?.fullName || 'Motorista Nô Bai');
    const carModel = sanitizeHtmlText(ride.driver?.vehicleBrand || 'Veículo');
    const carColor = sanitizeHtmlText(ride.driver?.vehicleColor || 'Amarelo');
    const licensePlate = sanitizeHtmlText(ride.driver?.vehiclePlate || 'N/A');
    const destinationAddress = sanitizeHtmlText(ride.destinationAddress || 'Endereço de destino');

    const mapboxToken = process.env.EXPO_PUBLIC_MAPBOX_TOKEN || process.env.MAPBOX_ACCESS_TOKEN || '';

    res.send(`
      <!DOCTYPE html>
      <html lang="pt">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <title>Rastreamento de Viagem - Nô Bai 245</title>
        <script src="https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl.js"></script>
        <link href="https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl.css" rel="stylesheet" />
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          html, body { height: 100%; width: 100%; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #0F172A; color: #FFFFFF; }
          body { display: flex; flex-direction: column; }
          #map { flex: 1; width: 100%; height: 100%; }
          .info-card { background-color: #1E293B; padding: 20px; border-top-left-radius: 24px; border-top-right-radius: 24px; border-top: 1px solid #334155; z-index: 10; box-shadow: 0 -10px 25px rgba(0,0,0,0.5); }
          .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
          .title { font-size: 18px; font-weight: 800; color: #EAB308; display: flex; align-items: center; gap: 8px; }
          .badge { background: #0F172A; color: #10B981; font-weight: 700; font-size: 11px; padding: 4px 10px; border-radius: 12px; border: 1px solid #334155; text-transform: uppercase; letter-spacing: 0.5px; }
          .badge.cancelled { color: #EF4444; border-color: #7F1D1D; }
          .badge.completed { color: #3B82F6; border-color: #1E3A8A; }
          .badge.queued { color: #F59E0B; border-color: #78350F; }

          .metrics-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; background: #0F172A; padding: 12px; border-radius: 14px; margin-bottom: 14px; border: 1px solid #334155; }
          .metric-box { text-align: center; }
          .metric-label { font-size: 11px; color: #94A3B8; text-transform: uppercase; font-weight: 600; margin-bottom: 2px; }
          .metric-value { font-size: 16px; font-weight: 800; color: #F8FAFC; }

          .detail-item { font-size: 13px; color: #CBD5E1; margin-bottom: 6px; display: flex; align-items: center; gap: 6px; }
          .detail-item strong { color: #FFF; }

          .car-icon-wrapper {
            width: 42px;
            height: 42px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: transform 0.6s cubic-bezier(0.25, 1, 0.5, 1);
            transform-origin: center center;
          }
          .car-svg { width: 36px; height: 36px; filter: drop-shadow(0px 4px 6px rgba(0,0,0,0.6)); }
        </style>
      </head>
      <body>
        <div id="map"></div>
        <div class="info-card">
          <div class="header">
            <div class="title">🚕 Nô Bai 245</div>
            <div id="statusBadge" class="badge ${ride.status === 'CANCELLED' ? 'cancelled' : (ride.status === 'COMPLETED' ? 'completed' : ((ride.status as any) === 'QUEUED' ? 'queued' : ''))}">${sanitizeHtmlText(ride.status) || 'EM ANDAMENTO'}</div>
          </div>

          <div class="metrics-grid">
            <div class="metric-box">
              <div class="metric-label">Tempo Estimado</div>
              <div id="etaValue" class="metric-value">Calculando...</div>
            </div>
            <div class="metric-box">
              <div class="metric-label">Distância</div>
              <div id="distValue" class="metric-value">Calculando...</div>
            </div>
          </div>

          <div class="detail-item"><strong>👤 Motorista:</strong> ${driverName}</div>
          <div class="detail-item"><strong>🚘 Veículo:</strong> ${carModel} (${carColor}) — Placa: <strong>${licensePlate}</strong></div>
          <div class="detail-item"><strong>📍 Destino:</strong> ${destinationAddress}</div>
        </div>

        <script>
          const MAPBOX_TOKEN = '${mapboxToken}';
          mapboxgl.accessToken = MAPBOX_TOKEN;

          const origin = [${originLng}, ${originLat}];
          const destination = [${destLng}, ${destLat}];
          let lastPos = [${driverLng}, ${driverLat}];

          const map = new mapboxgl.Map({
            container: 'map',
            style: 'mapbox://styles/mapbox/dark-v11',
            center: lastPos,
            zoom: 15
          });

          const carContainer = document.createElement('div');
          carContainer.className = 'car-icon-wrapper';
          carContainer.innerHTML = \`
            <svg class="car-svg" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5H6.5C5.84 5 5.29 5.42 5.08 6.01L3 12V20C3 20.55 3.45 21 4 21H5C5.55 21 6 20.55 6 20V19H18V20C18 20.55 18.45 21 19 21H20C20.55 21 21 20.55 21 20V12L18.92 6.01ZM6.85 7H17.14L18.22 10.12H5.78L6.85 7ZM19 17H5V12H19V17ZM7.5 16C8.33 16 9 15.33 9 14.5C9 13.67 8.33 13 7.5 13C6.67 13 6 13.67 6 14.5C6 15.33 6.67 16 7.5 16ZM16.5 16C17.33 16 18 15.33 18 14.5C18 13.67 17.33 13 16.5 13C15.67 13 15 13.67 15 14.5C15 15.33 15.67 16 16.5 16Z" fill="#EAB308"/>
            </svg>
          \`;

          const driverMarker = new mapboxgl.Marker({ element: carContainer, anchor: 'center' }).setLngLat(lastPos).addTo(map);

          const originEl = document.createElement('div');
          originEl.style.fontSize = '22px';
          originEl.innerHTML = '🟢';
          new mapboxgl.Marker({ element: originEl }).setLngLat(origin).addTo(map);

          const destEl = document.createElement('div');
          destEl.style.fontSize = '22px';
          destEl.innerHTML = '🏁';
          new mapboxgl.Marker({ element: destEl }).setLngLat(destination).addTo(map);

          function calculateBearing(startLat, startLng, destLat, destLng) {
            const startLatRad = startLat * Math.PI / 180;
            const startLngRad = startLng * Math.PI / 180;
            const destLatRad = destLat * Math.PI / 180;
            const destLngRad = destLng * Math.PI / 180;

            const y = Math.sin(destLngRad - startLngRad) * Math.cos(destLatRad);
            const x = Math.cos(startLatRad) * Math.sin(destLatRad) -
                      Math.sin(startLatRad) * Math.cos(destLatRad) * Math.cos(destLngRad - startLngRad);

            let brng = Math.atan2(y, x) * 180 / Math.PI;
            return (brng + 360) % 360;
          }

          async function updateRoute(currentPos) {
            try {
              const query = await fetch(
                \`https://api.mapbox.com/directions/v5/mapbox/driving/\${currentPos[0]},\${currentPos[1]};\${destination[0]},\${destination[1]}?steps=true&geometries=geojson&access_token=\${MAPBOX_TOKEN}\`
              );
              const json = await query.json();

              if (json.routes && json.routes[0]) {
                const route = json.routes[0];
                const routeCoords = route.geometry.coordinates;

                const durationMin = Math.round(route.duration / 60);
                const distanceKm = (route.distance / 1000).toFixed(1);

                document.getElementById('etaValue').innerText = durationMin > 0 ? durationMin + ' min' : 'Chegando';
                document.getElementById('distValue').innerText = distanceKm + ' km';

                if (map.getSource('route')) {
                  map.getSource('route').setData({
                    type: 'Feature',
                    properties: {},
                    geometry: { type: 'LineString', coordinates: routeCoords }
                  });
                } else {
                  map.addSource('route', {
                    type: 'geojson',
                    data: {
                      type: 'Feature',
                      properties: {},
                      geometry: { type: 'LineString', coordinates: routeCoords }
                    }
                  });

                  map.addLayer({
                    id: 'routeLine',
                    type: 'line',
                    source: 'route',
                    layout: { 'line-join': 'round', 'line-cap': 'round' },
                    paint: { 'line-color': '#EAB308', 'line-width': 5, 'line-opacity': 0.85 }
                  });
                }
              }
            } catch (err) {
              console.error('Erro ao buscar rota Mapbox:', err);
            }
          }

          map.on('load', async function() {
            map.resize();
            const bounds = new mapboxgl.LngLatBounds();
            bounds.extend(origin);
            bounds.extend(destination);
            bounds.extend(lastPos);
            map.fitBounds(bounds, { padding: 60, maxZoom: 16 });

            await updateRoute(lastPos);
          });

          setInterval(async () => {
            try {
              const res = await fetch('/track/${rideId}/data');
              if (!res.ok) return;
              const data = await res.json();

              if (data.driverLat && data.driverLng) {
                const newPos = [Number(data.driverLng), Number(data.driverLat)];

                if (newPos[0] !== lastPos[0] || newPos[1] !== lastPos[1]) {
                  const angle = calculateBearing(lastPos[1], lastPos[0], newPos[1], newPos[0]);
                  carContainer.style.transform = 'rotate(' + angle + 'deg)';

                  driverMarker.setLngLat(newPos);
                  lastPos = newPos;

                  updateRoute(newPos);
                }
              }

              const badge = document.getElementById('statusBadge');
              if (badge && data.status) {
                badge.innerText = data.status;
                if (data.status === 'CANCELLED') badge.className = 'badge cancelled';
                else if (data.status === 'COMPLETED') badge.className = 'badge completed';
                else if (data.status === 'QUEUED') badge.className = 'badge queued';
              }
            } catch (e) {
              console.warn('Erro na atualização em tempo real:', e);
            }
          }, 3500);
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

    io.to('admin_dashboard').emit('admin:sos_alert', {
      sosId: sosAlert?.id,
      userId,
      userType: userTypeEnum,
      rideId: rideId || null,
      latitude: latNum,
      longitude: lngNum,
      timestamp: timestamp || new Date().toISOString()
    });
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

    // 🛑 TRAVA DE SEGURANÇA: Saldo mínimo na carteira digital para cobrir comissões
    const MIN_REQUIRED_BALANCE = 0;
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
        passengerPhone: pendingRide.passenger?.phone || null,
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
        passengerPhone: passengerInfo?.phone || null,
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
        driverPhone: driverUser?.phone || null,
        startOtp: updatedRide.startOtp || ride.startOtp || null,
        passengerName: passengerUser?.fullName || 'Passageiro',
        passengerPhone: passengerUser?.phone || null,
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

      if (passengerUser?.deviceToken && typeof sendPushNotification === 'function') {
        const acceptPayLabel =
          updatedRide.paymentMethod === 'ORANGE_MONEY' ? 'via Orange Money' :
          updatedRide.paymentMethod === 'MTN_MOMO' ? 'via MTN MoMo' :
          (updatedRide.paymentMethod as string) === 'CORPORATE' ? 'via Conta Corporativa' : 'em dinheiro';
        sendPushNotification(
          passengerUser.deviceToken,
          '🚗 Motorista a Caminho!',
          `${driverUser?.fullName || 'Seu motorista'} aceitou a corrida! Valor total: ${updatedRide.priceXof} XOF (${acceptPayLabel}).`,
          { type: 'RIDE_ACCEPTED', rideId },
          PUSH_CHANNELS.RIDE_UPDATE
        ).catch(() => null);
      }


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

    const { rideId, latitude, longitude, speed, heading, durationMinutes } = coords || {};
    const driverId = socket.data.user?.id;

    if (!isValidCoordinate(Number(latitude), Number(longitude))) return;

    const safeSpeed = speed != null ? Number(speed) : null;
    const safeHeading = heading != null ? Number(heading) : 0;
    const safeDuration = durationMinutes != null ? Number(durationMinutes) : null;

    await safeRedis.geoAdd('drivers:locations', {
      longitude: Number(longitude),
      latitude: Number(latitude),
      member: driverId
    });
    await safeRedis.set(`driver:last_seen:${driverId}`, String(Date.now()), { EX: 300 });

    if (rideId && isUuid(rideId)) {
      const posPayload = {
        rideId,
        latitude: Number(latitude),
        longitude: Number(longitude),
        heading: safeHeading,
        durationMinutes: safeDuration
      };
      io.to(rideId).emit('driver:position', posPayload);
      io.to(`ride_${rideId}`).emit('driver:position', posPayload);
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
      socket.join('admin_dashboard');
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

    if (ride?.passenger?.deviceToken) {
      sendPushNotification(
        ride.passenger.deviceToken,
        '📍 Motorista Chegou!',
        `Seu motorista está no local. Informe o PIN ${ride.startOtp || ''} para iniciar.`,
        { type: 'DRIVER_ARRIVED', rideId },
        PUSH_CHANNELS.RIDE_UPDATE
      ).catch(() => null);
    }
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

      const startedPassenger = updatedRide?.passengerId ? await prisma.passenger.findUnique({ where: { id: updatedRide.passengerId }, select: { deviceToken: true } }) : null; if (startedPassenger?.deviceToken) { sendPushNotification(startedPassenger.deviceToken,
          '🚕 Viagem Iniciada!',
          'Tenha uma excelente viagem com o Nô Bai 245!',
          { type: 'RIDE_STARTED', rideId },
          PUSH_CHANNELS.RIDE_UPDATE
        ).catch(() => null);
      }
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

      const finishedPayload = {
        rideId,
        status: 'FINISHED',
        fareXOF: result?.fareXOF,
        priceXof: result?.fareXOF,
        totalAmount: result?.fareXOF,
        distanceKm: result?.distanceKm,
        driverEarnings: result?.driverEarnings,
        platformFee: result?.platformFee,
      };

        const rideInfo = await prisma.ride.findUnique({
          where: { id: rideId },
          select: { passengerId: true, paymentMethod: true, passenger: { select: { deviceToken: true } } }
        });

        if (typeof ackCallback === 'function') {
          ackCallback({
            success: true,
            rideId,
            fareXOF: result?.fareXOF,
            driverEarnings: result?.driverEarnings,
            platformFee: result?.platformFee,
            distanceKm: result?.distanceKm,
            transactionId: result?.commissionTransactionId || `TRX-${rideId.slice(0, 6).toUpperCase()}`,
          });
        }

        const targetRooms = [
          rideId,
          rideInfo?.passengerId,
          `passenger_${rideInfo?.passengerId}`,
          `passenger:${rideInfo?.passengerId}`,
          `user_${rideInfo?.passengerId}`
        ].filter(Boolean);

        targetRooms.forEach(room => {
          io.to(room).emit('ride:finished', finishedPayload);
          io.to(room).emit('ride:completed', finishedPayload);
        });

        io.to('admin_dashboard').emit('admin:ride_update', { rideId, status: 'FINISHED' });

        if (rideInfo?.passenger?.deviceToken) {
          const finishPushBody =
            rideInfo.paymentMethod === 'ORANGE_MONEY'
              ? `Você chegou ao seu destino. Total: ${result.fareXOF} XOF (pago via Orange Money).`
              : rideInfo.paymentMethod === 'MTN_MOMO'
              ? `Você chegou ao seu destino. Total: ${result.fareXOF} XOF (pago via MTN MoMo).`
              : (rideInfo.paymentMethod as string) === 'CORPORATE'
              ? `Você chegou ao seu destino. Total: ${result.fareXOF} XOF (faturado na conta corporativa).`
              : `Você chegou ao seu destino. Pague ${result.fareXOF} XOF em dinheiro ao motorista.`;

          sendPushNotification(
            rideInfo.passenger.deviceToken,
            '🏁 Viagem Concluída!',
            finishPushBody,
            { type: 'RIDE_COMPLETED', rideId },
            PUSH_CHANNELS.RIDE_UPDATE
          ).catch(() => null);
        }
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
          fs.mkdirSync(uploadDir, { recursive: true });
          const cleanBase64 = rawAudio.replace(/^data:audio\/[^;]+;base64,/, '');
          const fileName = `${rideId}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.m4a`;
          fs.writeFileSync(path.join(uploadDir, fileName), Buffer.from(cleanBase64, 'base64'));
          const baseUrl = (process.env.APP_URL || 'https://api.nobai245.com').replace(/\/$/, '');
          finalAudioUrl = `${baseUrl}/uploads/chat/${fileName}`;
        } catch (fileErr: any) {
          console.error('❌ [CHAT_AUDIO_SAVE_ERR]:', fileErr?.message);
          finalAudioUrl = rawAudio;
        }
      }
    }

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


      const previousStatus = rideToCancel.status;
      const cleanReason = typeof reason === 'string' ? reason.trim().slice(0, 250) : 'Corrida cancelada';
      const normalizedUserType = (userType || socket.data.user?.role || socket.data.user?.userType) === 'DRIVER' ? 'DRIVER' : 'PASSENGER';

      const result = await cancelRideLogic(rideId, currentUserId, normalizedUserType, cleanReason);

      await safeRedis.del(`active_ride:${rideId}`);
      if (rideToCancel.driverId) {
        await safeRedis.del(`driver_active_ride:${rideToCancel.driverId}`);
      }

      const cancelPayload = {
        rideId,
        status: 'CANCELLED',
        cancelledBy: normalizedUserType,
        reason: cleanReason,
        appliedPenalty: Boolean(result?.appliedPenalty),
        penaltyAmount: Number(result?.penaltyAmount || 0)
      };

      const targetRooms = [
        rideId,
        `ride_${rideId}`,
        rideToCancel.passengerId,
        `passenger_${rideToCancel.passengerId}`,
        `passenger:${rideToCancel.passengerId}`,
        rideToCancel.driverId,
        `driver_${rideToCancel.driverId}`,
        `driver:${rideToCancel.driverId}`
      ].filter(Boolean) as string[];

      targetRooms.forEach(room => {
        io.to(room).emit('ride:cancelled', cancelPayload);
      });

      if (previousStatus === 'SEARCHING') {
        io.to('available_drivers').emit('ride:cancelled_by_passenger', { rideId });
      }

      const recipientToken = normalizedUserType === 'DRIVER'
        ? rideToCancel.passenger?.deviceToken
        : rideToCancel.driver?.deviceToken;

        if (recipientToken) {
          sendPushNotification(
            recipientToken,
            '⚠️ Corrida Cancelada',
            normalizedUserType === 'DRIVER' ? 'O motorista cancelou a viagem.' : 'O passageiro cancelou a viagem.',
            { rideId, type: 'RIDE_CANCELLED' },
            PUSH_CHANNELS.RIDE_UPDATE
          ).catch(() => {});
        }

        if (typeof ackCallback === 'function') {
          ackCallback({
            success: true,
            rideId,
            appliedPenalty: Boolean(result?.appliedPenalty),
            penaltyAmount: Number(result?.penaltyAmount || 0)
          });
        }

      } catch (err: any) {
        const errMsg = err?.message || 'Erro ao cancelar corrida.';
        console.error(`❌ [CANCEL_ERROR] ID: ${rideId}:`, errMsg);
        socket.emit('error', { message: errMsg });
        if (typeof ackCallback === 'function') ackCallback({ error: true, message: errMsg });
      }

  });

});

// -----------------------------------------------------------------------------
// 7. ENCERRAMENTO GRACIOSO DO SERVIDOR (SHUTDOWN)
// -----------------------------------------------------------------------------
const shutdown = async () => {
  console.log('\n🛑 [SISTEMA BAI245] Iniciando shutdown seguro...');

  const forceExitTimeout = setTimeout(() => {
    console.error('⚠️ [SHUTDOWN] Forçando encerramento do processo após timeout de 10s.');
    process.exit(1);
  }, 10000);

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
        await (safeRedis as any).zRem?.('drivers:locations', d.id).catch?.(() => {});
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
