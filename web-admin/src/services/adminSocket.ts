import { io, Socket } from 'socket.io-client';

const rawUrl = import.meta.env?.VITE_API_URL || 'https://api.nobai245.com';
const API_URL = rawUrl.replace(/\/api\/?$/, '').replace(/\/$/, '');

export const adminSocket: Socket = io(API_URL, {
  autoConnect: false,
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 10000,
  randomizationFactor: 0.5
});

export function connectAdminSocket(adminId: string, token: string) {
  if (!token) return;

  const currentToken = (adminSocket.auth as Record<string, string> | undefined)?.token;
  if (currentToken !== token) {
    adminSocket.auth = { token };
    if (adminSocket.connected) {
      adminSocket.disconnect();
    }
  }

  if (!adminSocket.connected) {
    adminSocket.off('connect');
    adminSocket.off('disconnect');
    adminSocket.off('connect_error');

    adminSocket.on('connect', () => {
      adminSocket.emit('join_room', {
        room: 'admin_room',
        role: 'ADMIN',
        adminId
      });
    });

    adminSocket.on('disconnect', () => {});
    adminSocket.on('connect_error', () => {});

    adminSocket.connect();
  }
}

export function disconnectAdminSocket() {
  adminSocket.auth = {};
  if (adminSocket.connected) {
    adminSocket.disconnect();
  }
}
