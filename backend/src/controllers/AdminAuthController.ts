import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { DriverStatus, PassengerStatus, TransactionType } from '@prisma/client';

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error('❌ [AUTH ADMIN] FATAL: JWT_SECRET não está configurado nas variáveis de ambiente.');
}

export class AdminAuthController {
  // 🗑️ Soft Delete de Motorista pelo Admin
  async deleteDriver(req: Request, res: Response) {
    try {
      const { driverId } = req.params;

      const driver = await prisma.driver.findUnique({ where: { id: String(driverId) } });
      if (!driver) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Motorista não encontrado.' });
      }

      await prisma.driver.update({
        where: { id: String(driverId) },
        data: {
          deletedAt: new Date(),
          isOnline: false,
          isAvailable: false,
          status: 'SUSPENDED'
        }
      });

      return res.status(200).json({ message: 'Conta do motorista desativada/excluída com sucesso.' });
    } catch (error) {
      return res.status(500).json({ error: 'SERVER_ERROR', message: 'Erro ao desativar motorista.' });
    }
  }

  // 🗑️ Soft Delete de Passageiro pelo Admin
  async deletePassenger(req: Request, res: Response) {
    try {
      const { passengerId } = req.params;

      const passenger = await prisma.passenger.findUnique({ where: { id: String(passengerId) } });
      if (!passenger) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Passageiro não encontrado.' });
      }

      await prisma.passenger.update({
        where: { id: String(passengerId) },
        data: {
          deletedAt: new Date(),
          status: 'SUSPENDED'
        }
      });

      return res.status(200).json({ message: 'Conta do passageiro desativada/excluída com sucesso.' });
    } catch (error) {
      return res.status(500).json({ error: 'SERVER_ERROR', message: 'Erro ao desativar passageiro.' });
    }
  }

  // 📋 Listar solicitações de exclusão enviadas pelos Apps
  async listAccountDeletionRequests(req: Request, res: Response) {
    try {
      const requests = await prisma.accountDeletionRequest.findMany({
        include: {
          passenger: { select: { id: true, fullName: true, phone: true, email: true } },
          driver: { select: { id: true, fullName: true, phone: true } }
        },
        orderBy: { createdAt: 'desc' }
      });

      return res.status(200).json(requests);
    } catch (error) {
      return res.status(500).json({ error: 'SERVER_ERROR', message: 'Erro ao listar solicitações.' });
    }
  }

  // ⚙️ Aprovar ou Rejeitar pedido de exclusão enviado pelo App
  async reviewAccountDeletionRequest(req: Request, res: Response) {
    try {
      const { requestId } = req.params;
      const { status } = req.body; // 'APPROVED' ou 'REJECTED'

      const deletionReq = await prisma.accountDeletionRequest.findUnique({ where: { id: String(requestId) } });
      if (!deletionReq) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Solicitação não encontrada.' });
      }

      if (status === 'APPROVED') {
        if (deletionReq.passengerId) {
          await prisma.passenger.update({
            where: { id: deletionReq.passengerId },
            data: { deletedAt: new Date(), status: 'SUSPENDED' }
          });
        }
        if (deletionReq.driverId) {
          await prisma.driver.update({
            where: { id: deletionReq.driverId },
            data: { deletedAt: new Date(), status: 'SUSPENDED', isOnline: false }
          });
        }
      }

      const updated = await prisma.accountDeletionRequest.update({
        where: { id: String(requestId) },
        data: { status }
      });

      return res.status(200).json(updated);
    } catch (error) {
      return res.status(500).json({ error: 'SERVER_ERROR', message: 'Erro ao processar solicitação.' });
    }
  }

  // 🛡️ 1. REGISTRO DO PRIMEIRO ADMINISTRADOR (COM BLOQUEIO DE SEGURANÇA)
  async register(req: Request, res: Response): Promise<Response> {
    try {
      const { name, email, password } = req.body;

      if (!name || !email || !password) {
        return res.status(400).json({ error: 'Nome, email e senha são obrigatórios.' });
      }

      const adminCount = await prisma.admin.count();
      if (adminCount > 0) {
        return res.status(403).json({ 
          error: 'O cadastro público de administradores está desativado. Solicite a um Super Admin existente.' 
        });
      }

      const cleanEmail = String(email).trim().toLowerCase();

      const existingAdmin = await prisma.admin.findUnique({ where: { email: cleanEmail } });
      if (existingAdmin) {
        return res.status(409).json({ error: 'Este email já pertence a um administrador.' });
      }

      const passwordHash = await bcrypt.hash(password, 10);

      const admin = await prisma.admin.create({
        data: {
          name: String(name).trim(),
          email: cleanEmail,
          passwordHash,
          role: 'SUPER_ADMIN',
        },
      });

      const token = jwt.sign(
        { id: admin.id, role: admin.role },
        JWT_SECRET!,
        { expiresIn: '1d' }
      );

      return res.status(201).json({
        message: 'Super Admin inicial criado com sucesso!',
        token,
        admin: { id: admin.id, name: admin.name, role: admin.role },
      });
    } catch (error) {
      console.error('[ERRO NO CADASTRO DE ADMIN]:', error);
      return res.status(500).json({ error: 'Erro interno no servidor.' });
    }
  }

  // 🔐 2. LOGIN DE ADMINISTRADOR
  async login(req: Request, res: Response): Promise<Response> {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        return res.status(400).json({ error: 'Email e senha são obrigatórios.' });
      }

      const cleanEmail = String(email).trim().toLowerCase();

      const admin = await prisma.admin.findUnique({ where: { email: cleanEmail } });
      if (!admin) {
        return res.status(401).json({ error: 'Credenciais inválidas.' });
      }

      if (admin.isActive === false) {
        return res.status(403).json({ error: 'Sua conta de administrador está desativada pela gestão.' });
      }

      const isValidPassword = await bcrypt.compare(password, admin.passwordHash);
      if (!isValidPassword) {
        return res.status(401).json({ error: 'Credenciais inválidas.' });
      }

      const token = jwt.sign(
        { id: admin.id, role: admin.role },
        JWT_SECRET!,
        { expiresIn: '1d' }
      );

      return res.status(200).json({
        message: 'Login realizado com sucesso',
        token,
        admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role },
      });
    } catch (error) {
      console.error('[ERRO NO LOGIN DE ADMIN]:', error);
      return res.status(500).json({ error: 'Erro ao realizar login admin.' });
    }
  }

  // 📋 3. LISTAR MOTORISTAS
  async listDrivers(req: Request, res: Response): Promise<Response> {
    try {
      const { status } = req.query;
      
      const drivers = await prisma.driver.findMany({
        where: status ? { status: status as DriverStatus } : {},
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          fullName: true,
          phone: true,
          vehicleType: true,
          vehiclePlate: true,
          vehicleBrand: true,
          status: true,
          isOnline: true,
          profilePicture: true,
          licenseFrontPicture: true,
          licenseBackPicture: true,
          createdAt: true,
          orangeNumber: true,
          mtnNumber: true,
          paymentAccountNumber: true
        },
      });

      const formattedDrivers = drivers.map(driver => {
        let provider = 'Não configurado';
        
        if (driver.paymentAccountNumber) {
          if (driver.paymentAccountNumber === driver.orangeNumber) provider = 'ORANGE';
          else if (driver.paymentAccountNumber === driver.mtnNumber) provider = 'MTN';
        }

        return {
          ...driver,
          mobileMoneyProvider: provider,
          mobileMoneyNumber: driver.paymentAccountNumber
        };
      });

      return res.status(200).json(formattedDrivers);
    } catch (error) {
      console.error('[ERRO AO LISTAR MOTORISTAS]:', error);
      return res.status(500).json({ error: 'Erro ao buscar motoristas.' });
    }
  }

  // 💰 ATUALIZAR DADOS DE PAGAMENTO DO MOTORISTA (MOBILE MONEY)
  async updateDriverPaymentInfo(req: Request, res: Response): Promise<Response> {
    try {
      const { driverId } = req.params;
      const { mobileMoneyProvider, mobileMoneyNumber } = req.body;

      if (!mobileMoneyProvider || !mobileMoneyNumber) {
        return res.status(400).json({ error: 'Operadora e número são obrigatórios.' });
      }

      const cleanNumber = String(mobileMoneyNumber).replace(/\D/g, '');
      if (cleanNumber.length !== 9) {
        return res.status(400).json({ error: 'O número deve ter exatamente 9 dígitos.' });
      }

      const prefix = cleanNumber.substring(0, 2);
      const providerUpper = String(mobileMoneyProvider).toUpperCase();
      let updateData: any = { paymentAccountNumber: cleanNumber };

      if (providerUpper.includes('ORANGE')) {
        if (prefix !== '95') return res.status(400).json({ error: 'Números da Orange devem começar com 95.' });
        updateData.orangeNumber = cleanNumber;
      } else if (providerUpper.includes('MTN')) {
        if (!['96', '97'].includes(prefix)) return res.status(400).json({ error: 'Números da MTN devem começar com 96 ou 97.' });
        updateData.mtnNumber = cleanNumber;
      } else {
        return res.status(400).json({ error: 'Operadora inválida.' });
      }

      const updatedDriver = await prisma.driver.update({
        where: { id: String(driverId) },
        data: updateData,
      });

      return res.status(200).json({
        message: 'Dados de pagamento atualizados com sucesso.',
        driver: { id: updatedDriver.id, paymentAccountNumber: updatedDriver.paymentAccountNumber }
      });
    } catch (error) {
      console.error('[ERRO AO ATUALIZAR PAGAMENTO DO MOTORISTA]:', error);
      return res.status(500).json({ error: 'Erro interno ao atualizar dados de pagamento.' });
    }
  }

  // 🛡️ 4. APROVAR MOTORISTA
  async approveDriver(req: Request, res: Response): Promise<Response> {
    try {
      const { driverId } = req.params;

      const driver = await prisma.driver.findUnique({ where: { id: String(driverId) } });
      if (!driver) {
        return res.status(404).json({ error: 'Motorista não encontrado.' });
      }

      const updatedDriver = await prisma.driver.update({
        where: { id: String(driverId) },
        data: { status: 'APPROVED' },
      });

      return res.status(200).json({
        message: 'Motorista aprovado e pronto para trabalhar!',
        driver: { id: updatedDriver.id, status: updatedDriver.status }
      });
    } catch (error) {
      console.error('[ERRO AO APROVAR MOTORISTA]:', error);
      return res.status(500).json({ error: 'Erro interno ao aprovar motorista.' });
    }
  }

  // 📋 5. LISTAR PASSAGEIROS
  async listPassengers(req: Request, res: Response): Promise<Response> {
    try {
      const passengers = await prisma.passenger.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          fullName: true,
          phone: true,
          email: true,
          profilePicture: true,
          status: true,
          walletBalance: true,
          ratingAverage: true,
          createdAt: true,
          _count: {
            select: { rides: true }
          }
        },
      });

      const formattedPassengers = passengers.map(passenger => ({
        ...passenger,
        avatarUrl: passenger.profilePicture || null,
        totalRides: passenger._count?.rides || 0
      }));

      return res.status(200).json(formattedPassengers);
    } catch (error) {
      console.error('[ERRO AO LISTAR PASSAGEIROS]:', error);
      return res.status(500).json({ error: 'Erro ao buscar passageiros.' });
    }
  }

  // 🚫 6. ATUALIZAR STATUS DO PASSAGEIRO
  async togglePassengerStatus(req: Request, res: Response): Promise<Response> {
    try {
      const { passengerId } = req.params;
      const { status } = req.body;

      if (!['ACTIVE', 'SUSPENDED'].includes(status)) {
        return res.status(400).json({ error: 'Status inválido.' });
      }

      const passenger = await prisma.passenger.update({
        where: { id: String(passengerId) },
        data: { status: status as PassengerStatus },
      });

      return res.status(200).json({
        message: `Passageiro ${status === 'ACTIVE' ? 'ativado' : 'suspenso'} com sucesso!`,
        passenger: { id: passenger.id, status: passenger.status }
      });
    } catch (error) {
      console.error('[ERRO AO ATUALIZAR STATUS DO PASSAGEIRO]:', error);
      return res.status(500).json({ error: 'Erro ao atualizar passageiro.' });
    }
  }

  // 🚫 7. ATUALIZAR STATUS DO MOTORISTA
  async toggleDriverStatus(req: Request, res: Response): Promise<Response> {
    try {
      const { driverId } = req.params;
      const { status } = req.body;

      if (!['APPROVED', 'SUSPENDED', 'REJECTED', 'PENDING_APPROVAL'].includes(status)) {
        return res.status(400).json({ error: 'Status fornecido é inválido.' });
      }

      const driver = await prisma.driver.update({
        where: { id: String(driverId) },
        data: { status: status as DriverStatus },
      });

      return res.status(200).json({
        message: `Status do motorista alterado para ${status}.`,
        driver: { id: driver.id, status: driver.status }
      });
    } catch (error) {
      console.error('[ERRO AO ATUALIZAR STATUS DO MOTORISTA]:', error);
      return res.status(500).json({ error: 'Erro ao atualizar motorista.' });
    }
  }

  // 💰 8. DASHBOARD FINANCEIRO
  async getFinancialDashboard(req: Request, res: Response): Promise<Response> {
    try {
      const mainWallet = await prisma.companyWallet.findFirst();

      const recentTransactions = await prisma.transaction.findMany({
        take: 50,
        orderBy: { createdAt: 'desc' },
        include: {
          passenger: { select: { fullName: true } },
          driver: { select: { fullName: true } }
        }
      });

      return res.status(200).json({
        wallet: mainWallet || { balance: 0, totalCollected: 0 },
        transactions: recentTransactions
      });
    } catch (error) {
      console.error('[ERRO AO BUSCAR DADOS FINANCEIROS]:', error);
      return res.status(500).json({ error: 'Erro ao buscar dados financeiros.' });
    }
  }

  // 🗺️ 9. LISTAR TODAS AS CORRIDAS
  async listAllRides(req: Request, res: Response): Promise<Response> {
    try {
      const rides = await prisma.ride.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          passenger: { select: { fullName: true, phone: true } },
          driver: { select: { fullName: true, phone: true, vehiclePlate: true } },
          ratings: {
            where: { reviewerType: 'PASSENGER' },
            select: { stars: true }
          }
        },
        take: 200
      });

      const formattedRides = rides.map(ride => ({
        id: ride.id,
        passengerName: ride.passenger?.fullName || 'N/A',
        driverName: ride.driver?.fullName || 'Não atribuído',
        vehiclePlate: ride.driver?.vehiclePlate || 'N/A',
        originAddress: ride.originAddress,
        destinationAddress: ride.destinationAddress,
        originLat: (ride as any).originLat || null,
        originLng: (ride as any).originLng || null,
        destLat: (ride as any).destinationLat || null,
        destLng: (ride as any).destinationLng || null,
        routePolyline: (ride as any).routePolyline || null, 
        amount: ride.priceXof || 0,
        status: ride.status,
        createdAt: ride.createdAt,
        rating: ride.ratings && ride.ratings.length > 0 ? ride.ratings[0].stars : null
      }));

      return res.status(200).json(formattedRides);
    } catch (error) {
      console.error('[ERRO AO LISTAR CORRIDAS NO ADMIN]:', error);
      return res.status(500).json({ error: 'Erro ao buscar histórico de corridas.' });
    }
  }

  // 💰 10. RECARGA MANUAL COM TRANSAÇÃO ATÔMICA
  async manualRecharge(req: Request, res: Response): Promise<Response> {
    try {
      const { userType, userId, amount } = req.body;

      if (!userId || !amount || Number(amount) <= 0) {
        return res.status(400).json({ error: 'ID do usuário e valor válido são obrigatórios.' });
      }

      if (!['PASSENGER', 'DRIVER'].includes(userType)) {
        return res.status(400).json({ error: 'Tipo de usuário inválido.' });
      }

      const numericAmount = Number(amount);
      const targetPassengerId = userType === 'PASSENGER' ? String(userId) : null;
      const targetDriverId = userType === 'DRIVER' ? String(userId) : null;

      const randomRef = `RECHARGE-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

      const result = await prisma.$transaction(async (tx) => {
        if (userType === 'PASSENGER') {
          await tx.passenger.update({
            where: { id: String(userId) },
            data: { walletBalance: { increment: numericAmount } }
          });
        } else {
          await tx.driver.update({
            where: { id: String(userId) },
            data: { walletBalance: { increment: numericAmount } }
          });
        }

        return await tx.transaction.create({
          data: {
            type: TransactionType.DEPOSIT,
            amount: numericAmount,
            status: 'COMPLETED',
            paymentMethod: 'CASH',
            passengerId: targetPassengerId,
            driverId: targetDriverId,
            reference: randomRef,
            description: 'Recarga Manual realizada pela Gestão/Admin'
          }
        });
      });

      return res.status(200).json({ message: 'Recarga efetuada com sucesso!', transaction: result });
    } catch (error) {
      console.error('[ERRO AO RECARREGAR SALDO]:', error);
      return res.status(500).json({ error: 'Erro interno ao processar recarga.' });
    }
  }

  // 🛡️ 11. LISTAR SOLICITAÇÕES PENDENTES DE MOTORISTAS
  async listDriverChangeRequests(req: Request, res: Response): Promise<Response> {
    try {
      const requests = await prisma.driverChangeRequest.findMany({
        where: { status: 'PENDING' },
        include: {
          driver: {
            select: { fullName: true, phone: true, vehiclePlate: true, vehicleBrand: true, vehicleColor: true, documentNumber: true }
          }
        },
        orderBy: { createdAt: 'asc' }
      });

      return res.status(200).json(requests);
    } catch (error) {
      console.error('[ERRO AO LISTAR SOLICITAÇÕES]:', error);
      return res.status(500).json({ error: 'Erro ao buscar solicitações.' });
    }
  }

  // 👥 13. LISTAR ADMINISTRADORES DA EQUIPE (SUPER ADMIN)
  async listAdmins(req: Request, res: Response): Promise<Response> {
    try {
      const admins = await prisma.admin.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          createdAt: true,
        },
      });

      return res.status(200).json(admins);
    } catch (error) {
      console.error('[ERRO AO LISTAR ADMINS]:', error);
      return res.status(500).json({ error: 'Erro ao listar equipe de administradores.' });
    }
  }

  // 👥 14. CRIAR NOVO ADMINISTRADOR/OPERADOR (SUPER ADMIN)
  async createAdmin(req: Request, res: Response): Promise<Response> {
    try {
      const { name, email, password, role } = req.body;

      if (!name || !email || !password || !role) {
        return res.status(400).json({ error: 'Nome, email, senha e função (role) são obrigatórios.' });
      }

      if (!['SUPER_ADMIN', 'OPERATOR', 'FINANCE'].includes(role)) {
        return res.status(400).json({ error: 'Função inválida. Escolha entre SUPER_ADMIN, OPERATOR ou FINANCE.' });
      }

      const cleanEmail = String(email).trim().toLowerCase();

      const existingAdmin = await prisma.admin.findUnique({ where: { email: cleanEmail } });
      if (existingAdmin) {
        return res.status(409).json({ error: 'Este e-mail já está cadastrado para outro usuário administrativo.' });
      }

      const passwordHash = await bcrypt.hash(password, 10);

      const newAdmin = await prisma.admin.create({
        data: {
          name: String(name).trim(),
          email: cleanEmail,
          passwordHash,
          role,
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          isActive: true,
          createdAt: true,
        },
      });

      return res.status(201).json({
        message: 'Novo membro da equipe criado com sucesso!',
        admin: newAdmin,
      });
    } catch (error) {
      console.error('[ERRO AO CRIAR ADMIN]:', error);
      return res.status(500).json({ error: 'Erro interno ao criar administrador.' });
    }
  }

  // 👥 15. ATIVAR/DESATIVAR ADMINISTRADOR (SUPER ADMIN)
  async toggleAdminStatus(req: Request, res: Response): Promise<Response> {
    try {
      const { adminId } = req.params;
      const { isActive } = req.body;

      if (typeof isActive !== 'boolean') {
        return res.status(400).json({ error: 'O campo isActive deve ser um booleano (true ou false).' });
      }

      const reqAdminId = (req as any).user?.id || (req as any).admin?.id;
      if (reqAdminId === adminId && !isActive) {
        return res.status(400).json({ error: 'Você não pode desativar a sua própria conta.' });
      }

      const updatedAdmin = await prisma.admin.update({
        where: { id: String(adminId) },
        data: { isActive },
        select: { id: true, name: true, email: true, role: true, isActive: true },
      });

      return res.status(200).json({
        message: `Acesso do administrador ${isActive ? 'ativado' : 'desativado'} com sucesso!`,
        admin: updatedAdmin,
      });
    } catch (error) {
      console.error('[ERRO AO ALTERAR STATUS DE ADMIN]:', error);
      return res.status(500).json({ error: 'Erro ao alterar status do administrador.' });
    }
  }

  // 🛡️ 12. APROVAR OU REJEITAR SOLICITAÇÃO DE ALTERAÇÃO DE DADOS DE MOTORISTA
  async reviewDriverChangeRequest(req: Request, res: Response): Promise<Response> {
    try {
      const { requestId } = req.params;
      const { action } = req.body;

      const changeRequest = await prisma.driverChangeRequest.findUnique({
        where: { id: String(requestId) }
      });

      if (!changeRequest || changeRequest.status !== 'PENDING') {
        return res.status(404).json({ error: 'Solicitação não encontrada ou já processada.' });
      }

      if (action === 'REJECT') {
        await prisma.driverChangeRequest.update({
          where: { id: String(requestId) },
          data: { status: 'REJECTED' }
        });
        return res.status(200).json({ message: 'Solicitação rejeitada com sucesso.' });
      }

      if (action === 'APPROVE') {
        await prisma.$transaction([
          prisma.driver.update({
            where: { id: changeRequest.driverId },
            data: {
              ...(changeRequest.newFullName && { fullName: changeRequest.newFullName }),
              ...(changeRequest.newVehiclePlate && { vehiclePlate: changeRequest.newVehiclePlate }),
              ...(changeRequest.newVehicleBrand && { vehicleBrand: changeRequest.newVehicleBrand }),
              ...(changeRequest.newVehicleColor && { vehicleColor: changeRequest.newVehicleColor }),
              ...(changeRequest.newDocumentNumber && { documentNumber: changeRequest.newDocumentNumber }),
            }
          }),
          prisma.driverChangeRequest.update({
            where: { id: String(requestId) },
            data: { status: 'APPROVED' }
          })
        ]);

        return res.status(200).json({ message: 'Dados do motorista atualizados com sucesso!' });
      }

      return res.status(400).json({ error: 'Ação inválida fornecida.' });
    } catch (error) {
      console.error('[ERRO AO PROCESSAR SOLICITAÇÃO]:', error);
      return res.status(500).json({ error: 'Erro ao processar a solicitação.' });
    }
  }

  // 🚗 LISTAR MOTORISTAS ONLINE (PARA O RADAR DA FROTA / MAPA)
  async getOnlineDrivers(req: Request, res: Response): Promise<Response> {
    try {
      const drivers = await prisma.driver.findMany({
        where: {
          isOnline: true,
          deletedAt: null,
        },
        select: {
          id: true,
          fullName: true,
          phone: true,
          vehiclePlate: true,
          vehicleBrand: true,
          status: true,
          isOnline: true,
          isAvailable: true,
          lastLat: true,
          lastLng: true,
          updatedAt: true,
        },
      });

      const formattedDrivers = drivers.map(driver => ({
        driverId: driver.id,
        fullName: driver.fullName,
        phone: driver.phone,
        vehiclePlate: driver.vehiclePlate,
        vehicleBrand: driver.vehicleBrand,
        latitude: (driver as any).lastLat || (driver as any).currentLat || (driver as any).latitude || 0,
        longitude: (driver as any).lastLng || (driver as any).currentLng || (driver as any).longitude || 0,
        status: driver.isAvailable ? 'AVAILABLE' : 'ON_RIDE',
        lastUpdate: driver.updatedAt || new Date()
      }));

      return res.status(200).json(formattedDrivers);
    } catch (error) {
      console.error('[ERRO AO BUSCAR MOTORISTAS ONLINE]:', error);
      return res.status(500).json({ error: 'Erro interno ao buscar motoristas online.' });
    }
  }
}

export default new AdminAuthController();