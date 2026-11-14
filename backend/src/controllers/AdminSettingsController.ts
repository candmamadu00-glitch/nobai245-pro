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
      const body = req.body || {};
      const cleanData: Record<string, any> = {};

      if (body.adminOrangeNumber !== undefined) cleanData.adminOrangeNumber = String(body.adminOrangeNumber).trim();
      if (body.adminMtnNumber !== undefined) cleanData.adminMtnNumber = String(body.adminMtnNumber).trim();
      if (body.adminMerchantCode !== undefined) cleanData.adminMerchantCode = String(body.adminMerchantCode).trim();
      if (body.companyName !== undefined) cleanData.companyName = String(body.companyName).trim();
      if (body.defaultCommissionRate !== undefined) cleanData.defaultCommissionRate = Number(body.defaultCommissionRate);
      if (body.globalSurgeActive !== undefined) cleanData.globalSurgeActive = Boolean(body.globalSurgeActive);
      if (body.globalSurgeMultiplier !== undefined) cleanData.globalSurgeMultiplier = Number(body.globalSurgeMultiplier) || 1.0;
      if (body.minDriverBalanceXof !== undefined) cleanData.minDriverBalanceXof = Number(body.minDriverBalanceXof) || 0;
      if (body.autoBlockExpiredDocs !== undefined) cleanData.autoBlockExpiredDocs = Boolean(body.autoBlockExpiredDocs);

      let config = await prisma.systemConfig.findFirst();

      if (config) {
        config = await prisma.systemConfig.update({
          where: { id: config.id },
          data: cleanData
        });
      } else {
        config = await prisma.systemConfig.create({ data: cleanData });
      }

      return res.status(200).json(config);
    } catch (error) {
      console.error('❌ Erro ao atualizar configurações:', error);
      return res.status(500).json({ error: 'Erro ao atualizar configurações do sistema.' });
    }
  }

  async getTariffs(req: Request, res: Response): Promise<Response> {
    try {
      const tariffs = await prisma.tariffConfig.findMany({
        orderBy: [{ vehicleType: 'asc' }, { serviceType: 'asc' }]
      });
      return res.status(200).json(tariffs);
    } catch (error) {
      console.error('❌ Erro ao buscar tarifas:', error);
      return res.status(500).json({ error: 'Erro ao buscar tarifas.' });
    }
  }

  async updateTariff(req: Request, res: Response): Promise<Response> {
    try {
      const { id } = req.params;
      const body = req.body || {};
      const cleanData: Record<string, any> = {};

      if (body.baseFare !== undefined) cleanData.baseFare = Number(body.baseFare);
      if (body.perKmFare !== undefined) cleanData.perKmFare = Number(body.perKmFare);
      if (body.perMinuteFare !== undefined) cleanData.perMinuteFare = Number(body.perMinuteFare);
      if (body.minimumFare !== undefined) cleanData.minimumFare = Number(body.minimumFare);
      if (body.commissionRate !== undefined) cleanData.commissionRate = Number(body.commissionRate);
      if (body.surgeMultiplier !== undefined) cleanData.surgeMultiplier = Number(body.surgeMultiplier);
      if (body.isActive !== undefined) cleanData.isActive = Boolean(body.isActive);

      const tariff = await prisma.tariffConfig.update({
        where: { id: String(id) },
        data: cleanData
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
