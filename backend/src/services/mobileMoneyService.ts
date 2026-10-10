import axios, { AxiosError } from 'axios';
import crypto from 'crypto';
import { 
  PaymentMethod, 
  MobileMoneyProvider, 
  PaymentIntentStatus, 
  TransactionType, 
  TransactionStatus,
  RideStatus
} from '@prisma/client';
import { prisma } from '../lib/prisma';

// Configurações de ambiente com fallbacks seguros
const MTN_BASE_URL = process.env.MTN_MOMO_BASE_URL || 'https://sandbox.momodeveloper.mtn.com';
const MTN_SUBSCRIPTION_KEY = process.env.MTN_MOMO_SUBSCRIPTION_KEY || '';
const MTN_TARGET_ENV = process.env.MTN_MOMO_TARGET_ENV || 'sandbox';

const ORANGE_BASE_URL = process.env.ORANGE_MONEY_API_URL || 'https://api.orange.com';
const ORANGE_CLIENT_ID = process.env.ORANGE_MONEY_CLIENT_ID || '';
const ORANGE_CLIENT_SECRET = process.env.ORANGE_MONEY_CLIENT_SECRET || '';
const ORANGE_MERCHANT_KEY = process.env.ORANGE_MONEY_MERCHANT_KEY || '';

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

/**
 * Formata o número de telefone para o padrão internacional E.164 da Guiné-Bissau (+245)
 */
export function formatPhoneNumber(phone: string): string {
  if (!phone) return '';
  let cleanPhone = phone.replace(/\D/g, '');
  if (!cleanPhone) return '';

  // Remove duplicações do código do país 245 (ex: 245245955219149 -> 245955219149)
  while (cleanPhone.startsWith('245245')) {
    cleanPhone = cleanPhone.substring(3);
  }

  if (cleanPhone.startsWith('245')) return `+${cleanPhone}`;
  return `+245${cleanPhone}`;
}

/**
 * Valida se o número pertence às operadoras da Guiné-Bissau (5, 6, 7, 9)
 */
export function isValidBissauPhone(phone: string): boolean {
  const formatted = formatPhoneNumber(phone).replace(/^\+/, '');
  return /^245[5679]\d{6,8}$/.test(formatted);
}

/**
 * Converte qualquer referência em UUID v4 determinístico para headers da API MTN MoMo
 */
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
// 1. GERENCIAMENTO MUTEX E CACHE DE TOKENS OAUTH
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
      if (!token) {
        throw new Error('INVALID_TOKEN_RESPONSE: Resposta da Orange não contém access_token.');
      }

      const expiresInSeconds = Number(response.data?.expires_in) || 3600;
      tokenCache.orange = { 
        token, 
        expiresAt: Date.now() + expiresInSeconds * 1000 
      };
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
        throw new Error(`MISSING_CONFIG: Credenciais do MTN MoMo (${type}) incompletas.`);
      }

      const authHeader = Buffer.from(`${apiUser}:${apiKey}`).toString('base64');
      const response = await apiClient.post(`${MTN_BASE_URL}/${urlPath}/token/`, {}, {
        headers: { 
          Authorization: `Basic ${authHeader}`, 
          'Ocp-Apim-Subscription-Key': subKey 
        },
      });

      const token = response.data?.access_token;
      if (!token) {
        throw new Error(`INVALID_TOKEN_RESPONSE: Resposta do MTN (${type}) não contém access_token.`);
      }

      const expiresInSeconds = Number(response.data?.expires_in) || 3600;
      tokenCache[cacheKey] = { 
        token, 
        expiresAt: Date.now() + expiresInSeconds * 1000 
      };
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
// 2. COBRANÇA DO PASSAGEIRO (PUSH PAY / WEB PAYMENT)
// -----------------------------------------------------------------------------

export interface ChargeParams {
  passengerId?: string;
  phone: string;
  amount: number;
  provider: PaymentMethod | MobileMoneyProvider | string;
  rideId?: string;
  transactionId?: string;
  isWalletRecharge?: boolean;
}

export async function chargePassengerMobileMoney(
  phoneOrParams: string | ChargeParams,
  amount?: number,
  provider?: string
) {
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

  let cleanMsisdn = formattedPhone.replace(/^\+/, '');
  while (cleanMsisdn.startsWith('245245')) {
    cleanMsisdn = cleanMsisdn.substring(3);
  }

  const cleanAmount = Math.round(Number(params.amount));
  if (isNaN(cleanAmount) || cleanAmount <= 0) {
    return { success: false, error: 'INVALID_AMOUNT', details: 'O valor da cobrança deve ser superior a zero.' };
  }

  const targetProviderStr = (params.provider || PaymentMethod.ORANGE_MONEY).toString().toUpperCase();
  const rawTransactionId = params.transactionId || `TX-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const mtnReferenceId = toDeterministicUuid(rawTransactionId);

  const enumProvider = targetProviderStr.includes('MTN') 
    ? MobileMoneyProvider.MTN_MOMO 
    : MobileMoneyProvider.ORANGE_MONEY;

  let passengerId = params.passengerId;
  if (!passengerId && params.rideId) {
    const ride = await prisma.ride.findUnique({
      where: { id: params.rideId },
      select: { passengerId: true }
    });
    if (ride) passengerId = ride.passengerId;
  }

  let createdIntentId: string | null = null;

  if (passengerId) {
    const createdIntent = await prisma.paymentIntent.create({
      data: {
        passengerId,
        rideId: params.rideId || null,
        transactionId: isUuid(params.transactionId) ? params.transactionId : null,
        provider: enumProvider,
        phone: formattedPhone,
        amount: cleanAmount,
        reference: rawTransactionId,
        status: PaymentIntentStatus.PENDING
      }
    });
    createdIntentId = createdIntent.id;
  }

  try {
    if (enumProvider === MobileMoneyProvider.ORANGE_MONEY) {
      const accessToken = await getOrangeAccessToken();

      const payload = {
        merchant_key: ORANGE_MERCHANT_KEY,
        currency: 'XOF',
        order_id: rawTransactionId,
        amount: cleanAmount,
        reference: params.isWalletRecharge ? `RECHARGE-${rawTransactionId.substring(0, 8)}` : `RIDE-${(params.rideId || rawTransactionId).substring(0, 8)}`,
        subscriber_msisdn: cleanMsisdn,
      };

      console.log('🍊 [REQUISICAO ORANGE WEBPAY]:', JSON.stringify({
        url: `${ORANGE_BASE_URL}/orange-money-webpay/bissau/v1/webpayment`,
        payload
      }));

      const response = await apiClient.post(`${ORANGE_BASE_URL}/orange-money-webpay/bissau/v1/webpayment`, payload, { 
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } 
      });

      console.log('✅ [RESPOSTA ORANGE WEBPAY]:', response.data);

      return { 
        success: true, 
        providerRef: response.data?.notif_token || rawTransactionId, 
        paymentUrl: response.data?.payment_url, 
        status: 'PENDING_WEBHOOK' 
      };
    }

    if (enumProvider === MobileMoneyProvider.MTN_MOMO) {
      const token = await getMtnToken('COLLECTION');

      const payload = {
        amount: cleanAmount.toString(),
        currency: 'XOF',
        externalId: rawTransactionId,
        payer: { partyIdType: 'MSISDN', partyId: cleanMsisdn },
        payerMessage: 'Pagamento BAI 245',
        payeeNote: params.isWalletRecharge ? 'Recarga de Carteira' : `Corrida: ${params.rideId || 'N/A'}`,
      };

      console.log('🟡 [REQUISICAO MTN MOMO]:', JSON.stringify(payload));

      await apiClient.post(`${MTN_BASE_URL}/collection/v1_0/requesttopay`, payload, { 
        headers: { 
          Authorization: `Bearer ${token}`, 
          'X-Reference-Id': mtnReferenceId, 
          'X-Target-Environment': MTN_TARGET_ENV, 
          'Ocp-Apim-Subscription-Key': MTN_SUBSCRIPTION_KEY 
        } 
      });

      console.log('✅ [RESPOSTA MTN MOMO]: Solicitação enviada com sucesso');

      return { success: true, providerRef: mtnReferenceId, status: 'PENDING_WEBHOOK' };
    }
  } catch (error: any) {
    const isAxios = axios.isAxiosError(error);
    const errObj = error as AxiosError;
    const isTimeout = isAxios && (!errObj.response || errObj.code === 'ECONNABORTED');

    console.error('❌ [ERRO GATEWAY ORANGE/MTN]:', {
      message: error.message,
      responseData: isAxios ? errObj.response?.data : null,
      status: isAxios ? errObj.response?.status : null
    });

    if (!isTimeout && createdIntentId) {
      await prisma.paymentIntent.update({
        where: { id: createdIntentId },
        data: { 
          status: PaymentIntentStatus.FAILED, 
          failureReason: isAxios ? JSON.stringify(errObj.response?.data || errObj.message) : error.message 
        }
      }).catch(() => null);
    }

    return { 
      success: false, 
      error: isTimeout ? 'TIMEOUT_REQUIRES_POLLING' : 'PROVIDER_REJECTED', 
      details: isTimeout 
        ? 'A rede da operadora demorou a responder. Aguardando confirmação assíncrona.' 
        : (isAxios ? (errObj.response?.data as any)?.message || errObj.message : error.message)
    };
  }

  return { success: false, error: 'UNKNOWN_PROVIDER', details: 'Provedor de pagamento desconhecido.' };
}

// -----------------------------------------------------------------------------
// 3. MOTOR DE ESCROW (CONTA CAUÇÃO DA PLATAFORMA)
// -----------------------------------------------------------------------------

export async function lockFundsInEscrow(passengerId: string, amount: number, rideId: string, transactionId: string) {
  return await prisma.$transaction(async (tx) => {
    const result = await tx.passenger.updateMany({
      where: { 
        id: passengerId,
        walletBalance: { gte: amount }
      },
      data: {
        walletBalance: { decrement: amount },
        lockedBalance: { increment: amount },
        version: { increment: 1 }
      }
    });

    if (result.count === 0) {
      throw new Error('INSUFFICIENT_FUNDS: Saldo insuficiente ou transação concorrente em andamento.');
    }

    const updatedPassenger = await tx.passenger.findUnique({ where: { id: passengerId } });

    await tx.transaction.update({
      where: { id: transactionId },
      data: { status: TransactionStatus.HELD_IN_ESCROW, balanceAfter: updatedPassenger!.walletBalance }
    });

    return updatedPassenger;
  });
}

export async function releaseFundsAndPayout(rideId: string, totalAmount: number, platformFee: number, driverEarnings: number) {
  return await prisma.$transaction(async (tx) => {
    const heldTransaction = await tx.transaction.findFirst({
      where: { rideId, status: TransactionStatus.HELD_IN_ESCROW }
    });

    if (!heldTransaction) {
      throw new Error('NO_HELD_ESCROW_FOUND: Nenhum pagamento retido ou pendente encontrado para esta corrida.');
    }

    const ride = await tx.ride.findUnique({ where: { id: rideId }, include: { driver: true } });
    if (!ride || !ride.driverId) {
      throw new Error('INVALID_RIDE_DATA: Dados da corrida ou motorista não encontrados.');
    }

    await tx.transaction.update({
      where: { id: heldTransaction.id },
      data: { status: TransactionStatus.COMPLETED }
    });

    await tx.companyWallet.upsert({
      where: { id: 'bai245-main-wallet' },
      update: { balance: { increment: platformFee }, totalCollected: { increment: totalAmount }, version: { increment: 1 } },
      create: { id: 'bai245-main-wallet', balance: platformFee, totalCollected: totalAmount, version: 1 }
    });

    const payoutTx = await tx.transaction.create({
      data: {
        rideId,
        driverId: ride.driverId,
        type: TransactionType.DRIVER_PAYOUT,
        amount: driverEarnings,
        status: TransactionStatus.PENDING,
        reference: `EARN-${rideId.slice(0, 8)}-${Date.now()}`,
      }
    });

    return { success: true, payoutId: payoutTx.id };
  });
}

// -----------------------------------------------------------------------------
// 4. VERIFICAÇÃO ATIVA DE STATUS (POLLING / RECONCILIAÇÃO)
// -----------------------------------------------------------------------------

export async function verifyTransactionStatus(transactionId: string): Promise<{ 
  status: 'SUCCESS' | 'FAILED' | 'PENDING'; 
  ref?: string; 
}> {
  if (IS_MOCK_MODE || transactionId.startsWith('MOCK-')) {
    if (IS_PRODUCTION) {
      throw new Error('FATAL_SECURITY_ERROR: Modo MOCK ativado indevidamente em ambiente de PRODUÇÃO!');
    }
    return { status: 'SUCCESS', ref: `MOCK-CONFIRMED-${transactionId}` };
  }

  const transaction = await prisma.transaction.findFirst({
    where: {
      OR: [
        { id: isUuid(transactionId) ? transactionId : undefined },
        { reference: transactionId },
        { externalRef: transactionId }
      ]
    }
  });

  if (!transaction) throw new Error('NOT_FOUND: Transação não localizada no banco de dados.');

  const provider = (transaction.paymentMethod || 'ORANGE_MONEY').toString().toUpperCase();

  try {
    if (provider.includes('ORANGE')) {
      const accessToken = await getOrangeAccessToken();
      const response = await apiClient.post(`${ORANGE_BASE_URL}/orange-money-webpay/bissau/v1/transactionstatus`, 
        { 
          order_id: transaction.reference || transactionId, 
          amount: Math.round(Number(transaction.amount)), 
          merchant_key: ORANGE_MERCHANT_KEY 
        },
        { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
      );
      
      const status = (response.data?.status || response.data?.txstat || '').toString().toUpperCase();
      if (['SUCCESS', 'COMPLETED', 'SUCCESSFUL'].includes(status)) {
        return { status: 'SUCCESS', ref: response.data?.txnid || transactionId };
      }
      if (['FAILED', 'CANCELLED', 'EXPIRED', 'REFUSED'].includes(status)) {
        return { status: 'FAILED' };
      }
      return { status: 'PENDING' };
    }

    if (provider.includes('MTN')) {
      const token = await getMtnToken('COLLECTION');
      const mtnLookupId = toDeterministicUuid(transaction.reference || transactionId);

      const response = await apiClient.get(`${MTN_BASE_URL}/collection/v1_0/requesttopay/${mtnLookupId}`, 
        { 
          headers: { 
            Authorization: `Bearer ${token}`, 
            'X-Target-Environment': MTN_TARGET_ENV, 
            'Ocp-Apim-Subscription-Key': MTN_SUBSCRIPTION_KEY 
          } 
        }
      );

      const status = (response.data?.status || '').toString().toUpperCase();
      if (status === 'SUCCESSFUL') return { status: 'SUCCESS', ref: response.data?.financialTransactionId };
      if (['FAILED', 'REJECTED', 'EXPIRED'].includes(status)) return { status: 'FAILED' };
      return { status: 'PENDING' };
    }

    throw new Error(`UNSUPPORTED_PROVIDER: Provedor ${provider} não reconhecido.`);
  } catch (error: any) {
    return { status: 'PENDING' };
  }
}

// -----------------------------------------------------------------------------
// 5. MOTOR DE DESEMBOLSO / B2C TRANSFER (PAYOUT & REFUND)
// -----------------------------------------------------------------------------

export interface DisbursementParams {
  rideId?: string;
  driverId?: string;
  passengerId?: string;
  payoutId?: string;
  refundId?: string;
  amount: number;
  phone: string;
  provider: PaymentMethod | MobileMoneyProvider | string;
  transactionId?: string;
}

export async function executeRideDisbursement(params: DisbursementParams): Promise<{
  success: boolean;
  providerRef?: string;
  error?: string;
  details?: string;
}> {
  const { amount, phone, provider, rideId } = params;
  const transactionId = params.transactionId || params.payoutId || params.refundId;
  const cleanPhone = formatPhoneNumber(phone).replace(/^\+/, '');
  const cleanAmount = Math.round(Number(amount));

  if (!isValidBissauPhone(phone)) {
    return { success: false, error: 'INVALID_PHONE', details: 'Número de telefone Bissau inválido (+245).' };
  }

  if (IS_MOCK_MODE) {
    return { success: true, providerRef: `MOCK-DISB-${Date.now()}`, details: 'Transferência Mock concluída.' };
  }

  const providerStr = (provider || '').toString().toUpperCase();
  const ref = transactionId || `DISB-${rideId ? rideId.slice(0, 8) : Date.now()}`;

  try {
    if (providerStr.includes('ORANGE')) {
      const token = await getOrangeAccessToken();
      const response = await apiClient.post(`${ORANGE_BASE_URL}/orange-money-webpay/bissau/v1/transfer`, {
        recipient_msisdn: cleanPhone,
        amount: cleanAmount,
        reference: ref,
        merchant_key: ORANGE_MERCHANT_KEY,
      }, { 
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } 
      });

      const isSuccess = response.data?.status === 'SUCCESS' || !!response.data?.txnid;
      if (!isSuccess) {
        return { success: false, error: 'PROVIDER_REJECTED', details: response.data?.message || 'Transferência recusada pela Orange.' };
      }

      return { 
        success: true, 
        providerRef: response.data?.txnid || ref 
      };
    }

    if (providerStr.includes('MTN')) {
      const token = await getMtnToken('DISBURSEMENT');
      const mtnRefUuid = toDeterministicUuid(ref);

      await apiClient.post(`${MTN_BASE_URL}/disbursement/v1_0/deposit`, {
        amount: cleanAmount.toString(),
        currency: 'XOF',
        externalId: ref,
        payee: { partyIdType: 'MSISDN', partyId: cleanPhone },
        payerMessage: 'Pagamento BAI 245',
        payeeNote: `Repasse BAI 245 (${rideId || 'Geral'})`
      }, {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Reference-Id': mtnRefUuid,
          'X-Target-Environment': MTN_TARGET_ENV,
          'Ocp-Apim-Subscription-Key': process.env.MTN_DISB_SUBSCRIPTION_KEY || MTN_SUBSCRIPTION_KEY
        }
      });

      return { success: true, providerRef: mtnRefUuid };
    }

    throw new Error(`UNSUPPORTED_PROVIDER: Provedor ${provider} não suportado para repasses.`);
  } catch (error: any) {
    const isAxios = axios.isAxiosError(error);
    const isTimeout = isAxios && (!error.response || error.code === 'ECONNABORTED');

    if (isTimeout) {
      return {
        success: false,
        error: 'TIMEOUT_REQUIRES_RECONCILIATION',
        details: 'Timeout na chamada da operadora. Reconciliação passiva agendada.'
      };
    }

    const details = isAxios ? JSON.stringify(error.response?.data || error.message) : error.message;
    return { success: false, error: 'DISBURSEMENT_FAILED', details };
  }
}

export async function verifyMobileMoneyAccount(phone: string, provider: PaymentMethod | string): Promise<{ active: boolean; error?: string }> {
  const formatted = formatPhoneNumber(phone);
  if (!isValidBissauPhone(formatted)) {
    return { active: false, error: 'Número de telefone inválido para a Guiné-Bissau (+245).' };
  }
  return { active: true };
}

export async function payoutToDriverMobileMoney(params: DisbursementParams) {
  return await executeRideDisbursement(params);
}

export async function refundPassengerMobileMoney(params: DisbursementParams) {
  return await executeRideDisbursement(params);
}

// -----------------------------------------------------------------------------
// 6. PROCESSAMENTO ATÔMICO DE CONFIRMAÇÃO DE WEBHOOK
// -----------------------------------------------------------------------------

export async function processWebhookConfirmation(
  transactionId: string, 
  status: 'SUCCESS' | 'FAILED', 
  providerRef: string, 
  rawPayload: any,
  providerName: string = 'ORANGE_MONEY'
) {
  return await prisma.$transaction(async (tx) => {
    const existingWebhook = await tx.webhookEvent.findUnique({
      where: { eventId: providerRef }
    });

    if (existingWebhook) {
      console.log(`[WEBHOOK] Notificação já processada anteriormente (eventId: ${providerRef}). Ignorando.`);
      return { alreadyProcessed: true, duplicated: true };
    }

    try {
      await tx.webhookEvent.create({
        data: {
          eventId: providerRef,
          provider: providerName,
          payload: rawPayload,
          isProcessed: true
        }
      });
    } catch (err: any) {
      if (err.code === 'P2002') {
        return { alreadyProcessed: true, duplicated: true };
      }
      throw err;
    }

    const intent = await tx.paymentIntent.findFirst({
      where: {
        OR: [
          { reference: transactionId },
          { id: isUuid(transactionId) ? transactionId : undefined }
        ]
      },
    });

    if (!intent) {
      throw new Error(`INTENT_NOT_FOUND: Intenção de pagamento ${transactionId} não encontrada.`);
    }

    if (intent.status === PaymentIntentStatus.SUCCESS) {
      return { alreadyProcessed: true, rideId: intent.rideId };
    }

    if (status === 'FAILED') {
      await tx.paymentIntent.update({
        where: { id: intent.id },
        data: { 
          status: PaymentIntentStatus.FAILED, 
          failureReason: 'Recusado pelo usuário ou saldo insuficiente',
          rawResponse: rawPayload 
        }
      });

      if (intent.rideId) {
        await tx.ride.update({
          where: { id: intent.rideId },
          data: { status: RideStatus.CANCELLED, cancellationReason: 'Pagamento recusado pela operadora' }
        }).catch(() => null);
      }

      return { success: false, status: 'FAILED' };
    }

    await tx.paymentIntent.update({
      where: { id: intent.id },
      data: { 
        status: PaymentIntentStatus.SUCCESS, 
        rawResponse: rawPayload 
      }
    });

    const existingTx = await tx.transaction.findFirst({
      where: {
        OR: [
          { reference: transactionId },
          { externalRef: providerRef },
          { id: isUuid(transactionId) ? transactionId : undefined }
        ]
      }
    });

    if (existingTx) {
      const updatedTx = await tx.transaction.update({
        where: { id: existingTx.id },
        data: {
          status: TransactionStatus.HELD_IN_ESCROW,
          externalRef: providerRef,
          updatedAt: new Date()
        }
      });

      if (intent.rideId) {
        await tx.ride.update({
          where: { id: intent.rideId },
          data: { status: RideStatus.SEARCHING }
        }).catch(() => null);
      }

      return { 
        success: true, 
        status: 'HELD', 
        passengerId: intent.passengerId, 
        rideId: intent.rideId,
        transactionId: updatedTx.id,
        alreadyProcessed: false
      };
    }

    const transaction = await tx.transaction.create({
      data: {
        rideId: intent.rideId,
        passengerId: intent.passengerId,
        type: TransactionType.RIDE_PAYMENT,
        status: TransactionStatus.HELD_IN_ESCROW,
        amount: intent.amount,
        reference: transactionId,
        externalRef: providerRef,
        paymentMethod: intent.provider
      }
    });

    if (intent.rideId) {
      await tx.ride.update({
        where: { id: intent.rideId },
        data: { status: RideStatus.SEARCHING }
      }).catch(() => null);
    }

    return { 
      success: true, 
      status: 'HELD', 
      passengerId: intent.passengerId, 
      rideId: intent.rideId,
      transactionId: transaction.id
    };
  });
}