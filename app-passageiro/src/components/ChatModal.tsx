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
  socket: Socket;
  rideId: string;
  currentRole: 'passenger' | 'driver';
  currentUserPhoto?: string | null;
  otherUserName?: string;
  otherUserPhoto?: string | null;
}

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

export function ChatModal({ 
  visible, 
  onClose, 
  socket, 
  rideId, 
  currentRole,
  currentUserPhoto,
  otherUserName,
  otherUserPhoto
}: ChatModalProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const [isRecording, setIsRecording] = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);

  const flatListRef = useRef<FlatList>(null);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activePlayerRef = useRef<any>(null);

  // Key de storage por viagem para manter persistência
  const storageKey = `@bai245:chat_${rideId}`;

  // 💾 Salva a lista de mensagens no AsyncStorage sempre que for atualizada
  useEffect(() => {
    if (messages.length > 0 && rideId) {
      AsyncStorage.setItem(storageKey, JSON.stringify(messages)).catch(() => {});
    }
  }, [messages, rideId, storageKey]);

  useEffect(() => {
    return () => {
      if (activePlayerRef.current) {
        try { activePlayerRef.current.pause(); } catch (e) {}
      }
      if (recordTimerRef.current) {
        clearInterval(recordTimerRef.current);
      }
    };
  }, []);

  // 🔄 Carrega mensagens do Cache Local primeiro e depois da API
  useEffect(() => {
    if (visible && rideId) {
      // 1. Carrega do armazenamento local (restaura se fechar a janela)
      AsyncStorage.getItem(storageKey).then((cached) => {
        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            if (Array.isArray(parsed) && parsed.length > 0) {
              setMessages(parsed);
            }
          } catch (e) {}
        }
      });

      // 2. Sincroniza com a API do Backend
      api.get(`/rides/${rideId}/chat`)
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
              id: String(msg.id || Math.random()),
              sender: (msg.senderType === 'PASSENGER' || msg.sender === 'passenger') ? 'passenger' : 'driver',
              text: msg.message || msg.text || '',
              audioUrl: msg.audioUrl || msg.audio || null,
              audioDuration: msg.audioDuration || 0,
              createdAt: msg.createdAt || new Date().toISOString(),
            }));

            setMessages((prev) => {
              // Unifica o histórico da API sem duplicar os itens locais
              const map = new Map<string, ChatMessage>();
              [...prev, ...history].forEach(m => map.set(m.id, m));
              return Array.from(map.values());
            });
          }
        })
        .catch(error => {
          console.warn("⚠️ [CHAT] Erro ao carregar histórico da API:", error?.response?.data || error?.message);
        });
    } else if (!visible) {
      if (activePlayerRef.current) {
        try { activePlayerRef.current.pause(); } catch (e) {}
        activePlayerRef.current = null;
        setPlayingAudioId(null);
      }
    }
  }, [visible, rideId, storageKey]);

  // ⚡ Socket Listeners
  useEffect(() => {
    if (!socket || !visible) return;

    const handleReceiveMessage = (msg: any) => {
      if (!msg) return;

      const msgSender = (msg.sender === 'passenger' || msg.senderType === 'PASSENGER') ? 'passenger' : 'driver';
      const msgText = msg.text || msg.message || '';
      const msgAudio = msg.audioUrl || msg.audio || null;

      const formattedMsg: ChatMessage = {
        id: String(msg.id || `msg-${Date.now()}-${Math.random()}`),
        sender: msgSender,
        text: msgText,
        audioUrl: msgAudio,
        audioDuration: msg.audioDuration || 0,
        senderPhoto: msg.senderPhoto,
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
    };

    socket.off('chat:receive_message');
    socket.off('chat:message');
    socket.off('chat:new_message');

    socket.on('chat:receive_message', handleReceiveMessage);
    socket.on('chat:message', handleReceiveMessage);
    socket.on('chat:new_message', handleReceiveMessage);

    return () => {
      socket.off('chat:receive_message', handleReceiveMessage);
      socket.off('chat:message', handleReceiveMessage);
      socket.off('chat:new_message', handleReceiveMessage);
    };
  }, [socket, visible, currentRole]);

  const sendMessage = () => {
    if (!inputText.trim() || !socket) return;

    const text = inputText.trim();
    const uniqueId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;

    const newMsg: ChatMessage = {
      id: uniqueId,
      sender: currentRole,
      text,
      senderPhoto: currentUserPhoto,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, newMsg]);
    socket.emit('chat:send_message', { rideId, text, id: uniqueId, sender: currentRole });
    setInputText('');
  };

  const startRecording = async () => {
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

      recordTimerRef.current = setInterval(() => {
        setRecordDuration((prev) => {
          if (prev >= 9) {
            stopAndSendRecording(10);
            return 10;
          }
          return prev + 1;
        });
      }, 1000);

    } catch (err) {
      console.error('Falha ao iniciar gravação:', err);
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
      await audioRecorder.stop();
      const uri = audioRecorder.uri;

      if (!uri) return;

      const durationSec = finalDuration || recordDuration || 1;
      const uniqueId = `audio-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;

      // 🎙️ Converte o arquivo de áudio para Base64 para enviar via Socket/API
      let audioPayload = uri;
      try {
        const base64Audio = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
        audioPayload = `data:audio/m4a;base64,${base64Audio}`;
      } catch (b64Err) {
        console.warn('⚠️ Não foi possível converter áudio para base64:', b64Err);
      }

      const newMsg: ChatMessage = {
        id: uniqueId,
        sender: currentRole,
        audioUrl: audioPayload,
        audioDuration: durationSec,
        senderPhoto: currentUserPhoto,
        createdAt: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, newMsg]);

      socket.emit('chat:send_message', { 
        rideId, 
        audioUrl: audioPayload, 
        audioDuration: durationSec, 
        id: uniqueId,
        sender: currentRole
      });

      setRecordDuration(0);
    } catch (error) {
      console.error('Erro ao finalizar áudio:', error);
      setIsRecording(false);
    }
  };

  const cancelRecording = async () => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    try {
      await audioRecorder.stop();
    } catch (e) {}
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

      const player = createAudioPlayer({ uri: audioUrl });
      activePlayerRef.current = player;
      setPlayingAudioId(msgId);
      player.play();

      player.addListener('playbackStatusUpdate', (status: any) => {
        if (status?.didJustFinish) {
          setPlayingAudioId(null);
          activePlayerRef.current = null;
        }
      });
    } catch (error) {
      console.warn("Erro ao reproduzir áudio:", error);
      setPlayingAudioId(null);
    }
  };

  const renderAvatar = (photoUrl?: string | null) => {
    if (photoUrl) {
      return <Image source={{ uri: photoUrl }} style={styles.avatarImage} />;
    }
    return (
      <View style={styles.avatarPlaceholder}>
        <Ionicons name="person" size={16} color="#64748B" />
      </View>
    );
  };

  const dynamicBottomPadding = Math.max(insets.bottom + 8, Platform.OS === 'android' ? 20 : 16);

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
          {/* CABEÇALHO */}
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

          {/* MENSAGENS */}
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item, index) => item.id || String(index)}
            contentContainerStyle={styles.messageList}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
            renderItem={({ item }) => {
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

                  {isMe && renderAvatar(currentUserPhoto)}
                </View>
              );
            }}
          />

          {/* INPUT + BOTÃO DE ÁUDIO/MIC */}
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

                <TouchableOpacity 
                  onPress={() => stopAndSendRecording()} 
                  style={styles.sendAudioBtn}
                >
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
                  <TouchableOpacity 
                    style={styles.chatSendButton} 
                    onPress={sendMessage}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="send" size={18} color="#0F172A" style={styles.sendIcon} />
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity 
                    style={styles.micButton} 
                    onPress={startRecording}
                    activeOpacity={0.8}
                  >
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
  chatOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(15, 23, 42, 0.6)', 
  },
  chatContainer: {
    backgroundColor: '#0F172A',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '88%',
    flex: 1,
    paddingTop: 8,
  },
  chatHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 14,
    paddingTop: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  chatTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  chatSubtitle: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 2,
  },
  closeButton: {
    backgroundColor: '#1E293B',
    padding: 6,
    borderRadius: 20,
  },
  messageList: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 16,
    gap: 8,
  },
  rowMe: {
    justifyContent: 'flex-end',
  },
  rowOther: {
    justifyContent: 'flex-start',
  },
  messageContent: {
    maxWidth: '75%',
  },
  bubble: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
  },
  bubbleMe: {
    backgroundColor: '#EAB308',
    borderBottomRightRadius: 4,
  },
  bubbleOther: {
    backgroundColor: '#1E293B',
    borderBottomLeftRadius: 4,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 22,
  },
  textMe: {
    color: '#0F172A',
    fontWeight: '600',
  },
  textOther: {
    color: '#FFFFFF',
  },
  timestamp: {
    fontSize: 10,
    color: '#64748B',
    marginTop: 4,
  },
  timestampMe: {
    textAlign: 'right',
  },
  timestampOther: {
    textAlign: 'left',
  },
  avatarImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#334155',
  },
  avatarPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#334155',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#1E293B',
    backgroundColor: '#0F172A',
    gap: 12,
  },
  chatInput: {
    flex: 1,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    minHeight: 48,
    maxHeight: 120,
    fontSize: 15,
    color: '#FFFFFF',
  },
  chatSendButton: {
    backgroundColor: '#EAB308',
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micButton: {
    backgroundColor: '#EAB308',
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendIcon: {
    marginLeft: 2, 
  },
  audioContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 160,
  },
  audioWaveformPlaceholder: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    flex: 1,
  },
  audioBar: {
    width: 3,
    borderRadius: 2,
  },
  audioDurationText: {
    fontSize: 12,
    fontWeight: '600',
  },
  recordingBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    backgroundColor: '#450A0A',
    borderWidth: 1,
    borderColor: '#991B1B',
    borderRadius: 24,
    paddingHorizontal: 12,
    height: 48,
  },
  cancelRecBtn: {
    padding: 6,
  },
  recordingTimerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#EF4444',
  },
  recordingTimerText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FCA5A5',
  },
  sendAudioBtn: {
    backgroundColor: '#16A34A',
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});