import { io, Socket } from 'socket.io-client';

const API_URL = (import.meta.env?.VITE_API_URL || 'http://localhost:3333').replace(/\/$/, '');

export const adminSocket: Socket = io(API_URL, {
  autoConnect: false,
  transports: ['websocket'],
  reconnection: true,             
  reconnectionAttempts: Infinity, 
  reconnectionDelay: 1000,        
  reconnectionDelayMax: 10000,    
  randomizationFactor: 0.5,       
});

/**
 * Conecta e autentica o socket do painel de administração
 */
export function connectAdminSocket(adminId: string, token: string) {
  if (!token) return;

  // Atualiza o token se mudou ou se estiver desconectado
  const currentToken = (adminSocket.auth as any)?.token;
  if (currentToken !== token) {
    adminSocket.auth = { token };
    if (adminSocket.connected) {
      adminSocket.disconnect();
    }
  }

  if (!adminSocket.connected) {
    // Remove listeners antigos para evitar chamadas duplicadas
    adminSocket.off('connect');
    adminSocket.off('disconnect');
    adminSocket.off('connect_error');

    adminSocket.on('connect', () => {
      console.log('✅ Conectado ao servidor de Monitoramento (Socket)');
      adminSocket.emit('join_room', {
        room: 'admin_room',
        role: 'ADMIN',
        adminId,
      });
    });

    adminSocket.on('disconnect', (reason) => {
      console.warn(`⚠️ WebSocket Desconectado. Motivo: ${reason}`);
    });

    adminSocket.on('connect_error', (error) => {
      console.error('❌ Falha na conexão WebSocket. Tentando reconectar...', error.message);
    });

    adminSocket.connect();
  }
}

export function disconnectAdminSocket() {
  if (adminSocket.connected) {
    adminSocket.disconnect();
    adminSocket.removeAllListeners();
  }
}