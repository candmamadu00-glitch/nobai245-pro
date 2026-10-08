import { io, Socket } from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { storage } from './storage';

const BASE_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://api.nobai245.com').replace(/\/api\/?$/, '');

export const socket: Socket = io(BASE_URL, {
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  transports: ['websocket', 'polling'],
});

let offlineQueue: Array<{ event: string; data: any; id: string }> = [];
let isProcessingQueue = false;

const saveQueue = async () => {
  try {
    await AsyncStorage.setItem('@nobai245:driverSocketQueue', JSON.stringify(offlineQueue));
  } catch (err) {
    console.warn('[SOCKET MOTORISTA] Erro ao salvar fila offline:', err);
  }
};

const loadQueue = async () => {
  try {
    const saved = await AsyncStorage.getItem('@nobai245:driverSocketQueue');
    if (saved) offlineQueue = JSON.parse(saved);
  } catch (err) {
    console.warn('[SOCKET MOTORISTA] Erro ao carregar fila offline:', err);
  }
};

const processOfflineQueue = async () => {
  if (isProcessingQueue) return;
  isProcessingQueue = true;
  await loadQueue();
  
  const queueToProcess = [...offlineQueue];
  offlineQueue = [];
  
  for (const item of queueToProcess) {
    if (socket.connected) {
      socket.emit(item.event, item.data);
    } else {
      offlineQueue.push(item);
    }
  }
  await saveQueue();
  isProcessingQueue = false;
};

socket.io.on('reconnect_attempt', async () => {
  try {
    const token = await storage.getAccessToken();
    if (token) socket.auth = { token };
  } catch (err) {
    console.warn('[SOCKET MOTORISTA] Erro ao injetar token no reconnect:', err);
  }
});

socket.on('connect', async () => {
  console.log('🟢 [SOCKET MOTORISTA] Conectado ao servidor');
  await processOfflineQueue();

  try {
    const driver = await storage.getDriver();
    const isManuallyOnline = await AsyncStorage.getItem('@nobai245:isOnline');

    if (driver?.id) {
      socket.emit('driver:request_state');
      if (isManuallyOnline === 'true') {
        socket.emit('driver:online', { driverId: driver.id });
      }
    }
  } catch (err) {
    console.warn('[SOCKET MOTORISTA] Erro ao sincronizar estado inicial:', err);
  }
});

socket.on('connect_error', (err) => {
  if (err.message.includes('Token') || err.message.includes('Acesso negado')) {
    console.warn('⚠️ [SOCKET MOTORISTA] Acesso negado pelo servidor:', err.message);
    socket.disconnect();
  }
});

export const connectDriverSocket = async () => {
  if (socket.connected) return;
  const token = await storage.getAccessToken();
  if (token) {
    socket.auth = { token };
    socket.connect();
  }
};

export const disconnectDriverSocket = () => {
  if (socket.connected) {
    socket.disconnect();
    socket.auth = {};
  }
};

// 🔧 CORREÇÃO: Exportação da função para atualização de token no Socket
export const updateSocketToken = (newToken: string) => {
  socket.auth = { token: newToken };
  if (socket.connected) {
    socket.disconnect();
    socket.connect();
  }
};

export const setDriverOnlineStatus = async (isOnline: boolean, driverId: string) => {
  await AsyncStorage.setItem('@nobai245:isOnline', String(isOnline));
  if (socket.connected) {
    socket.emit(isOnline ? 'driver:online' : 'driver:offline', { driverId });
  }
};

const emitCriticoDriver = async (event: string, data: any) => {
  if (socket.connected) {
    socket.emit(event, data);
  } else {
    offlineQueue.push({ event, data, id: Date.now().toString() });
    await saveQueue();
  }
};

export const acceptRide = (rideId: string, driverId: string, driverLat: number, driverLng: number) => 
  emitCriticoDriver('driver:accept_ride', { rideId, driverId, driverLat, driverLng });

export const notifyArrival = (rideId: string) => 
  emitCriticoDriver('driver:arrived', { rideId });

export const startRideWithOtp = (rideId: string, otp: string) => 
  emitCriticoDriver('driver:start_ride', { rideId, otp });

export const finishRide = (rideId: string, dropoffLat: number, dropoffLng: number) => 
  emitCriticoDriver('driver:finish_ride', { rideId, dropoffLat, dropoffLng });

export const cancelRideByDriver = (rideId: string, userId: string, reason?: string) => 
  emitCriticoDriver('ride:cancel', { rideId, userId, userType: 'DRIVER', reason: reason || 'Cancelado pelo motorista' });

export const sendLocationUpdate = (payload: { rideId: string; latitude: number; longitude: number; heading?: number }) => { 
  if (socket.connected) socket.emit('driver:location_update', payload); 
};