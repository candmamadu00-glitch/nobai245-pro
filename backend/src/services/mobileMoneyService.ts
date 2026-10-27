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
// 1. CACHE E GERENCIAMENTO DE TOKENS OAUTH
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
        console.error('❌ [CONFIG ERRO ORANGE]: Client ID/Secret vazios.');
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
// 2. COBRANÇA DO PASSAGEIRO (PRÉ-PAGAMENTO AUTOMÁTICO)
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
      const baseDomain = process.env.EXPO_PUBLIC_API_URL || 'https://api.nobai245.com';
      const webhookUrl = process.env.ORANGE_WEBHOOK_URL || `${baseDomain}/api/payments/orange/webhook`;

      const payload = {
        merchant_key: ORANGE_MERCHANT_KEY,
        currency: 'XOF',
        order_id: rawTransactionId,
        amount: cleanAmount,
        reference: `RIDE-${(params.rideId || rawTransactionId).substring(0, 8)}`,
        subscriber_msisdn: cleanMsisdn,
        return_url: `${baseDomain}/api/payments/orange/return`,
        cancel_url: `${baseDomain}/api/payments/orange/cancel`,
        notif_url: webhookUrl
      };

      const response = await apiClient.post(`${ORANGE_BASE_URL}/orange-money-webpay/gw/v1/webpayment`, payload, { 
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } 
      });

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
        payerMessage: 'Pagamento Nô Bai 245',
        payeeNote: `Corrida Nô Bai: ${params.rideId || 'N/A'}`,
      };

      await apiClient.post(`${MTN_BASE_URL}/collection/v1_0/requesttopay`, payload, { 
        headers: { 
          Authorization: `Bearer ${token}`, 
          'X-Reference-Id': mtnReferenceId, 
          'X-Target-Environment': MTN_TARGET_ENV, 
          'Ocp-Apim-Subscription-Key': MTN_SUBSCRIPTION_KEY 
        } 
      });

      return { success: true, providerRef: mtnReferenceId, status: 'PENDING_WEBHOOK' };
    }
  } catch (error: any) {
    const isAxios = axios.isAxiosError(error);
    const errObj = error as AxiosError;

    if (createdIntentId) {
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
      error: 'PROVIDER_REJECTED', 
      details: isAxios ? (errObj.response?.data as any)?.message || errObj.message : error.message
    };
  }

  return { success: false, error: 'UNKNOWN_PROVIDER', details: 'Provedor de pagamento desconhecido.' };
}

// -----------------------------------------------------------------------------
// 3. MOTOR DE DESEMBOLSO / TRANSFERÊNCIA B2C (PAYOUT E REFUND)
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
      const response = await apiClient.post(`${ORANGE_BASE_URL}/orange-money-webpay/gw/v1/transfer`, {
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

      return { success: true, providerRef: response.data?.txnid || ref };
    }

    if (providerStr.includes('MTN')) {
      const token = await getMtnToken('DISBURSEMENT');
      const mtnRefUuid = toDeterministicUuid(ref);

      await apiClient.post(`${MTN_BASE_URL}/disbursement/v1_0/deposit`, {
        amount: cleanAmount.toString(),
        currency: 'XOF',
        externalId: ref,
        payee: { partyIdType: 'MSISDN', partyId: cleanPhone },
        payerMessage: 'Pagamento Nô Bai 245',
        payeeNote: `Repasse Nô Bai 245 (${rideId || 'Geral'})`
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
    const details = isAxios ? JSON.stringify(error.response?.data || error.message) : error.message;
    return { success: false, error: 'DISBURSEMENT_FAILED', details };
  }
}

export async function payoutToDriverMobileMoney(params: DisbursementParams) {
  return await executeRideDisbursement(params);
}

export async function refundPassengerMobileMoney(params: DisbursementParams) {
  return await executeRideDisbursement(params);
}

// -----------------------------------------------------------------------------
// 4. CONCLUSÃO DA CORRIDA, SPLIT E REPASSE INSTANTÂNEO AO MOTORISTA
// -----------------------------------------------------------------------------

export async function releaseFundsAndPayout(rideId: string, totalAmount: number, platformFee: number, driverEarnings: number) {
  return await prisma.$transaction(async (tx) => {
    // 1. Localiza a transação retida em caução (Escrow)
    const heldTransaction = await tx.transaction.findFirst({
      where: { rideId, status: TransactionStatus.HELD_IN_ESCROW }
    });

    if (!heldTransaction) {
      throw new Error('NO_HELD_ESCROW_FOUND: Nenhum pagamento retido em caução para esta corrida.');
    }

    // 2. Busca dados da corrida e do motorista
    const ride = await tx.ride.findUnique({ 
      where: { id: rideId }, 
      include: { driver: true } 
    });

    if (!ride || !ride.driver || !ride.driverId) {
      throw new Error('INVALID_RIDE_DATA: Dados da corrida ou motorista não encontrados.');
    }

    // 3. Atualiza a transação em caução para COMPLETED
    await tx.transaction.update({
      where: { id: heldTransaction.id },
      data: { status: TransactionStatus.COMPLETED }
    });

    // 4. Credita a comissão da empresa na carteira corporativa (CompanyWallet)
    await tx.companyWallet.upsert({
      where: { id: 'bai245-main-wallet' },
      update: { 
        balance: { increment: platformFee }, 
        totalCollected: { increment: totalAmount }, 
        version: { increment: 1 } 
      },
      create: { 
        id: 'bai245-main-wallet', 
        balance: platformFee, 
        totalCollected: totalAmount, 
        version: 1 
      }
    });

    // 5. Registra a transação de Repasse do Motorista
    const payoutTx = await tx.transaction.create({
      data: {
        rideId,
        driverId: ride.driverId,
        type: TransactionType.DRIVER_PAYOUT,
        amount: driverEarnings,
        status: TransactionStatus.PENDING,
        reference: `EARN-${rideId.slice(0, 8)}-${Date.now()}`,
        paymentMethod: heldTransaction.paymentMethod || PaymentMethod.ORANGE_MONEY
      }
    });

    // 6. 🚀 EXECUÇÃO INSTANTÂNEA E AUTOMÁTICA DO REPASSE AO MOTORISTA
    const driverPhone = ride.driver.phone;
    const provider = heldTransaction.paymentMethod || PaymentMethod.ORANGE_MONEY;

    const payoutResult = await payoutToDriverMobileMoney({
      rideId,
      driverId: ride.driverId,
      payoutId: payoutTx.id,
      amount: driverEarnings,
      phone: driverPhone,
      provider
    });

    if (payoutResult.success) {
      await tx.transaction.update({
        where: { id: payoutTx.id },
        data: { 
          status: TransactionStatus.COMPLETED, 
          externalRef: payoutResult.providerRef 
        }
      });
      console.log(`✅ [REPASSE AUTOMÁTICO SUCESSO]: Enviado ${driverEarnings} XOF para o motorista (${driverPhone})`);
    } else {
      console.error(`⚠️ [FALHA NO REPASSE AUTOMÁTICO]: Ficou pendente para tentativa posterior:`, payoutResult.details);
    }

    return { success: true, payoutId: payoutTx.id, instantPayout: payoutResult.success };
  });
}

// -----------------------------------------------------------------------------
// 5. ESTORNO AUTOMÁTICO AO PASSAGEIRO CASO O MOTORISTA CANCELE
// -----------------------------------------------------------------------------

export async function refundPassengerOnCancellation(rideId: string, cancellationReason: string = 'Cancelado pelo motorista') {
  return await prisma.$transaction(async (tx) => {
    const heldTransaction = await tx.transaction.findFirst({
      where: { rideId, status: TransactionStatus.HELD_IN_ESCROW }
    });

    if (!heldTransaction) {
      console.log(`ℹ️ [ESTORNO]: Nenhuma transação caucionada encontrada para cancelar na corrida ${rideId}.`);
      return { success: false, reason: 'NO_HELD_ESCROW' };
    }

    const ride = await tx.ride.findUnique({
      where: { id: rideId },
      include: { passenger: true }
    });

    if (!ride || !ride.passenger) {
      throw new Error('INVALID_RIDE_PASSENGER: Passageiro não localizado para efetuar estorno.');
    }

    // Registra transação de estorno
    const refundTx = await tx.transaction.create({
      data: {
        rideId,
        passengerId: ride.passengerId,
        type: TransactionType.REFUND,
        amount: heldTransaction.amount,
        status: TransactionStatus.PENDING,
        reference: `REFUND-${rideId.slice(0, 8)}-${Date.now()}`,
        paymentMethod: heldTransaction.paymentMethod
      }
    });

    // 🚀 EXECUTA O ENVIAR DO DINHEIRO DE VOLTA PARA O MOBILE MONEY DO PASSAGEIRO
    const refundResult = await refundPassengerMobileMoney({
      rideId,
      passengerId: ride.passengerId,
      refundId: refundTx.id,
      amount: Number(heldTransaction.amount),
      phone: ride.passenger.phone,
      provider: heldTransaction.paymentMethod || PaymentMethod.ORANGE_MONEY
    });

    if (refundResult.success) {
      await tx.transaction.update({
        where: { id: heldTransaction.id },
        data: { status: TransactionStatus.CANCELLED }
      });

      await tx.transaction.update({
        where: { id: refundTx.id },
        data: { status: TransactionStatus.COMPLETED, externalRef: refundResult.providerRef }
      });

      console.log(`💸 [ESTORNO AUTOMÁTICO CONCLUÍDO]: Devolvido ${heldTransaction.amount} XOF para o passageiro (${ride.passenger.phone})`);
      return { success: true, refundId: refundTx.id };
    } else {
      console.error(`❌ [FALHA NO ESTORNO AUTOMÁTICO]:`, refundResult.details);
      return { success: false, error: refundResult.details };
    }
  });
}

// -----------------------------------------------------------------------------
// 6. PROCESSAMENTO DE WEBHOOK E CONFIRMAÇÃO DA ENTRADA DO DINHEIRO
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
      if (err.code === 'P2002') return { alreadyProcessed: true, duplicated: true };
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
      throw new Error(`INTENT_NOT_FOUND: Intenção ${transactionId} não encontrada.`);
    }

    if (intent.status === PaymentIntentStatus.SUCCESS) {
      return { alreadyProcessed: true, rideId: intent.rideId };
    }

    if (status === 'FAILED') {
      await tx.paymentIntent.update({
        where: { id: intent.id },
        data: { status: PaymentIntentStatus.FAILED, failureReason: 'Recusado pelo cliente', rawResponse: rawPayload }
      });

      if (intent.rideId) {
        await tx.ride.update({
          where: { id: intent.rideId },
          data: { status: RideStatus.CANCELLED, cancellationReason: 'Pagamento recusado no Mobile Money' }
        }).catch(() => null);
      }

      return { success: false, status: 'FAILED' };
    }

    await tx.paymentIntent.update({
      where: { id: intent.id },
      data: { status: PaymentIntentStatus.SUCCESS, rawResponse: rawPayload }
    });

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