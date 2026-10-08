import axios from 'axios';

const TERMII_API_KEY = process.env.TERMII_API_KEY;
const TERMII_SENDER_ID = process.env.TERMII_SENDER_ID || 'BAI245';
const TERMII_BASE_URL = process.env.TERMII_BASE_URL || 'https://api.ng.termii.com';

/**
 * Envia um SMS com o código OTP usando a API do Termii
 * @param phone Número do destinatário no formato internacional (ex: 245955800991)
 * @param code Código de 6 dígitos
 */
export async function sendSmsOtp(phone: string, code: string): Promise<boolean> {
  try {
    // Formata o número (garante que não tem o sinal +)
    const formattedPhone = phone.replace('+', '').trim();

    const payload = {
      to: formattedPhone,
      from: TERMII_SENDER_ID,
      sms: `Seu codigo de recuperacao BAI 245 e: ${code}. Valido por 10 minutos. Nao compartilhe com ninguem.`,
      type: 'plain',
      channel: 'generic', // ou 'dnd'
      api_key: TERMII_API_KEY,
    };

    const response = await axios.post(`${TERMII_BASE_URL}/api/sms/send`, payload);

    if (response.data && (response.data.code === 'ok' || response.data.message_id)) {
      console.log(`[SMS Termii] OTP enviado com sucesso para ${formattedPhone}`);
      return true;
    }

    console.error('[SMS Termii] Erro na resposta da API:', response.data);
    return false;
  } catch (error: any) {
    console.error('[SMS Termii] Falha ao enviar SMS:', error?.response?.data || error.message);
    return false;
  }
}