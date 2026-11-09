import { Router, Request, Response } from 'express';
import { prisma } from '../config/prisma';

const router = Router();

// 🟢 1. CADASTRAR PONTO DE REFERÊNCIA
router.post('/landmarks', async (req: Request, res: Response) => {
  try {
    const { neighborhoodName, name, popularName, referenceNotes, latitude, longitude, createdById } = req.body;

    if (!neighborhoodName || !name || latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: 'Bairro, Nome do Local, Latitude e Longitude são obrigatórios.' });
    }

    let neighborhood = await prisma.neighborhood.findUnique({
      where: { name: neighborhoodName.trim() }
    });

    if (!neighborhood) {
      neighborhood = await prisma.neighborhood.create({
        data: {
          name: neighborhoodName.trim(),
          centerLat: parseFloat(latitude),
          centerLng: parseFloat(longitude)
        }
      });
    }

    const terms = [
      name.toLowerCase(),
      popularName ? popularName.toLowerCase() : '',
      neighborhoodName.toLowerCase()
    ].filter(Boolean);

    const place = await prisma.customPlace.create({
      data: {
        neighborhoodId: neighborhood.id,
        name: name.trim(),
        popularName: popularName ? popularName.trim() : null,
        referenceNotes: referenceNotes ? referenceNotes.trim() : null,
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        searchKeywords: terms,
        createdById: createdById || null
      },
      include: { neighborhood: true }
    });

    return res.status(201).json({ success: true, place });
  } catch (error) {
    console.error('❌ Erro ao cadastrar ponto:', error);
    return res.status(500).json({ error: 'Erro interno ao salvar local.' });
  }
});

// 🟢 2. LISTAR TODOS OS PONTOS (PAINEL DE ADMINISTRAÇÃO)
router.get('/landmarks', async (_req: Request, res: Response) => {
  try {
    const places = await prisma.customPlace.findMany({
      include: { neighborhood: true },
      orderBy: { createdAt: 'desc' }
    });

    const formattedResults = places.map((p: any) => ({
      id: p.id,
      name: p.name,
      popularName: p.popularName,
      neighborhood: p.neighborhood?.name || '',
      referenceNotes: p.referenceNotes,
      latitude: p.latitude,
      longitude: p.longitude,
      isActive: p.isActive,
      createdAt: p.createdAt
    }));

    return res.json(formattedResults);
  } catch (error) {
    console.error('❌ Erro ao listar pontos:', error);
    return res.status(500).json({ error: 'Erro interno ao consultar pontos.' });
  }
});

// 🟢 3. BUSCA HÍBRIDA (PASSAGEIRO / APP) - CORRIGIDA COM FALLBACKS DE CAMPOS
router.get('/landmarks/search', async (req: Request, res: Response) => {
  try {
    const query = String(req.query.q || '').trim().toLowerCase();

    if (!query || query.length < 2) {
      return res.json([]);
    }

    const places = await prisma.customPlace.findMany({
      where: {
        isActive: true,
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { popularName: { contains: query, mode: 'insensitive' } },
          { neighborhood: { name: { contains: query, mode: 'insensitive' } } },
          { searchKeywords: { has: query } }
        ]
      },
      include: { neighborhood: true },
      take: 15
    });

    const formattedResults = places.map((p: any) => ({
      id: p.id,
      name: p.name,
      popularName: p.popularName,
      neighborhood: p.neighborhood?.name || '',
      referenceNotes: p.referenceNotes,
      title: p.name,
      subtitle: `${p.neighborhood?.name || ''}${p.referenceNotes ? ` • ${p.referenceNotes}` : ''}`,
      displayText: p.popularName 
        ? `${p.name} (${p.popularName}) - ${p.neighborhood?.name || ''}` 
        : `${p.name}${p.neighborhood?.name ? ` - ${p.neighborhood.name}` : ''}`,
      latitude: p.latitude,
      longitude: p.longitude
    }));

    return res.json(formattedResults);
  } catch (error) {
    console.error('❌ Erro na busca de locais:', error);
    return res.status(500).json({ error: 'Erro na consulta de locais.' });
  }
});

// 🟢 4. ATUALIZAR PONTO DE REFERÊNCIA
router.put('/landmarks/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const { neighborhoodName, name, popularName, referenceNotes, latitude, longitude } = req.body;

    let neighborhood = await prisma.neighborhood.findUnique({
      where: { name: neighborhoodName.trim() }
    });

    if (!neighborhood) {
      neighborhood = await prisma.neighborhood.create({
        data: {
          name: neighborhoodName.trim(),
          centerLat: parseFloat(latitude),
          centerLng: parseFloat(longitude)
        }
      });
    }

    const updatedPlace = await prisma.customPlace.update({
      where: { id },
      data: {
        neighborhoodId: neighborhood.id,
        name: name.trim(),
        popularName: popularName ? popularName.trim() : null,
        referenceNotes: referenceNotes ? referenceNotes.trim() : null,
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        searchKeywords: [
          name.toLowerCase(),
          popularName ? popularName.toLowerCase() : '',
          neighborhoodName.toLowerCase()
        ].filter(Boolean)
      }
    });

    return res.json({ success: true, place: updatedPlace });
  } catch (error) {
    console.error('❌ Erro ao atualizar ponto:', error);
    return res.status(500).json({ error: 'Erro ao atualizar ponto.' });
  }
});

// 🟢 5. REMOVER PONTO DE REFERÊNCIA
router.delete('/landmarks/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    await prisma.customPlace.delete({ where: { id } });
    return res.json({ success: true, message: 'Ponto removido com sucesso.' });
  } catch (error) {
    console.error('❌ Erro ao apagar ponto:', error);
    return res.status(500).json({ error: 'Erro ao apagar ponto de referência.' });
  }
});

export default router;