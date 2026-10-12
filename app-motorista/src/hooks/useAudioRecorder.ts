import { useState } from 'react';
import { useAudioRecorder as useExpoAudioRecorder, AudioModule, RecordingPresets } from 'expo-audio';
import * as FileSystem from 'expo-file-system';

export function useAudioRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const audioRecorder = useExpoAudioRecorder(RecordingPresets.LOW_QUALITY);

  async function startRecording() {
    try {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      if (!status.granted) {
        console.warn('Permissão de microfone negada');
        return;
      }

      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      setIsRecording(true);
    } catch (err) {
      console.error('Erro ao iniciar gravação SOS:', err);
      setIsRecording(false);
    }
  }

  async function stopRecording(): Promise<string | null> {
    try {
      if (!audioRecorder.isRecording) return null;

      await audioRecorder.stop();
      const uri = audioRecorder.uri;
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
      return null;
    }
  }

  return { isRecording, startRecording, stopRecording };
}