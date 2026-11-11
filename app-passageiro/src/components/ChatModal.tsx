import React, { useState, useEffect, useRef } from 'react';
import { 
  View, Text, TouchableOpacity, StyleSheet, Modal, 
  KeyboardAvoidingView, Platform, Keyboard,
  FlatList, TextInput, Image, TouchableWithoutFeedback, Alert
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Socket } from 'socket.io-client';
import { useTranslation } from 'react-i18next';
import { AudioModule, RecordingPresets, useAudioRecorder, createAudioPlayer } from 'expo-audio';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import { api } from '../services/api';

export interface ChatMessage {
  id: string;
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
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${cleanBase}${cleanPath}`;
};

const formatTime = (isoString?: string) => {
  if (!isoString) return '';
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '';
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
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
      const fileUri = `${FileSystem.cacheDirectory}audio_${msgId.replace(/[^a-zA-Z0-9]/g, '')}.m4a`;
      const fileInfo = await FileSystem.getInfoAsync(fileUri);
      if (!fileInfo.exists) {
        await FileSystem.writeAsStringAsync(fileUri, base64Data, {
          encoding: FileSystem.EncodingType.Base64,
        });
      }
      return fileUri;
    } catch (e) {
      console.warn('⚠️ Erro ao converter áudio base64 em arquivo local:', e);
    }
  }
  const cleanBase = API_URL.replace(/\/$/, '');
  const cleanPath = audioUrl.startsWith('/') ? audioUrl : `/${audioUrl}`;
  return `${cleanBase}${cleanPath}`;
};

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

  let audioRecorder: any = null;
  try {
    audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  } catch (recorderErr) {
    console.warn('⚠️ [CHAT_PASSENGER] Gravador de áudio não inicializado:', recorderErr);
  }

  const [isRecording, setIsRecording] = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);

  const flatListRef = useRef<FlatList>(null);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activePlayerRef = useRef<any>(null);

  const storageKey = `@bai245:chat_${rideId}`;

  const safeEmit = (event: string, payload: any) => {
    try {
      if (socket && socket.connected) {
        socket.emit(event, payload);
      }
    } catch (err) {}
  };

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
      if (activePlayerRef.current) {
        try { activePlayerRef.current.pause(); } catch (e) {}
        activePlayerRef.current = null;
      }
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (visible && rideId) {
      AsyncStorage.getItem(storageKey).then((cached) => {
        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            if (Array.isArray(parsed) && parsed.length > 0) setMessages(parsed);
          } catch (e) {}
        }
      }).catch(() => {});

      if (api && typeof api.get === 'function') {
        api.get(`/rides/${rideId}/chat`)
          .then(response => {
            const data = response?.data;
            const rawList = Array.isArray(data) ? data : Array.isArray(data?.messages) ? data.messages : Array.isArray(data?.history) ? data.history : [];

            if (rawList.length > 0) {
              const history: ChatMessage[] = rawList.map((msg: any) => ({
                id: String(msg.id || `hist-${Math.random().toString(36).substring(2, 7)}`),
                sender: (msg.senderType === 'PASSENGER' || msg.sender === 'passenger' || msg.senderRole === 'passenger') ? 'passenger' : 'driver',
                text: msg.message || msg.text || '',
                audioUrl: msg.audioUrl || msg.audio || msg.fileUrl || null,
                audioDuration: Number(msg.audioDuration || msg.duration || 0),
                senderPhoto: formatPhotoUrl(msg.senderPhoto || msg.userPhoto),
                createdAt: msg.createdAt || new Date().toISOString(),
              }));

              setMessages((prev) => {
                const map = new Map<string, ChatMessage>();
                [...prev, ...history].forEach(m => { if (m && m.id) map.set(m.id, m); });
                return Array.from(map.values());
              });
            }
          })
          .catch(() => {});
      }
    } else if (!visible) {
      if (activePlayerRef.current) {
        try { activePlayerRef.current.pause(); } catch (e) {}
        activePlayerRef.current = null;
        setPlayingAudioId(null);
      }
    }
  }, [visible, rideId, storageKey]);

  useEffect(() => {
    if (!socket || !visible) return;

    const handleReceiveMessage = (msg: any) => {
      if (!msg) return;

      try {
        const msgSender = (msg.sender === 'passenger' || msg.senderType === 'PASSENGER' || msg.senderRole === 'passenger') ? 'passenger' : 'driver';
        const msgText = msg.text || msg.message || '';
        const msgAudio = msg.audioUrl || msg.audio || msg.fileUrl || null;

        const formattedMsg: ChatMessage = {
          id: String(msg.id || `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`),
          sender: msgSender,
          text: msgText,
          audioUrl: msgAudio,
          audioDuration: Number(msg.audioDuration || msg.duration || 0),
          senderPhoto: formatPhotoUrl(msg.senderPhoto),
          createdAt: msg.createdAt || new Date().toISOString(),
        };

        setMessages((prev) => {
          if (prev.some((item) => item.id === formattedMsg.id)) return prev;
          if (formattedMsg.sender === currentRole) {
            const isOptimisticDuplicate = prev.some(
              (item) => item.sender === currentRole && 
              ((msgText && item.text === msgText) || (msgAudio && item.audioUrl === msgAudio))
            );
            if (isOptimisticDuplicate) return prev;
          }
          return [...prev, formattedMsg];
        });
      } catch (err) {}
    };

    try {
      socket.off('chat:receive_message', handleReceiveMessage);
      socket.off('chat:message', handleReceiveMessage);
      socket.off('chat:new_message', handleReceiveMessage);

      socket.on('chat:receive_message', handleReceiveMessage);
      socket.on('chat:message', handleReceiveMessage);
      socket.on('chat:new_message', handleReceiveMessage);
    } catch (sErr) {}

    return () => {
      try {
        socket.off('chat:receive_message', handleReceiveMessage);
        socket.off('chat:message', handleReceiveMessage);
        socket.off('chat:new_message', handleReceiveMessage);
      } catch (e) {}
    };
  }, [socket, visible, currentRole]);

  const sendMessage = () => {
    if (!inputText.trim()) return;

    const text = inputText.trim();
    const uniqueId = `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    const newMsg: ChatMessage = {
      id: uniqueId,
      sender: currentRole,
      text,
      senderPhoto: formatPhotoUrl(currentUserPhoto),
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, newMsg]);

    safeEmit('chat:send_message', { 
      rideId, 
      text, 
      message: text,
      id: uniqueId, 
      sender: currentRole,
      senderRole: currentRole
    });

    setInputText('');
  };

  const startRecording = async () => {
    if (!audioRecorder) {
      Alert.alert(t('error_title', 'Erro'), 'Gravador de áudio indisponível neste dispositivo.');
      return;
    }

    try {
      const permission = await AudioModule.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t('permission_denied', 'Permissão negada'), t('mic_permission_needed', 'Precisamos de acesso ao microfone para enviar áudios.'));
        return;
      }

      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      setIsRecording(true);
      setRecordDuration(0);

      if (recordTimerRef.current) clearInterval(recordTimerRef.current);

      let currentSec = 0;
      recordTimerRef.current = setInterval(() => {
        currentSec += 1;
        setRecordDuration(currentSec);

        if (currentSec >= 10) {
          if (recordTimerRef.current) {
            clearInterval(recordTimerRef.current);
            recordTimerRef.current = null;
          }
          stopAndSendRecording(10);
        }
      }, 1000);

    } catch (err) {
      setIsRecording(false);
    }
  };

  const stopAndSendRecording = async (finalDuration?: number) => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }

    try {
      setIsRecording(false);
      if (audioRecorder) await audioRecorder.stop();
      const uri = audioRecorder?.uri;
      if (!uri) return;

      const durationSec = finalDuration || recordDuration || 1;
      const uniqueId = `audio-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

      let audioPayload = uri;
      try {
        const base64Audio = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        audioPayload = `data:audio/m4a;base64,${base64Audio}`;
      } catch (b64Err) {}

      const newMsg: ChatMessage = {
        id: uniqueId,
        sender: currentRole,
        audioUrl: audioPayload,
        audioDuration: durationSec,
        senderPhoto: formatPhotoUrl(currentUserPhoto),
        createdAt: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, newMsg]);

      safeEmit('chat:send_message', { 
        rideId, 
        audioUrl: audioPayload,
        audio: audioPayload, 
        audioDuration: durationSec, 
        duration: durationSec,
        id: uniqueId,
        sender: currentRole,
        senderRole: currentRole,
        text: '',
        message: ''
      });

      setRecordDuration(0);
    } catch (error) {
      setIsRecording(false);
    }
  };

  const cancelRecording = async () => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    try { if (audioRecorder) await audioRecorder.stop(); } catch (e) {}
    setIsRecording(false);
    setRecordDuration(0);
  };

  const togglePlayAudio = async (msgId: string, audioUrl?: string | null) => {
    if (!audioUrl) return;

    try {
      if (playingAudioId === msgId && activePlayerRef.current) {
        try { activePlayerRef.current.pause(); } catch (e) {}
        activePlayerRef.current = null;
        setPlayingAudioId(null);
        return;
      }

      if (activePlayerRef.current) {
        try { activePlayerRef.current.pause(); } catch (e) {}
        activePlayerRef.current = null;
      }

      const playableUri = await getPlayableAudioUri(msgId, audioUrl);
      const player = createAudioPlayer({ uri: playableUri });
      if (!player) return;

      activePlayerRef.current = player;
      setPlayingAudioId(msgId);
      
      if (typeof player.play === 'function') player.play();

      if (typeof player.addListener === 'function') {
        player.addListener('playbackStatusUpdate', (status: any) => {
          if (status?.didJustFinish || status?.error) {
            setPlayingAudioId(null);
            activePlayerRef.current = null;
          }
        });
      }
    } catch (error) {
      setPlayingAudioId(null);
      activePlayerRef.current = null;
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
            <Text style={{ color: '#FFF', fontSize: 16, fontWeight: 'bold', marginTop: 12 }}>
              Chat indisponível no momento
            </Text>
            <TouchableOpacity style={styles.closeButton} onPress={onClose}>
              <Text style={{ color: '#EAB308', fontWeight: 'bold' }}>Fechar Chat</Text>
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
                  {otherUserName || t('chat_with_user', 'Chat de Suporte / Viagem')}
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
              <Ionicons name="close" size={22} color="#94A3B8" />
            </TouchableOpacity>
          </View>

          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item, index) => item.id ? `${item.id}-${index}` : `msg-${index}`}
            contentContainerStyle={styles.messageList}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => {
              try { flatListRef.current?.scrollToEnd({ animated: true }); } catch (e) {}
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
                            name={isPlaying ? "pause-circle" : "play-circle"} 
                            size={32} 
                            color={isMe ? "#0F172A" : "#EAB308"} 
                          />
                          <View style={styles.audioWaveformPlaceholder}>
                            <View style={[styles.audioBar, { height: 12, backgroundColor: isMe ? '#0F172A' : '#E2E8F0' }]} />
                            <View style={[styles.audioBar, { height: 20, backgroundColor: isMe ? '#0F172A' : '#E2E8F0' }]} />
                            <View style={[styles.audioBar, { height: 16, backgroundColor: isMe ? '#0F172A' : '#E2E8F0' }]} />
                            <View style={[styles.audioBar, { height: 24, backgroundColor: isMe ? '#0F172A' : '#E2E8F0' }]} />
                            <View style={[styles.audioBar, { height: 10, backgroundColor: isMe ? '#0F172A' : '#E2E8F0' }]} />
                          </View>
                          <Text style={[styles.audioDurationText, isMe ? styles.textMe : styles.textOther]}>
                            00:{String(item.audioDuration || 0).padStart(2, '0')}
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

          <View style={[styles.chatInputContainer, { paddingBottom: dynamicBottomPadding }]}>
            {isRecording ? (
              <View style={styles.recordingBar}>
                <TouchableOpacity onPress={cancelRecording} style={styles.cancelRecBtn}>
                  <Ionicons name="trash-outline" size={22} color="#EF4444" />
                </TouchableOpacity>

                <View style={styles.recordingTimerContainer}>
                  <View style={styles.recordingDot} />
                  <Text style={styles.recordingTimerText}>
                    00:{String(recordDuration).padStart(2, '0')} / 00:10
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
                  placeholder={t('type_something', 'Escreva algo...')}
                  placeholderTextColor="#64748B"
                  multiline
                  maxLength={250}
                />

                {inputText.trim().length > 0 ? (
                  <TouchableOpacity style={styles.chatSendButton} onPress={sendMessage} activeOpacity={0.8}>
                    <Ionicons name="send" size={18} color="#0F172A" style={styles.sendIcon} />
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={styles.micButton} onPress={startRecording} activeOpacity={0.8}>
                    <Ionicons name="mic" size={22} color="#0F172A" />
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
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15, 23, 42, 0.6)' },
  chatContainer: { backgroundColor: '#0F172A', borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '88%', flex: 1, paddingTop: 8 },
  chatHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 14, paddingTop: 8, borderBottomWidth: 1, borderBottomColor: '#1E293B' },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  chatTitle: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
  chatSubtitle: { fontSize: 12, color: '#94A3B8', marginTop: 2 },
  closeButton: { backgroundColor: '#1E293B', padding: 6, borderRadius: 20 },
  messageList: { paddingHorizontal: 20, paddingVertical: 16 },
  messageRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 16, gap: 8 },
  rowMe: { justifyContent: 'flex-end' },
  rowOther: { justifyContent: 'flex-start' },
  messageContent: { maxWidth: '75%' },
  bubble: { paddingHorizontal: 16, paddingVertical: 12, borderRadius: 20 },
  bubbleMe: { backgroundColor: '#EAB308', borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: '#1E293B', borderBottomLeftRadius: 4 },
  messageText: { fontSize: 15, lineHeight: 22 },
  textMe: { color: '#0F172A', fontWeight: '600' },
  textOther: { color: '#FFFFFF' },
  timestamp: { fontSize: 10, color: '#64748B', marginTop: 4 },
  timestampMe: { textAlign: 'right' },
  timestampOther: { textAlign: 'left' },
  avatarImage: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#334155' },
  avatarPlaceholder: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#334155', alignItems: 'center', justifyContent: 'center' },
  chatInputContainer: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#1E293B', backgroundColor: '#0F172A', gap: 12 },
  chatInput: { flex: 1, backgroundColor: '#1E293B', borderWidth: 1, borderColor: '#334155', borderRadius: 24, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, minHeight: 48, maxHeight: 120, fontSize: 15, color: '#FFFFFF' },
  chatSendButton: { backgroundColor: '#EAB308', width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  micButton: { backgroundColor: '#EAB308', width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  sendIcon: { marginLeft: 2 },
  audioContainer: { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 160 },
  audioWaveformPlaceholder: { flexDirection: 'row', alignItems: 'center', gap: 3, flex: 1 },
  audioBar: { width: 3, borderRadius: 2 },
  audioDurationText: { fontSize: 12, fontWeight: '600' },
  recordingBar: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#450A0A', borderWidth: 1, borderColor: '#991B1B', borderRadius: 24, paddingHorizontal: 12, height: 48 },
  cancelRecBtn: { padding: 6 },
  recordingTimerContainer: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  recordingDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#EF4444' },
  recordingTimerText: { fontSize: 14, fontWeight: '700', color: '#FCA5A5' },
  sendAudioBtn: { backgroundColor: '#16A34A', width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});