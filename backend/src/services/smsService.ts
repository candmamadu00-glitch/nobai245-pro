import axios from 'axios';

const TERMII_API_KEY = process.env.TERMII_API_KEY;
// NOTA: Se "NOBAI245" não estiver aprovado no painel da Termii, use "N-Alert" para garantir entrega internacional
const TERMII_SENDER_ID = process.env.TERMII_SENDER_ID || 'N-Alert';
const TERMII_CHANNEL = process.env.TERMII_CHANNEL || 'generic';
const TERMII_BASE_URL = (process.env.TERMII_BASE_URL || 'https://api.ng.termii.com').replace(/\/$/, '');

/**
 * Envia um SMS com o código OTP usando a API da Termii (Rota Guiné-Bissau +245)
 */
export async function sendSmsOtp(phone: string, code: string): Promise<boolean> {
  try {
    // 1. Limpa tudo que não for número
    let cleanPhone = phone.replace(/\D/g, '');

    // 2. Trata prefixos com zeros (ex: 00245 -> 245)
    cleanPhone = cleanPhone.replace(/^0+/, '');

    // 3. Se tiver 9 dígitos (número local de Guiné-Bissau), insere 245 na frente
    if (cleanPhone.length === 9) {
      cleanPhone = `245${cleanPhone}`;
    }

    const payload = {
      to: cleanPhone,
      from: TERMII_SENDER_ID, 
      sms: `Seu codigo de verificacao No Bai 245 e: ${code}. Valido por 10 minutos. Nao compartilhe com ninguem.`,
      type: 'plain',
      channel: TERMII_CHANNEL, 
      api_key: TERMII_API_KEY,
    };

    console.log(`📡 [SMS Termii] Enviando OTP para +${cleanPhone} (Sender: '${TERMII_SENDER_ID}')...`);

    const response = await axios.post(`${TERMII_BASE_URL}/api/sms/send`, payload, {
      headers: { 'Content-Type': 'application/json' },
    });

    if (response.data && (response.data.code === 'ok' || response.data.message_id || response.status === 200)) {
      console.log(`✅ [SMS Termii] OTP enviado com sucesso para +${cleanPhone}:`, response.data);
      return true;
    }

    console.error('❌ [SMS Termii] Resposta de erro da API Termii:', response.data);
    return false;
  } catch (error: any) {
    console.error('❌ [SMS Termii] Falha crítica ao enviar SMS:', error?.response?.data || error.message);
    return false;
  }
}