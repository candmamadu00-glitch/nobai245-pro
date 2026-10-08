import { useState, useRef } from 'react';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';

export function useAudioRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const recordingRef = useRef<Audio.Recording | null>(null);

  async function startRecording() {
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (permission.status !== 'granted') {
        console.warn('Permissão de microfone negada');
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.LOW_QUALITY // Qualidade ideal para áudio leve de emergência
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

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
      });

      if (!uri) return null;

      // Lê o áudio do armazenamento local e converte para string Base64
      const base64Audio = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      return base64Audio;
    } catch (err) {
      console.error('Erro ao parar gravação SOS:', err);
      setIsRecording(false);
      return null;
    }
  }

  return { isRecording, startRecording, stopRecording };
}