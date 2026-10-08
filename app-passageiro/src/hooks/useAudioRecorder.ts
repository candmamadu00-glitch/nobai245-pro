import { useState } from 'react';
import { useAudioRecorder as useExpoAudioRecorder, AudioModule, RecordingPresets } from 'expo-audio';

export function useAudioRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [audioUri, setAudioUri] = useState<string | null>(null);

  const audioRecorder = useExpoAudioRecorder(RecordingPresets.HIGH_QUALITY);

  async function startRecording(): Promise<boolean> {
    try {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      if (!status.granted) {
        console.warn('[SOS Audio] Permissão de microfone negada');
        return false;
      }

      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      setIsRecording(true);
      return true;
    } catch (error) {
      console.error('[SOS Audio] Erro ao iniciar gravação:', error);
      setIsRecording(false);
      return false;
    }
  }

  async function stopRecording(): Promise<string | null> {
    try {
      if (isRecording) {
        await audioRecorder.stop();
      }
      setIsRecording(false);
      const uri = audioRecorder.uri;
      setAudioUri(uri || null);
      return uri || null;
    } catch (error) {
      console.error('[SOS Audio] Erro ao parar gravação:', error);
      setIsRecording(false);
      return null;
    }
  }

  return {
    isRecording,
    audioUri,
    startRecording,
    stopRecording,
  };
}