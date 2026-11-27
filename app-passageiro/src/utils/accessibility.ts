import * as Speech from 'expo-speech';
import { AudioModule } from 'expo-audio';
import { Vibration, Platform } from 'react-native';
import i18n from '../services/i18n';

const resolveSpeechLocale = (langCode?: string): { lang: 'pt' | 'en' | 'fr'; locale: string } => {
  const raw = String(langCode || i18n.language || 'pt').toLowerCase();
  if (raw.startsWith('en')) return { lang: 'en', locale: 'en-US' };
  if (raw.startsWith('fr')) return { lang: 'fr', locale: 'fr-FR' };
  return { lang: 'pt', locale: 'pt-PT' };
};

/**
 * 🔊 Lê um texto em voz alta através do sintetizador de voz do sistema,
 * garantindo reprodução mesmo se o aparelho estiver em modo silencioso e no idioma ativo.
 */
let lastSpokenMessage = { normalized: '', timestamp: 0 };
let isVoiceRecordingActive = false;

export const setVoiceRecordingLock = (active: boolean) => {
  isVoiceRecordingActive = active;
};

export const speakText = async (text: string, stopPrevious: boolean = true, langOverride?: string) => {
  if (!text || !text.trim()) return;

  const normalizedKey = text.trim().toLowerCase();
  const now = Date.now();
  if (lastSpokenMessage.normalized === normalizedKey && (now - lastSpokenMessage.timestamp) < 12000) {
    return;
  }
  lastSpokenMessage = { normalized: normalizedKey, timestamp: now };

  if (isVoiceRecordingActive) return;

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

    const { locale } = resolveSpeechLocale(langOverride);
    Speech.speak(text.trim(), {
      language: locale,
      pitch: 1.0,
      rate: 0.95,
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
    language?: string;
  }
) => {
  if (extraData?.enabled === false) return;
  const { lang } = resolveSpeechLocale(extraData?.language);

  switch (status) {
    case 'queued':
      if (lang === 'en') {
        speakText(`Your trip is confirmed with driver ${extraData?.driverName || ''}. They are completing a nearby drop-off and will head to you shortly.`, true, lang);
      } else if (lang === 'fr') {
        speakText(`Votre course est confirmée avec le chauffeur ${extraData?.driverName || ''}. Il termine une dépose à proximité et arrive vers vous.`, true, lang);
      } else {
        speakText(`Sua viagem foi confirmada com o motorista ${extraData?.driverName || ''}. Ele está finalizando um desembarque próximo e seguirá para você em instantes.`, true, lang);
      }
      triggerHapticFeedback('NEW_OFFER');
      break;

    case 'accepted': {
      if (lang === 'en') {
        const driverPart = extraData?.driverName ? `by driver ${extraData.driverName}` : '';
        const carPart = extraData?.carModel ? `. Vehicle ${extraData.carModel} ${extraData?.carColor || ''}` : '';
        const platePart = extraData?.plate ? `, license plate ${extraData.plate}` : '';
        speakText(`Ride confirmed ${driverPart}${carPart}${platePart}. Track their arrival on the map.`, true, lang);
      } else if (lang === 'fr') {
        const driverPart = extraData?.driverName ? `par le chauffeur ${extraData.driverName}` : '';
        const carPart = extraData?.carModel ? `. Véhicule ${extraData.carModel} ${extraData?.carColor || ''}` : '';
        const platePart = extraData?.plate ? `, immatriculation ${extraData.plate}` : '';
        speakText(`Course confirmée ${driverPart}${carPart}${platePart}. Suivez son arrivée sur la carte.`, true, lang);
      } else {
        const driverPart = extraData?.driverName ? `pelo motorista ${extraData.driverName}` : '';
        const carPart = extraData?.carModel ? `. Veículo ${extraData.carModel} ${extraData?.carColor || ''}` : '';
        const platePart = extraData?.plate ? `, matrícula ${extraData.plate}` : '';
        speakText(`Viagem confirmada ${driverPart}${carPart}${platePart}. Acompanhe a chegada no mapa.`, true, lang);
      }
      triggerHapticFeedback('NEW_OFFER');
      break;
    }

    case 'arrived': {
      const spacedOtp = extraData?.startOtp ? extraData.startOtp.split('').join(' ') : '';
      if (lang === 'en') {
        const otpNotice = spacedOtp ? ` Please share security PIN ${spacedOtp} when boarding.` : '';
        speakText(`Your driver has arrived at the pickup point.${otpNotice}`, true, lang);
      } else if (lang === 'fr') {
        const otpNotice = spacedOtp ? ` Veuillez indiquer le code de sécurité ${spacedOtp} à l'embarquement.` : '';
        speakText(`Votre chauffeur est arrivé au point de prise en charge.${otpNotice}`, true, lang);
      } else {
        const otpNotice = spacedOtp ? ` Informe o código de segurança ${spacedOtp} ao embarcar.` : '';
        speakText(`Seu motorista chegou ao ponto de embarque.${otpNotice}`, true, lang);
      }
      triggerHapticFeedback('ARRIVED');
      break;
    }

    case 'in_progress': {
      if (lang === 'en') {
        const destNotice = extraData?.destination ? ` to ${extraData.destination}` : '';
        speakText(`Trip started${destNotice}. For your safety, please fasten your seatbelt. Have a pleasant journey!`, true, lang);
      } else if (lang === 'fr') {
        const destNotice = extraData?.destination ? ` vers ${extraData.destination}` : '';
        speakText(`Course démarrée${destNotice}. Pour votre sécurité, veuillez attacher votre ceinture. Bon voyage !`, true, lang);
      } else {
        const destNotice = extraData?.destination ? ` com destino a ${extraData.destination}` : '';
        speakText(`Viagem iniciada${destNotice}. Para sua segurança, por favor afivele o cinto de segurança. Tenha uma excelente viagem!`, true, lang);
      }
      triggerHapticFeedback('BUTTON_PRESS');
      break;
    }

    case 'nearing_destination':
      if (lang === 'en') {
        speakText('We are approaching your destination. Before exiting the vehicle, please check all your personal belongings.', true, lang);
      } else if (lang === 'fr') {
        speakText('Nous approchons de votre destination. Avant de quitter le véhicule, veuillez vérifier tous vos effets personnels.', true, lang);
      } else {
        speakText('Estamos nos aproximando do seu destino. Antes de sair do veículo, por favor verifique todos os seus pertences pessoais, como celular, carteira e bolsas.', true, lang);
      }
      triggerHapticFeedback('BUTTON_PRESS');
      break;

    case 'completed': {
      const amount = extraData?.price && extraData.price > 0 ? Math.round(extraData.price) : 0;
      if (lang === 'en') {
        const priceText = amount > 0 ? ` Total fare: ${amount} CFA francs.` : '';
        speakText(`You have arrived at your destination.${priceText} Thank you for riding with Nô Bai 245.`, true, lang);
      } else if (lang === 'fr') {
        const priceText = amount > 0 ? ` Montant total : ${amount} francs CFA.` : '';
        speakText(`Vous êtes arrivé à destination.${priceText} Merci d'avoir voyagé avec Nô Bai 245.`, true, lang);
      } else {
        const priceText = amount > 0 ? ` Valor total da viagem: ${amount} francos CFA.` : '';
        speakText(`Você chegou ao seu destino.${priceText} Obrigado por viajar com a Nô Bai 245.`, true, lang);
      }
      triggerHapticFeedback('FINISHED');
      break;
    }

    case 'cancelled':
      if (lang === 'en') {
        speakText('Attention: Your trip has been cancelled.', true, lang);
      } else if (lang === 'fr') {
        speakText('Attention : Votre course a été annulée.', true, lang);
      } else {
        speakText('Atenção: A sua viagem foi cancelada.', true, lang);
      }
      triggerHapticFeedback('CANCELLED');
      break;
  }
};
