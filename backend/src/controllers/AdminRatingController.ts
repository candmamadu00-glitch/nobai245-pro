import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';

export class AdminRatingController {
  static async listRatings(req: Request, res: Response) {
    try {
      const { page = 1, limit = 20, minScore, reviewerType, search } = req.query;
      const skip = (Number(page) - 1) * Number(limit);
      const where: any = {};

      if (minScore) where.stars = { lte: Number(minScore) };
      if (reviewerType) where.reviewerType = String(reviewerType);

      if (search) {
        where.OR = [
          { comment: { contains: String(search), mode: 'insensitive' } },
          { ride: { passenger: { fullName: { contains: String(search), mode: 'insensitive' } } } },
          { ride: { driver: { fullName: { contains: String(search), mode: 'insensitive' } } } }
        ];
      }

      const [total, ratings] = await Promise.all([
        prisma.rating.count({ where }),
        prisma.rating.findMany({
          where,
          skip,
          take: Number(limit),
          orderBy: { createdAt: 'desc' },
          include: {
            ride: {
              select: {
                id: true,
                passenger: { select: { id: true, fullName: true, phone: true } },
                driver: { select: { id: true, fullName: true, phone: true } }
              }
            }
          }
        })
      ]);

      return res.json({
        success: true,
        data: ratings,
        meta: { total, page: Number(page), pages: Math.ceil(total / Number(limit)) }
      });
    } catch (error) {
      console.error('❌ Erro ao listar avaliações:', error);
      return res.status(500).json({ error: 'Erro ao listar avaliações.' });
    }
  }

  static async toggleModeration(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const { isApproved } = req.body;

      const rating = await prisma.rating.update({
        where: { id: String(id) },
        data: { isApproved: Boolean(isApproved) }
      });

      return res.json({ success: true, data: rating });
    } catch (error) {
      console.error('❌ Erro ao moderar avaliação:', error);
      return res.status(500).json({ error: 'Erro ao moderar avaliação.' });
    }
  }
}