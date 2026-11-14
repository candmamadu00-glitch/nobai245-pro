import { useCallback, useRef } from 'react';
import { AudioModule, createAudioPlayer } from 'expo-audio';
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

async function ensurePlaybackAudioMode() {
  try {
    if (typeof (AudioModule as any)?.setAudioModeAsync === 'function') {
      await (AudioModule as any).setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: false,
      });
    }
  } catch {}
}

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

      if (lastSpokenRef.current.text === ptText && (now - lastSpokenRef.current.time) < 8000) {
        return;
      }

      const savedMode = (await AsyncStorage.getItem(STORAGE_VOICE_MODE_KEY)) as VoiceMode;
      const mode = forcedMode || savedMode || 'BOTH';

      if (mode === 'OFF') return;

      lastSpokenRef.current = { text: ptText, time: now };

      await ensurePlaybackAudioMode();

      try { Speech.stop(); } catch {}

      if (playerRef.current) {
        try { playerRef.current.pause(); } catch {}
        try { playerRef.current.remove?.(); } catch {}
        playerRef.current = null;
      }

      const playCreoleMp3 = async () => {
        const asset = CREOLE_AUDIO_MAP[actionKey];
        if (!asset) return;

        try {
          await ensurePlaybackAudioMode();
          const player = createAudioPlayer(asset);
          playerRef.current = player;
          player.play();
        } catch (errMp3) {
          console.warn('⚠️ [VOZ LOG] Erro ao tocar MP3 Crioulo:', errMp3);
        }
      };

      if (mode === 'PT') {
        Speech.speak(ptText, { language: 'pt-PT', rate: 0.96, pitch: 1.0 });
        return;
      }

      if (mode === 'CRI') {
        await playCreoleMp3();
        return;
      }

      if (mode === 'BOTH') {
        Speech.speak(ptText, {
          language: 'pt-PT',
          rate: 1.0,
          pitch: 1.0,
          onDone: () => { playCreoleMp3(); },
          onError: () => { playCreoleMp3(); },
        });
      }
    } catch (err) {
      console.warn('⚠️ [VOZ LOG] Erro na voz:', err);
    }
  }, []);

  return { speakInstruction };
}
