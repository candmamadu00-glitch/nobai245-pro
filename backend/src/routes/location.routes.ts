import { Router, Request, Response } from 'express';
import { prisma } from '../config/prisma';

const router = Router();

// 🟢 1. CADASTRAR PONTO DE REFERÊNCIA EM CAMPO (EQUIPE)
router.post('/landmarks', async (req: Request, res: Response) => {
  try {
    const { neighborhoodName, name, popularName, referenceNotes, latitude, longitude, createdById } = req.body;

    if (!neighborhoodName || !name || latitude === undefined || longitude === undefined) {
      return res.status(400).json({ error: 'Bairro, Nome do Local, Latitude e Longitude são obrigatórios.' });
    }

    // Busca ou cria o bairro automaticamente
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

    // Gera lista de termos de busca
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
    console.error('❌ Erro ao cadastrar ponto de referência:', error);
    return res.status(500).json({ error: 'Erro interno ao salvar local.' });
  }
});

// 🟢 2. BUSCA HÍBRIDA HIERÁRQUICA (PASSAGEIRO)
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

    // Formatação de exibição hierárquica clara para o passageiro
    const formattedResults = places.map((p: any) => ({
      id: p.id,
      title: `${p.name}`,
      subtitle: `${p.neighborhood.name}${p.referenceNotes ? ` • ${p.referenceNotes}` : ''}`,
      displayText: `${p.name} (${p.neighborhood.name})`,
      latitude: p.latitude,
      longitude: p.longitude
    }));

    return res.json(formattedResults);
  } catch (error) {
    console.error('❌ Erro na busca de locais:', error);
    return res.status(500).json({ error: 'Erro na consulta de locais.' });
  }
});

export default router;