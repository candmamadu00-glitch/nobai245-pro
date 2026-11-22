import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Image,
  Vibration,
  Animated,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Socket } from 'socket.io-client';
import * as Haptics from 'expo-haptics';
import {
  AudioModule,
  RecordingPresets,
  useAudioRecorder,
  setAudioModeAsync,
  setIsAudioActiveAsync,
  createAudioPlayer,
} from 'expo-audio';
import * as FileSystemLegacy from 'expo-file-system/legacy';

const FileSystem: any = FileSystemLegacy;

const CALL_VOICE_PRESET = {
  ...RecordingPresets.HIGH_QUALITY,
  extension: '.m4a',
  sampleRate: 22050,
  numberOfChannels: 1,
  bitRate: 48000,
  android: {
    ...(RecordingPresets.HIGH_QUALITY?.android || {}),
    extension: '.m4a',
    outputFormat: 'mpeg4' as const,
    audioEncoder: 'aac' as const,
    sampleRate: 22050,
  },
  ios: {
    ...(RecordingPresets.HIGH_QUALITY?.ios || {}),
    extension: '.m4a',
    outputFormat: 'aac ' as const,
    audioQuality: 64,
    sampleRate: 22050,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
};

export type CallDirection = 'outgoing' | 'incoming';
export type CallPhase = 'outgoing' | 'incoming' | 'connected' | 'ended';

interface InAppCallModalProps {
  visible: boolean;
  onClose: () => void;
  socket: Socket | null;
  rideId: string;
  currentRole: 'driver' | 'passenger';
  otherUserName: string;
  otherUserPhoto?: string | null;
  initialDirection: CallDirection;
  callLogId?: string | null;
}

export const InAppCallModal: React.FC<InAppCallModalProps> = ({
  visible,
  onClose,
  socket,
  rideId,
  currentRole,
  otherUserName,
  otherUserPhoto,
  initialDirection,
  callLogId: initialCallLogId,
}) => {
  const insets = useSafeAreaInsets();
  const audioRecorder = useAudioRecorder(CALL_VOICE_PRESET);

  const [phase, setPhase] = useState<CallPhase>(initialDirection);
  const [statusLabel, setStatusLabel] = useState<string>(
    initialDirection === 'incoming' ? 'Chamada de voz recebida...' : 'Chamando via canal seguro...'
  );
  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const [isRecordingVoice, setIsRecordingVoice] = useState<boolean>(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState<boolean>(true);
  const [isRemoteSpeaking, setIsRemoteSpeaking] = useState<boolean>(false);
  const [activeCallLogId, setActiveCallLogId] = useState<string | null>(initialCallLogId || null);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const elapsedRef = useRef<number>(0);
  const isRecordingRef = useRef<boolean>(false);
  const playbackQueueRef = useRef<Array<{ id: string; base64: string }>>([]);
  const isPlayingQueueRef = useRef<boolean>(false);
  const currentPlayerRef = useRef<any>(null);
  const closingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    elapsedRef.current = elapsedSec;
  }, [elapsedSec]);

  useEffect(() => {
    if (initialCallLogId) {
      setActiveCallLogId(initialCallLogId);
    }
  }, [initialCallLogId]);

  const stopPlayback = useCallback(() => {
    playbackQueueRef.current = [];
    isPlayingQueueRef.current = false;
    setIsRemoteSpeaking(false);
    if (currentPlayerRef.current) {
      try {
        currentPlayerRef.current.pause?.();
        currentPlayerRef.current.remove?.();
      } catch {}
      currentPlayerRef.current = null;
    }
  }, []);

  const finishAndClose = useCallback(
    (label: string) => {
      Vibration.cancel();
      stopPlayback();
      if (isRecordingRef.current) {
        isRecordingRef.current = false;
        setIsRecordingVoice(false);
        try {
          audioRecorder.stop();
        } catch {}
      }
      setPhase('ended');
      setStatusLabel(label);
      if (closingTimeoutRef.current) clearTimeout(closingTimeoutRef.current);
      closingTimeoutRef.current = setTimeout(() => {
        onClose();
      }, 1300);
    },
    [audioRecorder, onClose, stopPlayback]
  );

  useEffect(() => {
    if (!visible) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.14, duration: 750, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 750, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [visible, pulseAnim]);

  useEffect(() => {
    if (!visible || phase !== 'incoming') {
      Vibration.cancel();
      return;
    }
    const pattern = Platform.OS === 'android' ? [0, 600, 900] : [600, 900];
    Vibration.vibrate(pattern, true);
    return () => Vibration.cancel();
  }, [visible, phase]);

  useEffect(() => {
    if (!visible || phase !== 'connected') return;
    const timer = setInterval(() => {
      setElapsedSec((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [visible, phase]);

  useEffect(() => {
    if (!visible || phase !== 'outgoing') return;
    const ringTimeout = setTimeout(() => {
      if (socket && rideId) {
        socket.emit('call:end', {
          rideId,
          callLogId: activeCallLogId,
          durationSec: 0,
          reason: 'no_answer',
        });
      }
      finishAndClose('Sem resposta');
    }, 35000);
    return () => clearTimeout(ringTimeout);
  }, [visible, phase, socket, rideId, activeCallLogId, finishAndClose]);

  useEffect(() => {
    if (!visible) {
      Vibration.cancel();
      stopPlayback();
      setElapsedSec(0);
      if (closingTimeoutRef.current) clearTimeout(closingTimeoutRef.current);
      return;
    }

    setPhase(initialDirection);
    setElapsedSec(0);
    setStatusLabel(
      initialDirection === 'incoming'
        ? 'Chamada de voz segura recebida...'
        : 'Chamando via canal protegido...'
    );

    if (initialDirection === 'outgoing' && socket && rideId) {
      socket.emit(
        'call:initiate',
        { rideId, callerRole: currentRole },
        (ack?: { callLogId?: string; error?: boolean; message?: string }) => {
          if (ack?.callLogId) {
            setActiveCallLogId(ack.callLogId);
          }
          if (ack?.error) {
            finishAndClose(ack.message || 'Não foi possível completar a chamada');
          }
        }
      );
    }
  }, [visible, initialDirection, socket, rideId, currentRole, finishAndClose, stopPlayback]);

  const processNextAudioChunk = useCallback(async () => {
    if (isPlayingQueueRef.current) return;
    const nextItem = playbackQueueRef.current.shift();
    if (!nextItem) {
      setIsRemoteSpeaking(false);
      return;
    }

    isPlayingQueueRef.current = true;
    setIsRemoteSpeaking(true);

    try {
      await setIsAudioActiveAsync(true).catch(() => {});
      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: false,
        shouldRouteThroughEarpiece: !isSpeakerOn,
        interruptionMode: 'doNotMix',
        shouldPlayInBackground: false,
      }).catch(() => {});

      const cacheDir = FileSystem.cacheDirectory || FileSystem.documentDirectory || '';
      const tempUri = `${cacheDir}call_chunk_${nextItem.id}.m4a`;
      const cleanBase64 = nextItem.base64.replace(/^data:audio\/[^;]+;base64,/, '');
      await FileSystem.writeAsStringAsync(tempUri, cleanBase64, {
        encoding: FileSystem?.EncodingType?.Base64 || 'base64',
      });

      if (typeof createAudioPlayer === 'function') {
        const player = createAudioPlayer({ uri: tempUri });
        currentPlayerRef.current = player;
        if ('muted' in player) (player as any).muted = false;
        player.volume = 1.0;

        await new Promise<void>((resolve) => {
          let settled = false;
          const done = () => {
            if (settled) return;
            settled = true;
            try {
              player.remove?.();
            } catch {}
            currentPlayerRef.current = null;
            FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => {});
            resolve();
          };

          player.addListener?.('playbackStatusUpdate', (st: any) => {
            if (st?.didJustFinish || st?.error) done();
          });

          setTimeout(done, 15000);
          try {
            player.play();
          } catch {
            done();
          }
        });
      }
    } catch {
      // Ignora falha pontual
    } finally {
      isPlayingQueueRef.current = false;
      if (playbackQueueRef.current.length > 0) {
        processNextAudioChunk();
      } else {
        setIsRemoteSpeaking(false);
      }
    }
  }, [isSpeakerOn]);

  useEffect(() => {
    if (!visible || !socket) return;

    const handleAccepted = (data: any) => {
      if (data?.rideId && data.rideId !== rideId) return;
      if (data?.callLogId) setActiveCallLogId(data.callLogId);
      Vibration.cancel();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setPhase('connected');
      setStatusLabel('Chamada conectada • Áudio protegido');
    };

    const handleRejected = (data: any) => {
      if (data?.rideId && data.rideId !== rideId) return;
      finishAndClose('Chamada recusada');
    };

    const handleEnded = (data: any) => {
      if (data?.rideId && data.rideId !== rideId) return;
      finishAndClose('Chamada encerrada');
    };

    const handleVoiceChunk = (data: any) => {
      if (data?.rideId && data.rideId !== rideId) return;
      if (data?.senderRole === currentRole) return;
      if (!data?.audioBase64) return;

      if (phase !== 'connected') {
        setPhase('connected');
        setStatusLabel('Chamada conectada • Áudio protegido');
      }

      playbackQueueRef.current.push({
        id: `${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        base64: data.audioBase64,
      });
      processNextAudioChunk();
    };

    socket.on('call:accepted', handleAccepted);
    socket.on('call:rejected', handleRejected);
    socket.on('call:ended', handleEnded);
    socket.on('call:voice_chunk', handleVoiceChunk);

    return () => {
      socket.off('call:accepted', handleAccepted);
      socket.off('call:rejected', handleRejected);
      socket.off('call:ended', handleEnded);
      socket.off('call:voice_chunk', handleVoiceChunk);
    };
  }, [visible, socket, rideId, currentRole, phase, finishAndClose, processNextAudioChunk]);

  const handleAcceptCall = async () => {
    Vibration.cancel();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    await AudioModule.requestRecordingPermissionsAsync().catch(() => {});
    setPhase('connected');
    setStatusLabel('Chamada conectada • Áudio protegido');
    socket?.emit('call:accept', {
      rideId,
      callLogId: activeCallLogId,
      accepterRole: currentRole,
    });
  };

  const handleRejectCall = () => {
    Vibration.cancel();
    socket?.emit('call:reject', {
      rideId,
      callLogId: activeCallLogId,
      rejecterRole: currentRole,
    });
    finishAndClose('Chamada recusada');
  };

  const handleHangup = () => {
    socket?.emit('call:end', {
      rideId,
      callLogId: activeCallLogId,
      durationSec: elapsedRef.current,
      endedBy: currentRole,
    });
    finishAndClose('Chamada encerrada');
  };

  const startSpeaking = async () => {
    if (isRecordingRef.current || phase !== 'connected') return;
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm?.granted) return;

      stopPlayback();
      await setIsAudioActiveAsync(true).catch(() => {});
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        shouldRouteThroughEarpiece: !isSpeakerOn,
        interruptionMode: 'doNotMix',
      }).catch(() => {});

      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      isRecordingRef.current = true;
      setIsRecordingVoice(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    } catch {
      isRecordingRef.current = false;
      setIsRecordingVoice(false);
    }
  };

  const stopSpeakingAndSend = async () => {
    if (!isRecordingRef.current) return;
    isRecordingRef.current = false;
    setIsRecordingVoice(false);

    try {
      await audioRecorder.stop();
      await new Promise((r) => setTimeout(r, 120));
    } catch {}

    try {
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        shouldRouteThroughEarpiece: !isSpeakerOn,
        interruptionMode: 'doNotMix',
      }).catch(() => {});

      const uri = audioRecorder?.uri || (audioRecorder as any)?.getStatus?.()?.url;
      if (!uri || !socket || !rideId) return;

      const base64Audio = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem?.EncodingType?.Base64 || 'base64',
      });

      if (base64Audio && base64Audio.length > 120) {
        socket.emit('call:voice_chunk', {
          rideId,
          senderRole: currentRole,
          audioBase64: base64Audio,
        });
      }
      FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    } catch {}
  };

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60)
      .toString()
      .padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={handleHangup}>
      <View
        style={[
          styles.container,
          {
            paddingTop: Math.max(insets.top + 16, 42),
            paddingBottom: Math.max(insets.bottom + 24, 36),
          },
        ]}
      >
        <View style={styles.privacyBadge}>
          <Ionicons name="shield-checkmark" size={15} color="#10B981" />
          <Text style={styles.privacyBadgeText}>
            Número oculto • Chamada segura Nô Bai 245
          </Text>
        </View>

        <View style={styles.profileSection}>
          <Animated.View
            style={[
              styles.avatarPulseRing,
              {
                transform: [{ scale: pulseAnim }],
                borderColor:
                  phase === 'connected'
                    ? isRemoteSpeaking
                      ? '#10B981'
                      : 'rgba(16, 185, 129, 0.35)'
                    : 'rgba(234, 179, 8, 0.45)',
              },
            ]}
          >
            <View style={styles.avatarCircle}>
              {otherUserPhoto ? (
                <Image source={{ uri: otherUserPhoto }} style={styles.avatarImage} />
              ) : (
                <Ionicons name="person" size={52} color="#94A3B8" />
              )}
            </View>
          </Animated.View>

          <Text style={styles.userName}>{otherUserName || 'Usuário Nô Bai 245'}</Text>
          <Text style={styles.roleTag}>
            {currentRole === 'driver' ? 'Passageiro da corrida' : 'Motorista parceiro'}
          </Text>

          <Text style={styles.statusText}>{statusLabel}</Text>
          {phase === 'connected' && (
            <Text style={styles.timerText}>{formatTimer(elapsedSec)}</Text>
          )}
        </View>

        <View style={styles.centerControls}>
          {phase === 'connected' ? (
            <>
              <TouchableOpacity
                activeOpacity={0.85}
                onPressIn={startSpeaking}
                onPressOut={stopSpeakingAndSend}
                style={[
                  styles.pttButton,
                  isRecordingVoice && styles.pttButtonRecording,
                ]}
              >
                <Ionicons
                  name={isRecordingVoice ? 'radio' : 'mic'}
                  size={42}
                  color={isRecordingVoice ? '#FFFFFF' : '#0F172A'}
                />
              </TouchableOpacity>
              <Text style={styles.pttHintTitle}>
                {isRecordingVoice
                  ? 'Falando agora... Solte para enviar'
                  : isRemoteSpeaking
                  ? `${otherUserName} está falando...`
                  : 'Segure o microfone para falar'}
              </Text>
              <Text style={styles.pttHintSub}>
                Sua voz é transmitida pelo aplicativo sem revelar seu número
              </Text>
            </>
          ) : (
            <View style={styles.infoBox}>
              <Ionicons name="lock-closed" size={20} color="#EAB308" />
              <Text style={styles.infoBoxText}>
                Para sua segurança, os números de telefone pessoais nunca são exibidos entre motorista e passageiro.
              </Text>
            </View>
          )}
        </View>

        <View style={styles.bottomActions}>
          {phase === 'incoming' ? (
            <View style={styles.incomingRow}>
              <TouchableOpacity style={styles.rejectBtn} onPress={handleRejectCall} activeOpacity={0.85}>
                <Ionicons name="call" size={30} color="#FFFFFF" style={{ transform: [{ rotate: '135deg' }] }} />
                <Text style={styles.actionLabel}>Recusar</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.acceptBtn} onPress={handleAcceptCall} activeOpacity={0.85}>
                <Ionicons name="call" size={30} color="#FFFFFF" />
                <Text style={styles.actionLabel}>Atender</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.activeRow}>
              <TouchableOpacity
                style={[styles.secondaryCircleBtn, isSpeakerOn && styles.secondaryCircleBtnActive]}
                onPress={() => setIsSpeakerOn((prev) => !prev)}
                activeOpacity={0.85}
              >
                <Ionicons
                  name={isSpeakerOn ? 'volume-high' : 'ear-outline'}
                  size={24}
                  color={isSpeakerOn ? '#0F172A' : '#E2E8F0'}
                />
                <Text style={[styles.secondaryBtnText, isSpeakerOn && { color: '#0F172A' }]}>
                  {isSpeakerOn ? 'Viva-voz' : 'Auricular'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.hangupBtn} onPress={handleHangup} activeOpacity={0.85}>
                <Ionicons name="call" size={30} color="#FFFFFF" style={{ transform: [{ rotate: '135deg' }] }} />
                <Text style={styles.actionLabel}>Desligar</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1324',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  privacyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.35)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  privacyBadgeText: {
    color: '#6EE7B7',
    fontSize: 12,
    fontWeight: '700',
  },
  profileSection: {
    alignItems: 'center',
    marginTop: 12,
  },
  avatarPulseRing: {
    width: 136,
    height: 136,
    borderRadius: 68,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  avatarCircle: {
    width: 116,
    height: 116,
    borderRadius: 58,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  userName: {
    color: '#F8FAFC',
    fontSize: 24,
    fontWeight: '800',
    textAlign: 'center',
  },
  roleTag: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
  },
  statusText: {
    color: '#EAB308',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 14,
  },
  timerText: {
    color: '#10B981',
    fontSize: 28,
    fontWeight: '800',
    marginTop: 6,
    fontVariant: ['tabular-nums'],
  },
  centerControls: {
    alignItems: 'center',
    width: '100%',
  },
  pttButton: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: '#EAB308',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#EAB308',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  pttButtonRecording: {
    backgroundColor: '#EF4444',
    shadowColor: '#EF4444',
    transform: [{ scale: 1.08 }],
  },
  pttHintTitle: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '700',
    marginTop: 14,
    textAlign: 'center',
  },
  pttHintSub: {
    color: '#94A3B8',
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
    maxWidth: 280,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(30, 41, 59, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.2)',
    borderRadius: 14,
    padding: 14,
    maxWidth: 330,
  },
  infoBoxText: {
    color: '#CBD5E1',
    fontSize: 12,
    flex: 1,
    lineHeight: 17,
  },
  bottomActions: {
    width: '100%',
    alignItems: 'center',
  },
  incomingRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    maxWidth: 320,
  },
  activeRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 36,
  },
  rejectBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hangupBtn: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryCircleBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryCircleBtnActive: {
    backgroundColor: '#E2E8F0',
    borderColor: '#FFFFFF',
  },
  secondaryBtnText: {
    color: '#E2E8F0',
    fontSize: 10,
    fontWeight: '700',
    marginTop: 3,
  },
  actionLabel: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
});
