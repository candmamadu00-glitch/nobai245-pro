import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal,
  KeyboardAvoidingView, Platform, Keyboard,
  FlatList,
  ScrollView, TextInput, Image, TouchableWithoutFeedback, Alert
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Socket } from 'socket.io-client';
import { useTranslation } from 'react-i18next';
import { AudioModule, RecordingPresets, useAudioRecorder, createAudioPlayer } from 'expo-audio';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystemLegacy from 'expo-file-system/legacy';
const FileSystem: any = FileSystemLegacy;
import { api } from '../services/api';

export interface ChatMessage {
  id: string;
  clientTempId?: string;
  sender: 'passenger' | 'driver';
  text?: string;
  audioUrl?: string | null;
  audioDuration?: number;
  senderPhoto?: string | null;
  createdAt?: string;
}

interface ChatModalProps {
  visible: boolean;
  onClose: () => void;
  socket: Socket | null | undefined;
  rideId: string;
  currentRole: 'passenger' | 'driver';
  currentUserPhoto?: string | null;
  otherUserName?: string;
  otherUserPhoto?: string | null;
}

const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://api.nobai245.com').replace(/\/api\/?$/, '');

const formatPhotoUrl = (path?: string | null) => {
  if (!path || typeof path !== 'string') return null;
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:')) return path;
  const cleanBase = API_URL.replace(/\/$/, '');
  const cleanPath = path.startsWith('/') ? path : '/' + path;
  return cleanBase + cleanPath;
};

const formatTime = (isoString?: string) => {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '';
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return hours + ':' + minutes;
  } catch {
    return '';
  }
};

const getPlayableAudioUri = async (msgId: string, audioUrl: string): Promise<string> => {
  if (audioUrl.startsWith('http://') || audioUrl.startsWith('https://') || audioUrl.startsWith('file://')) {
    return audioUrl;
  }
  if (audioUrl.startsWith('data:') || audioUrl.length > 500) {
    try {
      const base64Data = audioUrl.includes('base64,') ? audioUrl.split('base64,')[1] : audioUrl;
      const safeId = msgId.replace(/[^a-zA-Z0-9]/g, '') || String(Date.now());
      const fileUri = FileSystem.cacheDirectory + 'audio_' + safeId + '.m4a';
      const encodingOpt = FileSystem?.EncodingType?.Base64 || 'base64';
      const fileInfo = await FileSystem.getInfoAsync(fileUri);
      if (!fileInfo.exists) {
        await FileSystem.writeAsStringAsync(fileUri, base64Data, {
          encoding: encodingOpt,
        });
      }
      return fileUri;
    } catch (e) {
      console.warn('⚠️ Erro ao converter áudio base64 em arquivo local:', e);
    }
  }
  const cleanBase = API_URL.replace(/\/$/, '');
  const cleanPath = audioUrl.startsWith('/') ? audioUrl : '/' + audioUrl;
  return cleanBase + cleanPath;
};

const QUICK_REPLIES_DRIVER = [
  '📍 Cheguei ao ponto de embarque',
  '🚗 Estou a caminho (2 min)',
  '📌 Onde você está exatamente?',
  '🚦 Trânsito um pouco lento, já chego',
];

const QUICK_REPLIES_PASSENGER = [
  '📍 Já estou no ponto de embarque',
  '🚶 Estou a sair agora',
  '🚗 Qual é a cor do carro?',
  '⏱️ Aguarde 1 minuto, por favor',
];

function isDuplicateMessage(list: ChatMessage[], candidate: ChatMessage): boolean {
  return list.some((item) => {
    if (!item) return false;
    if (item.id && candidate.id && item.id === candidate.id) return true;
    if (item.clientTempId && candidate.clientTempId && item.clientTempId === candidate.clientTempId) return true;
    if (item.id && candidate.clientTempId && item.id === candidate.clientTempId) return true;
    if (item.clientTempId && candidate.id && item.clientTempId === candidate.id) return true;

    if (item.sender === candidate.sender) {
      const t1 = item.createdAt ? new Date(item.createdAt).getTime() : 0;
      const t2 = candidate.createdAt ? new Date(candidate.createdAt).getTime() : Date.now();
      const closeInTime = !t1 || !t2 || Math.abs(t1 - t2) < 15000;

      if (closeInTime && candidate.text && item.text && item.text.trim() === candidate.text.trim()) {
        return true;
      }
      if (closeInTime && candidate.audioUrl && item.audioUrl) {
        if (item.audioUrl === candidate.audioUrl) return true;
        if (
          Number(item.audioDuration || 0) > 0 &&
          Number(item.audioDuration || 0) === Number(candidate.audioDuration || 0)
        ) {
          return true;
        }
      }
    }
    return false;
  });
}

export function ChatModal({
  visible,
  onClose,
  socket,
  rideId,
  currentRole = 'passenger',
  currentUserPhoto,
  otherUserName,
  otherUserPhoto
}: ChatModalProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [hasRenderError, setHasRenderError] = useState(false);

  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const [isRecording, setIsRecording] = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);

  const flatListRef = useRef<FlatList>(null);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activePlayerRef = useRef<any>(null);
  const isRecordingRef = useRef<boolean>(false);
  const recordDurationRef = useRef<number>(0);

  const storageKey = '@bai245:chat_' + rideId;

  const safeEmit = useCallback((event: string, payload: any) => {
    try {
      if (socket) {
        if (!socket.connected && typeof socket.connect === 'function') {
          socket.connect();
        }
        socket.emit(event, payload);
      }
    } catch {}
  }, [socket]);

  const stopActivePlayer = useCallback(() => {
    if (activePlayerRef.current) {
      try { activePlayerRef.current.pause(); } catch {}
      try { activePlayerRef.current.remove?.(); } catch {}
      activePlayerRef.current = null;
    }
    setPlayingAudioId(null);
  }, []);

  useEffect(() => {
    if (!rideId) setMessages([]);
    setHasRenderError(false);
  }, [rideId]);

  useEffect(() => {
    if (messages.length > 0 && rideId) {
      AsyncStorage.setItem(storageKey, JSON.stringify(messages)).catch(() => {});
    }
  }, [messages, rideId, storageKey]);

  useEffect(() => {
    return () => {
      stopActivePlayer();
      if (recordTimerRef.current) {
        clearInterval(recordTimerRef.current);
        recordTimerRef.current = null;
      }
    };
  }, [stopActivePlayer]);

  useEffect(() => {
    if (visible && rideId) {
      AsyncStorage.getItem(storageKey).then((cached) => {
        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            if (Array.isArray(parsed) && parsed.length > 0) {
              setMessages((prev) => {
                const merged = [...prev];
                parsed.forEach((m: ChatMessage) => {
                  if (m && !isDuplicateMessage(merged, m)) merged.push(m);
                });
                return merged;
              });
            }
          } catch {}
        }
      }).catch(() => {});

      if (api && typeof api.get === 'function') {
        api.get('/rides/' + rideId + '/chat')
          .then(response => {
            const data = response?.data;
            const rawList = Array.isArray(data)
              ? data
              : Array.isArray(data?.messages)
                ? data.messages
                : Array.isArray(data?.history)
                  ? data.history
                  : [];

            if (rawList.length > 0) {
              const history: ChatMessage[] = rawList.map((msg: any) => ({
                id: String(msg.id || ('hist-' + Math.random().toString(36).substring(2, 7))),
                clientTempId: msg.clientTempId ? String(msg.clientTempId) : undefined,
                sender: (msg.senderType === 'PASSENGER' || msg.sender === 'passenger' || msg.senderRole === 'passenger') ? 'passenger' : 'driver',
                text: msg.message || msg.text || '',
                audioUrl: msg.audioUrl || msg.audio || msg.fileUrl || (typeof msg.message === 'string' && msg.message.startsWith('[AUDIO]') ? msg.message.replace('[AUDIO]', '').split('|')[0] : null),
                audioDuration: Number(msg.audioDuration || msg.duration || 0),
                senderPhoto: formatPhotoUrl(msg.senderPhoto || msg.userPhoto),
                createdAt: msg.createdAt || new Date().toISOString(),
              }));

              setMessages((prev) => {
                const next = [...prev];
                history.forEach((hMsg) => {
                  if (!hMsg) return;
                  if (!hMsg.audioUrl && hMsg.text === '🎤 Mensagem de áudio') return;
                  if (!isDuplicateMessage(next, hMsg)) {
                    next.push(hMsg);
                  }
                });
                return next;
              });
            }
          })
          .catch(() => {});
      }
    } else if (!visible) {
      stopActivePlayer();
    }
  }, [visible, rideId, storageKey, stopActivePlayer]);

  useEffect(() => {
    if (!socket || !visible) return;
    if (rideId) {
      safeEmit('join_room', rideId);
      safeEmit('join_room', 'ride_' + rideId);
    }

    const handleReceiveMessage = (msg: any) => {
      if (!msg) return;
      if (msg.rideId && rideId && String(msg.rideId) !== String(rideId)) return;

      try {
        const msgSender = (msg.sender === 'passenger' || msg.senderType === 'PASSENGER' || msg.senderRole === 'passenger') ? 'passenger' : 'driver';
        const msgText = msg.text || msg.message || '';
        const msgAudio = msg.audioUrl || msg.audio || msg.fileUrl || null;

        const formattedMsg: ChatMessage = {
          id: String(msg.id || ('msg-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7))),
          clientTempId: msg.clientTempId ? String(msg.clientTempId) : undefined,
          sender: msgSender,
          text: msgText,
          audioUrl: msgAudio,
          audioDuration: Number(msg.audioDuration || msg.duration || 0),
          senderPhoto: formatPhotoUrl(msg.senderPhoto),
          createdAt: msg.createdAt || new Date().toISOString(),
        };

        setMessages((prev) => {
          if (isDuplicateMessage(prev, formattedMsg)) return prev;
          return [...prev, formattedMsg];
        });
      } catch {}
    };

    try {
      socket.off('chat:receive_message', handleReceiveMessage);
      socket.off('chat:message', handleReceiveMessage);
      socket.off('chat:new_message', handleReceiveMessage);

      socket.on('chat:receive_message', handleReceiveMessage);
      socket.on('chat:message', handleReceiveMessage);
      socket.on('chat:new_message', handleReceiveMessage);
    } catch {}

    return () => {
      try {
        socket.off('chat:receive_message', handleReceiveMessage);
        socket.off('chat:message', handleReceiveMessage);
        socket.off('chat:new_message', handleReceiveMessage);
      } catch {}
    };
  }, [socket, visible, rideId, safeEmit]);

  const sendMessage = (overrideText?: string) => {
    const rawText = typeof overrideText === 'string' ? overrideText : inputText;
    if (!rawText.trim()) return;

    const text = rawText.trim();
    const uniqueId = 'msg-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);

    const newMsg: ChatMessage = {
      id: uniqueId,
      clientTempId: uniqueId,
      sender: currentRole,
      text,
      senderPhoto: formatPhotoUrl(currentUserPhoto),
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => (isDuplicateMessage(prev, newMsg) ? prev : [...prev, newMsg]));

    safeEmit('chat:send_message', {
      rideId,
      text,
      message: text,
      id: uniqueId,
      clientTempId: uniqueId,
      sender: currentRole,
      senderRole: currentRole
    });

    setInputText('');
  };

  const stopAndSendRecording = useCallback(async (finalDuration?: number) => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }

    if (!isRecordingRef.current) return;
    isRecordingRef.current = false;
    setIsRecording(false);

    try {
      await audioRecorder.stop();
    } catch {}

    try {
      if (typeof (AudioModule as any)?.setAudioModeAsync === 'function') {
        await (AudioModule as any).setAudioModeAsync({
          allowsRecording: false,
          playsInSilentMode: true,
        });
      }
    } catch {}

    try {
      const uri = audioRecorder?.uri || (audioRecorder as any)?.getStatus?.()?.url;
      if (!uri) {
        Alert.alert(t('error_title', 'Erro'), 'Não foi possível capturar o arquivo de áudio.');
        return;
      }

      const durationSec = Math.max(1, finalDuration || recordDurationRef.current || 1);
      const uniqueId = 'audio-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);

      let audioPayload = '';
      try {
        const encodingOpt = FileSystem?.EncodingType?.Base64 || 'base64';
        const base64Audio = await FileSystem.readAsStringAsync(uri, { encoding: encodingOpt });
        if (base64Audio) {
          audioPayload = 'data:audio/m4a;base64,' + base64Audio;
        }
      } catch (b64Err) {
        console.warn('⚠️ Falha ao converter áudio para Base64:', b64Err);
      }

      if (!audioPayload) {
        Alert.alert(t('error_title', 'Erro'), 'Não foi possível processar o áudio gravado. Tente novamente.');
        return;
      }

      const newMsg: ChatMessage = {
        id: uniqueId,
        clientTempId: uniqueId,
        sender: currentRole,
        audioUrl: uri,
        audioDuration: durationSec,
        senderPhoto: formatPhotoUrl(currentUserPhoto),
        createdAt: new Date().toISOString(),
      };

      setMessages((prev) => (isDuplicateMessage(prev, newMsg) ? prev : [...prev, newMsg]));

      safeEmit('chat:send_message', {
        rideId,
        audioUrl: audioPayload,
        audio: audioPayload,
        audioDuration: durationSec,
        duration: durationSec,
        id: uniqueId,
        clientTempId: uniqueId,
        sender: currentRole,
        senderRole: currentRole,
        text: '',
        message: ''
      });

      recordDurationRef.current = 0;
      setRecordDuration(0);
    } catch (error) {
      console.warn('⚠️ Erro ao enviar gravação de áudio:', error);
    }
  }, [audioRecorder, currentRole, currentUserPhoto, rideId, safeEmit, t]);

  const startRecording = async () => {
    if (isRecordingRef.current) return;
    stopActivePlayer();

    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(
          t('permission_denied', 'Permissão negada'),
          t('mic_permission_needed', 'Precisamos de acesso ao microfone para enviar áudios.')
        );
        return;
      }

      if (typeof (AudioModule as any)?.setAudioModeAsync === 'function') {
        await (AudioModule as any).setAudioModeAsync({
          allowsRecording: true,
          playsInSilentMode: true,
        });
      }

      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();

      isRecordingRef.current = true;
      recordDurationRef.current = 0;
      setIsRecording(true);
      setRecordDuration(0);

      if (recordTimerRef.current) clearInterval(recordTimerRef.current);

      let currentSec = 0;
      recordTimerRef.current = setInterval(() => {
        currentSec += 1;
        recordDurationRef.current = currentSec;
        setRecordDuration(currentSec);

        if (currentSec >= 15) {
          stopAndSendRecording(15);
        }
      }, 1000);
    } catch (err) {
      isRecordingRef.current = false;
      setIsRecording(false);
      Alert.alert(t('error_title', 'Erro'), 'Não foi possível iniciar o microfone neste momento.');
    }
  };

  const cancelRecording = async () => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    isRecordingRef.current = false;
    try { await audioRecorder.stop(); } catch {}
    try {
      if (typeof (AudioModule as any)?.setAudioModeAsync === 'function') {
        await (AudioModule as any).setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      }
    } catch {}
    recordDurationRef.current = 0;
    setIsRecording(false);
    setRecordDuration(0);
  };

  const togglePlayAudio = async (msgId: string, audioUrl?: string | null) => {
    if (!audioUrl) return;

    try {
      if (playingAudioId === msgId && activePlayerRef.current) {
        stopActivePlayer();
        return;
      }

      stopActivePlayer();

      if (typeof (AudioModule as any)?.setAudioModeAsync === 'function') {
        await (AudioModule as any).setAudioModeAsync({
          playsInSilentMode: true,
          allowsRecording: false,
        });
      }

      const playableUri = await getPlayableAudioUri(msgId, audioUrl);
      const player = createAudioPlayer({ uri: playableUri });
      if (!player) return;

      player.volume = 1.0;
      activePlayerRef.current = player;
      setPlayingAudioId(msgId);

      if (typeof player.play === 'function') player.play();

      if (typeof player.addListener === 'function') {
        player.addListener('playbackStatusUpdate', (status: any) => {
          if (status?.didJustFinish || status?.error) {
            stopActivePlayer();
          }
        });
      }
    } catch {
      stopActivePlayer();
    }
  };

  const renderAvatar = (photoUrl?: string | null) => {
    const formatted = formatPhotoUrl(photoUrl);
    if (formatted) return <Image source={{ uri: formatted }} style={styles.avatarImage} />;
    return (
      <View style={styles.avatarPlaceholder}>
        <Ionicons name="person" size={16} color="#64748B" />
      </View>
    );
  };

  const dynamicBottomPadding = Math.max(insets.bottom + 8, Platform.OS === 'android' ? 20 : 16);

  if (hasRenderError) {
    return (
      <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
        <View style={styles.chatOverlay}>
          <View style={[styles.chatContainer, { justifyContent: 'center', alignItems: 'center', padding: 20 }]}>
            <Ionicons name="alert-circle-outline" size={48} color="#EF4444" />
            <Text style={{ color: '#0F172A', fontSize: 16, fontWeight: 'bold', marginTop: 12 }}>
              Chat temporariamente indisponível
            </Text>
            <TouchableOpacity style={[styles.closeButton, { marginTop: 16 }]} onPress={onClose}>
              <Text style={{ color: '#EF4444', fontWeight: 'bold' }}>Voltar para a Corrida</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.chatOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.backdrop} />
        </TouchableWithoutFeedback>

        <View style={styles.chatContainer}>
          <View style={styles.chatHeader}>
            <View style={styles.headerTitleRow}>
              {renderAvatar(otherUserPhoto)}
              <View>
                <Text style={styles.chatTitle}>
                  {otherUserName || t('chat_with_user', 'Chat da Corrida')}
                </Text>
                <Text style={styles.chatSubtitle}>
                  {currentRole === 'passenger' ? t('driver', 'Motorista') : t('passenger', 'Passageiro')}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={onClose}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="close" size={22} color="#64748B" />
            </TouchableOpacity>
          </View>

          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item, index) => item.id ? (item.id + '-' + index) : ('msg-' + index)}
            contentContainerStyle={styles.messageList}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => {
              try { flatListRef.current?.scrollToEnd({ animated: true }); } catch {}
            }}
            renderItem={({ item }) => {
              if (!item) return null;
              const isMe = item.sender === currentRole;
              const isPlaying = playingAudioId === item.id;

              return (
                <View style={[styles.messageRow, isMe ? styles.rowMe : styles.rowOther]}>
                  {!isMe && renderAvatar(item.senderPhoto || otherUserPhoto)}

                  <View style={styles.messageContent}>
                    <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleOther]}>
                      {item.audioUrl ? (
                        <TouchableOpacity
                          style={styles.audioContainer}
                          onPress={() => togglePlayAudio(item.id, item.audioUrl)}
                          activeOpacity={0.8}
                        >
                          <Ionicons
                            name={isPlaying ? 'pause-circle' : 'play-circle'}
                            size={32}
                            color={isMe ? '#EAB308' : '#0F172A'}
                          />
                          <View style={styles.audioWaveformPlaceholder}>
                            <View style={[styles.audioBar, { height: 12, backgroundColor: isMe ? '#FFF' : '#64748B' }]} />
                            <View style={[styles.audioBar, { height: 20, backgroundColor: isMe ? '#FFF' : '#64748B' }]} />
                            <View style={[styles.audioBar, { height: 16, backgroundColor: isMe ? '#FFF' : '#64748B' }]} />
                            <View style={[styles.audioBar, { height: 24, backgroundColor: isMe ? '#FFF' : '#64748B' }]} />
                            <View style={[styles.audioBar, { height: 10, backgroundColor: isMe ? '#FFF' : '#64748B' }]} />
                          </View>
                          <Text style={[styles.audioDurationText, isMe ? styles.textMe : styles.textOther]}>
                            00:{String(item.audioDuration || 1).padStart(2, '0')}
                          </Text>
                        </TouchableOpacity>
                      ) : (
                        <Text style={[styles.messageText, isMe ? styles.textMe : styles.textOther]}>
                          {item.text}
                        </Text>
                      )}
                    </View>
                    {item.createdAt && (
                      <Text style={[styles.timestamp, isMe ? styles.timestampMe : styles.timestampOther]}>
                        {formatTime(item.createdAt)}
                      </Text>
                    )}
                  </View>

                  {isMe && renderAvatar(item.senderPhoto || currentUserPhoto)}
                </View>
              );
            }}
          />

          {!isRecording && (
            <View style={styles.quickRepliesWrapper}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.quickRepliesContent}
                keyboardShouldPersistTaps="handled"
              >
                {(currentRole === 'driver' ? QUICK_REPLIES_DRIVER : QUICK_REPLIES_PASSENGER).map((phrase, idx) => (
                  <TouchableOpacity
                    key={idx}
                    style={styles.quickReplyChip}
                    onPress={() => sendMessage(phrase)}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.quickReplyText}>{phrase}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          <View style={[styles.chatInputContainer, { paddingBottom: dynamicBottomPadding }]}>
            {isRecording ? (
              <View style={styles.recordingBar}>
                <TouchableOpacity onPress={cancelRecording} style={styles.cancelRecBtn}>
                  <Ionicons name="trash-outline" size={22} color="#EF4444" />
                </TouchableOpacity>

                <View style={styles.recordingTimerContainer}>
                  <View style={styles.recordingDot} />
                  <Text style={styles.recordingTimerText}>
                    00:{String(recordDuration).padStart(2, '0')} / 00:15
                  </Text>
                </View>

                <TouchableOpacity onPress={() => stopAndSendRecording()} style={styles.sendAudioBtn}>
                  <Ionicons name="checkmark-sharp" size={20} color="#FFF" />
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <TextInput
                  style={styles.chatInput}
                  value={inputText}
                  onChangeText={setInputText}
                  placeholder={t('type_something', 'Digite sua mensagem...')}
                  placeholderTextColor="#94A3B8"
                  multiline
                  maxLength={250}
                />

                {inputText.trim().length > 0 ? (
                  <TouchableOpacity style={styles.chatSendButton} onPress={() => sendMessage()} activeOpacity={0.8}>
                    <Ionicons name="send" size={18} color="#FFF" style={styles.sendIcon} />
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={styles.micButton} onPress={startRecording} activeOpacity={0.8}>
                    <Ionicons name="mic" size={22} color="#FFF" />
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  chatOverlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(15, 23, 42, 0.4)' },
  chatContainer: { backgroundColor: '#FFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '88%', flex: 1, paddingTop: 8, elevation: 10 },
  chatHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 14, paddingTop: 8, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  chatTitle: { fontSize: 16, fontWeight: '700', color: '#0F172A' },
  chatSubtitle: { fontSize: 12, color: '#64748B', marginTop: 2 },
  closeButton: { backgroundColor: '#F1F5F9', padding: 6, borderRadius: 20 },
  messageList: { paddingHorizontal: 20, paddingVertical: 16 },
  messageRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 16, gap: 8 },
  rowMe: { justifyContent: 'flex-end' },
  rowOther: { justifyContent: 'flex-start' },
  messageContent: { maxWidth: '75%' },
  bubble: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 20 },
  bubbleMe: { backgroundColor: '#0F172A', borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: '#F1F5F9', borderBottomLeftRadius: 4 },
  messageText: { fontSize: 15, lineHeight: 22 },
  textMe: { color: '#FFFFFF' },
  textOther: { color: '#0F172A' },
  timestamp: { fontSize: 10, color: '#94A3B8', marginTop: 4 },
  timestampMe: { textAlign: 'right' },
  timestampOther: { textAlign: 'left' },
  avatarImage: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#E2E8F0' },
  avatarPlaceholder: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#E2E8F0', alignItems: 'center', justifyContent: 'center' },
  chatInputContainer: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 12, backgroundColor: '#FFF', borderTopWidth: 1, borderTopColor: '#F1F5F9', gap: 10 },
  chatInput: { flex: 1, backgroundColor: '#F8FAFC', borderRadius: 22, paddingHorizontal: 18, paddingVertical: 10, fontSize: 15, color: '#0F172A', maxHeight: 100, borderWidth: 1, borderColor: '#E2E8F0' },
  chatSendButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#0F172A', alignItems: 'center', justifyContent: 'center' },
  sendIcon: { marginLeft: 2 },
  micButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#EAB308', alignItems: 'center', justifyContent: 'center' },
  recordingBar: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#FEF2F2', borderRadius: 24, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: '#FECACA' },
  cancelRecBtn: { padding: 6 },
  recordingTimerContainer: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  recordingDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#EF4444' },
  recordingTimerText: { fontSize: 14, fontWeight: '700', color: '#DC2626' },
  sendAudioBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#10B981', alignItems: 'center', justifyContent: 'center' },
  audioContainer: { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 155 },
  audioWaveformPlaceholder: { flexDirection: 'row', alignItems: 'center', gap: 3, flex: 1 },
  audioBar: { width: 3, borderRadius: 2 },
  audioDurationText: { fontSize: 12, fontWeight: '700' },
  quickRepliesWrapper: { backgroundColor: '#FFF', paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  quickRepliesContent: { paddingHorizontal: 16, gap: 8 },
  quickReplyChip: { backgroundColor: '#F8FAFC', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, borderWidth: 1, borderColor: '#E2E8F0' },
  quickReplyText: { fontSize: 13, fontWeight: '600', color: '#334155' },
});
