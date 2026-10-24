import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../config/prisma';
import { DriverStatus, PassengerStatus, TransactionType } from '@prisma/client';

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error('❌ [AUTH ADMIN] FATAL: JWT_SECRET não está configurado nas variáveis de ambiente.');
}

export class AdminAuthController {
  // 🗑️ Soft/Hard Delete de Motorista pelo Admin com Liberação de Credenciais
  async deleteDriver(req: Request, res: Response): Promise<Response> {
    try {
      const { driverId } = req.params;

      const driver = await prisma.driver.findUnique({
        where: { id: String(driverId) },
        include: { rides: { take: 1 }, transactions: { take: 1 } }
      });

      if (!driver) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Motorista não encontrado.' });
      }

      const hasHistory = driver.rides.length > 0 || driver.transactions.length > 0;

      if (!hasHistory) {
        // Sem histórico: Remoção definitiva da base de dados
        await prisma.driver.delete({ where: { id: String(driverId) } });
      } else {
        // Com histórico: Anonimiza dados únicos para liberar telefone, placa e documento
        const stamp = Date.now().toString().slice(-8);
        await prisma.driver.update({
          where: { id: String(driverId) },
          data: {
            phone: `d_${stamp}`,
            vehiclePlate: `p_${stamp}`,
            documentNumber: `doc_${stamp}`,
            orangeNumber: null,
            mtnNumber: null,
            paymentAccountNumber: null,
            status: 'SUSPENDED',
            isOnline: false,
            isAvailable: false,
            currentRideId: null,
            deletedAt: new Date(),
            refreshTokenHash: null,
            deviceToken: null
          }
        });
      }

      return res.status(200).json({ message: 'Conta do motorista excluída e credenciais liberadas com sucesso.' });
    } catch (error) {
      console.error('[ERRO AO EXCLUIR MOTORISTA]:', error);
      return res.status(500).json({ error: 'SERVER_ERROR', message: 'Erro ao desativar/excluir motorista.' });
    }
  }

  // 🗑️ Soft/Hard Delete de Passageiro pelo Admin com Liberação de Telefone
  async deletePassenger(req: Request, res: Response): Promise<Response> {
    try {
      const { passengerId } = req.params;

      const passenger = await prisma.passenger.findUnique({
        where: { id: String(passengerId) },
        include: { rides: { take: 1 }, transactions: { take: 1 } }
      });

      if (!passenger) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Passageiro não encontrado.' });
      }

      const hasHistory = passenger.rides.length > 0 || passenger.transactions.length > 0;

      if (!hasHistory) {
        // Sem histórico: Remoção definitiva da base de dados
        await prisma.passenger.delete({ where: { id: String(passengerId) } });
      } else {
        // Com histórico: Anonimiza telefone e e-mail para liberar cadastro futuro
        const stamp = Date.now().toString().slice(-8);
        const rand = Math.floor(100 + Math.random() * 900);
        await prisma.passenger.update({
          where: { id: String(passengerId) },
          data: {
            fullName: 'Passageiro Anônimo',
            phone: `p_${stamp}_${rand}`,
            email: `del_${stamp}_${rand}@anon.com`,
            documentNumber: null,
            paymentAccountNumber: null,
            status: 'SUSPENDED',
            deletedAt: new Date(),
            refreshTokenHash: null,
            deviceToken: null
          }
        });
      }

      return res.status(200).json({ message: 'Conta do passageiro excluída e telefone liberado com sucesso.' });
    } catch (error) {
      console.error('[ERRO AO EXCLUIR PASSAGEIRO]:', error);
      return res.status(500).json({ error: 'SERVER_ERROR', message: 'Erro ao desativar/excluir passageiro.' });
    }
  }

  // 📋 Listar solicitações de exclusão enviadas pelos Apps
  async listAccountDeletionRequests(req: Request, res: Response): Promise<Response> {
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
      console.error('[ERRO AO LISTAR SOLICITAÇÕES DE DELEÇÃO]:', error);
      return res.status(500).json({ error: 'SERVER_ERROR', message: 'Erro ao listar solicitações.' });
    }
  }

  // ⚙️ Aprovar ou Rejeitar pedido de exclusão enviado pelo App
  async reviewAccountDeletionRequest(req: Request, res: Response): Promise<Response> {
    try {
      const { requestId } = req.params;
      const { status } = req.body;

      const deletionReq = await prisma.accountDeletionRequest.findUnique({ where: { id: String(requestId) } });
      if (!deletionReq) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Solicitação não encontrada.' });
      }

      if (status === 'APPROVED') {
        const stamp = Date.now().toString().slice(-8);
        const rand = Math.floor(100 + Math.random() * 900);

        if (deletionReq.passengerId) {
          const passenger = await prisma.passenger.findUnique({
            where: { id: deletionReq.passengerId },
            include: { rides: { take: 1 }, transactions: { take: 1 } }
          });
          if (passenger) {
            const hasHistory = passenger.rides.length > 0 || passenger.transactions.length > 0;
            if (!hasHistory) {
              await prisma.passenger.delete({ where: { id: deletionReq.passengerId } });
            } else {
              await prisma.passenger.update({
                where: { id: deletionReq.passengerId },
                data: {
                  deletedAt: new Date(),
                  status: 'SUSPENDED',
                  fullName: 'Passageiro Anônimo',
                  phone: `p_${stamp}_${rand}`,
                  email: `del_${stamp}_${rand}@anon.com`,
                  documentNumber: null,
                  paymentAccountNumber: null,
                  refreshTokenHash: null,
                  deviceToken: null
                }
              });
            }
          }
        }

        if (deletionReq.driverId) {
          const driver = await prisma.driver.findUnique({
            where: { id: deletionReq.driverId },
            include: { rides: { take: 1 }, transactions: { take: 1 } }
          });
          if (driver) {
            const hasHistory = driver.rides.length > 0 || driver.transactions.length > 0;
            if (!hasHistory) {
              await prisma.driver.delete({ where: { id: deletionReq.driverId } });
            } else {
              await prisma.driver.update({
                where: { id: deletionReq.driverId },
                data: {
                  deletedAt: new Date(),
                  status: 'SUSPENDED',
                  isOnline: false,
                  isAvailable: false,
                  phone: `d_${stamp}`,
                  vehiclePlate: `p_${stamp}`,
                  documentNumber: `doc_${stamp}`,
                  orangeNumber: null,
                  mtnNumber: null,
                  paymentAccountNumber: null,
                  refreshTokenHash: null,
                  deviceToken: null
                }
              });
            }
          }
        }
      }

      const updated = await prisma.accountDeletionRequest.update({
        where: { id: String(requestId) },
        data: { status }
      });

      return res.status(200).json(updated);
    } catch (error) {
      console.error('[ERRO AO REVISAR SOLICITAÇÃO DE DELEÇÃO]:', error);
      return res.status(500).json({ error: 'SERVER_ERROR', message: 'Erro ao processar solicitação.' });
    }
  }

  // 🛡️ 1. REGISTRO DO PRIMEIRO ADMINISTRADOR
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

  // 📋 3. LISTAR MOTORISTAS (FILTRANDO CONTAS EXCLUÍDAS)
  async listDrivers(req: Request, res: Response): Promise<Response> {
    try {
      const { status } = req.query;
      
      const drivers = await prisma.driver.findMany({
        where: {
          deletedAt: null,
          ...(status ? { status: status as DriverStatus } : {})
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          fullName: true,
          phone: true,
          vehicleType: true,
          vehiclePlate: true,
          vehicleBrand: true,
          vehicleColor: true,
          vehicleSeats: true,
          documentType: true,
          documentNumber: true,
          status: true,
          isOnline: true,
          walletBalance: true,
          ratingAverage: true,
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
          walletBalance: Number(driver.walletBalance || 0),
          ratingAverage: Number(driver.ratingAverage || 5.0),
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

  // 💰 ATUALIZAR DADOS DE PAGAMENTO DO MOTORISTA
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
      const formattedPhone = `+245${cleanNumber}`;
      let updateData: any = { paymentAccountNumber: formattedPhone };

      if (providerUpper.includes('ORANGE')) {
        if (prefix !== '95') return res.status(400).json({ error: 'Números da Orange devem começar com 95.' });
        updateData.orangeNumber = formattedPhone;
      } else if (providerUpper.includes('MTN')) {
        if (!['96', '97'].includes(prefix)) return res.status(400).json({ error: 'Números da MTN devem começar com 96 ou 97.' });
        updateData.mtnNumber = formattedPhone;
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

  // 📋 5. LISTAR PASSAGEIROS (FILTRANDO CONTAS EXCLUÍDAS)
  async listPassengers(req: Request, res: Response): Promise<Response> {
    try {
      const passengers = await prisma.passenger.findMany({
        where: {
          deletedAt: null
        },
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
        walletBalance: Number(passenger.walletBalance || 0),
        ratingAverage: Number(passenger.ratingAverage || 5.0),
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
        wallet: {
          balance: Number(mainWallet?.balance || 0),
          totalCollected: Number(mainWallet?.totalCollected || 0)
        },
        transactions: recentTransactions.map(t => ({
          ...t,
          amount: Number(t.amount || 0)
        }))
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
        originLat: (ride as any).originLat ? Number((ride as any).originLat) : null,
        originLng: (ride as any).originLng ? Number((ride as any).originLng) : null,
        destLat: (ride as any).destinationLat ? Number((ride as any).destinationLat) : null,
        destLng: (ride as any).destinationLng ? Number((ride as any).destinationLng) : null,
        routePolyline: (ride as any).routePolyline || null, 
        amount: Number(ride.priceXof || 0),
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

  // 💰 10. RECARGA MANUAL
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

      return res.status(200).json({ 
        message: 'Recarga efetuada com sucesso!', 
        transaction: {
          ...result,
          amount: Number(result.amount)
        } 
      });
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

  // 👥 13. LISTAR ADMINISTRADORES
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

  // 👥 14. CRIAR NOVO ADMINISTRADOR/OPERADOR
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

  // 👥 15. ATIVAR/DESATIVAR ADMINISTRADOR
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

  // 🚗 LISTAR MOTORISTAS ONLINE
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
        latitude: (driver as any).lastLat ? Number((driver as any).lastLat) : 0,
        longitude: (driver as any).lastLng ? Number((driver as any).lastLng) : 0,
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

const adminAuthController = new AdminAuthController();

export const deleteDriver = (req: Request, res: Response) => adminAuthController.deleteDriver(req, res);
export const deletePassenger = (req: Request, res: Response) => adminAuthController.deletePassenger(req, res);
export const listAccountDeletionRequests = (req: Request, res: Response) => adminAuthController.listAccountDeletionRequests(req, res);
export const reviewAccountDeletionRequest = (req: Request, res: Response) => adminAuthController.reviewAccountDeletionRequest(req, res);
export const register = (req: Request, res: Response) => adminAuthController.register(req, res);
export const login = (req: Request, res: Response) => adminAuthController.login(req, res);
export const listDrivers = (req: Request, res: Response) => adminAuthController.listDrivers(req, res);
export const updateDriverPaymentInfo = (req: Request, res: Response) => adminAuthController.updateDriverPaymentInfo(req, res);
export const approveDriver = (req: Request, res: Response) => adminAuthController.approveDriver(req, res);
export const listPassengers = (req: Request, res: Response) => adminAuthController.listPassengers(req, res);
export const togglePassengerStatus = (req: Request, res: Response) => adminAuthController.togglePassengerStatus(req, res);
export const toggleDriverStatus = (req: Request, res: Response) => adminAuthController.toggleDriverStatus(req, res);
export const getFinancialDashboard = (req: Request, res: Response) => adminAuthController.getFinancialDashboard(req, res);
export const listAllRides = (req: Request, res: Response) => adminAuthController.listAllRides(req, res);
export const manualRecharge = (req: Request, res: Response) => adminAuthController.manualRecharge(req, res);
export const listDriverChangeRequests = (req: Request, res: Response) => adminAuthController.listDriverChangeRequests(req, res);
export const listAdmins = (req: Request, res: Response) => adminAuthController.listAdmins(req, res);
export const createAdmin = (req: Request, res: Response) => adminAuthController.createAdmin(req, res);
export const toggleAdminStatus = (req: Request, res: Response) => adminAuthController.toggleAdminStatus(req, res);
export const reviewDriverChangeRequest = (req: Request, res: Response) => adminAuthController.reviewDriverChangeRequest(req, res);
export const getOnlineDrivers = (req: Request, res: Response) => adminAuthController.getOnlineDrivers(req, res);

export default adminAuthController;