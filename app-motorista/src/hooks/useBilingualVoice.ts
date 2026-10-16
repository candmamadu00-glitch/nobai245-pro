import { useCallback, useRef } from 'react';
import { createAudioPlayer } from 'expo-audio';
import * as Speech from 'expo-speech';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const STORAGE_VOICE_MODE_KEY = '@nobai245:driver_voice_mode';
export type VoiceMode = 'BOTH' | 'CRI' | 'PT' | 'OFF';

const CREOLE_AUDIO_MAP: Record<string, any> = {
  turn_left: require('../../assets/audio/crioulo/turn_left.mp3'),
  turn_right: require('../../assets/audio/crioulo/turn_right.mp3'),
  go_straight: require('../../assets/audio/crioulo/go_straight.mp3'),
  in_100m: require('../../assets/audio/crioulo/in_100m.mp3'),
  arrived_pickup: require('../../assets/audio/crioulo/arrived_pickup.mp3'),
  arrived_dest: require('../../assets/audio/crioulo/arrived_dest.mp3'),
  new_ride: require('../../assets/audio/crioulo/new_ride.mp3'),
};

export function useBilingualVoice() {
  const playerRef = useRef<any>(null);

  const speakInstruction = useCallback(async (
    actionKey: keyof typeof CREOLE_AUDIO_MAP,
    ptText: string,
    forcedMode?: VoiceMode
  ) => {
    console.log(`🚀 [VOZ LOG] Executando speakInstruction para "${actionKey}"...`);
    try {
      const savedMode = (await AsyncStorage.getItem(STORAGE_VOICE_MODE_KEY)) as VoiceMode;
      const mode = forcedMode || savedMode || 'BOTH';

      console.log(`🔍 [VOZ LOG] Modo ativo: "${mode}" | Texto PT: "${ptText}"`);

      if (mode === 'OFF') {
        console.log('🔇 [VOZ LOG] Orientação por voz está DESATIVADA nas configurações.');
        return;
      }

      if (playerRef.current) {
        console.log('🛑 [VOZ LOG] Parando áudio anterior...');
        try { playerRef.current.pause(); } catch (e) {}
        playerRef.current = null;
      }

      const playCreoleMp3 = () => {
        const asset = CREOLE_AUDIO_MAP[actionKey];
        console.log(`🎵 [VOZ LOG] ID do Asset do MP3 "${actionKey}":`, asset);

        if (!asset) {
          console.error(`💥 [VOZ LOG] ERRO: Ficheiro MP3 para "${actionKey}" não encontrado!`);
          return;
        }

        try {
          console.log(`▶️ [VOZ LOG] Criando e iniciando AudioPlayer (expo-audio)...`);
          const player = createAudioPlayer(asset);
          playerRef.current = player;
          player.play();
          console.log('✅ [VOZ LOG] player.play() executado com sucesso!');
        } catch (errMp3) {
          console.error(`💥 [VOZ LOG] ERRO ao tocar MP3 Crioulo:`, errMp3);
        }
      };

      if (mode === 'PT') {
        console.log('🗣️ [VOZ LOG] Falando em Português...');
        Speech.speak(ptText, { language: 'pt-PT', rate: 1.0 });
        return;
      }

      if (mode === 'CRI') {
        console.log('🗣️ [VOZ LOG] Tocando MP3 Crioulo...');
        playCreoleMp3();
        return;
      }

      if (mode === 'BOTH') {
        console.log('🗣️ [VOZ LOG] Falando Português + Crioulo...');
        Speech.speak(ptText, {
          language: 'pt-PT',
          rate: 1.05,
          onDone: () => {
            console.log('✅ [VOZ LOG] Português concluído. Tocando Crioulo...');
            playCreoleMp3();
          },
          onError: (e) => console.error('💥 [VOZ LOG] ERRO no TTS:', e),
        });
      }
    } catch (err) {
      console.error('💥 [VOZ LOG] Erro crítico:', err);
    }
  }, []);

  return { speakInstruction };
}