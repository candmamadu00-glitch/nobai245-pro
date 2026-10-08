import { Server, Socket } from 'socket.io';
import { prisma } from '../config/prisma';

export function setupTicketSocketHandlers(io: Server, socket: Socket) {
  socket.on('admin:join_dashboard', () => {
    socket.join('admin_dashboard');
  });

  socket.on('ticket:join', ({ ticketId }: { ticketId: string }) => {
    if (ticketId) {
      socket.join(`ticket_${ticketId}`);
    }
  });

  // Atualização de localização do motorista
  socket.on('driver:update_location', async (data: { driverId: string; rideId?: string; latitude: number; longitude: number; heading?: number; speed?: number }) => {
    
    // Transmite para o dashboard do admin/mapa
    io.emit('admin:map_update', data);

    // Se houver corrida ativa, grava no histórico com os nomes exatos das colunas do Prisma Schema (lat, lng, createdAt)
    if (data.rideId) {
      try {
        await prisma.rideLocationHistory.create({
          data: {
            rideId: data.rideId,
            lat: data.latitude,
            lng: data.longitude,
            heading: data.heading || 0,
            speed: data.speed || 0
          }
        });
      } catch (err) {
        console.error('Erro ao salvar ponto de telemetria:', err);
      }
    }
  });

  // Alerta de local de difícil acesso
  socket.on('driver:alert_inaccessible_location', (data: { rideId: string, passengerId: string }) => {
    if (!data.passengerId) return;

    io.to(`passenger_${data.passengerId}`).emit('ride:inaccessible_location_alert', {
      title: 'Atenção ao Local de Embarque',
      message: 'Seu motorista está próximo, mas relatou dificuldade de acesso à sua rua. Por favor, aproxime-se da via principal mais próxima para facilitar o encontro.',
      rideId: data.rideId,
      timestamp: new Date()
    });
  });

  // Envio de mensagens de ticket
socket.on(
  'ticket:send_message',
  async (data: {
    ticketId: string;
    message: string;
    sender?: 'ADMIN' | 'PASSENGER' | 'DRIVER';
    senderId?: string;
    userId?: string;
  }) => {
    try {
      const { ticketId, message, sender = 'DRIVER' } = data;

      if (!ticketId || !message?.trim()) return;

      const newMessage = await prisma.ticketMessage.create({
        data: {
          ticketId: String(ticketId),
          sender: sender,
          senderId: String(data.senderId || data.userId || 'SYSTEM'),
          message: message.trim(),
        },
      });

      if (sender === 'ADMIN') {
        await prisma.ticket.update({
          where: { id: ticketId },
          data: { status: 'IN_PROGRESS' },
        });
      }

      io.to(`ticket_${ticketId}`).emit('ticket:receive_message', {
        ...newMessage,
        ticketId,
      });

      io.to('admin_dashboard').emit('admin:ticket_updated', {
        ticketId,
        lastMessage: message.trim(),
        sender,
        updatedAt: new Date(),
      });
    } catch (error) {
      console.error('Erro ao processar mensagem do ticket via socket:', error);
    }
  }
);
}