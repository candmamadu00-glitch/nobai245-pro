import { useState, useRef } from 'react';
import { Audio } from 'expo-audio';
// @ts-ignore
import * as FileSystem from 'expo-file-system';

export function useAudioRecorder() {
  const [isRecording, setIsRecording] = useState(false);
  const [audioUri, setAudioUri] = useState<string | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);

  async function startRecording(): Promise<boolean> {
    try {
      const status = await Audio.requestPermissionsAsync();
      if (!status.granted) {
        console.warn('[SOS Audio] Permissão de microfone negada');
        return false;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      recordingRef.current = recording;
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
      if (!recordingRef.current) return null;

      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;
      setIsRecording(false);
      setAudioUri(uri || null);

      if (!uri) return null;

      const base64Audio = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      return base64Audio;
    } catch (error) {
      console.error('[SOS Audio] Erro ao parar gravação:', error);
      setIsRecording(false);
      recordingRef.current = null;
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