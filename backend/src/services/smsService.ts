import axios from 'axios';

const TERMII_API_KEY = process.env.TERMII_API_KEY;
const TERMII_SENDER_ID = process.env.TERMII_SENDER_ID || 'NOBAI245';
const TERMII_CHANNEL = process.env.TERMII_CHANNEL || 'generic';
const TERMII_BASE_URL = (process.env.TERMII_BASE_URL || 'https://api.ng.termii.com').replace(/\/$/, '');

/**
 * Envia um SMS com o código OTP usando a API da Termii (Rota Guiné-Bissau)
 * @param phone Número do destinatário (ex: 955800991 ou 245955800991)
 * @param code Código de 6 dígitos
 */
export async function sendSmsOtp(phone: string, code: string): Promise<boolean> {
  try {
    // Limpa caracteres especiais e garante o prefixo 245
    let cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length === 9) {
      cleanPhone = `245${cleanPhone}`;
    }

    const payload = {
      to: cleanPhone,
      from: TERMII_SENDER_ID, // "NOBAI245"
      sms: `Seu codigo de verificacao No Bai 245 e: ${code}. Valido por 10 minutos. Nao compartilhe com ninguem.`,
      type: 'plain',
      channel: TERMII_CHANNEL, // "generic"
      api_key: TERMII_API_KEY,
    };

    console.log(`📡 [SMS Termii] A enviar OTP para +${cleanPhone} via remetente '${TERMII_SENDER_ID}'...`);

    const response = await axios.post(`${TERMII_BASE_URL}/api/sms/send`, payload, {
      headers: { 'Content-Type': 'application/json' },
    });

    if (response.data && (response.data.code === 'ok' || response.data.message_id || response.status === 200)) {
      console.log(`✅ [SMS Termii] OTP enviado com sucesso para +${cleanPhone}:`, response.data);
      return true;
    }

    console.error('❌ [SMS Termii] Erro na resposta da API:', response.data);
    return false;
  } catch (error: any) {
    console.error('❌ [SMS Termii] Falha ao enviar SMS:', error?.response?.data || error.message);
    return false;
  }
}