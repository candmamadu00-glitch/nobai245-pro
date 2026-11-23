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
    initialDirection === 'incoming' ? 'Chamada de voz recebida...' : 'Chamando via canal protegido...'
  );
  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState<boolean>(true);
  const [isRemoteSpeaking, setIsRemoteSpeaking] = useState<boolean>(false);
  const [activeCallLogId, setActiveCallLogId] = useState<string | null>(initialCallLogId || null);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const elapsedRef = useRef<number>(0);
  const phaseRef = useRef<CallPhase>(initialDirection);
  const visibleRef = useRef<boolean>(visible);
  const isMutedRef = useRef<boolean>(false);
  const isSpeakerOnRef = useRef<boolean>(true);
  const isRecordingRef = useRef<boolean>(false);
  const hasPermRef = useRef<boolean>(false);
  const hasInitiatedSessionRef = useRef<boolean>(false);
  const activeCallLogIdRef = useRef<string | null>(initialCallLogId || null);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const socketRef = useRef(socket);
  socketRef.current = socket;
  const rideIdRef = useRef(rideId);
  rideIdRef.current = rideId;
  const currentRoleRef = useRef(currentRole);
  currentRoleRef.current = currentRole;

  const playbackQueueRef = useRef<Array<{ id: string; base64: string }>>([]);
  const isPlayingQueueRef = useRef<boolean>(false);
  const currentPlayerRef = useRef<any>(null);
  const closingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    elapsedRef.current = elapsedSec;
  }, [elapsedSec]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    isSpeakerOnRef.current = isSpeakerOn;
  }, [isSpeakerOn]);

  useEffect(() => {
    if (initialCallLogId) {
      setActiveCallLogId(initialCallLogId);
      activeCallLogIdRef.current = initialCallLogId;
    }
  }, [initialCallLogId]);

  const stopRecorderSafely = useCallback(async () => {
    if (isRecordingRef.current) {
      isRecordingRef.current = false;
      try {
        await audioRecorder.stop();
      } catch {}
    }
  }, [audioRecorder]);

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
      if (phaseRef.current === 'ended') return;
      phaseRef.current = 'ended';
      Vibration.cancel();
      stopPlayback();
      stopRecorderSafely();
      setPhase('ended');
      setStatusLabel(label);
      if (closingTimeoutRef.current) clearTimeout(closingTimeoutRef.current);
      closingTimeoutRef.current = setTimeout(() => {
        hasInitiatedSessionRef.current = false;
        onCloseRef.current?.();
      }, 1200);
    },
    [stopPlayback, stopRecorderSafely]
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
      if (phaseRef.current !== 'outgoing') return;
      if (socketRef.current && rideIdRef.current) {
        socketRef.current.emit('call:end', {
          rideId: rideIdRef.current,
          callLogId: activeCallLogIdRef.current,
          durationSec: 0,
          reason: 'no_answer',
        });
      }
      finishAndClose('Sem resposta');
    }, 35000);
    return () => clearTimeout(ringTimeout);
  }, [visible, phase, finishAndClose]);

  useEffect(() => {
    if (!visible) {
      hasInitiatedSessionRef.current = false;
      Vibration.cancel();
      stopPlayback();
      stopRecorderSafely();
      setElapsedSec(0);
      setIsMuted(false);
      isMutedRef.current = false;
      if (closingTimeoutRef.current) clearTimeout(closingTimeoutRef.current);
      return;
    }

    if (hasInitiatedSessionRef.current) {
      return;
    }
    hasInitiatedSessionRef.current = true;

    phaseRef.current = initialDirection;
    setPhase(initialDirection);
    setElapsedSec(0);
    setIsMuted(false);
    isMutedRef.current = false;
    setStatusLabel(
      initialDirection === 'incoming'
        ? 'Chamada de voz segura recebida...'
        : 'Chamando via canal protegido...'
    );

    AudioModule.requestRecordingPermissionsAsync()
      .then((perm) => {
        hasPermRef.current = Boolean(perm?.granted);
      })
      .catch(() => {});

    if (initialDirection === 'outgoing' && socketRef.current && rideIdRef.current) {
      socketRef.current.emit(
        'call:initiate',
        { rideId: rideIdRef.current, callerRole: currentRoleRef.current },
        (ack?: { callLogId?: string; error?: boolean; message?: string }) => {
          if (ack?.callLogId) {
            setActiveCallLogId(ack.callLogId);
            activeCallLogIdRef.current = ack.callLogId;
          }
          if (ack?.error) {
            finishAndClose(ack.message || 'Não foi possível completar a chamada');
          }
        }
      );
    }
  }, [visible, initialDirection, finishAndClose, stopPlayback, stopRecorderSafely]);

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
      await stopRecorderSafely();
      await setIsAudioActiveAsync(true).catch(() => {});
      await setAudioModeAsync({
        playsInSilentMode: true,
        allowsRecording: false,
        shouldRouteThroughEarpiece: !isSpeakerOnRef.current,
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

          setTimeout(done, 10000);
          try {
            player.play();
          } catch {
            done();
          }
        });
      }
    } catch {
    } finally {
      isPlayingQueueRef.current = false;
      if (playbackQueueRef.current.length > 0 && visibleRef.current && phaseRef.current === 'connected') {
        processNextAudioChunk();
      } else {
        setIsRemoteSpeaking(false);
      }
    }
  }, [stopRecorderSafely]);

  useEffect(() => {
    if (!visible || phase !== 'connected' || isMuted) {
      stopRecorderSafely();
      return;
    }

    let cancelled = false;

    const runVoiceLoop = async () => {
      if (!hasPermRef.current) {
        const perm = await AudioModule.requestRecordingPermissionsAsync().catch(() => null);
        hasPermRef.current = Boolean(perm?.granted);
      }
      if (!hasPermRef.current || cancelled) return;

      while (!cancelled && visibleRef.current && phaseRef.current === 'connected' && !isMutedRef.current) {
        if (isPlayingQueueRef.current || playbackQueueRef.current.length > 0) {
          await new Promise((r) => setTimeout(r, 180));
          continue;
        }

        try {
          await setIsAudioActiveAsync(true).catch(() => {});
          await setAudioModeAsync({
            allowsRecording: true,
            playsInSilentMode: true,
            shouldRouteThroughEarpiece: !isSpeakerOnRef.current,
            interruptionMode: 'doNotMix',
          }).catch(() => {});

          await audioRecorder.prepareToRecordAsync(CALL_VOICE_PRESET);
          audioRecorder.record();
          isRecordingRef.current = true;

          for (let step = 0; step < 7; step++) {
            await new Promise((r) => setTimeout(r, 200));
            if (
              cancelled ||
              !visibleRef.current ||
              phaseRef.current !== 'connected' ||
              isMutedRef.current ||
              isPlayingQueueRef.current
            ) {
              break;
            }
          }

          if (isRecordingRef.current) {
            isRecordingRef.current = false;
            await audioRecorder.stop().catch(() => {});
            await new Promise((r) => setTimeout(r, 120));

            const uri = audioRecorder?.uri || (audioRecorder as any)?.getStatus?.()?.url;
            if (uri && socketRef.current && rideIdRef.current && !isMutedRef.current && phaseRef.current === 'connected') {
              const info = await FileSystem.getInfoAsync(uri).catch(() => null);
              if (info?.exists && (info?.size ?? 0) > 256) {
                const base64Audio = await FileSystem.readAsStringAsync(uri, {
                  encoding: FileSystem?.EncodingType?.Base64 || 'base64',
                }).catch(() => '');

                if (base64Audio && base64Audio.length > 200) {
                  socketRef.current.emit('call:voice_chunk', {
                    rideId: rideIdRef.current,
                    senderRole: currentRoleRef.current,
                    audioBase64: base64Audio,
                  });
                }
              }
            }
          }
        } catch {
          isRecordingRef.current = false;
          await new Promise((r) => setTimeout(r, 300));
        }
      }
    };

    runVoiceLoop();

    return () => {
      cancelled = true;
      stopRecorderSafely();
    };
  }, [visible, phase, isMuted, audioRecorder, stopRecorderSafely]);

  useEffect(() => {
    if (!visible || !socket) return;

    const handleAccepted = (data: any) => {
      if (data?.rideId && String(data.rideId) !== String(rideIdRef.current)) return;
      if (data?.callLogId) {
        setActiveCallLogId(data.callLogId);
        activeCallLogIdRef.current = data.callLogId;
      }
      Vibration.cancel();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      phaseRef.current = 'connected';
      setPhase('connected');
      setStatusLabel('Chamada conectada • Áudio protegido');
    };

    const handleRejected = (data: any) => {
      if (data?.rideId && String(data.rideId) !== String(rideIdRef.current)) return;
      finishAndClose('Chamada recusada');
    };

    const handleEnded = (data: any) => {
      if (data?.rideId && String(data.rideId) !== String(rideIdRef.current)) return;
      finishAndClose('Chamada encerrada');
    };

    const handleVoiceChunk = (data: any) => {
      if (data?.rideId && String(data.rideId) !== String(rideIdRef.current)) return;
      if (data?.senderRole === currentRoleRef.current) return;
      if (!data?.audioBase64) return;

      if (phaseRef.current !== 'connected' && phaseRef.current !== 'ended') {
        phaseRef.current = 'connected';
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
  }, [visible, socket, finishAndClose, processNextAudioChunk]);

  const handleAcceptCall = async () => {
    Vibration.cancel();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    const perm = await AudioModule.requestRecordingPermissionsAsync().catch(() => null);
    hasPermRef.current = Boolean(perm?.granted);
    phaseRef.current = 'connected';
    setPhase('connected');
    setStatusLabel('Chamada conectada • Áudio protegido');
    socketRef.current?.emit('call:accept', {
      rideId: rideIdRef.current,
      callLogId: activeCallLogIdRef.current,
      accepterRole: currentRoleRef.current,
    });
  };

  const handleRejectCall = () => {
    Vibration.cancel();
    socketRef.current?.emit('call:reject', {
      rideId: rideIdRef.current,
      callLogId: activeCallLogIdRef.current,
      rejecterRole: currentRoleRef.current,
    });
    finishAndClose('Chamada recusada');
  };

  const handleHangup = () => {
    socketRef.current?.emit('call:end', {
      rideId: rideIdRef.current,
      callLogId: activeCallLogIdRef.current,
      durationSec: elapsedRef.current,
      endedBy: currentRoleRef.current,
    });
    finishAndClose('Chamada encerrada');
  };

  const formatTimer = (sec: number) => {
    const mins = String(Math.floor(sec / 60)).padStart(2, '0');
    const rem = String(sec % 60).padStart(2, '0');
    return `${mins}:${rem}`;
  };

  return (
    <Modal visible={visible} animationType="fade" transparent={false} onRequestClose={handleHangup}>
      <View style={[styles.container, { paddingTop: Math.max(insets.top + 20, 44), paddingBottom: Math.max(insets.bottom + 24, 36) }]}>
        <View style={styles.privacyBadge}>
          <Ionicons name="shield-checkmark" size={16} color="#22C55E" />
          <Text style={styles.privacyBadgeText}>Chamada Segura Nô Bai 245 • Número Protegido</Text>
        </View>

        <View style={styles.centerBlock}>
          <Animated.View style={[styles.pulseRing, { transform: [{ scale: pulseAnim }] }]}>
            {otherUserPhoto ? (
              <Image source={{ uri: otherUserPhoto }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarFallback}>
                <Ionicons name="person" size={52} color="#EAB308" />
              </View>
            )}
          </Animated.View>

          <Text style={styles.userName}>{otherUserName || (currentRole === 'driver' ? 'Passageiro' : 'Motorista')}</Text>
          <Text style={styles.statusText}>{statusLabel}</Text>

          {phase === 'connected' && (
            <Text style={styles.timerText}>{formatTimer(elapsedSec)}</Text>
          )}

          {phase === 'connected' && (
            <View style={styles.liveIndicator}>
              <Ionicons
                name={isMuted ? 'mic-off' : isRemoteSpeaking ? 'volume-high' : 'mic'}
                size={16}
                color={isMuted ? '#EF4444' : isRemoteSpeaking ? '#38BDF8' : '#22C55E'}
              />
              <Text style={styles.liveIndicatorText}>
                {isMuted
                  ? 'Seu microfone está silenciado'
                  : isRemoteSpeaking
                  ? `${otherUserName || 'Contato'} está falando...`
                  : 'Microfone ativo • Pode falar normalmente'}
              </Text>
            </View>
          )}
        </View>

        {phase === 'incoming' ? (
          <View style={styles.incomingActions}>
            <TouchableOpacity style={styles.rejectBtn} onPress={handleRejectCall} activeOpacity={0.85}>
              <Ionicons name="call" size={30} color="#FFF" style={{ transform: [{ rotate: '135deg' }] }} />
              <Text style={styles.actionLabel}>Recusar</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.acceptBtn} onPress={handleAcceptCall} activeOpacity={0.85}>
              <Ionicons name="call" size={30} color="#FFF" />
              <Text style={styles.actionLabel}>Atender</Text>
            </TouchableOpacity>
          </View>
        ) : phase === 'connected' ? (
          <View style={styles.connectedControlsRow}>
            <TouchableOpacity
              style={[styles.secondaryBtn, isMuted && styles.mutedBtnActive]}
              onPress={() => {
                const nextMuted = !isMuted;
                setIsMuted(nextMuted);
                isMutedRef.current = nextMuted;
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              }}
              activeOpacity={0.85}
            >
              <Ionicons name={isMuted ? 'mic-off' : 'mic'} size={24} color="#FFF" />
              <Text style={styles.secondaryLabel}>{isMuted ? 'Ativar Som' : 'Silenciar'}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.hangupBtn} onPress={handleHangup} activeOpacity={0.85}>
              <Ionicons name="call" size={30} color="#FFF" style={{ transform: [{ rotate: '135deg' }] }} />
              <Text style={styles.actionLabel}>Desligar</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.secondaryBtn, isSpeakerOn && styles.speakerBtnActive]}
              onPress={() => {
                const nextSpeaker = !isSpeakerOn;
                setIsSpeakerOn(nextSpeaker);
                isSpeakerOnRef.current = nextSpeaker;
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
              }}
              activeOpacity={0.85}
            >
              <Ionicons name={isSpeakerOn ? 'volume-high' : 'ear'} size={24} color="#FFF" />
              <Text style={styles.secondaryLabel}>{isSpeakerOn ? 'Viva-voz' : 'Auricular'}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.outgoingActions}>
            <TouchableOpacity style={styles.hangupBtn} onPress={handleHangup} activeOpacity={0.85}>
              <Ionicons name="call" size={30} color="#FFF" style={{ transform: [{ rotate: '135deg' }] }} />
              <Text style={styles.actionLabel}>Desligar</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1120',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  privacyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(34, 197, 94, 0.14)',
    borderColor: 'rgba(34, 197, 94, 0.35)',
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    gap: 8,
  },
  privacyBadgeText: {
    color: '#86EFAC',
    fontSize: 12,
    fontWeight: '700',
  },
  centerBlock: {
    alignItems: 'center',
  },
  pulseRing: {
    width: 136,
    height: 136,
    borderRadius: 68,
    backgroundColor: 'rgba(234, 179, 8, 0.14)',
    borderWidth: 2,
    borderColor: 'rgba(234, 179, 8, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  avatar: {
    width: 112,
    height: 112,
    borderRadius: 56,
  },
  avatarFallback: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  userName: {
    color: '#F8FAFC',
    fontSize: 26,
    fontWeight: '800',
    marginBottom: 6,
  },
  statusText: {
    color: '#94A3B8',
    fontSize: 15,
    fontWeight: '600',
  },
  timerText: {
    color: '#EAB308',
    fontSize: 24,
    fontWeight: '800',
    marginTop: 10,
    letterSpacing: 1,
  },
  liveIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    marginTop: 14,
    gap: 8,
  },
  liveIndicatorText: {
    color: '#E2E8F0',
    fontSize: 13,
    fontWeight: '700',
  },
  incomingActions: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  connectedControlsRow: {
    flexDirection: 'row',
    width: '100%',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  outgoingActions: {
    alignItems: 'center',
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
    backgroundColor: '#22C55E',
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
  actionLabel: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 4,
  },
  secondaryBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#1E293B',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  speakerBtnActive: {
    backgroundColor: '#0284C7',
    borderColor: '#38BDF8',
  },
  mutedBtnActive: {
    backgroundColor: '#B91C1C',
    borderColor: '#F87171',
  },
  secondaryLabel: {
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 4,
  },
});
