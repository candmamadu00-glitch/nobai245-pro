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
import { Audio } from 'expo-audio';
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
  
  // Estados para gravação e reprodução de áudio
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordDuration, setRecordDuration] = useState(0);
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [soundObject, setSoundObject] = useState<Audio.Sound | null>(null);

  const flatListRef = useRef<FlatList>(null);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 1. Limpeza de som ao fechar o modal ou desmontar
  useEffect(() => {
    return () => {
      if (soundObject) {
        soundObject.unloadAsync();
      }
      if (recordTimerRef.current) {
        clearInterval(recordTimerRef.current);
      }
    };
  }, [soundObject]);

  // 2. Escuta de mensagens via Socket (Texto + Áudio)
  useEffect(() => {
    if (!socket || !visible) return;

    const handleReceiveMessage = (msg: any) => {
      if (!msg) return;

      const formattedMsg: ChatMessage = {
        id: String(msg.id || Date.now()),
        sender: msg.sender === 'passenger' || msg.senderType === 'PASSENGER' ? 'passenger' : 'driver',
        text: msg.text || msg.message || '',
        audioUrl: msg.audioUrl || msg.audio || null,
        audioDuration: msg.audioDuration || 0,
        senderPhoto: msg.senderPhoto,
        createdAt: msg.createdAt || new Date().toISOString(),
      };

      setMessages((prev) => {
        const isDuplicate = prev.some((item) => item.id === formattedMsg.id);
        if (isDuplicate) return prev;
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
  }, [socket, visible]);

  // 3. Busca histórico HTTP
  useEffect(() => {
    if (visible && rideId) {
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

          const history: ChatMessage[] = rawList.map((msg: any) => ({
            id: String(msg.id || Math.random()),
            sender: (msg.senderType === 'PASSENGER' || msg.sender === 'passenger') ? 'passenger' : 'driver',
            text: msg.message || msg.text || '',
            audioUrl: msg.audioUrl || msg.audio || null,
            audioDuration: msg.audioDuration || 0,
            createdAt: msg.createdAt,
          }));

          setMessages(history);
        })
        .catch(error => {
          console.warn("⚠️ Erro ao carregar histórico do chat:", error?.response?.data || error?.message);
          setMessages([]);
        });
    } else if (!visible) {
      setMessages([]);
      if (soundObject) {
        soundObject.unloadAsync();
        setPlayingAudioId(null);
      }
    }
  }, [visible, rideId]);

  // 4. Envio de mensagem de texto
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
    socket.emit('chat:send_message', { rideId, text, id: uniqueId });
    setInputText('');
  };

  // 5. Iniciar gravação de áudio (Máximo 10 segundos)
  const startRecording = async () => {
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (permission.status !== 'granted') {
        Alert.alert(t('permission_denied', 'Permissão negada'), t('mic_permission_needed', 'Precisamos de acesso ao microfone para enviar áudios.'));
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording: newRecording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      setRecording(newRecording);
      setIsRecording(true);
      setRecordDuration(0);

      // Cronômetro para limite de 10 segundos
      recordTimerRef.current = setInterval(() => {
        setRecordDuration((prev) => {
          if (prev >= 9) {
            stopAndSendRecording(newRecording, 10);
            return 10;
          }
          return prev + 1;
        });
      }, 1000);

    } catch (err) {
      console.error('Falha ao iniciar gravação:', err);
    }
  };

  // 6. Parar e enviar gravação de áudio
  const stopAndSendRecording = async (recToStop?: Audio.Recording | null, finalDuration?: number) => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }

    const currentRec = recToStop || recording;
    if (!currentRec) return;

    try {
      setIsRecording(false);
      await currentRec.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });

      const uri = currentRec.getURI();
      setRecording(null);

      if (!uri) return;

      const durationSec = finalDuration || recordDuration || 1;
      const uniqueId = `audio-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;

      // Cria objeto de mensagem local
      const newMsg: ChatMessage = {
        id: uniqueId,
        sender: currentRole,
        audioUrl: uri,
        audioDuration: durationSec,
        senderPhoto: currentUserPhoto,
        createdAt: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, newMsg]);

      // Envio via socket (pode enviar o URI ou integrar com a rota de upload de mídia da sua API)
      socket.emit('chat:send_message', { 
        rideId, 
        audioUrl: uri, 
        audioDuration: durationSec, 
        id: uniqueId 
      });

    } catch (error) {
      console.error('Erro ao finalizar áudio:', error);
    }
  };

  // 7. Cancelar gravação sem enviar
  const cancelRecording = async () => {
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    if (recording) {
      try {
        await recording.stopAndUnloadAsync();
      } catch (e) {}
    }
    setRecording(null);
    setIsRecording(false);
    setRecordDuration(0);
  };

  // 8. Reproduzir ou Pausar Mensagem de Voz
  const togglePlayAudio = async (msgId: string, audioUrl?: string | null) => {
    if (!audioUrl) return;

    try {
      if (playingAudioId === msgId && soundObject) {
        await soundObject.pauseAsync();
        setPlayingAudioId(null);
        return;
      }

      if (soundObject) {
        await soundObject.unloadAsync();
      }

      const { sound } = await Audio.Sound.createAsync(
        { uri: audioUrl },
        { shouldPlay: true }
      );

      setSoundObject(sound);
      setPlayingAudioId(msgId);

      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          setPlayingAudioId(null);
          sound.unloadAsync();
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

                  {isMe && renderAvatar(currentUserPhoto)}
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
  /* ESTILOS DE ÁUDIO */
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
  /* ESTILOS BARRA DE GRAVAÇÃO ATIVA */
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