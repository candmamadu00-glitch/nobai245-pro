import { useState, useRef } from 'react';
import { Audio } from 'expo-audio';
// @ts-ignore
import * as FileSystem from 'expo-file-system';

export function useAudioRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const recordingRef = useRef<Audio.Recording | null>(null);

  async function startRecording() {
    try {
      const status = await Audio.requestPermissionsAsync();
      if (!status.granted) {
        console.warn('Permissão de microfone negada');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.LOW_QUALITY
      );

      recordingRef.current = recording;
      setIsRecording(true);
    } catch (err) {
      console.error('Erro ao iniciar gravação SOS:', err);
      setIsRecording(false);
    }
  }

  async function stopRecording(): Promise<string | null> {
    try {
      if (!recordingRef.current) return null;

      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;
      setIsRecording(false);

      if (!uri) return null;

      // Converte o áudio gravado para string Base64 para envio no SOS
      const base64Audio = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      return base64Audio;
    } catch (err) {
      console.error('Erro ao parar gravação SOS:', err);
      setIsRecording(false);
      recordingRef.current = null;
      return null;
    }
  }

  return { isRecording, startRecording, stopRecording };
}