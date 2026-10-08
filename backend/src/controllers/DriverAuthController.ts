import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { getIo } from '../server';
import { formatPhoneNumber, isValidBissauPhone } from '../services/mobileMoneyService';
import { sendSmsOtp } from '../services/smsService';

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;

if (!JWT_SECRET || !JWT_REFRESH_SECRET) {
  throw new Error('❌ [AUTH] FATAL: JWT_SECRET e JWT_REFRESH_SECRET devem estar configurados nas variáveis de ambiente.');
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const sanitize = (text?: string): string => {
  if (!text || typeof text !== 'string') return '';
  return text.replace(/[^\w]/g, '').toUpperCase();
};

const sanitizeText = (text?: string, maxLength = 255): string => {
  if (!text || typeof text !== 'string') return '';
  return text.trim().slice(0, maxLength);
};

const isValidCoordinate = (lat: any, lng: any): boolean => {
  if (lat === null || lng === null || typeof lat === 'boolean' || typeof lng === 'boolean') return false;
  const l = Number(lat);
  const lg = Number(lng);
  return Number.isFinite(l) && Number.isFinite(lg) && l >= -90 && l <= 90 && lg >= -180 && lg <= 180;
};

const DISABLED_STATUSES = ['SUSPENDED', 'BANNED', 'REJECTED', 'INACTIVE'];

export class DriverAuthController {

  // ==========================================
  // 🔑 LOGIN DO MOTORISTA
  // ==========================================
  async login(req: Request, res: Response): Promise<Response> {
    try {
      const { password, deviceToken } = req.body;
      const rawPhone = req.body.phone ? String(req.body.phone) : '';

      if (!rawPhone || !password) {
        return res.status(400).json({ success: false, error: 'Telefone e senha são obrigatórios.' });
      }

      const formattedPhone = formatPhoneNumber(rawPhone);

      const driver = await prisma.driver.findFirst({
        where: {
          OR: [
            { phone: formattedPhone },
            { phone: rawPhone.trim() }
          ]
        }
      });

      const dummyHash = '$2b$12$e8Y547uXN8L8i0S9sS9O9e0mQxV1L3yS0N0c0W0X0Y0Z0a0b0c0d';
      const hashToCompare = driver ? driver.passwordHash : dummyHash;
      const isValidPassword = await bcrypt.compare(String(password), hashToCompare);

      if (!driver || !isValidPassword) {
        return res.status(401).json({ success: false, error: 'Credenciais inválidas.' });
      }

      if (DISABLED_STATUSES.includes((driver.status || '').toUpperCase())) {
        return res.status(403).json({ success: false, error: 'Sua conta de motorista está suspensa, rejeitada ou inativa.' });
      }

      const accessToken = jwt.sign(
        { id: driver.id, role: 'DRIVER', status: driver.status }, 
        JWT_SECRET!, 
        { expiresIn: '1h' }
      );
      
      const refreshToken = jwt.sign(
        { id: driver.id, role: 'DRIVER' }, 
        JWT_REFRESH_SECRET!, 
        { expiresIn: '7d' }
      );

      const cleanDeviceToken = deviceToken ? sanitizeText(String(deviceToken), 255) : undefined;

      await prisma.driver.update({
        where: { id: driver.id },
        data: {
          refreshTokenHash: hashToken(refreshToken),
          ...(cleanDeviceToken && { deviceToken: cleanDeviceToken })
        }
      });

      return res.json({
        success: true,
        message: 'Login realizado com sucesso!',
        accessToken,
        refreshToken,
        driver: { 
          id: driver.id, 
          fullName: driver.fullName, 
          phone: driver.phone,
          status: driver.status,
          vehiclePlate: driver.vehiclePlate,
          profilePicture: driver.profilePicture
        },
      });
    } catch (error: any) {
      console.error('❌ [LOGIN MOTORISTA ERROR]:', error?.message || error);
      return res.status(500).json({ success: false, error: 'Erro interno ao fazer login.' });
    }
  }

  // ==========================================
  // 📲 1. SOLICITAR CÓDIGO OTP VIA SMS (TERMII)
  // ==========================================
  async requestForgotPasswordOtp(req: Request, res: Response): Promise<Response> {
    try {
      const { phone } = req.body;
      if (!phone) {
        return res.status(400).json({ success: false, error: 'Número de telefone é obrigatório.' });
      }

      const formattedPhone = formatPhoneNumber(String(phone));

      const driver = await prisma.driver.findFirst({
        where: {
          OR: [
            { phone: formattedPhone },
            { phone: String(phone).trim() }
          ]
        }
      });

      if (!driver) {
        return res.status(200).json({ 
          success: true, 
          message: 'Se o número estiver cadastrado, o código SMS será enviado.' 
        });
      }

      if (driver.lastResetAttempt) {
        const diffInSeconds = (new Date().getTime() - new Date(driver.lastResetAttempt).getTime()) / 1000;
        if (diffInSeconds < 60) {
          return res.status(429).json({ 
            success: false, 
            error: 'Aguarde 60 segundos antes de solicitar um novo código SMS.' 
          });
        }
      }

      const otpCode = crypto.randomInt(100000, 1000000).toString();
      const otpCodeHash = await bcrypt.hash(otpCode, 10);
      const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

      await prisma.driver.update({
        where: { id: driver.id },
        data: {
          otpCodeHash,
          otpExpiresAt,
          lastResetAttempt: new Date(),
        },
      });

      const smsSent = await sendSmsOtp(driver.phone, otpCode);

      if (!smsSent) {
        return res.status(500).json({ 
          success: false, 
          error: 'Falha ao enviar o SMS de verificação. Tente novamente em instantes.' 
        });
      }

      return res.status(200).json({ 
        success: true, 
        message: 'Código de verificação enviado por SMS com sucesso.' 
      });
    } catch (error: any) {
      console.error('❌ Erro em requestForgotPasswordOtp:', error?.message || error);
      return res.status(500).json({ success: false, error: 'Erro interno ao processar solicitação de recuperação.' });
    }
  }

  async forgotPassword(req: Request, res: Response): Promise<Response> {
    return this.requestForgotPasswordOtp(req, res);
  }

  // ==========================================
  // 🔐 2. VALIDAR CÓDIGO OTP E DEFINIR NOVA SENHA
  // ==========================================
  async resetPasswordWithOtp(req: Request, res: Response): Promise<Response> {
    try {
      const { phone, otpCode, code, newPassword } = req.body;
      const effectiveOtp = String(otpCode || code || '').trim();

      if (!phone || !effectiveOtp || !newPassword) {
        return res.status(400).json({ 
          success: false, 
          error: 'Telefone, código OTP e nova senha são obrigatórios.' 
        });
      }

      if (String(newPassword).length < 6) {
        return res.status(400).json({ 
          success: false, 
          error: 'A nova senha deve ter no mínimo 6 caracteres.' 
        });
      }

      const formattedPhone = formatPhoneNumber(String(phone));

      const driver = await prisma.driver.findFirst({
        where: {
          OR: [
            { phone: formattedPhone },
            { phone: String(phone).trim() }
          ]
        }
      });

      if (!driver || !driver.otpCodeHash || !driver.otpExpiresAt) {
        return res.status(400).json({ 
          success: false, 
          error: 'Solicitação de recuperação inválida ou expirada.' 
        });
      }

      if (new Date() > new Date(driver.otpExpiresAt)) {
        return res.status(400).json({ 
          success: false, 
          error: 'O código de verificação expirou. Solicite um novo código.' 
        });
      }

      const isOtpValid = await bcrypt.compare(effectiveOtp, driver.otpCodeHash);
      if (!isOtpValid) {
        return res.status(400).json({ 
          success: false, 
          error: 'Código de verificação incorreto.' 
        });
      }

      const newPasswordHash = await bcrypt.hash(String(newPassword), 12);

      await prisma.driver.update({
        where: { id: driver.id },
        data: {
          passwordHash: newPasswordHash,
          otpCodeHash: null,
          otpExpiresAt: null,
        },
      });

      return res.status(200).json({ 
        success: true, 
        message: 'Senha redefinida com sucesso! Você já pode fazer login.' 
      });
    } catch (error: any) {
      console.error('❌ Erro em resetPasswordWithOtp:', error?.message || error);
      return res.status(500).json({ success: false, error: 'Erro interno ao redefinir a senha.' });
    }
  }

  async resetPassword(req: Request, res: Response): Promise<Response> {
    return this.resetPasswordWithOtp(req, res);
  }

  // ==========================================
  // 📝 REGISTRO DE MOTORISTA
  // ==========================================
  async register(req: Request, res: Response): Promise<Response> {
    try {
      const { 
        fullName, vehicleModel, password, vehicleColor, vehicleType, documentType 
      } = req.body;

      const rawPhone = req.body.phone ? String(req.body.phone).trim() : '';
      const formattedPhone = formatPhoneNumber(rawPhone);

      if (!isValidBissauPhone(formattedPhone)) {
        return res.status(400).json({ success: false, error: 'O número de telefone deve ser válido para a Guiné-Bissau (+245).' });
      }

      const vehiclePlate = sanitize(req.body.vehiclePlate);
      const documentNumber = sanitize(req.body.documentNumber);
      const cleanFullName = sanitizeText(fullName, 120);
      const cleanVehicleModel = sanitizeText(vehicleModel, 80);
      const cleanVehicleColor = sanitizeText(vehicleColor, 40);

      if (!cleanFullName || !cleanVehicleModel || !vehiclePlate || !password || !cleanVehicleColor || !documentNumber) {
        return res.status(400).json({ success: false, error: 'Todos os campos obrigatórios devem ser preenchidos.' });
      }

      if (String(password).length < 6) {
        return res.status(400).json({ success: false, error: 'A senha deve conter no mínimo 6 caracteres.' });
      }

      const [driverPhone, passengerPhone] = await Promise.all([
        prisma.driver.findFirst({ where: { phone: formattedPhone } }),
        prisma.passenger.findFirst({ where: { phone: formattedPhone } }),
      ]);

      if (driverPhone || passengerPhone) {
        return res.status(409).json({ success: false, error: 'Este número de telefone já está cadastrado na plataforma.' });
      }

      const [driverDoc, passengerDoc] = await Promise.all([
        prisma.driver.findFirst({ where: { documentNumber } }),
        prisma.passenger.findFirst({ where: { documentNumber } }),
      ]);

      if (driverDoc || passengerDoc) {
        return res.status(409).json({ success: false, error: 'Este documento já está vinculado a outra conta.' });
      }

      const plateExists = await prisma.driver.findFirst({ where: { vehiclePlate } });
      if (plateExists) {
        return res.status(409).json({ success: false, error: 'Esta placa de veículo já está cadastrada.' });
      }

      const passwordHash = await bcrypt.hash(String(password), 12);
      const baseUrl = process.env.APP_URL ? process.env.APP_URL.replace(/\/$/, '') : `${req.protocol}://${req.get('host')}`;

      const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
      const selfieFile = files?.['selfie']?.[0]; 
      const licenseFrontFile = files?.['licenseFront']?.[0];
      const licenseBackFile = files?.['licenseBack']?.[0];

      const profilePicture = selfieFile ? `${baseUrl}/uploads/${encodeURIComponent(selfieFile.filename)}` : null;
      const licenseFrontPicture = licenseFrontFile ? `${baseUrl}/uploads/${encodeURIComponent(licenseFrontFile.filename)}` : null;
      const licenseBackPicture = licenseBackFile ? `${baseUrl}/uploads/${encodeURIComponent(licenseBackFile.filename)}` : null;

      const driver = await prisma.driver.create({
        data: { 
          fullName: cleanFullName, 
          phone: formattedPhone, 
          passwordHash,
          vehiclePlate, 
          vehicleBrand: cleanVehicleModel, 
          vehicleType: vehicleType || 'TAXI', 
          vehicleColor: cleanVehicleColor, 
          documentType: documentType || 'BI',
          documentNumber,
          profilePicture,
          licenseFrontPicture,
          licenseBackPicture,
          status: 'PENDING_APPROVAL'
        },
      });

      return res.status(201).json({
        success: true,
        message: 'Cadastro realizado com sucesso!',
        driver: { id: driver.id, fullName: driver.fullName, phone: driver.phone, status: driver.status, profilePicture: driver.profilePicture },
      });
    } catch (error: any) {
      console.error('❌ [REGISTRO MOTORISTA]:', error?.message || error);
      return res.status(500).json({ success: false, error: 'Erro interno no servidor ao cadastrar motorista.' });
    }
  }

  // ==========================================
  // 🚨 BOTÃO DE EMERGÊNCIA (SOS)
  // ==========================================
  async triggerSos(req: Request, res: Response): Promise<Response> {
    try {
      const driverId = (req as any).user?.id;
      const { rideId, latitude, longitude, audioBase64 } = req.body;

      if (!driverId) {
        return res.status(401).json({ success: false, error: 'Motorista não autenticado.' });
      }

      if (!isValidCoordinate(latitude, longitude)) {
        return res.status(400).json({ success: false, error: 'Coordenadas de emergência inválidas.' });
      }

      const sosAlert = await prisma.sosAlert.create({
        data: {
          driverId,
          rideId: rideId ? String(rideId) : null,
          lat: Number(latitude),
          lng: Number(longitude),
          userType: 'DRIVER',
          audioUrl: audioBase64 ? String(audioBase64) : null,
          status: 'ACTIVE',
        },
        include: {
          driver: {
            select: { fullName: true, phone: true, vehiclePlate: true, vehicleBrand: true },
          },
          ride: {
            select: { id: true, originAddress: true, destinationAddress: true },
          },
        },
      });

      const io = getIo();
      if (io) {
        io.to('admin_dashboard').emit('admin:sos_alert', {
          id: sosAlert.id,
          driverId,
          driverName: sosAlert.driver?.fullName,
          vehiclePlate: sosAlert.driver?.vehiclePlate,
          vehicleModel: sosAlert.driver?.vehicleBrand,
          phone: sosAlert.driver?.phone,
          latitude: Number(latitude),
          longitude: Number(longitude),
          audioUrl: sosAlert.audioUrl,
          createdAt: sosAlert.createdAt,
        });
      }

      return res.status(201).json({ success: true, sosId: sosAlert.id });
    } catch (error: any) {
      console.error('❌ Erro ao disparar SOS do motorista:', error?.message || error);
      return res.status(500).json({ success: false, error: 'Erro interno ao acionar emergência.' });
    }
  }

  // ==========================================
  // 🔄 REFRESH TOKEN
  // ==========================================
  async refreshToken(req: Request, res: Response): Promise<Response> {
    try {
      const { refreshToken } = req.body;
      if (!refreshToken || typeof refreshToken !== 'string') {
        return res.status(400).json({ success: false, error: 'Refresh Token não fornecido.' });
      }

      const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET!) as { id: string; role: string };
      const driver = await prisma.driver.findUnique({ where: { id: decoded.id } });

      const incomingHash = hashToken(refreshToken);

      if (!driver || DISABLED_STATUSES.includes((driver.status || '').toUpperCase()) || driver.refreshTokenHash !== incomingHash) {
        return res.status(403).json({ success: false, error: 'Refresh Token inválido, revogado ou conta suspensa.' });
      }

      const accessToken = jwt.sign(
        { id: driver.id, role: 'DRIVER', status: driver.status }, 
        JWT_SECRET!, 
        { expiresIn: '1h' }
      );

      return res.json({ success: true, accessToken });
    } catch (error) {
      return res.status(401).json({ success: false, error: 'Refresh Token inválido ou expirado.' });
    }
  }

  // ==========================================
  // 👤 CONSULTAR PERFIL DO MOTORISTA
  // ==========================================
  async getProfile(req: Request, res: Response): Promise<Response> {
    try {
      const driverId = (req as any).user?.id;
      if (!driverId) return res.status(401).json({ success: false, error: 'Não autorizado.' });

      const driver = await prisma.driver.findUnique({
        where: { id: driverId },
        select: {
          id: true,
          fullName: true,
          phone: true,
          status: true,
          vehiclePlate: true,
          profilePicture: true,
        }
      });

      if (!driver) {
        return res.status(404).json({ success: false, error: 'Motorista não encontrado.' });
      }

      return res.status(200).json({ success: true, driver });
    } catch (error: any) {
      console.error('❌ [PERFIL MOTORISTA]:', error?.message || error);
      return res.status(500).json({ success: false, error: 'Erro interno ao buscar perfil.' });
    }
  }

  // ==========================================
  // 💰 EXTRATO E FINANÇAS
  // ==========================================
  async getFinance(req: Request, res: Response): Promise<Response> {
    try {
      const driverId = (req as any).user?.id;
      if (!driverId) return res.status(401).json({ success: false, error: 'Usuário não autenticado.' });

      const driver = await prisma.driver.findUnique({
        where: { id: driverId },
        select: { 
          fullName: true,
          orangeNumber: true,
          mtnNumber: true,
          paymentAccountNumber: true
        } 
      });

      if (!driver) return res.status(404).json({ success: false, error: 'Motorista não encontrado.' });

      const rides = await prisma.ride.findMany({
        where: { driverId, status: { in: ['COMPLETED', 'CANCELLED'] } },
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: {
          id: true, createdAt: true, originAddress: true, destinationAddress: true,
          priceXof: true, status: true, driverEarnings: true,
          passenger: { select: { fullName: true, profilePicture: true } },
          ratings: { where: { reviewerType: 'PASSENGER' }, select: { stars: true } }
        }
      });

      const totalEarned = rides.reduce((acc, ride) => {
        if (ride.status !== 'COMPLETED') return acc;
        return acc + Number(ride.driverEarnings || (Number(ride.priceXof || 0) * 0.85));
      }, 0);

      return res.status(200).json({
        success: true,
        totalEarned: Math.round(totalEarned),
        mobileMoneyAccount: driver.paymentAccountNumber,
        orangeNumber: driver.orangeNumber,
        mtnNumber: driver.mtnNumber,
        totalRides: rides.filter(r => r.status === 'COMPLETED').length,
        history: rides,
      });
    } catch (error: any) {
      console.error('❌ [FINANCEIRO MOTORISTA]:', error?.message || error);
      return res.status(500).json({ success: false, error: 'Erro interno ao buscar extrato.' });
    }
  }

  // ==========================================
  // 🗑️ EXCLUIR CONTA
  // ==========================================
  async deleteAccount(req: Request, res: Response): Promise<Response> {
    try {
      const driverId = (req as any).user?.id;
      if (!driverId) return res.status(401).json({ success: false, error: 'Não autorizado.' });

      const activeRide = await prisma.ride.findFirst({
        where: {
          driverId,
          status: { in: ['PENDING', 'SEARCHING', 'AWAITING_PAYMENT', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS'] }
        }
      });

      if (activeRide) {
        return res.status(400).json({ success: false, error: 'Você possui uma corrida em andamento. Conclua a corrida antes de excluir a conta.' });
      }

      const driver = await prisma.driver.findUnique({
        where: { id: driverId },
        select: { phone: true, status: true }
      });

      if (!driver) {
        return res.status(404).json({ success: false, error: 'Motorista não encontrado.' });
      }

      await prisma.driver.update({
        where: { id: driverId },
        data: {
          status: 'SUSPENDED',
          isOnline: false,
          isAvailable: false,
          phone: `del_${Date.now()}_${driver.phone}`,
          refreshTokenHash: null,
          deviceToken: null,
          paymentAccountNumber: null,
          orangeNumber: null,
          mtnNumber: null
        }
      });

      return res.status(200).json({ success: true, message: 'Conta excluída e dados sensíveis removidos com sucesso.' });
    } catch (error: any) {
      console.error('❌ [EXCLUSÃO DE CONTA MOTORISTA]:', error?.message || error);
      return res.status(500).json({ success: false, error: 'Erro interno ao tentar excluir a conta.' });
    }
  }

  // ==========================================
  // 📱 ATUALIZAR MOBILE MONEY
  // ==========================================
  async updatePaymentInfo(req: Request, res: Response): Promise<Response> {
    try {
      const driverId = (req as any).user?.id;
      if (!driverId) return res.status(401).json({ success: false, error: 'Não autorizado.' });

      const { mobileMoneyProvider, mobileMoneyNumber } = req.body;

      if (!mobileMoneyProvider || !mobileMoneyNumber) {
        return res.status(400).json({ success: false, error: 'Selecione a operadora e informe o número de telefone.' });
      }

      const formattedNumber = formatPhoneNumber(String(mobileMoneyNumber));

      if (!isValidBissauPhone(formattedNumber)) {
        return res.status(400).json({ success: false, error: 'O número da conta Mobile Money é inválido para Guiné-Bissau (+245).' });
      }

      const isOrange = String(mobileMoneyProvider).toUpperCase().includes('ORANGE');

      const updateData = isOrange 
        ? { orangeNumber: formattedNumber, mtnNumber: null, paymentAccountNumber: formattedNumber }
        : { mtnNumber: formattedNumber, orangeNumber: null, paymentAccountNumber: formattedNumber };

      const updatedDriver = await prisma.driver.update({
        where: { id: driverId },
        data: updateData,
        select: {
          paymentAccountNumber: true,
          orangeNumber: true,
          mtnNumber: true
        },
      });

      return res.status(200).json({ 
        success: true,
        message: 'Conta de recebimento atualizada com sucesso!',
        paymentInfo: updatedDriver
      });
    } catch (error: any) {
      console.error('❌ [PAGAMENTO MOTORISTA]:', error?.message || error);
      return res.status(500).json({ success: false, error: 'Erro ao atualizar dados de pagamento.' });
    }
  }

  // ==========================================
  // 🔔 ATUALIZAR TOKEN DE NOTIFICAÇÃO (PUSH)
  // ==========================================
  async updateDeviceToken(req: Request, res: Response): Promise<Response> {
    try {
      const driverId = (req as any).user?.id;
      if (!driverId) return res.status(401).json({ success: false, error: 'Não autorizado.' });

      const { deviceToken } = req.body;
      if (!deviceToken || typeof deviceToken !== 'string') {
        return res.status(400).json({ success: false, error: 'Token de notificação inválido ou ausente.' });
      }

      await prisma.driver.update({
        where: { id: driverId },
        data: { deviceToken: sanitizeText(deviceToken, 255) }
      });

      return res.status(200).json({ success: true, message: 'Token de notificação atualizado com sucesso!' });
    } catch (error: any) {
      console.error('❌ [PUSH TOKEN MOTORISTA]:', error?.message || error);
      return res.status(500).json({ success: false, error: 'Erro interno ao salvar token.' });
    }
  }

  // ==========================================
  // ✏️ SOLICITAÇÃO DE ALTERAÇÃO DE DADOS
  // ==========================================
  async requestProfileUpdate(req: Request, res: Response): Promise<Response> {
    try {
      const driverId = (req as any).user?.id;
      if (!driverId) return res.status(401).json({ success: false, error: 'Não autorizado.' });

      const { newFullName, newVehiclePlate, newVehicleBrand, newVehicleColor, newDocumentNumber } = req.body;

      const pendingRequest = await prisma.driverChangeRequest.findFirst({
        where: { driverId, status: 'PENDING' }
      });

      if (pendingRequest) {
        return res.status(400).json({ success: false, error: 'Você já possui uma solicitação em análise pela central.' });
      }

      const changeRequest = await prisma.driverChangeRequest.create({
        data: {
          driverId,
          newFullName: sanitizeText(newFullName, 120) || undefined,
          newVehiclePlate: newVehiclePlate ? sanitize(newVehiclePlate) : undefined,
          newVehicleBrand: sanitizeText(newVehicleBrand, 80) || undefined,
          newVehicleColor: sanitizeText(newVehicleColor, 40) || undefined,
          newDocumentNumber: newDocumentNumber ? sanitize(newDocumentNumber) : undefined
        }
      });

      return res.status(201).json({ success: true, message: 'Solicitação enviada com sucesso!', changeRequest });
    } catch (error: any) {
      console.error('❌ [SOLICITAÇÃO ALTERAÇÃO MOTORISTA]:', error?.message || error);
      return res.status(500).json({ success: false, error: 'Erro ao processar solicitação.' });
    }
  }

  async checkPendingRequest(req: Request, res: Response): Promise<Response> {
    try {
      const driverId = (req as any).user?.id;
      if (!driverId) return res.status(401).json({ success: false, error: 'Não autorizado.' });

      const pendingRequest = await prisma.driverChangeRequest.findFirst({
        where: { driverId, status: 'PENDING' }
      });

      return res.status(200).json({ success: true, hasPendingRequest: !!pendingRequest, requestData: pendingRequest });
    } catch (error: any) {
      console.error('❌ [CHECAR PENDÊNCIA MOTORISTA]:', error?.message || error);
      return res.status(500).json({ success: false, error: 'Erro ao checar solicitações.' });
    }
  }
  
  // ==========================================
  // 🖼️ ATUALIZAR FOTO DE PERFIL
  // ==========================================
  async updateProfilePicture(req: Request, res: Response): Promise<Response> {
    try {
      const driverId = (req as any).user?.id;
      if (!driverId) return res.status(401).json({ success: false, error: 'Não autorizado.' });

      const file = req.file;
      if (!file) return res.status(400).json({ success: false, error: 'Nenhuma imagem foi enviada.' });

      const baseUrl = process.env.APP_URL ? process.env.APP_URL.replace(/\/$/, '') : `${req.protocol}://${req.get('host')}`;
      const newProfilePicture = `${baseUrl}/uploads/${encodeURIComponent(file.filename)}`;
      
      await prisma.driver.update({
        where: { id: driverId },
        data: { profilePicture: newProfilePicture }
      });

      return res.status(200).json({ success: true, message: 'Foto atualizada com sucesso', profilePicture: newProfilePicture });
    } catch (error: any) {
      console.error('❌ [FOTO PERFIL]:', error?.message || error);
      return res.status(500).json({ success: false, error: 'Erro ao processar imagem.' });
    }
  }
}

const driverAuthController = new DriverAuthController();

export const requestForgotPasswordOtp = (req: Request, res: Response) => driverAuthController.requestForgotPasswordOtp(req, res);
export const resetPasswordWithOtp = (req: Request, res: Response) => driverAuthController.resetPasswordWithOtp(req, res);
export const forgotPassword = (req: Request, res: Response) => driverAuthController.forgotPassword(req, res);
export const resetPassword = (req: Request, res: Response) => driverAuthController.resetPassword(req, res);