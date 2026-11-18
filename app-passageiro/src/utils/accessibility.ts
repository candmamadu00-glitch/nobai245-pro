import * as Speech from 'expo-speech';
import { AudioModule } from 'expo-audio';
import { Vibration, Platform } from 'react-native';

/**
 * 🔊 Lê um texto em voz alta através do sintetizador de voz do sistema,
 * garantindo reprodução mesmo se o aparelho estiver em modo silencioso.
 */
export const speakText = async (text: string, stopPrevious: boolean = true) => {
  if (!text || !text.trim()) return;

  try {
    if (typeof (AudioModule as any)?.setAudioModeAsync === 'function') {
      await (AudioModule as any).setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: false,
      });
    }
  } catch {}

  try {
    if (stopPrevious) {
      Speech.stop();
    }

    Speech.speak(text.trim(), {
      language: 'pt-PT',
      pitch: 1.0,
      rate: 0.94,
    });
  } catch (error) {
    console.warn('⚠️ [ACESSIBILIDADE] Erro ao reproduzir áudio:', error);
  }
};

/**
 * 🛑 Interrompe imediatamente qualquer narração em curso
 */
export const stopSpeech = () => {
  try {
    Speech.stop();
  } catch (e) {}
};

/**
 * 📳 Padrões de vibração háptica para feedback tátil discreto e acessível
 */
export const triggerHapticFeedback = (type: 'NEW_OFFER' | 'ARRIVED' | 'FINISHED' | 'CANCELLED' | 'BUTTON_PRESS') => {
  try {
    switch (type) {
      case 'NEW_OFFER':
        Vibration.vibrate([0, 400, 200, 400]);
        break;
      case 'ARRIVED':
        Vibration.vibrate([0, 250, 150, 250, 150, 250]);
        break;
      case 'FINISHED':
        Vibration.vibrate([0, 500]);
        break;
      case 'CANCELLED':
        Vibration.vibrate([0, 150, 100, 150]);
        break;
      case 'BUTTON_PRESS':
        if (Platform.OS === 'android') {
          Vibration.vibrate(40);
        }
        break;
    }
  } catch (e) {}
};

/**
 * 🗣️ Assistente de Voz Profissional da Viagem (Padrão Executivo Nô Bai 245)
 */
export const speakRideStatusUpdate = (
  status: string,
  extraData?: {
    driverName?: string;
    carModel?: string;
    carColor?: string;
    plate?: string;
    price?: number;
    destination?: string;
    origin?: string;
    startOtp?: string;
    paymentMethod?: string;
    enabled?: boolean;
  }
) => {
  if (extraData?.enabled === false) return;

  switch (status) {
    case 'queued':
      speakText(
        `Sua viagem foi confirmada com o motorista ${extraData?.driverName || ''}. Ele está finalizando um desembarque próximo e seguirá para você em instantes.`
      );
      triggerHapticFeedback('NEW_OFFER');
      break;

    case 'accepted': {
      const driverPart = extraData?.driverName ? `pelo motorista ${extraData.driverName}` : '';
      const carPart = extraData?.carModel
        ? `. Veículo ${extraData.carModel} ${extraData?.carColor || ''}`
        : '';
      const platePart = extraData?.plate ? `, matrícula ${extraData.plate}` : '';
      speakText(`Viagem confirmada ${driverPart}${carPart}${platePart}. Acompanhe a chegada no mapa.`);
      triggerHapticFeedback('NEW_OFFER');
      break;
    }

    case 'arrived': {
      const otpNotice = extraData?.startOtp
        ? ` Informe o código de segurança ${extraData.startOtp.split('').join(' ')} ao embarcar.`
        : '';
      speakText(`Seu motorista chegou ao ponto de embarque.${otpNotice}`);
      triggerHapticFeedback('ARRIVED');
      break;
    }

    case 'in_progress': {
      const destNotice = extraData?.destination
        ? ` com destino a ${extraData.destination}`
        : '';
      speakText(
        `Viagem iniciada${destNotice}. Para sua segurança, por favor afivele o cinto de segurança. Tenha uma excelente viagem!`
      );
      triggerHapticFeedback('BUTTON_PRESS');
      break;
    }

    case 'nearing_destination':
      speakText(
        'Estamos nos aproximando do seu destino. Antes de sair do veículo, por favor verifique todos os seus pertences pessoais, como celular, carteira e bolsas.'
      );
      triggerHapticFeedback('BUTTON_PRESS');
      break;

    case 'completed': {
      const priceText = extraData?.price && extraData.price > 0
        ? ` Valor total da viagem: ${Math.round(extraData.price)} francos CFA.`
        : '';
      speakText(`Você chegou ao seu destino.${priceText} Obrigado por viajar com a Nô Bai 245.`);
      triggerHapticFeedback('FINISHED');
      break;
    }

    case 'cancelled':
      speakText('Atenção: A sua viagem foi cancelada.');
      triggerHapticFeedback('CANCELLED');
      break;
  }
};
