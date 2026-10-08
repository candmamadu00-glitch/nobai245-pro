import { SecureStorage } from './storage';
import { io, Socket } from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sentry from '@sentry/react-native';

const BASE_URL = (process.env.EXPO_PUBLIC_API_URL || 'http://192.168.18.29:3333').replace('/api', '');

export const socket: Socket = io(BASE_URL, {
  autoConnect: false,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  transports: ['websocket', 'polling'],
});

let passengerQueue: Array<{ event: string; data: any }> = [];

const savePassengerQueue = async () => {
  try { await AsyncStorage.setItem('@bai245:passengerQueue', JSON.stringify(passengerQueue)); } catch (e) {}
};

const processPassengerQueue = async () => {
  try {
    const saved = await AsyncStorage.getItem('@bai245:passengerQueue');
    if (saved) passengerQueue = JSON.parse(saved);
    
    while (passengerQueue.length > 0 && socket.connected) {
      const item = passengerQueue.shift();
      if (item) socket.emit(item.event, item.data);
    }
    await savePassengerQueue();
  } catch (e) {}
};

socket.io.on('reconnect_attempt', async () => {
  try {
    const token = await SecureStorage.getItem('@bai245:accessToken');
    if (token) socket.auth = { token };
  } catch (err) {
    Sentry.captureException(err);
  }
});

socket.on('connect', async () => {
  console.log('🟢 [SOCKET PASSAGEIRO] Conectado');
  await processPassengerQueue();
  try {
    const storedUser = await AsyncStorage.getItem('@bai245:user');
    if (storedUser) {
      const user = JSON.parse(storedUser);
      if (user?.id) socket.emit('passenger:request_state');
    }
  } catch (err) {
    Sentry.captureException(err);
  }
});

socket.on('connect_error', async (err) => {
  if (err.message.includes('Token inválido') || err.message.includes('Acesso negado')) {
    socket.disconnect();
    await SecureStorage.removeItem('@bai245:accessToken');
  } else {
    Sentry.captureMessage(`Socket Passageiro Error: ${err.message}`, 'error');
  }
});

export const connectPassengerSocket = async () => {
  if (socket.connected) return;
  try {
    const token = await SecureStorage.getItem('@bai245:accessToken'); 
    if (token) {
      socket.auth = { token };
      socket.connect();
    }
  } catch (error) {
    Sentry.captureException(error);
  }
};

export const disconnectSocket = () => {
  if (socket.connected) {
    socket.disconnect();
    socket.auth = {};
  }
};

const emitCriticoPassenger = async (event: string, data: any) => {
  if (socket.connected) {
    socket.emit(event, data);
  } else {
    passengerQueue.push({ event, data });
    await savePassengerQueue();
  }
};

export const requestRide = (payload: {
  passengerId: string;
  pickupLat: number;
  pickupLng: number;
  destinationLat: number;
  destinationLng: number;
  originAddress: string;
  destinationAddress: string;
  vehicleType: string;
  paymentMethod: string;
  serviceType?: string;
  referencePoint?: string;
}) => {
  emitCriticoPassenger('passenger:request_ride', payload);
};

export const cancelRideByPassenger = (rideId: string, userId: string, reason?: string) => {
  emitCriticoPassenger('ride:cancel', { rideId, userId, userType: 'PASSENGER', reason: reason || 'Cancelado pelo passageiro' });
};

export const sendChatMessage = (rideId: string, senderName: string, text: string) => {
  emitCriticoPassenger('chat:send_message', { rideId, sender: senderName, text });
};

export const rateDriver = (payload: { rideId: string; reviewerId: string; receiverId: string; stars: number; comment?: string; tags?: string[] }) => {
  emitCriticoPassenger('ride:rate', { ...payload, reviewerType: 'PASSENGER', tags: payload.tags || [] });
};

export const triggerSOS = (payload: { rideId?: string; latitude: number; longitude: number }) => {
  emitCriticoPassenger('sos:triggered', { ...payload, timestamp: new Date().toISOString() });
};