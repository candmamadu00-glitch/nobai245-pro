import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';

export class RatingController {
  static async submitRating(req: Request, res: Response) {
    try {
      // Pega o ID de quem faz a requisição por segurança (não permitindo falsidade ideológica)
      const tokenUserId = (req as any).user?.id;
      const tokenUserRole = (req as any).user?.role; 
      
      // EXTRAÍMOS O REVIEWER TYPE E RECEIVER ID DO BODY QUE O APP ENVIOU
      const { 
        rideId, 
        stars, 
        tags = [], 
        comment,
        reviewerType: bodyReviewerType, // O que o App enviou
        receiverId: bodyReceiverId      // O que o App enviou
      } = req.body;

      if (!rideId || !stars || stars < 1 || stars > 5) {
        return res.status(400).json({ error: 'Payload de avaliação inválido.' });
      }

      // 1. Define com segurança quem está avaliando (Prioriza o app, faz fallback pro token)
      const reviewerType = bodyReviewerType || tokenUserRole;

      if (reviewerType !== 'PASSENGER' && reviewerType !== 'DRIVER') {
        return res.status(400).json({ error: 'Tipo de avaliador inválido no sistema.' });
      }

      // 2. Valida a corrida
      const ride = await prisma.ride.findUnique({
        where: { id: rideId }
      });

      if (!ride || ride.status !== 'COMPLETED') {
        return res.status(400).json({ error: 'Corrida não encontrada ou não finalizada.' });
      }

      // 3. Determina quem vai receber a nota (prioriza o ID enviado pelo app)
      const receiverId = bodyReceiverId || (reviewerType === 'PASSENGER' ? ride.driverId : ride.passengerId);
      const targetEntity = reviewerType === 'PASSENGER' ? 'driver' : 'passenger';

      if (!receiverId) {
        return res.status(400).json({ error: 'Usuário avaliado não encontrado na corrida.' });
      }

      // 4. Executa a gravação e o recálculo de forma atômica
      await prisma.$transaction(async (tx) => {
        // A. Salva a nova avaliação com os tipos corretos e as tags
        await tx.rating.create({
          data: {
            rideId,
            reviewerId: tokenUserId, // Usa o ID do token para segurança
            reviewerType,
            receiverId,
            stars,
            tags: Array.isArray(tags) ? tags : [],
            comment,
            isApproved: true
          }
        });

        // B. Calcula a nova média do usuário avaliado
        const aggregations = await tx.rating.aggregate({
          where: { receiverId, isApproved: true },
          _avg: { stars: true },
          _count: { id: true }
        });

        const newAverage = aggregations._avg.stars || 5.0;
        const totalRatings = aggregations._count.id;

        // C. Atualiza o perfil do avaliado corretamente
        if (targetEntity === 'driver') {
          await tx.driver.update({
            where: { id: receiverId },
            data: { ratingAverage: newAverage, totalRatings }
          });
        } else {
          await tx.passenger.update({
            where: { id: receiverId },
            data: { ratingAverage: newAverage, totalRatings }
          });
        }
      });

      return res.status(200).json({ message: 'Avaliação registrada com sucesso.' });
    } catch (error: any) {
      // Trata erro caso o usuário tente avaliar a mesma corrida duas vezes
      if (error.code === 'P2002') {
        return res.status(409).json({ error: 'Você já avaliou esta corrida.' });
      }
      console.error('❌ [RATING ERROR]:', error);
      return res.status(500).json({ error: 'Falha interna ao processar a avaliação.' });
    }
  }
}