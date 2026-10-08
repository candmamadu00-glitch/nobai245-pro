import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { getIo } from '../server';

export class AdminTicketController {
  async listTickets(req: Request, res: Response): Promise<Response> {
    try {
      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 15));
      const skip = (page - 1) * limit;

      const { status, category, priority, search } = req.query;

      const where: any = {};

      if (status) where.status = status;
      if (category) where.category = category;
      if (priority) where.priority = priority;
      
      if (search) {
        where.OR = [
          { description: { contains: search as string, mode: 'insensitive' } },
          { passenger: { fullName: { contains: search as string, mode: 'insensitive' } } },
          { driver: { fullName: { contains: search as string, mode: 'insensitive' } } },
        ];
      }

      const [tickets, total] = await Promise.all([
        prisma.ticket.findMany({
          where,
          take: limit,
          skip: skip,
          orderBy: [
            { priority: 'desc' },
            { updatedAt: 'desc' }
          ],
          include: {
            passenger: { select: { id: true, fullName: true, phone: true, deviceToken: true } },
            driver: { select: { id: true, fullName: true, phone: true, deviceToken: true } },
            assignedAdmin: { select: { id: true, name: true, email: true } },
            messages: { orderBy: { createdAt: 'asc' } },
            ride: {
              select: { id: true, originAddress: true, destinationAddress: true, createdAt: true }
            }
          },
        }),
        prisma.ticket.count({ where }),
      ]);

      return res.status(200).json({
        data: tickets,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      console.error('❌ Erro ao buscar chamados:', error);
      return res.status(500).json({ error: 'Erro ao buscar chamados.' });
    }
  }

  async assignTicket(req: Request, res: Response): Promise<Response> {
    try {
      const { ticketId } = req.params;
      const { adminId, priority } = req.body;

      const updated = await prisma.ticket.update({
        where: { id: String(ticketId) },
        data: {
          assignedAdminId: adminId || null,
          ...(priority && { priority })
        },
        include: { assignedAdmin: { select: { id: true, name: true } } }
      });

      return res.status(200).json(updated);
    } catch (error) {
      return res.status(500).json({ error: 'Erro ao atribuir chamado.' });
    }
  }

  async replyTicket(req: Request, res: Response): Promise<Response> {
    try {
      const { ticketId } = req.params;
      const { message, newStatus } = req.body;
      
      let adminId = (req as any).user?.id || (req as any).admin?.id;

      if (!adminId && req.headers.authorization?.startsWith('Bearer ')) {
        const token = req.headers.authorization.split(' ')[1];
        try {
          const decoded = jwt.verify(token, process.env.JWT_SECRET as string) as any;
          adminId = decoded.id || decoded.userId || decoded.adminId;
        } catch (err) {
          console.error('Falha ao decodificar token no fallback:', err);
        }
      }

      if (!adminId) {
        return res.status(401).json({ error: 'Sessão inválida. O ID do administrador não pôde ser recuperado.' });
      }

      if (!message) {
        return res.status(400).json({ error: 'A mensagem de resposta é obrigatória.' });
      }

      const updateData: any = { status: newStatus || 'IN_PROGRESS' };
      if (newStatus === 'RESOLVED') updateData.resolvedAt = new Date();
      if (newStatus === 'CLOSED') updateData.closedAt = new Date();

      const [newMessage, updatedTicket] = await prisma.$transaction([
        prisma.ticketMessage.create({
          data: {
            ticketId: String(ticketId),
            sender: 'ADMIN',
            message,
            senderId: String(adminId), 
          },
        }),
        prisma.ticket.update({
          where: { id: String(ticketId) },
          data: updateData,
          include: { 
            passenger: { select: { id: true, fullName: true, phone: true, deviceToken: true } },
            driver: { select: { id: true, fullName: true, phone: true, deviceToken: true } },
            messages: { orderBy: { createdAt: 'asc' } },
          },
        }),
      ]);

      try {
        const io = getIo();
        if (io) {
          io.to(`ticket_${ticketId}`).emit('ticket:receive_message', {
            ...newMessage,
            ticketId,
          });

          io.to('admin_dashboard').emit('admin:ticket_updated', {
            ticketId,
            lastMessage: message,
            sender: 'ADMIN',
            updatedAt: new Date(),
          });
        }
      } catch (socketError) {
        console.error('Falha de socket:', socketError);
      }

      return res.status(200).json({ message: newMessage, ticket: updatedTicket });
    } catch (error: any) {
      console.error('❌ Erro ao responder ticket:', error);
      return res.status(500).json({ error: 'Erro ao registrar resposta.' });
    }
  }
}

export default new AdminTicketController();