import { Server, Socket } from 'socket.io';
import { prisma } from '../config/prisma';
import { notifyNewChatMessage } from '../services/rideService'; // 👈 Importação adicionada

export function setupTicketSocketHandlers(io: Server, socket: Socket) {
  socket.on('admin:join_dashboard', () => {
    socket.join('admin_dashboard');
  });

  socket.on('ticket:join', (data: { ticketId?: string } | string) => {
    const ticketId = typeof data === 'string' ? data : data?.ticketId;
    if (ticketId) {
      socket.join(`ticket_${String(ticketId)}`);
    }
  });

  socket.on('ticket:leave', (data: { ticketId?: string } | string) => {
    const ticketId = typeof data === 'string' ? data : data?.ticketId;
    if (ticketId) {
      socket.leave(`ticket_${String(ticketId)}`);
    }
  });

// Atualização de localização do motorista
  socket.on('driver:update_location', async (data: { driverId: string; rideId?: string; latitude: number; longitude: number; heading?: number; speed?: number }) => {
    io.to('admin_dashboard').emit('admin:map_update', data);

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

    io.to(`passenger_${data.passengerId}`).emit('ride:inaccessible_location', {
      title: 'Atenção ao Local de Embarque',
      message: 'Seu motorista está próximo, mas relatou dificuldade de acesso à sua rua. Por favor, aproxime-se da via principal mais próxima para facilitar o encontro.',
      rideId: data.rideId,
      timestamp: new Date()
    });
  });

  // Envio de mensagens de ticket de suporte
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

        const authenticatedUserId = socket.data?.user?.id || data.senderId || data.userId || 'SYSTEM';

        const newMessage = await prisma.ticketMessage.create({
          data: {
            ticketId: String(ticketId),
            sender: sender,
            senderId: String(authenticatedUserId),
            message: message.trim(),
          },
        });

        await prisma.ticket.update({
          where: { id: String(ticketId) },
          data: { updatedAt: new Date() },
        }).catch(() => {});

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