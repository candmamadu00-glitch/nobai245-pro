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
  const lastSpokenRef = useRef<{ text: string; time: number }>({ text: '', time: 0 });

  const speakInstruction = useCallback(async (
    actionKey: string,
    ptText: string,
    forcedMode?: VoiceMode
  ) => {
    try {
      const now = Date.now();

      // Trava antirrepetição (10 segundos)
      if (lastSpokenRef.current.text === ptText && (now - lastSpokenRef.current.time) < 10000) {
        return;
      }

      const savedMode = (await AsyncStorage.getItem(STORAGE_VOICE_MODE_KEY)) as VoiceMode;
      const mode = forcedMode || savedMode || 'BOTH';

      if (mode === 'OFF') return;

      lastSpokenRef.current = { text: ptText, time: now };

      try { Speech.stop(); } catch (e) {}

      if (playerRef.current) {
        try { playerRef.current.pause(); } catch (e) {}
        playerRef.current = null;
      }

      const playCreoleMp3 = async () => {
        const asset = CREOLE_AUDIO_MAP[actionKey];
        if (!asset) return;

        try {
          const player = createAudioPlayer(asset);
          playerRef.current = player;
          player.play();
        } catch (errMp3) {
          console.error('💥 [VOZ LOG] ERRO ao tocar MP3 Crioulo:', errMp3);
        }
      };

      if (mode === 'PT') {
        Speech.speak(ptText, { language: 'pt-PT', rate: 1.0 });
        return;
      }

      if (mode === 'CRI') {
        await playCreoleMp3();
        return;
      }

      if (mode === 'BOTH') {
        Speech.speak(ptText, {
          language: 'pt-PT',
          rate: 1.05,
          onDone: () => { playCreoleMp3(); },
          onError: () => { playCreoleMp3(); },
        });
      }
    } catch (err) {
      console.error('💥 [VOZ LOG] Erro crítico na voz:', err);
    }
  }, []);

  return { speakInstruction };
}