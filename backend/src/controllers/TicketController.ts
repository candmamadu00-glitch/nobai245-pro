import { Request, Response } from 'express';
import { prisma } from '../config/prisma';
import { getIo } from '../server';
export class TicketController {
  async create(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      const userRole = req.user?.role?.toString().toUpperCase();
      const { category, description, rideId } = req.body;

      if (!userId) {
        return res.status(401).json({ error: 'Usuário não autenticado.' });
      }

      if (!description || description.trim().length < 10) {
        return res.status(400).json({ error: 'A descrição deve conter no mínimo 10 caracteres.' });
      }

      const isDriver = userRole === 'DRIVER';

      if (rideId) {
        const ride = await prisma.ride.findFirst({
          where: {
            id: rideId,
            ...(isDriver ? { driverId: userId } : { passengerId: userId }),
          },
        });

        if (!ride) {
          return res.status(404).json({ error: 'Corrida não encontrada.' });
        }
      }

      const ticket = await prisma.ticket.create({
        data: {
          category: category || 'Outros',
          description: description.trim(),
          status: 'OPEN',
          createdByType: isDriver ? 'DRIVER' : 'PASSENGER',
          ...(isDriver ? { driverId: userId } : { passengerId: userId }),
          ...(rideId ? { rideId } : {}),
        },
        include: {
          messages: true,
        },
      });
      
      // Opcional: Avisar o painel admin que um ticket novo foi aberto
      try {
        const io = getIo();
        io.to('admin_dashboard').emit('admin:ticket_alert', {
          ticketId: ticket.id,
          message: 'Novo ticket criado',
        });
      } catch (err) {}

      return res.status(201).json(ticket);
    } catch (error: any) {
      console.error('Erro ao criar ticket:', error);
      return res.status(500).json({ error: 'Erro interno ao registrar chamado.', details: error.message });
    }
  }

  async getMyTickets(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      const userRole = req.user?.role?.toString().toUpperCase();

      if (!userId) return res.status(401).json({ error: 'Não autorizado.' });

      const isDriver = userRole === 'DRIVER';

      const tickets = await prisma.ticket.findMany({
        where: isDriver ? { driverId: userId } : { passengerId: userId },
        include: {
          messages: {
            orderBy: { createdAt: 'asc' },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      return res.json(tickets);
    } catch (error: any) {
      console.error('Erro ao buscar tickets:', error);
      return res.status(500).json({ error: 'Erro interno ao carregar chamados.' });
    }
  }

  async reply(req: Request, res: Response) {
    try {
      const userId = req.user?.id;
      const userRole = req.user?.role?.toString().toUpperCase();
      const { ticketId } = req.params;
      const { message } = req.body;

      if (!userId) return res.status(401).json({ error: 'Não autorizado.' });
      if (!message || !message.trim()) {
        return res.status(400).json({ error: 'Mensagem inválida.' });
      }

      const isDriver = userRole === 'DRIVER';
      const senderType = isDriver ? 'DRIVER' : 'PASSENGER';

      const ticket = await prisma.ticket.findFirst({
        where: {
          id:String (ticketId),
          ...(isDriver ? { driverId: userId } : { passengerId: userId }),
        },
      });

      if (!ticket) {
        return res.status(404).json({ error: 'Chamado não encontrado.' });
      }


const newMessage = await prisma.ticketMessage.create({
  data: {
    ticketId: String(ticketId),
    sender: senderType,
    senderId: userId,
    message: message.trim(),
  },
});

      await prisma.ticket.update({
        where: { id:String( ticketId) },
        data: { updatedAt: new Date() },
      });

      // DISPARO DO SOCKET INCLUÍDO AQUI
      try {
        const io = getIo();
        
        io.to(`ticket_${ticketId}`).emit('ticket:receive_message', {
          ...newMessage,
          ticketId,
        });

        io.to('admin_dashboard').emit('admin:ticket_updated', {
          ticketId,
          lastMessage: message.trim(),
          sender: senderType,
          updatedAt: new Date(),
        });
      } catch (socketError) {
        console.error('Falha ao emitir evento de socket (App):', socketError);
      }

      return res.status(201).json(newMessage);
    } catch (error: any) {
      console.error('Erro ao responder chamado:', error);
      return res.status(500).json({ error: 'Erro interno ao enviar resposta.', details: error.message });
    }
  }
}