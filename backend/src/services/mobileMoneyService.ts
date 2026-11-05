import axios, { AxiosError } from 'axios';
import crypto from 'crypto';
import { 
  PaymentMethod, 
  TransactionType, 
  TransactionStatus,
  RideStatus,
  Prisma
} from '@prisma/client';
import { prisma } from '../config/prisma';

// Configurações de ambiente MTN
const MTN_BASE_URL = process.env.MTN_MOMO_BASE_URL || 'https://sandbox.momodeveloper.mtn.com';
const MTN_SUBSCRIPTION_KEY = process.env.MTN_MOMO_SUBSCRIPTION_KEY || process.env.MTN_SUBSCRIPTION_KEY || '';
const MTN_TARGET_ENV = process.env.MTN_MOMO_TARGET_ENV || 'sandbox';

// Configurações de ambiente ORANGE
const ORANGE_BASE_URL = process.env.ORANGE_MONEY_API_URL || process.env.ORANGE_BASE_URL || 'https://api.orange.com';
const ORANGE_CLIENT_ID = process.env.ORANGE_CLIENT_ID || process.env.ORANGE_MONEY_CLIENT_ID || '';
const ORANGE_CLIENT_SECRET = process.env.ORANGE_CLIENT_SECRET || process.env.ORANGE_MONEY_CLIENT_SECRET || '';
const ORANGE_MERCHANT_KEY = process.env.ORANGE_MERCHANT_KEY || process.env.ORANGE_MONEY_MERCHANT_KEY || '';

// Configurações do Gateway Local SMS/USSD (Guiné-Bissau)
const GATEWAY_SECRET_KEY = process.env.GATEWAY_SECRET_KEY || 'bai245-secret-gateway-key-2026';
const ADMIN_ORANGE_PIN = process.env.ADMIN_ORANGE_PIN || '0000';
const ADMIN_MTN_PIN = process.env.ADMIN_MTN_PIN || '0000';
const ADMIN_ORANGE_PHONE = process.env.ADMIN_ORANGE_PHONE || '245950000000';
const ADMIN_MTN_PHONE = process.env.ADMIN_MTN_PHONE || '245960000000';

const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const IS_MOCK_MODE = !IS_PRODUCTION && (process.env.ENABLE_MOCK_PAYMENTS === 'true');

const apiClient = axios.create({ 
  timeout: 15000, 
  headers: { 'Accept': 'application/json' }
});

interface TokenCacheEntry {
  token: string;
  expiresAt: number;
}

const tokenCache: Record<'orange' | 'mtnCollection' | 'mtnDisbursement', TokenCacheEntry> = {
  orange: { token: '', expiresAt: 0 },
  mtnCollection: { token: '', expiresAt: 0 },
  mtnDisbursement: { token: '', expiresAt: 0 }
};

const tokenPromises: Record<string, Promise<string> | null> = {
  orange: null,
  mtnCollection: null,
  mtnDisbursement: null
};

// -----------------------------------------------------------------------------
// 🛠️ FUNÇÕES UTILITÁRIAS DE TELEFONE E VALIDAÇÃO
// -----------------------------------------------------------------------------

export function formatPhoneNumber(phone: string): string {
  if (!phone) return '';
  let cleanPhone = phone.replace(/\D/g, '');
  if (!cleanPhone) return '';

  while (cleanPhone.startsWith('245245')) {
    cleanPhone = cleanPhone.substring(3);
  }

  if (cleanPhone.startsWith('245')) return `+${cleanPhone}`;
  return `+245${cleanPhone}`;
}

export function isValidBissauPhone(phone: string): boolean {
  const formatted = formatPhoneNumber(phone).replace(/^\+/, '');
  return /^245[5679]\d{6,8}$/.test(formatted);
}

function toDeterministicUuid(input: string): string {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(input)) return input;

  const hash = crypto.createHash('sha256').update(input).digest('hex');
  return [
    hash.substring(0, 8),
    hash.substring(8, 12),
    '4' + hash.substring(13, 16),
    (parseInt(hash.substring(16, 17), 16) & 0x3 | 0x8).toString(16) + hash.substring(17, 20),
    hash.substring(20, 32)
  ].join('-');
}

function isUuid(str?: string): boolean {
  if (!str || typeof str !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);
}

// -----------------------------------------------------------------------------
// 📱 GATEWAY LOCAL: PARSER DE SMS (ORANGE MONEY & MTN MOMO GUINÉ-BISSAU)
// -----------------------------------------------------------------------------

export interface ParsedSms {
  provider: PaymentMethod;
  amount: number;
  senderPhone: string;
  txRef: string;
  isSuccess: boolean;
  rawSms: string;
}

/**
 * Lê o texto bruto do SMS recebido no Celular Gateway e extrai os dados.
 */
export function parseIncomingSms(smsText: string, senderHeader?: string): ParsedSms | null {
  if (!smsText || typeof smsText !== 'string') return null;

  const cleanText = smsText.trim();
  const header = (senderHeader || '').toUpperCase();

  // 1. IDENTIFICAÇÃO DE ORANGE MONEY GUINÉ-BISSAU
  if (header.includes('ORANGE') || cleanText.includes('Orange Money') || cleanText.includes('OM') || cleanText.includes('FCFA')) {
    const amountMatch = cleanText.match(/(?:recu|recebeu|transfert|valor:?)\s*(\d+(?:\.\d+)?)\s*(?:FCFA|XOF|CFA)/i) ||
                        cleanText.match(/(\d+(?:\.\d+)?)\s*(?:FCFA|XOF|CFA)/i);
    
    const phoneMatch = cleanText.match(/(?:de|from)\s*(?:245)?(9[57]\d{7})/i) ||
                       cleanText.match(/(?:245)?(9[57]\d{7})/);
    
    const refMatch = cleanText.match(/(?:ref|txnid|transid|id):?\s*([A-Z0-9.]+)/i);

    if (amountMatch && phoneMatch) {
      const amount = parseFloat(amountMatch[1]);
      const senderPhone = formatPhoneNumber(phoneMatch[1]);
      const txRef = refMatch ? refMatch[1] : `OM-SMS-${Date.now()}`;

      return {
        provider: PaymentMethod.ORANGE_MONEY,
        amount,
        senderPhone,
        txRef,
        isSuccess: !cleanText.toLowerCase().includes('echoue') && !cleanText.toLowerCase().includes('cancelada'),
        rawSms: cleanText
      };
    }
  }

  // 2. IDENTIFICAÇÃO DE MTN MOMO GUINÉ-BISSAU
  if (header.includes('MTN') || header.includes('MOMO') || cleanText.includes('MoMo') || cleanText.includes('MTN')) {
    const amountMatch = cleanText.match(/(?:received|recebeu|amount:?)\s*(\d+(?:\.\d+)?)\s*(?:FCFA|XOF|CFA)/i) ||
                        cleanText.match(/(\d+(?:\.\d+)?)\s*(?:FCFA|XOF|CFA)/i);
    
    const phoneMatch = cleanText.match(/(?:from|de)\s*(?:245)?(96\d{7})/i) ||
                       cleanText.match(/(?:245)?(96\d{7})/);
    
    const refMatch = cleanText.match(/(?:transaction id|txnid|ref):?\s*([A-Z0-9.]+)/i);

    if (amountMatch && phoneMatch) {
      const amount = parseFloat(amountMatch[1]);
      const senderPhone = formatPhoneNumber(phoneMatch[1]);
      const txRef = refMatch ? refMatch[1] : `MTN-SMS-${Date.now()}`;

      return {
        provider: PaymentMethod.MTN_MOMO,
        amount,
        senderPhone,
        txRef,
        isSuccess: !cleanText.toLowerCase().includes('failed') && !cleanText.toLowerCase().includes('falhou'),
        rawSms: cleanText
      };
    }
  }

  return null;
}

/**
 * Endpoint de Webhook chamado pelo aplicativo Gateway Android ao ler um SMS.
 */
export async function processSmsGatewayWebhook(payload: {
  smsText: string;
  senderHeader?: string;
  gatewaySecret: string;
}) {
  if (payload.gatewaySecret !== GATEWAY_SECRET_KEY) {
    throw new Error('UNAUTHORIZED_GATEWAY: Chave secreta do Gateway inválida.');
  }

  const parsed = parseIncomingSms(payload.smsText, payload.senderHeader);
  if (!parsed || !parsed.isSuccess) {
    return { success: false, reason: 'NOT_A_VALID_PAYMENT_SMS' };
  }

  return await prisma.$transaction(async (tx) => {
    // 1. Antiduplicação (Idempotência)
    const existingTx = await tx.transaction.findFirst({
      where: {
        OR: [
          { reference: parsed.txRef },
          { id: isUuid(parsed.txRef) ? parsed.txRef : undefined }
        ]
      }
    });

    if (existingTx) {
      return { success: true, duplicated: true, message: 'SMS já processado anteriormente.' };
    }

    const rawPhoneDigits = parsed.senderPhone.replace(/\D/g, '');

    // 2. Busca transação pendente compatível com o número do passageiro e valor
    const pendingPayment = await tx.transaction.findFirst({
      where: {
        passengerPhone: { contains: rawPhoneDigits.slice(-9) },
        status: TransactionStatus.PENDING,
        amount: new Prisma.Decimal(parsed.amount)
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!pendingPayment) {
      console.warn(`⚠️ [SMS GATEWAY] SMS recebido sem corrida pendente correspondente. Tel: ${parsed.senderPhone}, Valor: ${parsed.amount}`);
      return { success: false, reason: 'NO_MATCHING_PENDING_RIDE' };
    }

    // 3. Atualiza a transação de pagamento para HELD_IN_ESCROW
    const updatedPayment = await tx.transaction.update({
      where: { id: pendingPayment.id },
      data: {
        status: TransactionStatus.HELD_IN_ESCROW,
        reference: parsed.txRef,
        paymentMethod: parsed.provider
      }
    });

    // 4. Atualiza o status da corrida para SEARCHING (Liberada para motoristas)
    if (pendingPayment.rideId) {
      await tx.ride.update({
        where: { id: pendingPayment.rideId },
        data: { status: RideStatus.SEARCHING }
      });
    }

    return {
      success: true,
      rideId: pendingPayment.rideId,
      transactionId: updatedPayment.id,
      amount: parsed.amount,
      passengerPhone: parsed.senderPhone
    };
  });
}

/**
 * Gera a String USSD para o Celular Gateway executar (Repasses / Estornos)
 */
export function generateUssdCommand(
  targetPhone: string,
  amount: number,
  provider: PaymentMethod | string
): string {
  const cleanPhone = formatPhoneNumber(targetPhone).replace(/^\+245/, '').replace(/^\+/, '');
  const cleanAmount = Math.round(amount);
  const provStr = (provider || '').toString().toUpperCase();

  if (provStr.includes('ORANGE')) {
    return `*144*1*1*${cleanPhone}*${cleanAmount}*${ADMIN_ORANGE_PIN}#`;
  } else {
    return `*135*1*1*${cleanPhone}*${cleanAmount}*${ADMIN_MTN_PIN}#`;
  }
}

// -----------------------------------------------------------------------------
// 1. TOKENS OAUTH (MANTIDOS PARA REVERSIBILIDADE SE CASO ATIVAREM AS APIS)
// -----------------------------------------------------------------------------

export async function getOrangeAccessToken(): Promise<string> {
  const SAFETY_BUFFER_MS = 5 * 60 * 1000;
  if (tokenCache.orange.token && Date.now() < tokenCache.orange.expiresAt - SAFETY_BUFFER_MS) {
    return tokenCache.orange.token;
  }

  if (tokenPromises.orange) return tokenPromises.orange;

  tokenPromises.orange = (async () => {
    try {
      if (!ORANGE_CLIENT_ID || !ORANGE_CLIENT_SECRET) {
        throw new Error('MISSING_CONFIG: Credenciais Orange Money não configuradas.');
      }

      const authHeader = Buffer.from(`${ORANGE_CLIENT_ID}:${ORANGE_CLIENT_SECRET}`).toString('base64');
      const params = new URLSearchParams();
      params.append('grant_type', 'client_credentials');

      const response = await apiClient.post(`${ORANGE_BASE_URL}/oauth/v3/token`, params.toString(), {
        headers: { 
          Authorization: `Basic ${authHeader}`, 
          'Content-Type': 'application/x-www-form-urlencoded' 
        }
      });

      const token = response.data?.access_token;
      if (!token) throw new Error('INVALID_TOKEN_RESPONSE: Resposta sem access_token.');

      const expiresInSeconds = Number(response.data?.expires_in) || 3600;
      tokenCache.orange = { token, expiresAt: Date.now() + expiresInSeconds * 1000 };
      return tokenCache.orange.token;
    } catch (error: any) {
      console.error('[CRITICAL] Falha ao obter token da Orange Money:', error?.response?.data || error.message);
      throw new Error('PROVIDER_AUTH_FAILED');
    } finally {
      tokenPromises.orange = null;
    }
  })();

  return tokenPromises.orange;
}

export async function getMtnToken(type: 'COLLECTION' | 'DISBURSEMENT'): Promise<string> {
  const cacheKey = type === 'COLLECTION' ? 'mtnCollection' : 'mtnDisbursement';
  const SAFETY_BUFFER_MS = 5 * 60 * 1000;

  if (tokenCache[cacheKey].token && Date.now() < tokenCache[cacheKey].expiresAt - SAFETY_BUFFER_MS) {
    return tokenCache[cacheKey].token;
  }

  if (tokenPromises[cacheKey]) return tokenPromises[cacheKey]!;

  tokenPromises[cacheKey] = (async () => {
    try {
      const apiUser = type === 'COLLECTION' ? process.env.MTN_API_USER : process.env.MTN_DISB_API_USER;
      const apiKey = type === 'COLLECTION' ? process.env.MTN_API_KEY : process.env.MTN_DISB_API_KEY;
      const subKey = type === 'COLLECTION' ? MTN_SUBSCRIPTION_KEY : (process.env.MTN_DISB_SUBSCRIPTION_KEY || MTN_SUBSCRIPTION_KEY);
      const urlPath = type === 'COLLECTION' ? 'collection' : 'disbursement';

      if (!apiUser || !apiKey || !subKey) {
        throw new Error(`MISSING_CONFIG: Credenciais MTN MoMo (${type}) incompletas.`);
      }

      const authHeader = Buffer.from(`${apiUser}:${apiKey}`).toString('base64');
      const response = await apiClient.post(`${MTN_BASE_URL}/${urlPath}/token/`, {}, {
        headers: { 
          Authorization: `Basic ${authHeader}`, 
          'Ocp-Apim-Subscription-Key': subKey 
        },
      });

      const token = response.data?.access_token;
      if (!token) throw new Error(`INVALID_TOKEN_RESPONSE: Resposta sem access_token.`);

      const expiresInSeconds = Number(response.data?.expires_in) || 3600;
      tokenCache[cacheKey] = { token, expiresAt: Date.now() + expiresInSeconds * 1000 };
      return tokenCache[cacheKey].token;
    } catch (error: any) {
      console.error(`[CRITICAL] Falha ao obter token MTN ${type}:`, error?.response?.data || error.message);
      throw new Error('PROVIDER_AUTH_FAILED');
    } finally {
      tokenPromises[cacheKey] = null;
    }
  })();

  return tokenPromises[cacheKey]!;
}

// -----------------------------------------------------------------------------
// 2. SOLICITAÇÃO DE COBRANÇA (CRIA A TRANSACTION NO BANCO)
// -----------------------------------------------------------------------------

export interface ChargeParams {
  passengerId?: string;
  phone: string;
  amount: number;
  provider: PaymentMethod | string;
  rideId?: string;
  transactionId?: string;
  isWalletRecharge?: boolean;
}

export type ChargeResult = {
  success: boolean;
  status?: string;
  paymentTransactionId?: string;
  ussdCommand?: string;
  targetPhone?: string;
  amount?: number;
  provider?: PaymentMethod | string;
  instructions?: string;
  paymentUrl?: string | null;
  providerRef?: string;
  error?: string;
  details?: string;
};

export async function chargePassengerMobileMoney(
  phoneOrParams: string | ChargeParams,
  amount?: number,
  provider?: string
): Promise<ChargeResult> {
  const params: ChargeParams = typeof phoneOrParams === 'object' ? phoneOrParams : {
    passengerId: '',
    phone: String(phoneOrParams || ''),
    amount: amount || 0,
    provider: provider || PaymentMethod.ORANGE_MONEY
  };

  const formattedPhone = formatPhoneNumber(params.phone);
  if (!isValidBissauPhone(formattedPhone)) {
    return { success: false, error: 'INVALID_PHONE', details: 'Número inválido para a Guiné-Bissau (+245).' };
  }

  const cleanAmount = Math.round(Number(params.amount));
  if (isNaN(cleanAmount) || cleanAmount <= 0) {
    return { success: false, error: 'INVALID_AMOUNT', details: 'O valor da cobrança deve ser superior a zero.' };
  }

  const targetProviderStr = (params.provider || PaymentMethod.ORANGE_MONEY).toString().toUpperCase();
  const enumProvider = targetProviderStr.includes('MTN') 
    ? PaymentMethod.MTN_MOMO 
    : PaymentMethod.ORANGE_MONEY;

  if (params.rideId) {
    // 🟢 GARANTIA DE UUID VÁLIDO PARA A CHAVE PRIMÁRIA
    const targetTxId = params.transactionId && isUuid(params.transactionId)
      ? params.transactionId
      : toDeterministicUuid(`tx-${params.rideId}`);

    const paymentTx = await prisma.transaction.upsert({
      where: { id: targetTxId },
      create: {
        id: targetTxId,
        rideId: params.rideId,
        paymentMethod: enumProvider,
        type: TransactionType.RIDE_PAYMENT,
        amount: new Prisma.Decimal(cleanAmount),
        status: TransactionStatus.PENDING,
        passengerPhone: formattedPhone,
        description: `Cobrança Mobile Money passageiro (${formattedPhone})`
      } as any,
      update: {
        paymentMethod: enumProvider,
        amount: new Prisma.Decimal(cleanAmount),
        status: TransactionStatus.PENDING,
        passengerPhone: formattedPhone
      } as any
    });

    const destNumber = enumProvider === PaymentMethod.ORANGE_MONEY ? ADMIN_ORANGE_PHONE : ADMIN_MTN_PHONE;
    const ussdString = generateUssdCommand(destNumber, cleanAmount, enumProvider);

    return {
      success: true,
      status: 'PENDING_SMS',
      paymentTransactionId: paymentTx.id,
      ussdCommand: ussdString,
      targetPhone: destNumber,
      amount: cleanAmount,
      provider: enumProvider,
      instructions: `Por favor, faça a transferência de ${cleanAmount} XOF para o número ${destNumber} via ${enumProvider}.`,
      paymentUrl: null,
      providerRef: ussdString
    };
  }

  return { success: false, error: 'MISSING_RIDE_ID', details: 'É necessário informar o ID da corrida.' };
}

// -----------------------------------------------------------------------------
// 3. RECONCILIAÇÃO E VERIFICAÇÃO DE STATUS DA TRANSAÇÃO
// -----------------------------------------------------------------------------

export async function verifyTransactionStatus(transactionId: string): Promise<{ 
  status: 'SUCCESS' | 'FAILED' | 'PENDING'; 
  ref?: string; 
}> {
  const paymentTx = await prisma.transaction.findFirst({
    where: {
      OR: [
        { id: isUuid(transactionId) ? transactionId : undefined },
        { rideId: isUuid(transactionId) ? transactionId : undefined },
        { reference: transactionId }
      ]
    }
  });

  if (!paymentTx) return { status: 'PENDING' };

  if (paymentTx.status === TransactionStatus.COMPLETED || paymentTx.status === TransactionStatus.HELD_IN_ESCROW) {
    return { status: 'SUCCESS', ref: paymentTx.reference || paymentTx.id };
  }

  if (paymentTx.status === TransactionStatus.FAILED) {
    return { status: 'FAILED' };
  }

  return { status: 'PENDING' };
}

// -----------------------------------------------------------------------------
// 4. DESEMBOLSO E ESTRUTURAS DE REPASSE AO MOTORISTA / ESTORNO
// -----------------------------------------------------------------------------

export interface DisbursementParams {
  rideId?: string;
  driverId?: string;
  passengerId?: string;
  payoutId?: string;
  refundId?: string;
  amount: number;
  phone: string;
  provider: PaymentMethod | string;
  transactionId?: string;
}

export async function executeRideDisbursement(params: DisbursementParams): Promise<{
  success: boolean;
  providerRef?: string;
  ussdCommand?: string;
  error?: string;
  details?: string;
}> {
  const { amount, phone, provider, rideId } = params;
  const cleanPhone = formatPhoneNumber(phone);
  const cleanAmount = Math.round(Number(amount));

  if (!isValidBissauPhone(cleanPhone)) {
    return { success: false, error: 'INVALID_PHONE', details: 'Número de telefone Bissau inválido (+245).' };
  }

  const providerEnum = (provider || '').toString().toUpperCase().includes('MTN')
    ? PaymentMethod.MTN_MOMO
    : PaymentMethod.ORANGE_MONEY;

  const ussdCommand = generateUssdCommand(cleanPhone, cleanAmount, providerEnum);

  if (rideId) {
    await prisma.transaction.updateMany({
      where: { rideId },
      data: { status: TransactionStatus.PROCESSING }
    }).catch(() => null);
  }

  return { 
    success: true, 
    providerRef: `USSD-QUEUED-${Date.now()}`, 
    ussdCommand,
    details: `Instrução USSD gerada para o Celular Gateway: ${ussdCommand}` 
  };
}

export async function payoutToDriverMobileMoney(params: DisbursementParams) {
  return await executeRideDisbursement(params);
}

export async function refundPassengerMobileMoney(params: DisbursementParams) {
  return await executeRideDisbursement(params);
}

export async function refundPassengerOnCancellation(
  rideIdOrParams: string | DisbursementParams,
  _reason?: string
): Promise<{ success: boolean; providerRef?: string; ussdCommand?: string; error?: string; details?: string }> {
  if (typeof rideIdOrParams === 'string') {
    const ride = await prisma.ride.findUnique({
      where: { id: rideIdOrParams },
      include: { passenger: true }
    });
    
    if (!ride || !ride.passenger) {
      return { success: false, error: 'RIDE_NOT_FOUND', details: 'Corrida ou passageiro não localizado.' };
    }

    return await executeRideDisbursement({
      rideId: ride.id,
      passengerId: ride.passengerId,
      amount: Number(ride.priceXof || 0),
      phone: ride.passenger.phone,
      provider: ride.paymentMethod || PaymentMethod.ORANGE_MONEY
    });
  }
  return await executeRideDisbursement(rideIdOrParams);
}

// -----------------------------------------------------------------------------
// 5. PROCESSAMENTO DE CONFIRMAÇÃO DE WEBHOOK (GENÉRICO & RETROCOMPATÍVEL)
// -----------------------------------------------------------------------------

export async function processWebhookConfirmation(
  transactionId: string, 
  status: 'SUCCESS' | 'FAILED', 
  providerRef: string, 
  rawPayload: any,
  providerName: string = 'ORANGE_MONEY'
) {
  return await prisma.$transaction(async (tx) => {
    const existingWebhook = await (tx as any).webhookEvent?.findUnique({
      where: { eventId: providerRef }
    }).catch(() => null);

    if (existingWebhook) {
      return { alreadyProcessed: true, duplicated: true };
    }

    try {
      if ((tx as any).webhookEvent) {
        await (tx as any).webhookEvent.create({
          data: {
            eventId: providerRef,
            provider: providerName,
            payload: rawPayload,
            isProcessed: true
          }
        });
      }
    } catch (err: any) {
      if (err.code === 'P2002') return { alreadyProcessed: true, duplicated: true };
    }

    const paymentTx = await tx.transaction.findFirst({
      where: {
        OR: [
          { id: isUuid(transactionId) ? transactionId : undefined },
          { rideId: isUuid(transactionId) ? transactionId : undefined },
          { reference: transactionId }
        ]
      }
    });

    if (!paymentTx) {
      return { success: false, reason: 'TRANSACTION_NOT_FOUND' };
    }

    if (status === 'FAILED') {
      await tx.transaction.update({
        where: { id: paymentTx.id },
        data: { status: TransactionStatus.FAILED }
      });
      return { success: false, status: 'FAILED' };
    }

    await tx.transaction.update({
      where: { id: paymentTx.id },
      data: { status: TransactionStatus.HELD_IN_ESCROW, reference: providerRef }
    });

    if (paymentTx.rideId) {
      await tx.ride.update({
        where: { id: paymentTx.rideId },
        data: { status: RideStatus.SEARCHING }
      });
    }

    return { 
      success: true, 
      status: 'CONFIRMED', 
      rideId: paymentTx.rideId,
      transactionId: paymentTx.id
    };
  });
}