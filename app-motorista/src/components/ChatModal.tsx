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

export function ChatModal({ 
  visible, 
  onClose, 
  socket, 
  rideId, 
  currentRole = 'driver',
  currentUserPhoto,
  otherUserName,
  otherUserPhoto
}: ChatModalProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [hasRenderError, setHasRenderError] = useState(false);
  
  // Hook defensivo de gravação do expo-audio
  let audioRecorder: any = null;
  try {
    audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  } catch (recorderErr) {
    console.warn('⚠️ [CHAT MOTORISTA] Gravador de áudio não inicializado:', recorderErr);
  }

  // Estados para gravação e reprodução
  const [isRecording, setIsRecording] = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);

  const flatListRef = useRef<FlatList>(null);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activePlayerRef = useRef<any>(null);

  // Chave única no AsyncStorage para persistir o chat da corrida
  const storageKey = `@bai245:chat_${rideId}`;

  // Emissão Segura via Socket para prevenir crash por desconexão
  const safeEmit = (event: string, payload: any) => {
    try {
      if (socket && socket.connected) {
        socket.emit(event, payload);
        console.log(`📡 [CHAT_DRIVER_SOCKET] Evento "${event}" enviado com sucesso.`);
      } else {
        console.warn(`⚠️ [CHAT_DRIVER_SOCKET] Socket desconectado. Evento "${event}" retido localmente.`);
      }
    } catch (err) {
      console.error(`❌ [CHAT_DRIVER_SOCKET] Falha ao emitir "${event}":`, err);
    }
  };

  // 1. Limpa mensagens ao mudar de corrida
  useEffect(() => {
    if (!rideId) {
      setMessages([]);
    }
    setHasRenderError(false);
  }, [rideId]);

  // 2. Salva mensagens no AsyncStorage sempre que a lista for alterada
  useEffect(() => {
    if (messages.length > 0 && rideId) {
      AsyncStorage.setItem(storageKey, JSON.stringify(messages)).catch(() => {});
    }
  }, [messages, rideId, storageKey]);

  // 3. Limpeza ao desmontar
  useEffect(() => {
    return () => {
      if (activePlayerRef.current) {
        try { activePlayerRef.current.pause(); } catch (e) {}
        activePlayerRef.current = null;
      }
      if (recordTimerRef.current) {
        clearInterval(recordTimerRef.current);
      }
    };
  }, []);

  // 4. Carrega do Cache Local e em seguida sincroniza com o Histórico HTTP
  useEffect(() => {
    if (visible && rideId) {
      // Restaura cache local primeiro
      AsyncStorage.getItem(storageKey).then((cached) => {
        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            if (Array.isArray(parsed) && parsed.length > 0) {
              setMessages(parsed);
            }
          } catch (e) {}
        }
      }).catch(() => {});

      // Sincroniza com servidor se a API estiver acessível
      if (api && typeof api.get === 'function') {
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
                id: String(msg.id || `hist-${Math.random().toString(36).substring(2, 7)}`),
                sender: (msg.senderType === 'PASSENGER' || msg.sender === 'passenger' || msg.senderRole === 'passenger') ? 'passenger' : 'driver',
                text: msg.message || msg.text || '',
                audioUrl: msg.audioUrl || msg.audio || null,
                audioDuration: Number(msg.audioDuration || msg.duration || 0),
                senderPhoto: formatPhotoUrl(msg.senderPhoto || msg.userPhoto),
                createdAt: msg.createdAt || new Date().toISOString(),
              }));

              setMessages((prev) => {
                const map = new Map<string, ChatMessage>();
                [...prev, ...history].forEach(m => {
                  if (m && m.id) map.set(m.id, m);
                });
                return Array.from(map.values());
              });
            }
          })
          .catch(error => {
            console.warn("⚠️ [CHAT MOTORISTA] Erro ao carregar histórico HTTP:", error?.message);
          });
      }
    } else if (!visible) {
      if (activePlayerRef.current) {
        try { activePlayerRef.current.pause(); } catch (e) {}
        activePlayerRef.current = null;
        setPlayingAudioId(null);
      }
    }
  }, [visible, rideId, storageKey]);

  // 5. Escuta de mensagens via Socket com trava antiduplicação
  useEffect(() => {
    if (!socket || !visible) return;

    const handleReceiveMessage = (msg: any) => {
      if (!msg) return;

      try {
        const msgSender = (msg.sender === 'passenger' || msg.senderType === 'PASSENGER' || msg.senderRole === 'passenger') ? 'passenger' : 'driver';
        const msgText = msg.text || msg.message || '';
        const msgAudio = msg.audioUrl || msg.audio || null;

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
      } catch (err) {
        console.warn('⚠️ Erro ao processar mensagem recebida via socket no motorista:', err);
      }
    };

    try {
      socket.off('chat:receive_message', handleReceiveMessage);
      socket.off('chat:message', handleReceiveMessage);
      socket.off('chat:new_message', handleReceiveMessage);

      socket.on('chat:receive_message', handleReceiveMessage);
      socket.on('chat:message', handleReceiveMessage);
      socket.on('chat:new_message', handleReceiveMessage);
    } catch (sErr) {
      console.warn('⚠️ Erro ao configurar ouvintes do socket no Chat:', sErr);
    }

    return () => {
      try {
        socket.off('chat:receive_message', handleReceiveMessage);
        socket.off('chat:message', handleReceiveMessage);
        socket.off('chat:new_message', handleReceiveMessage);
      } catch (e) {}
    };
  }, [socket, visible, currentRole]);

  // 6. Envio de mensagem de texto
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

  // 7. Iniciar gravação de áudio com expo-audio
  const startRecording = async () => {
    if (!audioRecorder) {
      Alert.alert(t('error_title', 'Erro'), 'Recurso de microfone não disponível neste aparelho.');
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
      console.error('Falha ao iniciar gravação no motorista:', err);
      setIsRecording(false);
    }
  };

  // 8. Parar e enviar gravação de áudio em Base64
  const stopAndSendRecording = async (finalDuration?: number) => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }

    try {
      setIsRecording(false);
      if (audioRecorder) {
        await audioRecorder.stop();
      }
      const uri = audioRecorder?.uri;

      if (!uri) return;

      const durationSec = finalDuration || recordDuration || 1;
      const uniqueId = `audio-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

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
      console.error('Erro ao finalizar áudio no motorista:', error);
      setIsRecording(false);
    }
  };

  // 9. Cancelar gravação
  const cancelRecording = async () => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    try {
      if (audioRecorder) await audioRecorder.stop();
    } catch (e) {}
    setIsRecording(false);
    setRecordDuration(0);
  };

  // 🟢 NOS DOIS APPS: ChatModal.tsx
const togglePlayAudio = async (msgId: string, audioUrl?: string | null) => {
  if (!audioUrl) return;

  try {
    // Se o áudio clicado já estiver tocando, pausa
    if (playingAudioId === msgId && activePlayerRef.current) {
      try { activePlayerRef.current.pause(); } catch (e) {}
      activePlayerRef.current = null;
      setPlayingAudioId(null);
      return;
    }

    // Pausa qualquer outro áudio ativo antes de iniciar
    if (activePlayerRef.current) {
      try { activePlayerRef.current.pause(); } catch (e) {}
      activePlayerRef.current = null;
    }

    // Prepara a URL ou Base64 para execução
    const formattedUri = audioUrl.startsWith('data:') || audioUrl.startsWith('http') 
      ? audioUrl 
      : `${API_URL}${audioUrl.startsWith('/') ? '' : '/'}${audioUrl}`;

    const player = createAudioPlayer({ uri: formattedUri });
    if (!player) return;

    activePlayerRef.current = player;
    setPlayingAudioId(msgId);
    
    if (typeof player.play === 'function') {
      player.play();
    }

    // Monitora o término da reprodução para restaurar o ícone de Play
    if (typeof player.addListener === 'function') {
      player.addListener('playbackStatusUpdate', (status: any) => {
        if (status?.didJustFinish || status?.error) {
          setPlayingAudioId(null);
          activePlayerRef.current = null;
        }
      });
    }
  } catch (error) {
    console.warn("⚠️ [CHAT] Falha ao reproduzir áudio:", error);
    setPlayingAudioId(null);
    activePlayerRef.current = null;
  }
};
 
  const renderAvatar = (photoUrl?: string | null) => {
    const formatted = formatPhotoUrl(photoUrl);
    if (formatted) {
      return <Image source={{ uri: formatted }} style={styles.avatarImage} />;
    }
    return (
      <View style={styles.avatarPlaceholder}>
        <Ionicons name="person" size={16} color="#64748B" />
      </View>
    );
  };

  const dynamicBottomPadding = Math.max(insets.bottom + 8, Platform.OS === 'android' ? 20 : 16);

  // Interface de contingência (Evita fechar o aplicativo do motorista se houver erro interno)
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
          {/* CABEÇALHO DO CHAT */}
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

          {/* LISTA DE MENSAGENS */}
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
                      
                      {/* SE FOR MENSAGEM DE ÁUDIO */}
                      {item.audioUrl ? (
                        <TouchableOpacity 
                          style={styles.audioContainer}
                          onPress={() => togglePlayAudio(item.id, item.audioUrl)}
                          activeOpacity={0.8}
                        >
                          <Ionicons 
                            name={isPlaying ? "pause-circle" : "play-circle"} 
                            size={32} 
                            color={isMe ? "#EAB308" : "#0F172A"} 
                          />
                          <View style={styles.audioWaveformPlaceholder}>
                            <View style={[styles.audioBar, { height: 12, backgroundColor: isMe ? '#FFF' : '#64748B' }]} />
                            <View style={[styles.audioBar, { height: 20, backgroundColor: isMe ? '#FFF' : '#64748B' }]} />
                            <View style={[styles.audioBar, { height: 16, backgroundColor: isMe ? '#FFF' : '#64748B' }]} />
                            <View style={[styles.audioBar, { height: 24, backgroundColor: isMe ? '#FFF' : '#64748B' }]} />
                            <View style={[styles.audioBar, { height: 10, backgroundColor: isMe ? '#FFF' : '#64748B' }]} />
                          </View>
                          <Text style={[styles.audioDurationText, isMe ? styles.textMe : styles.textOther]}>
                            00:{String(item.audioDuration || 0).padStart(2, '0')}
                          </Text>
                        </TouchableOpacity>
                      ) : (
                        /* SE FOR MENSAGEM DE TEXTO */
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

          {/* CAIXA DE ENTRADA / CONTROLE DE GRAVAÇÃO */}
          <View style={[styles.chatInputContainer, { paddingBottom: dynamicBottomPadding }]}>
            {isRecording ? (
              /* BARRA DE GRAVAÇÃO ATIVA (ATÉ 10s) */
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
              /* ENTRADA DE TEXTO E MIC NORMAL */
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
                  <TouchableOpacity 
                    style={styles.chatSendButton} 
                    onPress={sendMessage}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="send" size={18} color="#FFF" style={styles.sendIcon} />
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity 
                    style={styles.micButton} 
                    onPress={startRecording}
                    activeOpacity={0.8}
                  >
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
  chatOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(15, 23, 42, 0.4)', 
  },
  chatContainer: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '88%',
    flex: 1,
    paddingTop: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 10,
  },
  chatHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 14,
    paddingTop: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  chatTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  chatSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  closeButton: {
    backgroundColor: '#F1F5F9',
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
    backgroundColor: '#0F172A',
    borderBottomRightRadius: 4,
  },
  bubbleOther: {
    backgroundColor: '#F1F5F9',
    borderBottomLeftRadius: 4,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 22,
  },
  textMe: {
    color: '#FFFFFF',
  },
  textOther: {
    color: '#0F172A',
  },
  timestamp: {
    fontSize: 10,
    color: '#94A3B8',
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
    backgroundColor: '#E2E8F0',
  },
  avatarPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    backgroundColor: '#FFF',
    gap: 12,
  },
  chatInput: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    minHeight: 48,
    maxHeight: 120,
    fontSize: 15,
    color: '#0F172A',
  },
  chatSendButton: {
    backgroundColor: '#0F172A',
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micButton: {
    backgroundColor: '#EF4444',
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
    justifyContent: 'space-between',
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
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
    color: '#991B1B',
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