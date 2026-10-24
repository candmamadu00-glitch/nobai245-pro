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
import { getRouteDistanceAndDuration, isWithinGuineaBissau } from './services/rideService';
import { passengerRoutes } from './routes/passengerRoutes'; 
import { driverRoutes } from './routes/driverRoutes'; 
import { adminRoutes } from './routes/adminRoutes';
import webhookRoutes from './routes/webhookRoutes';
import rideRoutes from './routes/rideRoutes';
import { createAdapter } from '@socket.io/redis-adapter';
import { setupTicketSocketHandlers } from './sockets/ticketSocket';
import { sendPushNotification, PUSH_CHANNELS } from './services/pushNotifications';
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

const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()) 
  : '*'; 

app.use(cors({ 
  origin: allowedOrigins, 
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] 
}));

app.use(express.json({
  limit: '10mb',
  verify: (req: Request, _res: Response, buf: Buffer) => {
    req.rawBody = buf;
  }
}));

app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, 
  max: 300, 
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições vindas deste IP. Tente novamente em instantes.' }
});

app.use('/api/', apiLimiter);

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
    catch (e) { console.error(`⚠️ [REDIS ZREM ERR] Key: ${key}`, e); }
  }
};

app.get('/api/passengers/drivers/nearby', async (req: Request, res: Response) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);

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

    const drivers = await Promise.all(
      nearbyDriverIds.map(async (driverId) => {
        const pos = await safeRedis.geoPos('drivers:locations', driverId);
        if (pos && pos[0]) {
          return {
            id: driverId,
            lng: pos[0].longitude,
            lat: pos[0].latitude,
          };
        }
        return null;
      })
    );

    return res.json({ drivers: drivers.filter(Boolean) });
  } catch (error) {
    console.error('Erro ao buscar motoristas próximos:', error);
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
            <div id="statusBadge" class="badge ${ride.status === 'CANCELLED' ? 'cancelled' : (ride.status === 'COMPLETED' ? 'completed' : (ride.status === 'QUEUED' ? 'queued' : ''))}">${sanitizeHtmlText(ride.status) || 'EM ANDAMENTO'}</div>
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
const io = new Server(server, {
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
// 6. EVENTOS WEBSOCKET (SOCKET.IO ENGINE)
// -----------------------------------------------------------------------------
io.on('connection', (socket) => {
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

  socket.on('join_room', (roomName: string) => {
    if (roomName && typeof roomName === 'string') {
      socket.join(roomName);
      console.log(`📡 [SOCKET ROOM] Cliente ${socket.id} (User: ${userId}) entrou na sala: ${roomName}`);
    }
  });

  handleSocketEvent(socket, 'passenger:rejoin_ride', async (data) => {
    const { rideId } = data || {};
    if (isUuid(rideId)) {
      socket.join(rideId);
      console.log(`📡 [PASSENGER REJOINED] User ${socket.data.user?.id} entrou na sala da corrida ${rideId}`);
    }
  });

  socket.on('disconnect', () => {
    console.log(`[-] Cliente desconectado: ${socket.id} (ID: ${socket.data.user?.id})`);

    if (socket.data.lastEvents) {
      socket.data.lastEvents.clear();
      socket.data.lastEvents = undefined;
    }

    const user = socket.data.user;
    if (user && (user.role === 'DRIVER' || user.userType === 'DRIVER')) {
      const driverId = user.id;
      console.log(`⏳ [MOTORISTA DESCONECTOU] Iniciando tolerância de 15s para o motorista ID: ${driverId}`);
      
      if (disconnectTimers.has(driverId)) {
        clearTimeout(disconnectTimers.get(driverId)!);
      }
      
      const timer = setTimeout(async () => {
        console.log(`🔴 [MOTORISTA TEMPO EXCEDIDO] Removendo motorista ${driverId} da lista de visíveis/disponíveis.`);
        await safeRedis.zRem('drivers:locations', driverId);
        
        const hasActiveRide = await safeRedis.get(`driver_active_ride:${driverId}`);
        if (!hasActiveRide) {
          await prisma.driver.update({ where: { id: driverId }, data: { isOnline: false } })
            .catch(e => console.warn(`⚠️ [DISCONNECT FAIL] Driver: ${driverId}`, e?.message));
          console.log(`🚫 [MOTORISTA OFFLINE NO DB] Motorista ID: ${driverId} marcado como Offline.`);
        } else {
          console.log(`ℹ️ [MOTORISTA POSSUI CORRIDA] Mantido em corrida ativa ID: ${hasActiveRide}`);
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
    console.log(`🔴 [MOTORISTA FICOU OFFLINE] Solicitação manual do motorista ID: ${driverId}`);
    
    socket.leave('available_drivers');

    await safeRedis.zRem('drivers:locations', driverId);
    await safeRedis.del(`driver_active_ride:${driverId}`);

    await prisma.driver.update({
      where: { id: driverId },
      data: { isOnline: false, isAvailable: false }
    }).catch(() => null);
    
    console.log(`✅ [MOTORISTA OFFLINE CONCLUÍDO] Motorista ${driverId} removido do Redis e salas Socket.`);
  });

  // 🛡️ SINCRONIZADO COM SCHEMA V3.0 (Tabela SosAlert)
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

    // 🟢 Grava o Alerta SOS na base de dados (Schema V3.0)
    const sosAlert = await prisma.sosAlert.create({
      data: {
        rideId: rideId && isUuid(rideId) ? rideId : null,
        userType: userTypeEnum as any,
        passengerId: !isDrv ? userId : null,
        driverId: isDrv ? userId : null,
        lat: latNum,
        lng: lngNum,
        status: 'ACTIVE'
      }
    }).catch(err => {
      console.error('❌ [ERRO SOS DB] Falha ao registrar SosAlert no banco:', err);
      return null;
    });

    console.warn(`🚨 [SOS ALERTA DISPARADO] Usuário: ${userId} (${userTypeEnum}) | SOS ID: ${sosAlert?.id || 'N/A'} | Coords: ${latNum}, ${lngNum}`);

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

  handleSocketEvent(socket, 'driver:alert_inaccessible_location', (data) => {
    const { rideId, passengerId } = data || {};
    if (!rideId) return;

    console.log(`📢 [LOCAL INACESSÍVEL] Motorista informou local inacessível. Corrida: ${rideId}, Passageiro: ${passengerId}`);
    
    io.to(rideId).to(`passenger_${passengerId}`).emit('ride:inaccessible_location', {
      title: 'Motorista com dificuldade de acesso ⚠️',
      message: 'O motorista está com dificuldades para chegar ao seu local exato. Por favor, verifique o chat ou tente se aproximar da via principal.'
    });
  });

  // --- MOTORISTA FICA ONLINE ---
  handleSocketEvent(socket, 'driver:online', async (data) => {
    if (isSocketRateLimited(socket, 'driver:online')) return;
    if (!isDriver(socket)) {
      socket.emit('error', { message: 'Acesso negado.' });
      return;
    }

    const driverId = socket.data.user.id;
    const { lat, lng } = data || {};

    console.log(`🟢 [MOTORISTA ONLINE INICIADO] ID: ${driverId} | Coords enviadas: ${lat}, ${lng}`);

    socket.join(driverId);
    socket.join(`driver_${driverId}`);
    socket.join(`driver:${driverId}`);
    socket.join('available_drivers');

    if (disconnectTimers.has(driverId)) {
      console.log(`🔄 [MOTORISTA RECONECTOU RÁPIDO] Cancelando timer de desconexão para driver: ${driverId}`);
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
      console.log(`📍 [REDIS GEO] Motorista ${driverId} adicionado na chave 'drivers:locations': [${currentLat}, ${currentLng}]`);
    } else {
      console.warn(`⚠️ [REDIS GEO WARN] Motorista ${driverId} ficou online SEM coordenadas válidas.`);
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

    console.log(`🔎 [OFERTAS PENDENTES] Encontradas ${pendingRides.length} corridas em busca de motorista na categoria ${updatedDriver.vehicleType}`);

    for (const pendingRide of pendingRides) {
      socket.emit('ride:new_request', {
        rideId: pendingRide.id,
        passengerId: pendingRide.passengerId,
        passengerName: pendingRide.passenger?.fullName || 'Passageiro',
        passengerPhone: pendingRide.passenger?.phone || null,
        passengerPhoto: pendingRide.passenger?.profilePicture || null,
        passengerRating: Number(pendingRide.passenger?.ratingAverage || 5.0),
        pickupLat: Number(pendingRide.originLat),
        pickupLng: Number(pendingRide.originLng),
        originAddress: pendingRide.originAddress,
        destinationLat: Number(pendingRide.destinationLat),
        destinationLng: Number(pendingRide.destinationLng),
        destinationAddress: pendingRide.destinationAddress,
        fareXOF: Number(pendingRide.priceXof),
        vehicleType: pendingRide.requestedVehicleType,
        serviceType: pendingRide.serviceType,
        paymentMethod: pendingRide.paymentMethod || 'ORANGE_MONEY'
      });
    }
  });

  // --- PASSAGEIRO SOLICITA CORRIDA ---
  handleSocketEvent(socket, 'passenger:request_ride', async (rideData) => {
    console.log(`🔴 [SOLICITAÇÃO DE CORRIDA] Socket ID: ${socket.id}`, rideData);

    if (isSocketRateLimited(socket, 'passenger:request_ride', 5000, 2)) return;

    const passengerId = socket.data.user?.id;
    if (!passengerId || !isPassenger(socket)) {
      socket.emit('error', { message: 'Ação não autorizada. Faça login novamente como passageiro.' });
      return;
    }

    const pLat = Number(rideData?.pickupLat);
    const pLng = Number(rideData?.pickupLng);
    const dLat = Number(rideData?.destinationLat);
    const dLng = Number(rideData?.destinationLng);

    if (!isValidCoordinate(pLat, pLng) || !isValidCoordinate(dLat, dLng)) {
      socket.emit('error', { message: 'Coordenadas de origem ou destino inválidas.' });
      return;
    }

    // 🛡️ TRAVA GEOGRÁFICA (GUINÉ-BISSAU)
    if (!isWithinGuineaBissau(pLat, pLng)) {
      console.warn(`🛑 [FORA DE COBERTURA] Coords [${pLat}, ${pLng}] fora da Guiné-Bissau para passenger: ${passengerId}`);
      socket.emit('error', { 
        message: '📍 Fora da área de cobertura. O Nô Bai 245 opera exclusivamente na Guiné-Bissau.' 
      });
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
        paymentMethod: rideData.paymentMethod,
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

      console.log(`✅ [CORRIDA CRIADA] ID: ${rideId} | Passageiro: ${passengerId} | Valor: ${ride.priceXof} XOF`);

      await safeRedis.set(`active_ride:${rideId}`, JSON.stringify({
        rideId, passengerId, pickupLat: pLat, pickupLng: pLng,
        fareXOF: Number(ride.priceXof), status: 'PENDING',
      }));

      const nearbyDriverIds = await safeRedis.geoSearch(
        'drivers:locations', 
        { longitude: pLng, latitude: pLat }, 
        { radius: 50, unit: 'km' }
      );

      console.log(`🔍 [REDIS BUSCA MOTORISTAS] Encontrados ${nearbyDriverIds?.length || 0} motoristas em um raio de 50km`);

      if (!nearbyDriverIds || nearbyDriverIds.length === 0) {
        console.warn(`⚠️ [SEM MOTORISTAS PRÓXIMOS] Nenhum motorista no Redis no raio de 50km.`);
        socket.emit('ride:no_drivers_found');
        socket.emit('error', { message: 'Nenhum motorista disponível próximo de si.' });
        await cancelRideLogic(rideId, passengerId, 'PASSENGER', 'Sem motoristas no raio');
        return;
      }

      const candidateDrivers = await prisma.driver.findMany({
        where: { 
          id: { in: nearbyDriverIds }, 
          vehicleType: normalizedVehicleType as any,
          isOnline: true, 
          status: 'APPROVED'
        },
        select: { 
          id: true, 
          deviceToken: true,
          isAvailable: true,
          currentRideId: true,
          rides: {
            where: { status: { in: ['ACCEPTED', 'ARRIVED', 'IN_PROGRESS'] } },
            select: { id: true }
          }
        }
      });

      const matchingDrivers = candidateDrivers.filter((driver: any) => {
        if (driver.isAvailable || !driver.currentRideId) return true;
        const activeRidesCount = Array.isArray(driver.rides) ? driver.rides.length : 0;
        return activeRidesCount <= 1; // Suporte a corrida em fila
      });

      console.log(`🎯 [MOTORISTAS ELEGÍVEIS] ${matchingDrivers.length} de ${candidateDrivers.length} motoristas prontos para receber a oferta`);

      if (matchingDrivers.length === 0) {
        socket.emit('ride:no_drivers_found');
        socket.emit('error', { message: `Motoristas na categoria ${normalizedVehicleType} estão ocupados.` });
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
        pickupLat: Number(ride.originLat), 
        pickupLng: Number(ride.originLng), 
        originAddress: rideData.originAddress, 
        destinationLat: Number(ride.destinationLat),
        destinationLng: Number(ride.destinationLng), 
        destinationAddress: rideData.destinationAddress,
        stops: ride.stops || rawStops,
        referencePoint: rideData.referencePoint || null,
        fareXOF: Number(ride.priceXof), 
        vehicleType: normalizedVehicleType,
        serviceType: ride.serviceType, 
        paymentMethod: ride.paymentMethod || 'ORANGE_MONEY'
      };

      for (const d of matchingDrivers) {
        const activeRidesCount = Array.isArray(d.rides) ? d.rides.length : 0;
        const isQueuedOffer = activeRidesCount > 0;

        // 🟢 Sincronização Schema V3.0: Registra oferta pendente com expiração de 15s
        await prisma.rideOffer.upsert({
          where: { rideId_driverId: { rideId, driverId: d.id } },
          update: { status: 'PENDING', expiresAt: new Date(Date.now() + 15000) },
          create: { rideId, driverId: d.id, status: 'PENDING', expiresAt: new Date(Date.now() + 15000) }
        }).catch(() => null);

        console.log(`📡 [DISPARANDO OFERTA] Para motorista ID: ${d.id} (Em fila: ${isQueuedOffer})`);

        io.to(d.id).emit('ride:new_request', { ...requestPayload, isQueuedOffer });
        io.to(`driver_${d.id}`).emit('ride:new_request', { ...requestPayload, isQueuedOffer });

        if (d.deviceToken) {
          const pushTitle = isQueuedOffer 
            ? `🚗 Próxima Corrida em Fila (Valor: ${ride.priceXof} XOF)` 
            : `🚕 Nova Corrida (Valor: ${ride.priceXof} XOF)`;

          sendPushNotification(
            d.deviceToken,
            pushTitle,
            `Passageiro: ${passengerInfo?.fullName || 'Passageiro'} solicitou corrida!`,
            { type: 'NEW_RIDE_REQUEST', rideId, isQueuedOffer },
            PUSH_CHANNELS.NEW_RIDE_ALARM
          ).catch(() => null);
        }
      }
    } catch (err: any) {
      console.error('❌ Erro na solicitação da corrida:', err);
      socket.emit('error', { message: 'Erro ao processar sua corrida e carteira digital.' });
    }
  });

  // --- MOTORISTA ACEITA CORRIDA ---
  handleSocketEvent(socket, 'driver:accept_ride', async (data) => {
    if (isSocketRateLimited(socket, 'driver:accept_ride', 2000, 1)) return;
    if (!isDriver(socket)) {
      socket.emit('error', { message: 'Apenas motoristas.' });
      return;
    }

    const driverId = socket.data.user.id;
    const { rideId, driverLat, driverLng } = data || {};

    console.log(`⚡ [TENTATIVA DE ACEITE] Motorista ID: ${driverId} tentando aceitar corrida ID: ${rideId}`);

    if (!isUuid(rideId)) {
      socket.emit('error', { message: 'ID de corrida inválido.' });
      return;
    }

    const lockKey = `lock:accept_ride:${rideId}`;
    const acquiredLock = await safeRedis.set(lockKey, driverId, { NX: true, EX: 5 });

    if (!acquiredLock) {
      const currentLock = await safeRedis.get(lockKey);
      if (currentLock && currentLock !== driverId) {
        console.warn(`🔒 [LOCK RACE CONDITION] Corrida ${rideId} já travada por outro motorista.`);
        socket.emit('error', { message: 'Corrida já foi aceita por outro colega!' });
        return;
      }
    }

    try {
      const updatedRide = await acceptRideLogic(rideId, driverId);

      // 🟢 Sincronização Schema V3.0: Atualiza a oferta do motorista para ACCEPTED
      await prisma.rideOffer.updateMany({
        where: { rideId, driverId },
        data: { status: 'ACCEPTED' }
      }).catch(() => null);

      console.log(`🎉 [CORRIDA ACEITA COM SUCESSO] Motorista ${driverId} assumiu a corrida ${rideId}`);

      await safeRedis.set(`driver_active_ride:${driverId}`, rideId);
      socket.join(rideId);
      socket.leave('available_drivers');

      const publicDriverPayload = {
        rideId, 
        driverId, 
        driverLat: Number(driverLat || 0), 
        driverLng: Number(driverLng || 0),
        driverName: updatedRide.driver?.fullName,
        driverPhoto: updatedRide.driver?.profilePicture,
        carModel: updatedRide.driver?.vehicleBrand,
        carColor: updatedRide.driver?.vehicleColor,
        licensePlate: updatedRide.driver?.vehiclePlate,
        driverRating: Number(updatedRide.driver?.ratingAverage || 5.0)
      };

      io.to(rideId).emit('ride:accepted', publicDriverPayload);

      socket.emit('driver:accept_ride_success', {
        ...publicDriverPayload,
        passengerName: updatedRide.passenger?.fullName,
        passengerPhone: updatedRide.passenger?.phone,
        passengerPhoto: updatedRide.passenger?.profilePicture,
        originAddress: updatedRide.originAddress,
        destinationAddress: updatedRide.destinationAddress,
        priceXof: Number(updatedRide.priceXof),
      });

      io.to(`passenger_${updatedRide.passengerId}`).emit('ride:accepted', {
        ...publicDriverPayload,
        startOtp: updatedRide.startOtp
      });

      if (updatedRide.passenger?.deviceToken) {
        sendPushNotification(
          updatedRide.passenger.deviceToken,
          '🚗 Motorista a Caminho!',
          `${updatedRide.driver?.fullName || 'Seu motorista'} aceitou a corrida!`,
          { type: 'RIDE_ACCEPTED', rideId },
          PUSH_CHANNELS.RIDE_UPDATE
        ).catch(() => null);
      }

      io.to('admin_dashboard').emit('admin:ride_update', { 
        rideId, status: 'ACCEPTED', driverId, passengerId: updatedRide.passengerId 
      });

    } catch (err: any) {
      console.error(`❌ [ERRO ACEITAR CORRIDA] Driver ${driverId} -> Ride ${rideId}:`, err?.message || err);
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

    await safeRedis.geoAdd('drivers:locations', { 
      longitude: Number(longitude), 
      latitude: Number(latitude), 
      member: driverId 
    });

    if (rideId && isUuid(rideId)) {
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

      // 🟢 Sincronização Schema V3.0: Atualiza localização e vetor de direção (currentHeading)
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
      console.log(`🛡️ [ADMIN DASHBOARD] Usuário ${socket.data.user?.id} entrou na sala do Dashboard.`);
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

    console.log(`📍 [MOTORISTA CHEGOU AO LOCAL] Driver ID: ${driverId} | Corrida ID: ${rideId}`);

    const ride = await driverArrivedLogic(rideId, driverId);
    io.to(rideId).emit('ride:driver_arrived', { rideId });

    if (ride?.passenger?.deviceToken) {
      sendPushNotification(
        ride.passenger.deviceToken,
        '📍 Motorista Chegou!',
        'Seu motorista está no local aguardando você.',
        { type: 'DRIVER_ARRIVED', rideId },
        PUSH_CHANNELS.RIDE_UPDATE
      ).catch(() => null);
    }
  });

  // --- INICIAR CORRIDA ---
  handleSocketEvent(socket, 'driver:start_ride', async (data) => {
    if (isSocketRateLimited(socket, 'driver:start_ride')) return;
    if (!isDriver(socket)) {
      socket.emit('error', { message: 'Acesso negado.' });
      return;
    }

    const { rideId, otp } = data || {};
    const driverId = socket.data.user.id;

    console.log(`🚀 [INICIANDO CORRIDA] Driver ID: ${driverId} | Corrida ID: ${rideId} | PIN/OTP: ${otp}`);

    if (!isUuid(rideId) || !otp) {
      socket.emit('error', { message: 'Código OTP obrigatório.' });
      return;
    }

    try {
      const updatedRide = await startRideLogic(rideId, driverId, String(otp));
      
      console.log(`✅ [CORRIDA INICIADA COM SUCESSO] ID: ${rideId}`);

      io.to(rideId).emit('ride:started', { rideId, status: 'IN_PROGRESS', startedAt: updatedRide?.startedAt });
      io.to('admin_dashboard').emit('admin:ride_update', { rideId, status: 'IN_PROGRESS', driverId });

      if (updatedRide?.passenger?.deviceToken) {
        sendPushNotification(
          updatedRide.passenger.deviceToken,
          '🚕 Viagem Iniciada!',
          'Tenha uma excelente viagem com o Nô Bai 245!',
          { type: 'RIDE_STARTED', rideId },
          PUSH_CHANNELS.RIDE_UPDATE
        ).catch(() => null);
      }
    } catch (err: any) {
      console.error(`❌ [ERRO INICIAR CORRIDA] Driver ${driverId} -> Ride ${rideId}:`, err?.message || err);
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

    const { rideId, dropoffLat, dropoffLng, finishOtp } = data || {};
    const driverId = socket.data.user.id;

    console.log(`🏁 [TENTATIVA DE FINALIZAÇÃO] Driver: ${driverId} | Ride: ${rideId} | Coords: ${dropoffLat}, ${dropoffLng} | PIN: ${finishOtp || 'N/A'}`);

    if (!isUuid(rideId) || !isValidCoordinate(Number(dropoffLat), Number(dropoffLng))) {
      socket.emit('error', { message: 'Coordenadas de destino inválidas.' });
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

      console.log(`✅ [CORRIDA FINALIZADA DB/FINANCEIRO] Valor: ${result?.fareXOF} XOF | Repasse Ganho: ${result?.driverEarnings} XOF`);

      await safeRedis.del(`active_ride:${rideId}`);
      await safeRedis.del(`driver_active_ride:${driverId}`);

      const dropLatNum = Number(dropoffLat);
      const dropLngNum = Number(dropoffLng);
      if (isValidCoordinate(dropLatNum, dropLngNum)) {
        await safeRedis.geoAdd('drivers:locations', {
          longitude: dropLngNum,
          latitude: dropLatNum,
          member: driverId
        });
        console.log(`📍 [REDIS GEO RE-ENTRY] Motorista ${driverId} inserido em 'drivers:locations' no local de desembarque.`);
      }

      socket.join('available_drivers');
      socket.join(`driver_${driverId}`);
      socket.leave(rideId);

      io.to(rideId).emit('ride:finished', result);
      io.to('admin_dashboard').emit('admin:ride_update', { rideId, status: 'FINISHED' });

      const ride = await prisma.ride.findUnique({
        where: { id: rideId },
        include: { passenger: { select: { deviceToken: true } } }
      });

      if (ride?.passenger?.deviceToken) {
        sendPushNotification(
          ride.passenger.deviceToken,
          '🏁 Viagem Concluída!',
          `Você chegou ao seu destino. Total: ${result.fareXOF} XOF.`,
          { type: 'RIDE_COMPLETED', rideId },
          PUSH_CHANNELS.RIDE_UPDATE
        ).catch(() => null);
      }
    } catch (err: any) {
      console.error(`🚨 [ERRO FINANCEIRO AO FINALIZAR] Corrida ${rideId}:`, err);
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
        // 🟢 Sincronização Schema V3.0: Grava mensagem com isRead: false
        const savedMessage = await prisma.rideChatMessage.create({
          data: { 
            rideId, 
            senderId: user.id, 
            senderType: senderTypeDb as any, 
            message: sanitizedText,
            isRead: false 
          }
        });

        console.log(`💬 [CHAT RIDE ${rideId}] De: ${senderRole} | Msg: "${sanitizedText}"`);

        const messagePayload = {
          id: savedMessage.id, 
          sender: senderRole, 
          text: sanitizedText,
          senderPhoto: user?.profilePicture || null, 
          createdAt: savedMessage.createdAt.toISOString(),
        };

        socket.to(rideId).emit('chat:receive_message', messagePayload);
        io.to('admin_dashboard').emit('admin:chat_monitor', { rideId, message: messagePayload });

        const ride = await prisma.ride.findUnique({
          where: { id: rideId },
          include: {
            passenger: { select: { id: true, deviceToken: true } },
            driver: { select: { id: true, deviceToken: true } }
          }
        });

        const targetToken = senderTypeDb === 'PASSENGER' 
          ? ride?.driver?.deviceToken 
          : ride?.passenger?.deviceToken;

        if (targetToken) {
          sendPushNotification(
            targetToken,
            `💬 Mensagem do ${senderRole === 'driver' ? 'Motorista' : 'Passageiro'}`,
            sanitizedText,
            { type: 'CHAT_MESSAGE', rideId },
            PUSH_CHANNELS.CHAT
          ).catch(() => null);
        }
      } catch (err) { 
        console.warn('Falha no chat:', err); 
      }
    }
  });

  // --- CANCELAMENTO DE CORRIDA ---
  handleSocketEvent(socket, 'ride:cancel', async (data) => {
    if (isSocketRateLimited(socket, 'ride:cancel', 2000, 2)) return;
    const { rideId, userId, userType, reason } = data || {};

    console.log(`⚠️ [SOLICITAÇÃO CANCELAMENTO] Corrida: ${rideId} | Por: ${userType} (${userId}) | Motivo: "${reason}"`);

    if (!isUuid(rideId) || !isAuthorizedUser(socket, userId)) {
      socket.emit('error', { message: 'Ação não autorizada.' });
      return;
    }

    try {
      const rideToCancel = await prisma.ride.findUnique({ where: { id: rideId } });
      const previousStatus = rideToCancel?.status;
      const cleanReason = typeof reason === 'string' ? reason.trim().slice(0, 250) : undefined;
      const normalizedUserType = userType === 'DRIVER' ? 'DRIVER' : 'PASSENGER';

      const result = await cancelRideLogic(rideId, userId, normalizedUserType, cleanReason);

      console.log(`❌ [CORRIDA CANCELADA SUCESSO] ID: ${rideId} | Penalidade Aplicada: ${Boolean(result?.appliedPenalty)}`);

      await safeRedis.del(`active_ride:${rideId}`);
      if (rideToCancel?.driverId) {
        await safeRedis.del(`driver_active_ride:${rideToCancel.driverId}`);
      }

      io.to(rideId).emit('ride:cancelled', {
        rideId,
        cancelledBy: normalizedUserType,
        reason: cleanReason,
        appliedPenalty: Boolean(result?.appliedPenalty),
        penaltyAmount: Number(result?.penaltyAmount || 0)
      });

      if (previousStatus === 'SEARCHING') {
        io.to('available_drivers').emit('ride:cancelled_by_passenger', { rideId });
      }

      io.to('admin_dashboard').emit('admin:ride_update', {
        rideId, status: 'CANCELLED', cancelledBy: normalizedUserType, reason: cleanReason
      });

      const socketsInRoom = await io.in(rideId).fetchSockets();
      for (const s of socketsInRoom) {
        s.leave(rideId);
        if (rideToCancel?.driverId && s.data?.user?.id === rideToCancel.driverId) {
          s.join('available_drivers');
        }
      }
    } catch (err: any) {
      console.error(`❌ [ERRO CANCELAMENTO CORRIDA] ID: ${rideId}:`, err?.message || err);
      socket.emit('error', { message: err.message || 'Erro ao cancelar corrida.' });
    }
  });

  // --- AVALIAÇÃO DE CORRIDA ---
  handleSocketEvent(socket, 'ride:rate', async (data) => {
    if (isSocketRateLimited(socket, 'ride:rate', 3000, 2)) return;
    const { rideId, receiverId, stars, tags, comment, reviewerType } = data || {};

    const numericStars = Number(stars);
    if (!isUuid(rideId) || !receiverId || isNaN(numericStars) || numericStars < 1 || numericStars > 5) {
      socket.emit('error', { message: 'Dados de avaliação inválidos. A nota deve ser entre 1 e 5.' });
      return;
    }

    try {
      const userRole = socket.data.user?.role || socket.data.user?.userType;
      const finalReviewerType = reviewerType === 'DRIVER' || userRole === 'DRIVER' ? 'DRIVER' : 'PASSENGER';
      const cleanComment = typeof comment === 'string' ? comment.trim().slice(0, 500) : undefined;
      const safeTags = Array.isArray(tags) ? tags.map(t => String(t).slice(0, 50)) : [];

      const newRating = await submitRatingLogic({
        rideId,
        reviewerId: socket.data.user.id,
        reviewerType: finalReviewerType,
        receiverId,
        stars: numericStars,
        tags: safeTags,
        comment: cleanComment
      });

      socket.emit('ride:rated_success', { message: 'Avaliação registrada!' });
      io.to('admin_dashboard').emit('admin:new_rating', newRating);
    } catch (error: any) {
      socket.emit('error', { message: error?.message || 'Falha ao processar a avaliação.' });
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
      console.log('✅ Sistema desligado.');

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
    console.log(`💳 Gateways de Pagamento: Orange Money & MTN (+245)`);
    console.log(`📡 Infraestrutura Sockets rodando em 0.0.0.0:${PORT}`);
    console.log(`🔐 Modo Criptografia e Escrow Ativos`);
    console.log('======================================================\n');
  });
}