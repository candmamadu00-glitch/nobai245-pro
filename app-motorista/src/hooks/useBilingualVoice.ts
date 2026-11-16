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

function resolveCreoleAsset(actionKey: string, text: string) {
  if (CREOLE_AUDIO_MAP[actionKey]) {
    return CREOLE_AUDIO_MAP[actionKey];
  }

  const normalized = (text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (normalized.includes('esquerda') || normalized.includes('skerda')) {
    return CREOLE_AUDIO_MAP.turn_left;
  }
  if (normalized.includes('direita') || normalized.includes('direta')) {
    return CREOLE_AUDIO_MAP.turn_right;
  }
  if (normalized.includes('100m') || normalized.includes('100 metros') || normalized.includes('cem metros')) {
    return CREOLE_AUDIO_MAP.in_100m;
  }
  if (normalized.includes('passageiro') || normalized.includes('embarque') || normalized.includes('buscar')) {
    return CREOLE_AUDIO_MAP.arrived_pickup;
  }
  if (normalized.includes('destino') || normalized.includes('distinu') || normalized.includes('tchega')) {
    return CREOLE_AUDIO_MAP.arrived_dest;
  }
  if (normalized.includes('frente') || normalized.includes('reto') || normalized.includes('siga') || normalized.includes('continue')) {
    return CREOLE_AUDIO_MAP.go_straight;
  }

  return null;
}

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
  const spokenKeysRef = useRef(new Map() as Map<string, number>);
  const sessionTokenRef = useRef<number>(0);

  const stopVoice = useCallback(() => {
    sessionTokenRef.current += 1;
    try { Speech.stop(); } catch {}
    if (playerRef.current) {
      try { playerRef.current.pause(); } catch {}
      try { playerRef.current.remove?.(); } catch {}
      playerRef.current = null;
    }
  }, []);

  const resetVoiceHistory = useCallback(() => {
    spokenKeysRef.current.clear();
    lastSpokenRef.current = { text: '', time: 0 };
  }, []);

  const speakInstruction = useCallback(async (
    actionKey: string,
    ptText: string,
    forcedMode?: VoiceMode,
    dedupeKey?: string
  ) => {
    try {
      const cleanText = (ptText || '').trim();
      if (!cleanText) return;

      const now = Date.now();

      if (dedupeKey) {
        const prevTime = spokenKeysRef.current.get(dedupeKey);
        if (prevTime && (now - prevTime) < 120000) {
          return;
        }
      }

      const normalizedCompare = cleanText.toLowerCase();
      if (lastSpokenRef.current.text === normalizedCompare && (now - lastSpokenRef.current.time) < 25000) {
        return;
      }

      const savedMode = (await AsyncStorage.getItem(STORAGE_VOICE_MODE_KEY)) as VoiceMode;
      const mode = forcedMode || savedMode || 'BOTH';

      if (mode === 'OFF') return;

      if (dedupeKey) {
        spokenKeysRef.current.set(dedupeKey, now);
      }
      lastSpokenRef.current = { text: normalizedCompare, time: now };

      stopVoice();
      const currentToken = sessionTokenRef.current;

      await ensurePlaybackAudioMode();
      if (sessionTokenRef.current !== currentToken) return;

      const playCreoleMp3 = async () => {
        if (sessionTokenRef.current !== currentToken) return;
        const asset = resolveCreoleAsset(actionKey, cleanText);
        if (!asset) return;

        try {
          await ensurePlaybackAudioMode();
          if (sessionTokenRef.current !== currentToken) return;
          const player = createAudioPlayer(asset);
          playerRef.current = player;
          player.play();
        } catch (errMp3) {
          console.warn('⚠️ [VOZ LOG] Erro ao tocar MP3 Crioulo:', errMp3);
        }
      };

      if (mode === 'PT') {
        Speech.speak(cleanText, { language: 'pt-PT', rate: 0.98, pitch: 1.0 });
        return;
      }

      if (mode === 'CRI') {
        await playCreoleMp3();
        return;
      }

      if (mode === 'BOTH') {
        Speech.speak(cleanText, {
          language: 'pt-PT',
          rate: 1.0,
          pitch: 1.0,
          onDone: () => {
            if (sessionTokenRef.current === currentToken) {
              playCreoleMp3();
            }
          },
          onError: () => {
            if (sessionTokenRef.current === currentToken) {
              playCreoleMp3();
            }
          },
        });
      }
    } catch (err) {
      console.warn('⚠️ [VOZ LOG] Erro na voz:', err);
    }
  }, [stopVoice]);

  return { speakInstruction, resetVoiceHistory, stopVoice };
}
