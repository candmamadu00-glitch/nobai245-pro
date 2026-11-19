import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { socket } from './socket';
import { storage } from './storage';

export const BACKGROUND_LOCATION_TASK = 'BACKGROUND_LOCATION_TASK';

const RAW_URL = process.env.EXPO_PUBLIC_API_URL || 'https://api.nobai245.com';
const CLEAN_BASE = RAW_URL.replace(/\/+$/, '');
const API_URL = CLEAN_BASE.endsWith('/api') ? CLEAN_BASE : `${CLEAN_BASE}/api`;

let cachedDriverId: string | null = null;
let cachedToken: string | null = null;
let cachedRideId: string | undefined = undefined;
let lastCacheUpdate = 0;
let lastBgLocationEmitAt = 0;

const refreshCache = async () => {
  const now = Date.now();
  if (now - lastCacheUpdate > 60000 || !cachedDriverId) {
    const driver = await storage.getDriver();
    cachedToken = await storage.getAccessToken();
    cachedDriverId = driver?.id || null;
    const currentRide = await AsyncStorage.getItem('@nobai245:activeRideId');
    cachedRideId = currentRide || undefined;
    lastCacheUpdate = now;
  }
};

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }: any) => {
  if (error || !data) return;

  const { locations } = data;
  const location = locations && locations.length > 0 ? locations[locations.length - 1] : null;

  if (location) {
    try {
      await refreshCache();
      if (!cachedDriverId) return;

      let bgDurationMinutes: number | undefined = undefined;
      let bgDistanceKm: number | undefined = undefined;
      let bgPhase: string | undefined = undefined;
      try {
        const rawMetrics = await AsyncStorage.getItem('@nobai245:activeRouteMetrics');
        if (rawMetrics) {
          const m = JSON.parse(rawMetrics);
          if (m && m.rideId === cachedRideId) {
            if (typeof m.durationMinutes === 'number' && m.durationMinutes > 0) {
              bgDurationMinutes = m.durationMinutes;
            }
            if (typeof m.distanceKm === 'number' && m.distanceKm >= 0) {
              bgDistanceKm = m.distanceKm;
            }
            if (typeof m.phase === 'string') {
              bgPhase = m.phase;
            }
            // Se o motorista se moveu enquanto usa Google Maps/Waze em primeiro plano, ajusta proporcionalmente
            if (
              typeof m.targetLat === 'number' &&
              typeof m.targetLng === 'number' &&
              m.targetLat !== 0 &&
              m.targetLng !== 0
            ) {
              const R = 6371;
              const dLat = ((m.targetLat - location.coords.latitude) * Math.PI) / 180;
              const dLng = ((m.targetLng - location.coords.longitude) * Math.PI) / 180;
              const a =
                Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos((location.coords.latitude * Math.PI) / 180) *
                  Math.cos((m.targetLat * Math.PI) / 180) *
                  Math.sin(dLng / 2) *
                  Math.sin(dLng / 2);
              const straightKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 1.25;
              if (Number.isFinite(straightKm) && straightKm > 0) {
                bgDistanceKm = Number(straightKm.toFixed(2));
                const speedKmh =
                  location.coords.speed && location.coords.speed > 2
                    ? Math.max(18, Math.min(70, location.coords.speed * 3.6))
                    : 28;
                bgDurationMinutes = Math.max(1, Math.ceil((straightKm / speedKmh) * 60));
              }
            }
          }
        }
      } catch (_) {}

      const payload = {
        driverId: cachedDriverId,
        rideId: cachedRideId,
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        speed: location.coords.speed || 0,
        heading: location.coords.heading || 0,
        durationMinutes: bgDurationMinutes,
        distanceKm: bgDistanceKm,
        phase: bgPhase,
      };

      const sendFallbackHttp = async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);

        try {
          const response = await fetch(`${API_URL}/drivers/location`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${cachedToken || ''}`,
            },
            body: JSON.stringify(payload),
            signal: controller.signal,
          });

          if (response.status === 401) {
            cachedToken = null;
          }
        } catch (fetchErr: any) {
          if (fetchErr.name !== 'AbortError') {
            console.error('❌ HTTP Fallback falhou:', fetchErr.message);
          }
        } finally {
          clearTimeout(timeoutId);
        }
      };

      const nowBg = Date.now();
      if (nowBg - lastBgLocationEmitAt >= 3000) {
        lastBgLocationEmitAt = nowBg;
        if (socket.connected) {
          socket.emit('driver:location_update', payload);
        } else {
          sendFallbackHttp();
        }
      }
    } catch (err) {
      console.error('⚠️ [BACKGROUND TASK ERR]:', err);
    }
  }
});

export const startLocationTracking = async () => {
  const hasStarted = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  if (hasStarted) return;

  const { status: foregroundStatus } = await Location.requestForegroundPermissionsAsync();
  if (foregroundStatus !== 'granted') return;

  const { status: backgroundStatus } = await Location.requestBackgroundPermissionsAsync();
  if (backgroundStatus !== 'granted') return;

  lastCacheUpdate = 0; 
  await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: 5000,
    distanceInterval: 10,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'Nōbaî 245 Motorista',
      notificationBody: 'Você está visível para receber chamadas de corridas.',
      notificationColor: '#0E243C',
    },
  });
};

export const stopLocationTracking = async () => {
  const hasStarted = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  if (hasStarted) {
    await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  }
  cachedDriverId = null;
  cachedToken = null;
  cachedRideId = undefined;
};