import axios from 'axios';

const TERMII_API_KEY = (process.env.TERMII_API_KEY || '').trim();
const TERMII_SENDER_ID = (process.env.TERMII_SENDER_ID || 'N-Alert').trim();
const TERMII_CHANNEL = (process.env.TERMII_CHANNEL || 'generic').trim();
const TERMII_BASE_URL = (process.env.TERMII_BASE_URL || 'https://v3.api.termii.com').trim().replace(/\/+$/, '');

function normalizeTermiiPhone(phone: string): string {
  let cleanPhone = String(phone || '').replace(/\D/g, '');
  cleanPhone = cleanPhone.replace(/^0+/, '');
  if (cleanPhone.length === 9) {
    cleanPhone = `245${cleanPhone}`;
  }
  return cleanPhone;
}

async function dispatchTermiiRequest(to: string, from: string, sms: string): Promise<{ ok: boolean; data?: any; error?: any }> {
  const payload = {
    to,
    from,
    sms,
    type: 'plain',
    channel: TERMII_CHANNEL,
    api_key: TERMII_API_KEY,
  };

  try {
    const response = await axios.post(`${TERMII_BASE_URL}/api/sms/send`, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 12000,
    });

    const data = response.data || {};
    const accepted =
      data.code === 'ok' ||
      Boolean(data.message_id) ||
      Boolean(data.messageId) ||
      (response.status === 200 && !data.error && data.status !== 'error');

    if (accepted) {
      return { ok: true, data };
    }
    return { ok: false, data };
  } catch (err: any) {
    return { ok: false, error: err?.response?.data || err?.message || err };
  }
}

/**
 * Envia um SMS com o código OTP usando a API da Termii (Rota Guiné-Bissau +245),
 * com fallback automático para 'N-Alert' caso o Sender ID customizado ainda não esteja aprovado.
 */
export async function sendSmsOtp(
  phone: string,
  code: string,
  purpose: 'REGISTER' | 'RESET_PASSWORD' = 'REGISTER'
): Promise<boolean> {
  if (!TERMII_API_KEY) {
    console.error('❌ [SMS Termii] TERMII_API_KEY não configurada no .env!');
    return false;
  }

  const cleanPhone = normalizeTermiiPhone(phone);
  if (!cleanPhone || cleanPhone.length < 11) {
    console.error(`❌ [SMS Termii] Número inválido para envio: "${phone}" -> "${cleanPhone}"`);
    return false;
  }

  const smsText =
    purpose === 'RESET_PASSWORD'
      ? `No Bai 245: Seu codigo para redefinir a senha e ${code}. Valido por 10 minutos. Nao compartilhe.`
      : `No Bai 245: Seu codigo de verificacao e ${code}. Valido por 10 minutos. Nao compartilhe.`;

  console.log(`📡 [SMS Termii] Enviando OTP (${purpose}) para +${cleanPhone} (Sender: '${TERMII_SENDER_ID}', Canal: '${TERMII_CHANNEL}')...`);

  const primaryAttempt = await dispatchTermiiRequest(cleanPhone, TERMII_SENDER_ID, smsText);
  if (primaryAttempt.ok) {
    console.log(`✅ [SMS Termii] OTP enviado com sucesso para +${cleanPhone}:`, primaryAttempt.data);
    return true;
  }

  const rawErrMsg = JSON.stringify(primaryAttempt.error || primaryAttempt.data || '').toLowerCase();
  console.warn(`⚠️ [SMS Termii] Falha com Sender '${TERMII_SENDER_ID}':`, primaryAttempt.error || primaryAttempt.data);

  // Fallback automático para 'N-Alert' se o Sender ID customizado não estiver aprovado pela operadora
  if (TERMII_SENDER_ID !== 'N-Alert' && (rawErrMsg.includes('sender') || rawErrMsg.includes('from') || rawErrMsg.includes('not approved') || rawErrMsg.includes('invalid'))) {
    console.log(`🔄 [SMS Termii] Tentando fallback com Sender 'N-Alert' para +${cleanPhone}...`);
    const fallbackAttempt = await dispatchTermiiRequest(cleanPhone, 'N-Alert', smsText);
    if (fallbackAttempt.ok) {
      console.log(`✅ [SMS Termii] OTP enviado via fallback 'N-Alert' para +${cleanPhone}:`, fallbackAttempt.data);
      return true;
    }
    console.error('❌ [SMS Termii] Falha também no fallback N-Alert:', fallbackAttempt.error || fallbackAttempt.data);
  }

  return false;
}
