import * as Speech from 'expo-speech';
import { AudioModule } from 'expo-audio';
import { Vibration, Platform } from 'react-native';

/**
 * 🔊 Lê um texto em voz alta através do sintetizador de voz do sistema
 */
export const speakText = async (text: string, stopPrevious: boolean = true) => {
  try {
    if (typeof (AudioModule as any)?.setAudioModeAsync === 'function') {
      await (AudioModule as any).setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
    }
  } catch {}
  if (!text || !text.trim()) return;

  try {
    if (stopPrevious) {
      Speech.stop();
    }

    Speech.speak(text.trim(), {
      language: 'pt-PT',
      pitch: 1.0,
      rate: 0.92, // Velocidade ajustada para máxima clareza auditiva
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
 * 📳 Padrões de vibração háptica para utilizadores com deficiência visual ou auditiva
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
 * 🗣️ Narrador automático de atualizações da viagem
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
  }
) => {
  switch (status) {
    case 'accepted':
      speakText(
        `A sua viagem foi aceite pelo motorista ${extraData?.driverName || ''}. Veículo ${extraData?.carModel || ''} ${extraData?.carColor || ''}, matrícula ${extraData?.plate || ''}.`
      );
      triggerHapticFeedback('NEW_OFFER');
      break;

    case 'arrived':
      speakText('Atenção: O motorista acabou de chegar ao local de embarque.');
      triggerHapticFeedback('ARRIVED');
      break;

    case 'in_progress':
      speakText(`Viagem iniciada com destino a: ${extraData?.destination || 'seu destino'}. Tenha uma excelente viagem!`);
      triggerHapticFeedback('BUTTON_PRESS');
      break;

    case 'completed':
      speakText(`Viagem finalizada com sucesso. Valor total: ${extraData?.price || 0} XOF. Obrigado por utilizar a Nobai245.`);
      triggerHapticFeedback('FINISHED');
      break;

    case 'cancelled':
      speakText('Atenção: A viagem foi cancelada.');
      triggerHapticFeedback('CANCELLED');
      break;
  }
};