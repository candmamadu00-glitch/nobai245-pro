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
  PermissionsAndroid,
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

let WebRTCModule: any = null;
try {
  WebRTCModule = require('react-native-webrtc');
} catch {
  WebRTCModule = null;
}

const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
};

const CALL_VOICE_PRESET = {
  ...RecordingPresets.HIGH_QUALITY,
  extension: '.m4a',
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 24000,
  android: {
    ...(RecordingPresets.HIGH_QUALITY?.android || {}),
    extension: '.m4a',
    outputFormat: 'mpeg4' as const,
    audioEncoder: 'aac' as const,
    sampleRate: 16000,
  },
  ios: {
    ...(RecordingPresets.HIGH_QUALITY?.ios || {}),
    extension: '.m4a',
    outputFormat: 'aac ' as const,
    audioQuality: 64,
    sampleRate: 16000,
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

interface QueuedVoicePacket {
  id: string;
  seq: number;
  uriPromise: Promise<string | null>;
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
  const [useLegacyFallback, setUseLegacyFallback] = useState<boolean>(false);

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

  // Refs WebRTC Full-Duplex
  const peerConnectionRef = useRef<any>(null);
  const localStreamRef = useRef<any>(null);
  const pendingIceCandidatesRef = useRef<any[]>([]);
  const webrtcConnectedRef = useRef<boolean>(false);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const socketRef = useRef(socket);
  socketRef.current = socket;
  const rideIdRef = useRef(rideId);
  rideIdRef.current = rideId;
  const currentRoleRef = useRef(currentRole);
  currentRoleRef.current = currentRole;

  const playbackQueueRef = useRef<QueuedVoicePacket[]>([]);
  const isPlayingQueueRef = useRef<boolean>(false);
  const currentPlayerRef = useRef<any>(null);
  const closingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remoteSpeakingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const outboundSeqRef = useRef<number>(1);
  const lastPlayedSeqRef = useRef<number>(0);

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
    if (localStreamRef.current) {
      try {
        localStreamRef.current.getAudioTracks().forEach((track: any) => {
          track.enabled = !isMuted;
        });
      } catch {}
    }
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

  const requestMicPermissionSafely = useCallback(async (): Promise<boolean> => {
    try {
      if (Platform.OS === 'android') {
        const res = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO).catch(() => null);
        if (res && res !== PermissionsAndroid.RESULTS.GRANTED) {
          hasPermRef.current = false;
          return false;
        }
      }
      const perm = await AudioModule.requestRecordingPermissionsAsync().catch(() => null);
      const granted = Boolean(perm?.granted);
      hasPermRef.current = granted;
      return granted;
    } catch {
      return hasPermRef.current;
    }
  }, []);

  const applyCallAudioMode = useCallback(async (speakerOn: boolean) => {
    try {
      await setIsAudioActiveAsync(true).catch(() => {});
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        shouldRouteThroughEarpiece: !speakerOn,
        interruptionMode: 'doNotMix',
        shouldPlayInBackground: false,
      });
    } catch {}
  }, []);

  const cleanupWebRTC = useCallback(() => {
    webrtcConnectedRef.current = false;
    pendingIceCandidatesRef.current = [];
    if (localStreamRef.current) {
      try {
        localStreamRef.current.getTracks().forEach((t: any) => t.stop());
      } catch {}
      localStreamRef.current = null;
    }
    if (peerConnectionRef.current) {
      try {
        peerConnectionRef.current.close();
      } catch {}
      peerConnectionRef.current = null;
    }
  }, []);

  const stopRecorderSafely = useCallback(async () => {
    if (isRecordingRef.current) {
      isRecordingRef.current = false;
      try {
        await audioRecorder.stop();
      } catch {}
    }
  }, [audioRecorder]);

  const stopPlayback = useCallback(() => {
    const pending = playbackQueueRef.current.splice(0);
    pending.forEach((item) => {
      item.uriPromise
        .then((uri) => {
          if (uri) FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
        })
        .catch(() => {});
    });
    isPlayingQueueRef.current = false;
    if (remoteSpeakingTimeoutRef.current) {
      clearTimeout(remoteSpeakingTimeoutRef.current);
      remoteSpeakingTimeoutRef.current = null;
    }
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
      cleanupWebRTC();
      stopPlayback();
      stopRecorderSafely();
      setPhase('ended');
      setStatusLabel(label);
      if (closingTimeoutRef.current) clearTimeout(closingTimeoutRef.current);
      closingTimeoutRef.current = setTimeout(() => {
        hasInitiatedSessionRef.current = false;
        setUseLegacyFallback(false);
        onCloseRef.current?.();
      }, 1200);
    },
    [cleanupWebRTC, stopPlayback, stopRecorderSafely]
  );

  // Inicializa PeerConnection WebRTC Full-Duplex
  const setupWebRTCPeer = useCallback(
    async (isInitiator: boolean) => {
      if (!WebRTCModule?.RTCPeerConnection || !WebRTCModule?.mediaDevices) {
        setUseLegacyFallback(true);
        return null;
      }

      if (peerConnectionRef.current) {
        return peerConnectionRef.current;
      }

      try {
        const granted = await requestMicPermissionSafely();
        if (!granted) {
          setUseLegacyFallback(true);
          return null;
        }

        await applyCallAudioMode(isSpeakerOnRef.current);

        const stream = await WebRTCModule.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });

        stream.getAudioTracks().forEach((track: any) => {
          track.enabled = !isMutedRef.current;
        });
        localStreamRef.current = stream;

        const pc = new WebRTCModule.RTCPeerConnection(RTC_CONFIG);
        peerConnectionRef.current = pc;

        stream.getTracks().forEach((track: any) => {
          pc.addTrack(track, stream);
        });

        pc.onicecandidate = (event: any) => {
          if (event?.candidate && socketRef.current && rideIdRef.current) {
            socketRef.current.emit('call:webrtc_ice', {
              rideId: rideIdRef.current,
              candidate: event.candidate,
              senderRole: currentRoleRef.current,
            });
          }
        };

        pc.ontrack = () => {
          webrtcConnectedRef.current = true;
          setIsRemoteSpeaking(true);
          setStatusLabel('Chamada HD conectada • Voz em tempo real');
        };

        pc.onconnectionstatechange = () => {
          const state = pc.connectionState;
          if (state === 'connected') {
            webrtcConnectedRef.current = true;
            setIsRemoteSpeaking(true);
            setStatusLabel('Chamada HD conectada • Voz em tempo real');
          } else if (state === 'failed') {
            cleanupWebRTC();
            setUseLegacyFallback(true);
          }
        };

        if (isInitiator && socketRef.current && rideIdRef.current) {
          const offer = await pc.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: false,
          });
          await pc.setLocalDescription(offer);
          socketRef.current.emit('call:webrtc_offer', {
            rideId: rideIdRef.current,
            sdp: offer,
            senderRole: currentRoleRef.current,
          });
        }

        return pc;
      } catch (err) {
        console.warn('⚠️ [WEBRTC_INIT_FALLBACK]:', err);
        cleanupWebRTC();
        setUseLegacyFallback(true);
        return null;
      }
    },
    [applyCallAudioMode, cleanupWebRTC, requestMicPermissionSafely]
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
      outboundSeqRef.current = 1;
      lastPlayedSeqRef.current = 0;
      setUseLegacyFallback(false);
      Vibration.cancel();
      cleanupWebRTC();
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
    outboundSeqRef.current = 1;
    lastPlayedSeqRef.current = 0;

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

    requestMicPermissionSafely();

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
  }, [visible, initialDirection, finishAndClose, cleanupWebRTC, stopPlayback, stopRecorderSafely, requestMicPermissionSafely]);

  useEffect(() => {
    if (!visible || phase !== 'connected') return;
    applyCallAudioMode(isSpeakerOn);
  }, [visible, phase, isSpeakerOn, applyCallAudioMode]);

  // Fallback legado (ativado apenas se WebRTC nativo nao estiver disponivel no device)
  const processNextAudioChunk = useCallback(async () => {
    if (isPlayingQueueRef.current) return;
    const nextItem = playbackQueueRef.current.shift();
    if (!nextItem) {
      if (remoteSpeakingTimeoutRef.current) clearTimeout(remoteSpeakingTimeoutRef.current);
      remoteSpeakingTimeoutRef.current = setTimeout(() => {
        if (!isPlayingQueueRef.current && playbackQueueRef.current.length === 0) {
          setIsRemoteSpeaking(false);
        }
      }, 350);
      return;
    }

    isPlayingQueueRef.current = true;
    if (remoteSpeakingTimeoutRef.current) {
      clearTimeout(remoteSpeakingTimeoutRef.current);
      remoteSpeakingTimeoutRef.current = null;
    }
    setIsRemoteSpeaking(true);
    if (nextItem.seq > lastPlayedSeqRef.current) {
      lastPlayedSeqRef.current = nextItem.seq;
    }

    let tempUri: string | null = null;
    try {
      tempUri = await nextItem.uriPromise;
      if (!tempUri || !visibleRef.current || phaseRef.current !== 'connected') {
        if (tempUri) FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => {});
        return;
      }

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
            if (tempUri) {
              FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => {});
            }
            resolve();
          };

          player.addListener?.('playbackStatusUpdate', (st: any) => {
            if (st?.didJustFinish || st?.error) done();
          });

          setTimeout(done, 4500);
          try {
            player.play();
          } catch {
            done();
          }
        });
      }
    } catch {
      if (tempUri) FileSystem.deleteAsync(tempUri, { idempotent: true }).catch(() => {});
    } finally {
      isPlayingQueueRef.current = false;
      if (playbackQueueRef.current.length > 0 && visibleRef.current && phaseRef.current === 'connected') {
        processNextAudioChunk();
      } else {
        if (remoteSpeakingTimeoutRef.current) clearTimeout(remoteSpeakingTimeoutRef.current);
        remoteSpeakingTimeoutRef.current = setTimeout(() => {
          if (!isPlayingQueueRef.current && playbackQueueRef.current.length === 0) {
            setIsRemoteSpeaking(false);
          }
        }, 350);
      }
    }
  }, []);

  useEffect(() => {
    if (!visible || phase !== 'connected' || isMuted || !useLegacyFallback) {
      stopRecorderSafely();
      return;
    }

    let cancelled = false;

    const runVoiceLoop = async () => {
      if (!hasPermRef.current) {
        await requestMicPermissionSafely();
      }
      if (!hasPermRef.current || cancelled) return;

      await applyCallAudioMode(isSpeakerOnRef.current);

      while (!cancelled && visibleRef.current && phaseRef.current === 'connected' && !isMutedRef.current && useLegacyFallback) {
        try {
          await audioRecorder.prepareToRecordAsync(CALL_VOICE_PRESET);
          audioRecorder.record();
          isRecordingRef.current = true;

          for (let step = 0; step < 6; step++) {
            await new Promise((r) => setTimeout(r, 150));
            if (
              cancelled ||
              !visibleRef.current ||
              phaseRef.current !== 'connected' ||
              isMutedRef.current
            ) {
              break;
            }
          }

          if (isRecordingRef.current) {
            isRecordingRef.current = false;
            await audioRecorder.stop().catch(() => {});

            const rawUri = audioRecorder?.uri || (audioRecorder as any)?.getStatus?.()?.url;
            if (rawUri && socketRef.current && rideIdRef.current && !isMutedRef.current && phaseRef.current === 'connected') {
              const seqToSend = outboundSeqRef.current++;
              const cacheDir = FileSystem.cacheDirectory || FileSystem.documentDirectory || '';
              const stagedUri = `${cacheDir}call_tx_${seqToSend}_${Date.now()}.m4a`;

              const copied = await FileSystem.copyAsync({ from: rawUri, to: stagedUri })
                .then(() => true)
                .catch(() => false);

              const fileToRead = copied ? stagedUri : rawUri;

              (async () => {
                try {
                  const info = await FileSystem.getInfoAsync(fileToRead).catch(() => null);
                  if (info?.exists && (info?.size ?? 0) > 220 && socketRef.current && rideIdRef.current && phaseRef.current === 'connected') {
                    const base64Audio = await FileSystem.readAsStringAsync(fileToRead, {
                      encoding: FileSystem?.EncodingType?.Base64 || 'base64',
                    }).catch(() => '');

                    if (base64Audio && base64Audio.length > 180) {
                      socketRef.current.emit('call:voice_chunk', {
                        rideId: rideIdRef.current,
                        senderRole: currentRoleRef.current,
                        seq: seqToSend,
                        audioBase64: base64Audio,
                      });
                    }
                  }
                } finally {
                  if (copied) {
                    FileSystem.deleteAsync(stagedUri, { idempotent: true }).catch(() => {});
                  }
                }
              })();
            }
          }
        } catch {
          isRecordingRef.current = false;
          await new Promise((r) => setTimeout(r, 180));
        }
      }
    };

    runVoiceLoop();

    return () => {
      cancelled = true;
      stopRecorderSafely();
    };
  }, [visible, phase, isMuted, useLegacyFallback, audioRecorder, applyCallAudioMode, stopRecorderSafely, requestMicPermissionSafely]);

  useEffect(() => {
    if (!visible || !socket) return;

    const handleAccepted = async (data: any) => {
      if (data?.rideId && String(data.rideId) !== String(rideIdRef.current)) return;
      if (data?.callLogId) {
        setActiveCallLogId(data.callLogId);
        activeCallLogIdRef.current = data.callLogId;
      }
      Vibration.cancel();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      phaseRef.current = 'connected';
      setPhase('connected');
      setStatusLabel('Conectando áudio HD...');

      // Quem iniciou a ligacao cria a oferta WebRTC assim que o destinatario atende
      if (initialDirection === 'outgoing') {
        await setupWebRTCPeer(true);
      }
    };

    const handleWebRTCOffer = async (data: any) => {
      if (data?.rideId && String(data.rideId) !== String(rideIdRef.current)) return;
      if (data?.senderRole === currentRoleRef.current || !data?.sdp) return;

      try {
        const pc = await setupWebRTCPeer(false);
        if (!pc || !WebRTCModule?.RTCSessionDescription) return;

        await pc.setRemoteDescription(new WebRTCModule.RTCSessionDescription(data.sdp));

        while (pendingIceCandidatesRef.current.length > 0) {
          const cand = pendingIceCandidatesRef.current.shift();
          if (cand && WebRTCModule?.RTCIceCandidate) {
            await pc.addIceCandidate(new WebRTCModule.RTCIceCandidate(cand)).catch(() => {});
          }
        }

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socketRef.current?.emit('call:webrtc_answer', {
          rideId: rideIdRef.current,
          sdp: answer,
          senderRole: currentRoleRef.current,
        });
      } catch (err) {
        console.warn('⚠️ [WEBRTC_OFFER_ERR]:', err);
        setUseLegacyFallback(true);
      }
    };

    const handleWebRTCAnswer = async (data: any) => {
      if (data?.rideId && String(data.rideId) !== String(rideIdRef.current)) return;
      if (data?.senderRole === currentRoleRef.current || !data?.sdp) return;

      try {
        const pc = peerConnectionRef.current;
        if (!pc || !WebRTCModule?.RTCSessionDescription) return;

        await pc.setRemoteDescription(new WebRTCModule.RTCSessionDescription(data.sdp));

        while (pendingIceCandidatesRef.current.length > 0) {
          const cand = pendingIceCandidatesRef.current.shift();
          if (cand && WebRTCModule?.RTCIceCandidate) {
            await pc.addIceCandidate(new WebRTCModule.RTCIceCandidate(cand)).catch(() => {});
          }
        }
      } catch (err) {
        console.warn('⚠️ [WEBRTC_ANSWER_ERR]:', err);
        setUseLegacyFallback(true);
      }
    };

    const handleWebRTCIce = async (data: any) => {
      if (data?.rideId && String(data.rideId) !== String(rideIdRef.current)) return;
      if (data?.senderRole === currentRoleRef.current || !data?.candidate) return;

      try {
        const pc = peerConnectionRef.current;
        if (pc && pc.remoteDescription && WebRTCModule?.RTCIceCandidate) {
          await pc.addIceCandidate(new WebRTCModule.RTCIceCandidate(data.candidate)).catch(() => {});
        } else {
          pendingIceCandidatesRef.current.push(data.candidate);
        }
      } catch {}
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
      if (webrtcConnectedRef.current) return;
      if (data?.rideId && String(data.rideId) !== String(rideIdRef.current)) return;
      if (data?.senderRole === currentRoleRef.current) return;
      if (!data?.audioBase64) return;

      setUseLegacyFallback(true);

      if (phaseRef.current !== 'connected' && phaseRef.current !== 'ended') {
        phaseRef.current = 'connected';
        setPhase('connected');
        setStatusLabel('Chamada conectada • Áudio protegido');
      }

      const incomingSeq =
        typeof data.seq === 'number' && Number.isFinite(data.seq)
          ? data.seq
          : lastPlayedSeqRef.current + playbackQueueRef.current.length + 1;

      if (incomingSeq <= lastPlayedSeqRef.current) return;
      if (playbackQueueRef.current.some((item) => item.seq === incomingSeq)) return;

      const chunkId = `${incomingSeq}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const cacheDir = FileSystem.cacheDirectory || FileSystem.documentDirectory || '';
      const tempUri = `${cacheDir}call_rx_${chunkId}.m4a`;
      const cleanBase64 = String(data.audioBase64).replace(/^data:audio\/[^;]+;base64,/, '');

      const uriPromise = FileSystem.writeAsStringAsync(tempUri, cleanBase64, {
        encoding: FileSystem?.EncodingType?.Base64 || 'base64',
      })
        .then(() => tempUri)
        .catch(() => null);

      playbackQueueRef.current.push({
        id: chunkId,
        seq: incomingSeq,
        uriPromise,
      });
      playbackQueueRef.current.sort((a, b) => a.seq - b.seq);

      while (playbackQueueRef.current.length > 3) {
        const dropped = playbackQueueRef.current.shift();
        if (dropped) {
          dropped.uriPromise
            .then((uri) => {
              if (uri) FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
            })
            .catch(() => {});
        }
      }

      processNextAudioChunk();
    };

    socket.on('call:accepted', handleAccepted);
    socket.on('call:webrtc_offer', handleWebRTCOffer);
    socket.on('call:webrtc_answer', handleWebRTCAnswer);
    socket.on('call:webrtc_ice', handleWebRTCIce);
    socket.on('call:rejected', handleRejected);
    socket.on('call:ended', handleEnded);
    socket.on('call:voice_chunk', handleVoiceChunk);

    return () => {
      socket.off('call:accepted', handleAccepted);
      socket.off('call:webrtc_offer', handleWebRTCOffer);
      socket.off('call:webrtc_answer', handleWebRTCAnswer);
      socket.off('call:webrtc_ice', handleWebRTCIce);
      socket.off('call:rejected', handleRejected);
      socket.off('call:ended', handleEnded);
      socket.off('call:voice_chunk', handleVoiceChunk);
    };
  }, [visible, socket, initialDirection, setupWebRTCPeer, finishAndClose, processNextAudioChunk]);

  const handleAcceptCall = async () => {
    Vibration.cancel();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    await requestMicPermissionSafely();
    phaseRef.current = 'connected';
    setPhase('connected');
    setStatusLabel('Conectando áudio HD...');
    await setupWebRTCPeer(false);
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
                  ? `${otherUserName || 'Contato'} conectado ao vivo`
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
