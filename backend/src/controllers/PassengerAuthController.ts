import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import axios from 'axios';
import { prisma } from '../lib/prisma';
import { formatPhoneNumber, isValidBissauPhone, chargePassengerMobileMoney } from '../services/mobileMoneyService';
import { sendWelcomeEmail } from '../services/emailService';
import { OAuth2Client } from 'google-auth-library';

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

const TERMII_API_KEY = process.env.TERMII_API_KEY;
const TERMII_BASE_URL = process.env.TERMII_BASE_URL || 'https://v4.api.termii.com/';
const TERMII_SENDER_ID = process.env.TERMII_SENDER_ID || 'NOBAI245';

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

if (!JWT_SECRET || !JWT_REFRESH_SECRET) {
  throw new Error('❌ [AUTH] FATAL: JWT_SECRET e JWT_REFRESH_SECRET devem estar configurados.');
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const sanitize = (text?: string): string => {
  if (!text || typeof text !== 'string') return '';
  return text.replace(/[\s.-]+/g, '').toUpperCase();
};

const sanitizeText = (text?: string, maxLength = 255): string => {
  if (!text || typeof text !== 'string') return '';
  return text.trim().slice(0, maxLength);
};

const DISABLED_STATUSES = ['SUSPENDED', 'BANNED', 'REJECTED', 'INACTIVE'];

export class PassengerAuthController {

  // 1. REGISTRO DE PASSAGEIRO
  async register(req: Request, res: Response): Promise<Response> {
    try {
      const { fullName, password, documentType, email } = req.body;

      const rawPhone = sanitize(req.body.phone);
      const documentNumber = sanitize(req.body.documentNumber);
      const cleanFullName = sanitizeText(fullName, 120);
      const cleanEmail = email ? sanitizeText(String(email).toLowerCase(), 150) : null;

      if (!cleanFullName || !rawPhone || !password) {
        return res.status(400).json({ success: false, error: 'Nome, telefone e senha são obrigatórios.' });
      }

      if (String(password).length < 6) {
        return res.status(400).json({ success: false, error: 'A senha deve possuir no mínimo 6 caracteres.' });
      }

      const formattedPhone = formatPhoneNumber(rawPhone);
      if (!isValidBissauPhone(formattedPhone)) {
        return res.status(400).json({ success: false, error: 'Número de telefone inválido para a Guiné-Bissau (+245).' });
      }

      const passengerPhoneExists = await prisma.passenger.findUnique({ where: { phone: formattedPhone } });
      const driverPhoneExists = await prisma.driver.findUnique({ where: { phone: formattedPhone } });
      
      if (passengerPhoneExists || driverPhoneExists) {
        return res.status(409).json({ success: false, error: 'Este número de telefone já está registrado no sistema.' });
      }

      if (documentNumber) {
        const passengerDocExists = await prisma.passenger.findFirst({ where: { documentNumber } });
        const driverDocExists = await prisma.driver.findFirst({ where: { documentNumber } });

        if (passengerDocExists || driverDocExists) {
          return res.status(409).json({ success: false, error: 'Este documento já está vinculado a outra conta.' });
        }
      }

      if (cleanEmail) {
        const emailExists = await prisma.passenger.findUnique({ where: { email: cleanEmail } });
        if (emailExists) {
          return res.status(409).json({ success: false, error: 'Este e-mail já está registrado no sistema.' });
        }
      }

      const passwordHash = await bcrypt.hash(String(password), 12);

      const passenger = await prisma.passenger.create({
        data: {
          fullName: cleanFullName,
          phone: formattedPhone,
          email: cleanEmail,
          passwordHash,
          documentType: documentType ? (sanitizeText(String(documentType), 20) as any) : null,
          documentNumber: documentNumber || null,
          paymentProvider: 'ORANGE_MONEY',
          paymentAccountNumber: formattedPhone,
          isVerified: false
        },
      });

      if (passenger.email) {
        Promise.resolve(sendWelcomeEmail(passenger.email, passenger.fullName)).catch((err) => {
          console.error('⚠️ [EMAIL WELCOME FAILED]:', err);
        });
      }

      return res.status(201).json({
        success: true,
        message: 'Passageiro cadastrado com sucesso! Verifique seu telefone para ativar a conta.',
        passenger: { 
          id: passenger.id, 
          fullName: passenger.fullName, 
          phone: passenger.phone,
          email: passenger.email
        },
      });
    } catch (error: any) {
      console.error('❌ [REGISTRO PASSAGEIRO]:', error?.message || error);
      return res.status(500).json({ success: false, error: 'Erro interno no servidor ao cadastrar passageiro.' });
    }
  }

  // 2. LOGIN TRADICIONAL
  async login(req: Request, res: Response): Promise<Response> {
    try {
      const { phone, password, deviceToken } = req.body;

      if (!phone || !password) {
        return res.status(400).json({ success: false, error: 'Telefone e senha são obrigatórios.' });
      }

      const formattedPhone = formatPhoneNumber(String(phone));
      const passenger = await prisma.passenger.findUnique({ where: { phone: formattedPhone } });

      const dummyHash = '$2b$12$e8Y547uXN8L8i0S9sS9O9e0mQxV1L3yS0N0c0W0X0Y0Z0a0b0c0d';
      const hashToCompare = passenger ? passenger.passwordHash : dummyHash;
      const isPasswordValid = await bcrypt.compare(String(password), hashToCompare);

      if (!passenger || !isPasswordValid) {
        return res.status(401).json({ success: false, error: 'Credenciais inválidas.' });
      }

      if (DISABLED_STATUSES.includes((passenger.status || '').toUpperCase())) {
        return res.status(403).json({ success: false, error: 'Sua conta de passageiro está suspensa ou inativa.' });
      }

      const accessToken = jwt.sign(
        { id: passenger.id, role: 'PASSENGER', status: passenger.status }, 
        JWT_SECRET!, 
        { expiresIn: '1h' }
      );
      
      const refreshToken = jwt.sign(
        { id: passenger.id, role: 'PASSENGER' }, 
        JWT_REFRESH_SECRET!, 
        { expiresIn: '7d' }
      );

      const cleanDeviceToken = deviceToken ? sanitizeText(String(deviceToken), 255) : undefined;

      await prisma.passenger.update({
        where: { id: passenger.id },
        data: {
          refreshTokenHash: hashToken(refreshToken),
          ...(cleanDeviceToken && { deviceToken: cleanDeviceToken }),
        },
      });

      return res.json({
        success: true,
        message: 'Login realizado com sucesso!',
        accessToken,
        refreshToken,
        passenger: {
          id: passenger.id,
          fullName: passenger.fullName,
          email: passenger.email,
          phone: passenger.phone,
          profilePicture: passenger.profilePicture,
          walletBalance: passenger.walletBalance,
          ratingAverage: passenger.ratingAverage,
          paymentProvider: passenger.paymentProvider,
          paymentAccountNumber: passenger.paymentAccountNumber,
          isVerified: passenger.isVerified
        },
      });
    } catch (error: any) {
      console.error('❌ [LOGIN PASSAGEIRO]:', error?.message || error);
      return res.status(500).json({ success: false, error: 'Erro interno ao realizar login.' });
    }
  }

  // 3. SOLICITAR / REENVIAR CÓDIGO OTP VIA TERMII (SMS REAL)
  async requestOTP(req: Request, res: Response): Promise<Response> {
    try {
      const { phone } = req.body;

      if (!phone) {
        return res.status(400).json({ success: false, error: 'Telefone é obrigatório.' });
      }

      const formattedPhone = formatPhoneNumber(String(phone));
      const passenger = await prisma.passenger.findUnique({ where: { phone: formattedPhone } });

      if (!passenger) {
        return res.status(404).json({ success: false, error: 'Passageiro não encontrado com este número.' });
      }

      // 💡 Gerando exatamente 4 DÍGITOS REAIS (compatível com a tela do app)
      const otpCode = Math.floor(1000 + Math.random() * 9000).toString();
      const otpCodeHash = await bcrypt.hash(otpCode, 10);
      const otpExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

      await prisma.passenger.update({
        where: { id: passenger.id },
        data: {
          otpCodeHash,
          otpExpiresAt,
        },
      });

      // Formatação do número para o Termii (+245955219149 -> 245955219149)
      const targetPhoneNoPlus = formattedPhone.replace(/^\+/, '');
      const baseUrlClean = TERMII_BASE_URL.endsWith('/') ? TERMII_BASE_URL : `${TERMII_BASE_URL}/`;
      const termiiEndpoint = `${baseUrlClean}api/sms/send`;

      const termiiPayload = {
        to: targetPhoneNoPlus,
        from: TERMII_SENDER_ID,
        sms: `O seu codigo de verificacao Nobai245 e ${otpCode}. Expira em 10 min.`,
        type: 'plain',
        channel: 'generic',
        api_key: TERMII_API_KEY,
      };

      try {
        const termiiRes = await axios.post(termiiEndpoint, termiiPayload, { timeout: 10000 });
        console.log(`✅ [TERMII ENVIADO PARA ${targetPhoneNoPlus}]:`, termiiRes.data);
      } catch (termiiErr: any) {
        console.error('❌ [ERRO TERMII SMS]:', termiiErr?.response?.data || termiiErr?.message);
      }

      return res.status(200).json({
        success: true,
        message: 'Código de verificação enviado por SMS com sucesso!',
      });
    } catch (error: any) {
      console.error('❌ [SOLICITAR OTP]:', error?.message || error);
      return res.status(500).json({ success: false, error: 'Erro ao solicitar envio de OTP.' });
    }
  }

  // 4. VERIFICAR CÓDIGO OTP REAL
  async verifyOTP(req: Request, res: Response): Promise<Response> {
    try {
      const { phone, otp } = req.body;

      if (!phone || !otp) {
        return res.status(400).json({ success: false, error: 'Telefone e código OTP são obrigatórios.' });
      }

      const formattedPhone = formatPhoneNumber(String(phone));
      const passenger = await prisma.passenger.findUnique({ where: { phone: formattedPhone } });

      if (!passenger) {
        return res.status(404).json({ success: false, error: 'Passageiro não encontrado.' });
      }

      const cleanOtp = String(otp).trim();

      const isValidOtp = passenger.otpCodeHash ? await bcrypt.compare(cleanOtp, passenger.otpCodeHash) : false;
      const isNotExpired = Boolean(passenger.otpExpiresAt && passenger.otpExpiresAt > new Date());

      if (!isValidOtp || !isNotExpired) {
        return res.status(400).json({ success: false, error: 'Código OTP inválido ou expirado.' });
      }

      await prisma.passenger.update({
        where: { id: passenger.id },
        data: {
          isVerified: true,
          otpCodeHash: null,
          otpExpiresAt: null,
        },
      });

      return res.status(200).json({ success: true, message: 'Conta verificada com sucesso!' });
    } catch (error: any) {
      console.error('❌ [VERIFICAR OTP]:', error?.message || error);
      return res.status(500).json({ success: false, error: 'Erro ao verificar código OTP.' });
    }
  }
  // 5. REFRESH TOKEN
  async refreshToken(req: Request, res: Response): Promise<Response> {
    try {
      const { refreshToken } = req.body;
      if (!refreshToken || typeof refreshToken !== 'string') {
        return res.status(400).json({ success: false, error: 'Refresh Token não fornecido.' });
      }

      const decoded = jwt.verify(refreshToken, JWT_REFRESH_SECRET!) as { id: string; role: string };
      const passenger = await prisma.passenger.findUnique({ where: { id: decoded.id } });

      const incomingHash = hashToken(refreshToken);
      if (!passenger || DISABLED_STATUSES.includes((passenger.status || '').toUpperCase()) || passenger.refreshTokenHash !== incomingHash) {
        return res.status(403).json({ success: false, error: 'Refresh Token inválido, revogado ou conta suspensa.' });
      }

      const accessToken = jwt.sign(
        { id: passenger.id, role: 'PASSENGER', status: passenger.status }, 
        JWT_SECRET!, 
        { expiresIn: '1h' }
      );

      return res.json({ success: true, accessToken });
    } catch (error) {
      return res.status(401).json({ success: false, error: 'Refresh Token inválido ou expirado.' });
    }
  }

  // 6. OBTER PERFIL
  async getProfile(req: Request, res: Response): Promise<Response> {
    try {
      const passengerId = (req as any).user?.id;
      if (!passengerId) return res.status(401).json({ success: false, error: 'Não autorizado.' });

      const passenger = await prisma.passenger.findUnique({
        where: { id: passengerId },
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          profilePicture: true,
          walletBalance: true,
          ratingAverage: true,
          paymentProvider: true,
          paymentAccountNumber: true,
          isVerified: true
        },
      });

      if (!passenger) return res.status(404).json({ success: false, error: 'Passageiro não encontrado.' });

      return res.status(200).json({ success: true, passenger });
    } catch (error: any) {
      console.error('❌ [PERFIL PASSAGEIRO]:', error?.message || error);
      return res.status(500).json({ success: false, error: 'Erro ao buscar dados do perfil.' });
    }
  }

  // 7. ATUALIZAR PERFIL
  async updateProfile(req: Request, res: Response): Promise<Response> {
    try {
      const passengerId = (req as any).user?.id;
      if (!passengerId) return res.status(401).json({ success: false, error: 'Não autorizado.' });

      const { fullName, email } = req.body;
      const dataToUpdate: any = {};

      if (fullName) dataToUpdate.fullName = sanitizeText(String(fullName), 120);
      
      if (email !== undefined) {
        const cleanEmail = email ? sanitizeText(String(email).toLowerCase(), 150) : null;
        if (cleanEmail) {
          const emailExists = await prisma.passenger.findUnique({ where: { email: cleanEmail } });
          if (emailExists && emailExists.id !== passengerId) {
            return res.status(409).json({ success: false, error: 'Este e-mail já está em uso por outra conta.' });
          }
        }
        dataToUpdate.email = cleanEmail;
      }

      if (req.file) {
        const baseUrl = process.env.APP_URL ? process.env.APP_URL.replace(/\/$/, '') : `${req.protocol}://${req.get('host')}`;
        const safeFilename = encodeURIComponent(req.file.filename);
        dataToUpdate.profilePicture = `${baseUrl}/uploads/${safeFilename}`;
      }

      const updatedPassenger = await prisma.passenger.update({
        where: { id: passengerId },
        data: dataToUpdate,
        select: {
          id: true,
          fullName: true,
          email: true,
          phone: true,
          profilePicture: true,
          walletBalance: true,
          ratingAverage: true,
          paymentProvider: true,
          paymentAccountNumber: true,
        },
      });

      return res.status(200).json({
        success: true,
        message: 'Perfil atualizado com sucesso!',
        passenger: updatedPassenger,
      });
    } catch (error: any) {
      console.error('❌ [ATUALIZAR PERFIL PASSAGEIRO]:', error?.message || error);
      return res.status(500).json({ success: false, error: 'Erro ao atualizar dados do perfil.' });
    }
  }

  // 8. EXTRATO FINANCEIRO
  async getFinance(req: Request, res: Response): Promise<Response> {
    try {
      const passengerId = (req as any).user?.id;
      if (!passengerId) return res.status(401).json({ success: false, error: 'Não autorizado.' });

      const passenger = await prisma.passenger.findUnique({
        where: { id: passengerId },
        select: { walletBalance: true, paymentProvider: true, paymentAccountNumber: true, phone: true },
      });

      if (!passenger) return res.status(404).json({ success: false, error: 'Passageiro não encontrado.' });

      const transactions = await prisma.transaction.findMany({
        where: { passengerId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });

      return res.status(200).json({
        success: true,
        walletBalance: passenger.walletBalance,
        paymentProvider: passenger.paymentProvider || 'ORANGE_MONEY',
        paymentAccountNumber: passenger.paymentAccountNumber || passenger.phone,
        transactions,
      });
    } catch (error: any) {
      console.error('❌ [FINANCEIRO PASSAGEIRO]:', error?.message || error);
      return res.status(500).json({ success: false, error: 'Erro interno ao buscar extrato.' });
    }
  }

  // 9. RECARGA DE CARTEIRA
  async rechargeWallet(req: Request, res: Response): Promise<Response> {
    try {
      const passengerId = (req as any).user?.id;
      if (!passengerId) return res.status(401).json({ success: false, error: 'Não autorizado.' });

      const { amount, provider, phone } = req.body;

      const cleanAmount = Math.round(Number(amount));
      if (isNaN(cleanAmount) || cleanAmount <= 0) {
        return res.status(400).json({ success: false, error: 'O valor da recarga deve ser maior que zero XOF.' });
      }

      const passenger = await prisma.passenger.findUnique({
        where: { id: passengerId },
        select: { phone: true, paymentProvider: true, paymentAccountNumber: true }
      });

      if (!passenger) return res.status(404).json({ success: false, error: 'Passageiro não encontrado.' });

      const selectedProvider = provider || passenger.paymentProvider || 'ORANGE_MONEY';
      if (!['ORANGE_MONEY', 'MTN_MOMO'].includes(selectedProvider)) {
        return res.status(400).json({ success: false, error: 'Provedor de pagamento inválido.' });
      }

      const rawPhone = phone || passenger.paymentAccountNumber || passenger.phone;
      const targetPhone = formatPhoneNumber(String(rawPhone));

      if (!isValidBissauPhone(targetPhone)) {
        return res.status(400).json({ success: false, error: 'Número de telefone Mobile Money inválido para Guiné-Bissau (+245).' });
      }

      const transaction = await prisma.transaction.create({
        data: {
          passengerId,
          amount: cleanAmount,
          type: 'DEPOSIT',
          status: 'PENDING',
          paymentMethod: selectedProvider,
          reference: `RECHARGE-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
          description: 'Recarga de saldo na Carteira In-App'
        }
      });

      let chargeResult: any;
      try {
        chargeResult = await chargePassengerMobileMoney({
          passengerId,
          phone: targetPhone,
          amount: cleanAmount,
          provider: selectedProvider,
          transactionId: transaction.id,
          isWalletRecharge: true
        });
      } catch (gatewayErr: any) {
        await prisma.transaction.update({
          where: { id: transaction.id },
          data: { status: 'FAILED', failureReason: gatewayErr.message || 'Falha de comunicação com o Gateway de Pagamentos.' }
        });
        return res.status(502).json({ success: false, error: 'Serviço de pagamento indisponível no momento.' });
      }

      if (!chargeResult.success) {
        await prisma.transaction.update({
          where: { id: transaction.id },
          data: { status: 'FAILED', failureReason: chargeResult.details || chargeResult.error }
        });
        return res.status(400).json({ success: false, error: chargeResult.details || 'Falha ao iniciar cobrança Mobile Money.' });
      }

      return res.status(200).json({
        success: true,
        message: String(selectedProvider).toUpperCase().includes('ORANGE') 
          ? 'Acesse o link para concluir o pagamento da recarga.' 
          : 'Solicitação enviada ao seu telefone. Digite o seu PIN do Mobile Money.',
        transactionId: transaction.id,
        paymentUrl: chargeResult.paymentUrl || null,
        providerRef: chargeResult.providerRef
      });
    } catch (error: any) {
      console.error('❌ [RECARGA CARTEIRA]:', error?.message || error);
      return res.status(500).json({ success: false, error: 'Erro interno ao processar recarga de carteira.' });
    }
  }

  // 10. CONFIGURAR MÉTODO DE PAGAMENTO
  async updatePaymentMethod(req: Request, res: Response): Promise<Response> {
    try {
      const passengerId = (req as any).user?.id;
      if (!passengerId) return res.status(401).json({ success: false, error: 'Não autorizado.' });

      const { paymentProvider, paymentAccountNumber } = req.body;

      if (!paymentProvider || !['ORANGE_MONEY', 'MTN_MOMO'].includes(paymentProvider)) {
        return res.status(400).json({ success: false, error: 'Selecione uma operadora válida (ORANGE_MONEY ou MTN_MOMO).' });
      }

      const formattedAccount = paymentAccountNumber ? formatPhoneNumber(String(paymentAccountNumber)) : undefined;
      if (formattedAccount && !isValidBissauPhone(formattedAccount)) {
        return res.status(400).json({ success: false, error: 'Número de conta Mobile Money inválido.' });
      }

      const updatedPassenger = await prisma.passenger.update({
        where: { id: passengerId },
        data: {
          paymentProvider,
          paymentAccountNumber: formattedAccount,
        },
        select: { paymentProvider: true, paymentAccountNumber: true },
      });

      return res.status(200).json({
        success: true,
        message: 'Método de pagamento configurado com sucesso!',
        paymentMethod: updatedPassenger,
      });
    } catch (error: any) {
      console.error('❌ [PAGAMENTO PASSAGEIRO]:', error?.message || error);
      return res.status(500).json({ success: false, error: 'Erro ao atualizar dados de pagamento.' });
    }
  }

  // 11. ATUALIZAR TOKEN PUSH
  async updateDeviceToken(req: Request, res: Response): Promise<Response> {
    try {
      const passengerId = (req as any).user?.id;
      if (!passengerId) return res.status(401).json({ success: false, error: 'Não autorizado.' });

      const { deviceToken } = req.body;
      if (!deviceToken || typeof deviceToken !== 'string') {
        return res.status(400).json({ success: false, error: 'Token de notificação inválido ou ausente.' });
      }

      await prisma.passenger.update({
        where: { id: passengerId },
        data: { deviceToken: sanitizeText(deviceToken, 255) },
      });

      return res.status(200).json({ success: true, message: 'Token de notificação atualizado com sucesso!' });
    } catch (error: any) {
      console.error('❌ [PUSH TOKEN PASSAGEIRO]:', error?.message || error);
      return res.status(500).json({ success: false, error: 'Erro interno ao salvar token de notificação.' });
    }
  }

  // 12. HISTÓRICO DE CORRIDAS
  async getRideHistory(req: Request, res: Response): Promise<Response> {
    try {
      const passengerId = (req as any).user?.id;
      if (!passengerId) {
        return res.status(401).json({ success: false, error: 'Sessão expirada ou não autorizada.' });
      }

      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
      const skip = (page - 1) * limit;

      const rides = await prisma.ride.findMany({
        where: { passengerId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          driver: {
            select: {
              id: true,
              fullName: true,
              phone: true,
              profilePicture: true,
              vehicleBrand: true,
              vehiclePlate: true,
            },
          },
        },
      });

      return res.status(200).json({
        success: true,
        rides,
      });
    } catch (error: any) {
      console.error('❌ [HISTORICO PASSAGEIRO]:', error?.message || error);
      return res.status(500).json({ success: false, error: 'Erro interno ao buscar histórico de corridas.' });
    }
  }

  // 13. CONTATOS DE EMERGÊNCIA - BUSCAR
  async getEmergencyContacts(req: Request, res: Response): Promise<Response> {
    try {
      const passengerId = (req as any).user?.id;
      if (!passengerId) return res.status(401).json({ success: false, error: 'Não autorizado.' });

      const contacts = await prisma.emergencyContact.findMany({
        where: { passengerId },
        orderBy: { createdAt: 'desc' },
      });

      return res.status(200).json({ success: true, contacts });
    } catch (error: any) {
      console.error('❌ [BUSCAR CONTATOS]:', error?.message || error);
      return res.status(500).json({ success: false, error: 'Erro ao buscar contatos de emergência.' });
    }
  }

  // 14. CONTATOS DE EMERGÊNCIA - ADICIONAR
  async addEmergencyContact(req: Request, res: Response): Promise<Response> {
    try {
      const passengerId = (req as any).user?.id;
      if (!passengerId) return res.status(401).json({ success: false, error: 'Não autorizado.' });

      const { name, phone, relationship } = req.body;

      if (!name || !phone) {
        return res.status(400).json({ success: false, error: 'Nome e telefone são obrigatórios.' });
      }

      const formattedPhone = formatPhoneNumber(String(phone));
      if (!isValidBissauPhone(formattedPhone)) {
        return res.status(400).json({ success: false, error: 'Número de telefone de emergência inválido para Guiné-Bissau (+245).' });
      }

      const newContact = await prisma.emergencyContact.create({
        data: {
          passengerId,
          name: sanitizeText(String(name), 100),
          phone: formattedPhone,
          relationship: relationship ? sanitizeText(String(relationship), 50) : null,
        },
      });

      return res.status(201).json({ success: true, contact: newContact });
    } catch (error: any) {
      console.error('❌ [CRIAR CONTATO]:', error?.message || error);
      return res.status(500).json({ success: false, error: 'Erro ao adicionar contato de emergência.' });
    }
  }

  // 15. LOGIN COM GOOGLE
  async googleSignIn(req: Request, res: Response): Promise<Response> {
    try {
      const { idToken, deviceToken } = req.body;

      if (!idToken || typeof idToken !== 'string') {
        return res.status(400).json({ success: false, error: 'Token do Google não fornecido.' });
      }

      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: GOOGLE_CLIENT_ID,
      });
      
      const payload = ticket.getPayload();
      if (!payload || !payload.email) {
        return res.status(400).json({ success: false, error: 'Token do Google inválido ou sem e-mail.' });
      }

      const { email, name, picture } = payload;
      const passenger = await prisma.passenger.findUnique({ where: { email } });

      if (!passenger) {
        return res.status(200).json({
          success: true,
          isNewUser: true,
          message: 'Conta Google validada. Por favor, informe seu número de telefone para concluir o cadastro.',
          googleData: { email, fullName: name, profilePicture: picture }
        });
      }

      if (DISABLED_STATUSES.includes((passenger.status || '').toUpperCase())) {
        return res.status(403).json({ success: false, error: 'Sua conta de passageiro está suspensa ou inativa.' });
      }

      const accessToken = jwt.sign(
        { id: passenger.id, role: 'PASSENGER', status: passenger.status }, 
        JWT_SECRET!, 
        { expiresIn: '1h' }
      );
      
      const refreshToken = jwt.sign(
        { id: passenger.id, role: 'PASSENGER' }, 
        JWT_REFRESH_SECRET!, 
        { expiresIn: '7d' }
      );

      const cleanDeviceToken = deviceToken ? sanitizeText(String(deviceToken), 255) : undefined;

      await prisma.passenger.update({
        where: { id: passenger.id },
        data: {
          refreshTokenHash: hashToken(refreshToken),
          isVerified: true,
          ...(cleanDeviceToken && { deviceToken: cleanDeviceToken }),
          profilePicture: passenger.profilePicture || picture
        },
      });

      return res.json({
        success: true,
        message: 'Login com Google realizado com sucesso!',
        isNewUser: false,
        accessToken,
        refreshToken,
        passenger: {
          id: passenger.id,
          fullName: passenger.fullName,
          email: passenger.email,
          phone: passenger.phone,
          profilePicture: passenger.profilePicture || picture,
          walletBalance: passenger.walletBalance,
          ratingAverage: passenger.ratingAverage,
          paymentProvider: passenger.paymentProvider,
          paymentAccountNumber: passenger.paymentAccountNumber,
        },
      });

    } catch (error: any) {
      console.error('❌ [LOGIN GOOGLE PASSAGEIRO]:', error?.message || error);
      return res.status(500).json({ success: false, error: 'Erro interno ao validar autenticação com o Google.' });
    }
  }

 // 16. CONCLUIR REGISTRO GOOGLE
  async completeGoogleRegistration(req: Request, res: Response): Promise<Response> {
    try {
      const { email, fullName, phone, profilePicture, deviceToken } = req.body;

      const cleanEmail = email ? sanitizeText(String(email).toLowerCase(), 150) : null;
      const cleanFullName = sanitizeText(fullName, 120);
      const rawPhone = sanitize(phone);

      if (!cleanEmail || !cleanFullName || !rawPhone) {
        return res.status(400).json({ success: false, error: 'E-mail, nome e telefone são obrigatórios.' });
      }

      const formattedPhone = formatPhoneNumber(rawPhone);
      if (!isValidBissauPhone(formattedPhone)) {
        return res.status(400).json({ success: false, error: 'Número de telefone inválido para Guiné-Bissau (+245).' });
      }

      const passengerPhoneExists = await prisma.passenger.findUnique({ where: { phone: formattedPhone } });
      const driverPhoneExists = await prisma.driver.findUnique({ where: { phone: formattedPhone } });
      
      if (passengerPhoneExists || driverPhoneExists) {
        return res.status(409).json({ success: false, error: 'Este número de telefone já está registrado em outra conta.' });
      }

      const emailExists = await prisma.passenger.findUnique({ where: { email: cleanEmail } });
      if (emailExists) {
        return res.status(409).json({ success: false, error: 'Este e-mail já está vinculado a outra conta.' });
      }

      const randomPassword = crypto.randomBytes(16).toString('hex');
      const passwordHash = await bcrypt.hash(randomPassword, 12);

      const passenger = await prisma.passenger.create({
        data: {
          fullName: cleanFullName,
          email: cleanEmail,
          phone: formattedPhone,
          passwordHash,
          profilePicture: profilePicture ? sanitizeText(String(profilePicture), 500) : null,
          deviceToken: deviceToken ? sanitizeText(String(deviceToken), 255) : null,
          isVerified: true,
          paymentProvider: 'ORANGE_MONEY',
          paymentAccountNumber: formattedPhone,
        },
      });

      Promise.resolve(sendWelcomeEmail(passenger.email!, passenger.fullName)).catch((err) => {
        console.error('⚠️ [EMAIL WELCOME FAILED]:', err);
      });

      const accessToken = jwt.sign(
        { id: passenger.id, role: 'PASSENGER', status: passenger.status }, 
        JWT_SECRET!, 
        { expiresIn: '1h' }
      );
      const refreshToken = jwt.sign(
        { id: passenger.id, role: 'PASSENGER' }, 
        JWT_REFRESH_SECRET!, 
        { expiresIn: '7d' }
      );

      await prisma.passenger.update({
        where: { id: passenger.id },
        data: { refreshTokenHash: hashToken(refreshToken) },
      });

      return res.status(201).json({
        success: true,
        message: 'Cadastro concluído com sucesso!',
        accessToken,
        refreshToken,
        passenger: { 
          id: passenger.id, 
          fullName: passenger.fullName, 
          phone: passenger.phone,
          email: passenger.email,
          profilePicture: passenger.profilePicture
        },
      });
    } catch (error: any) {
      console.error('❌ [CADASTRO GOOGLE PASSAGEIRO]:', error?.message || error);
      return res.status(500).json({ success: false, error: 'Erro interno ao concluir cadastro via Google.' });
    }
  }

  // 17. CRIAR CHAMADO DE SUPORTE
  async createTicket(req: Request, res: Response): Promise<Response> {
    try {
      const passengerId = (req as any).user?.id;
      if (!passengerId) return res.status(401).json({ success: false, error: 'Não autorizado.' });

      const { category, description, message } = req.body;

      const cleanCategory = sanitizeText(String(category || ''), 50);
      const cleanDescription = sanitizeText(String(description || ''), 1000);
      const initialMessage = sanitizeText(String(message || description || ''), 1000);

      if (!cleanCategory || !cleanDescription || !initialMessage) {
        return res.status(400).json({ success: false, error: 'Categoria e descrição válida do chamado são obrigatórias.' });
      }

      const ticket = await prisma.ticket.create({
        data: {
          passengerId,
          createdByType: 'PASSENGER',
          category: cleanCategory,
          description: cleanDescription,
          status: 'OPEN',
          messages: {
            create: {
              sender: 'PASSENGER',
              senderId: String(passengerId),
              message: initialMessage
            }
          }
        },
        include: {
          messages: true
        }
      });

      return res.status(201).json({ success: true, ticket });
    } catch (error: any) {
      console.error('❌ [CRIAR CHAMADO]:', error?.message || error);
      return res.status(500).json({ success: false, error: 'Erro ao criar chamado.' });
    }
  }

  // 18. LISTAR CHAMADOS
  async getTickets(req: Request, res: Response): Promise<Response> {
    try {
      const passengerId = (req as any).user?.id;
      if (!passengerId) return res.status(401).json({ success: false, error: 'Não autorizado.' });

      const tickets = await prisma.ticket.findMany({
        where: { passengerId },
        take: 50,
        include: {
          messages: {
            orderBy: { createdAt: 'asc' }
          }
        },
        orderBy: { createdAt: 'desc' }
      });

      return res.status(200).json({ success: true, tickets });
    } catch (error: any) {
      console.error('❌ [BUSCAR CHAMADOS]:', error?.message || error);
      return res.status(500).json({ success: false, error: 'Erro ao buscar chamados.' });
    }
  }

  // 19. RESPONDER CHAMADO
  async replyTicket(req: Request, res: Response): Promise<Response> {
    try {
      const { id } = req.params;
      const { message } = req.body;
      const passengerId = (req as any).user?.id;

      if (!passengerId) return res.status(401).json({ success: false, error: 'Não autorizado.' });

      const cleanMessage = sanitizeText(String(message || ''), 1000);
      if (!cleanMessage) {
        return res.status(400).json({ success: false, error: 'A mensagem não pode estar vazia.' });
      }

      const ticket = await prisma.ticket.findFirst({
        where: { id: String(id), passengerId }
      });

      if (!ticket) {
        return res.status(404).json({ success: false, error: 'Chamado não encontrado.' });
      }

      const newMessage = await prisma.ticketMessage.create({
        data: {
          ticketId: String(ticket.id),
          sender: 'PASSENGER',
          senderId: String(passengerId),
          message: cleanMessage
        }
      });

      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { status: 'OPEN' }
      });

      return res.status(200).json({ success: true, message: newMessage });
    } catch (error: any) {
      console.error('❌ [RESPONDER CHAMADO]:', error?.message || error);
      return res.status(500).json({ success: false, error: 'Erro ao enviar mensagem.' });
    }
  }

  // 20. EXCLUIR / ANONIMIZAR CONTA
  async deleteAccount(req: Request, res: Response): Promise<Response> {
    try {
      const passengerId = (req as any).user?.id;
      if (!passengerId) return res.status(401).json({ success: false, error: 'Não autorizado.' });

      const activeRide = await prisma.ride.findFirst({
        where: {
          passengerId,
          status: { in: ['PENDING', 'SEARCHING', 'AWAITING_PAYMENT', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS'] }
        }
      });

      if (activeRide) {
        return res.status(400).json({ 
          success: false, 
          error: 'Você possui uma corrida ativa ou em andamento. Finalize ou cancele a corrida antes de encerrar a conta.' 
        });
      }

      const uniqueHash = crypto.randomUUID();

      await prisma.passenger.update({
        where: { id: passengerId },
        data: {
          status: 'SUSPENDED',
          fullName: 'Passageiro Anônimo',
          phone: `DEL-${uniqueHash}`,
          email: `deleted-${uniqueHash}@anon.com`,
          paymentAccountNumber: null,
          refreshTokenHash: null,
          deviceToken: null,
        },
      });

      return res.status(200).json({ success: true, message: 'Conta e dados sensíveis desativados com sucesso.' });
    } catch (error: any) {
      console.error('❌ [EXCLUIR PASSAGEIRO]:', error?.message || error);
      return res.status(500).json({ success: false, error: 'Erro ao solicitar encerramento da conta.' });
    }
  }
}

const passengerAuthController = new PassengerAuthController();

export const register = (req: Request, res: Response) => passengerAuthController.register(req, res);
export const login = (req: Request, res: Response) => passengerAuthController.login(req, res);
export const requestOTP = (req: Request, res: Response) => passengerAuthController.requestOTP(req, res);
export const verifyOTP = (req: Request, res: Response) => passengerAuthController.verifyOTP(req, res);
export const refreshToken = (req: Request, res: Response) => passengerAuthController.refreshToken(req, res);
export const getProfile = (req: Request, res: Response) => passengerAuthController.getProfile(req, res);
export const updateProfile = (req: Request, res: Response) => passengerAuthController.updateProfile(req, res);
export const getFinance = (req: Request, res: Response) => passengerAuthController.getFinance(req, res);
export const rechargeWallet = (req: Request, res: Response) => passengerAuthController.rechargeWallet(req, res);
export const updatePaymentMethod = (req: Request, res: Response) => passengerAuthController.updatePaymentMethod(req, res);
export const updateDeviceToken = (req: Request, res: Response) => passengerAuthController.updateDeviceToken(req, res);
export const getRideHistory = (req: Request, res: Response) => passengerAuthController.getRideHistory(req, res);
export const getEmergencyContacts = (req: Request, res: Response) => passengerAuthController.getEmergencyContacts(req, res);
export const addEmergencyContact = (req: Request, res: Response) => passengerAuthController.addEmergencyContact(req, res);
export const googleSignIn = (req: Request, res: Response) => passengerAuthController.googleSignIn(req, res);
export const completeGoogleRegistration = (req: Request, res: Response) => passengerAuthController.completeGoogleRegistration(req, res);
export const createTicket = (req: Request, res: Response) => passengerAuthController.createTicket(req, res);
export const getTickets = (req: Request, res: Response) => passengerAuthController.getTickets(req, res);
export const replyTicket = (req: Request, res: Response) => passengerAuthController.replyTicket(req, res);
export const deleteAccount = (req: Request, res: Response) => passengerAuthController.deleteAccount(req, res);