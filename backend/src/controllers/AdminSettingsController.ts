import { Request, Response } from 'express';
import { prisma } from '../config/prisma';

export class AdminSettingsControllerClass {
  async getSystemConfig(req: Request, res: Response): Promise<Response> {
    try {
      let config = await prisma.systemConfig.findFirst();
      if (!config) {
        config = await prisma.systemConfig.create({
          data: {}
        });
      }
      return res.status(200).json(config);
    } catch (error) {
      console.error('❌ Erro ao buscar configurações:', error);
      return res.status(500).json({ error: 'Erro ao buscar configurações do sistema.' });
    }
  }

  async updateSystemConfig(req: Request, res: Response): Promise<Response> {
    try {
      const data = req.body;
      let config = await prisma.systemConfig.findFirst();

      if (config) {
        config = await prisma.systemConfig.update({
          where: { id: config.id },
          data
        });
      } else {
        config = await prisma.systemConfig.create({ data });
      }

      return res.status(200).json(config);
    } catch (error) {
      console.error('❌ Erro ao atualizar configurações:', error);
      return res.status(500).json({ error: 'Erro ao atualizar configurações do sistema.' });
    }
  }

  async getTariffs(req: Request, res: Response): Promise<Response> {
    try {
      const tariffs = await prisma.tariff.findMany();
      return res.status(200).json(tariffs);
    } catch (error) {
      console.error('❌ Erro ao buscar tarifas:', error);
      return res.status(500).json({ error: 'Erro ao buscar tarifas.' });
    }
  }

  async updateTariff(req: Request, res: Response): Promise<Response> {
    try {
      const { id } = req.params;
      const data = req.body;

      const tariff = await prisma.tariff.update({
        where: { id: String(id) },
        data
      });

      return res.status(200).json(tariff);
    } catch (error) {
      console.error('❌ Erro ao atualizar tarifa:', error);
      return res.status(500).json({ error: 'Erro ao atualizar tarifa.' });
    }
  }
}

export const AdminSettingsController = new AdminSettingsControllerClass();
export default AdminSettingsController;