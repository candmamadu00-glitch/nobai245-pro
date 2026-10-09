import React, { useState, useEffect, useRef } from 'react';
import { 
  View, Text, TouchableOpacity, StyleSheet, Modal, 
  KeyboardAvoidingView, Platform, Keyboard,
  FlatList, TextInput, Image, TouchableWithoutFeedback, SafeAreaView
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Socket } from 'socket.io-client';
import { useTranslation } from 'react-i18next';
import { api } from '../services/api';

const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://api.nobai245.com').replace(/\/api\/?$/, '');

const formatPhotoUrl = (path?: string | null) => {
  if (!path || typeof path !== 'string') return undefined;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const cleanBase = API_URL.replace(/\/$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${cleanBase}${cleanPath}`;
};

export interface ChatMessage {
  id: string;
  sender: 'passenger' | 'driver';
  text: string;
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
  const date = new Date(isoString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const flatListRef = useRef<FlatList>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!socket || !visible) return;

    const handleReceiveMessage = (msg: ChatMessage) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        return [...prev, msg];
      });
    };

    socket.on('chat:receive_message', handleReceiveMessage);

    return () => {
      socket.off('chat:receive_message', handleReceiveMessage);
    };
  }, [socket, visible]);

  useEffect(() => {
    if (visible && rideId) {
      api.get(`/rides/${rideId}/chat`)
        .then(response => {
          if (!isMountedRef.current) return;
          const history = (response.data || []).map((msg: any) => ({
            id: msg.id || String(Date.now() + Math.random()),
            sender: msg.senderType === 'PASSENGER' ? 'passenger' : 'driver',
            text: msg.message,
            senderPhoto: msg.senderType === 'PASSENGER' 
              ? (currentRole === 'passenger' ? currentUserPhoto : otherUserPhoto) 
              : (currentRole === 'driver' ? currentUserPhoto : otherUserPhoto),
            createdAt: msg.createdAt,
          }));
          setMessages(history);
        })
        .catch(error => console.error("Erro ao carregar histórico do chat:", error));
    } else if (!visible) {
      setMessages([]);
    }
  }, [visible, rideId, currentRole, currentUserPhoto, otherUserPhoto]);

  const sendMessage = () => {
    if (!inputText.trim() || !socket) return;

    const text = inputText.trim();
    const newMsg: ChatMessage = {
      id: String(Date.now()),
      sender: currentRole,
      text,
      senderPhoto: currentUserPhoto,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, newMsg]);
    socket.emit('chat:send_message', { rideId, text });
    setInputText('');
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

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={styles.backdrop} />
        </TouchableWithoutFeedback>

        <SafeAreaView style={styles.chatContainer}>
          <KeyboardAvoidingView 
            style={styles.keyboardAvoidingView} 
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={Platform.OS === 'ios' ? 10 : 0}
          >
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
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.messageList}
              keyboardShouldPersistTaps="handled"
              onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
              onLayout={() => flatListRef.current?.scrollToEnd({ animated: false })}
              renderItem={({ item }) => {
                const isMe = item.sender === currentRole;
                return (
                  <View style={[styles.messageRow, isMe ? styles.rowMe : styles.rowOther]}>
                    {!isMe && renderAvatar(item.senderPhoto || otherUserPhoto)}
                    
                    <View style={styles.messageContent}>
                      <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleOther]}>
                        <Text style={[styles.messageText, isMe ? styles.textMe : styles.textOther]}>
                          {item.text}
                        </Text>
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

            {/* CAMPO DE DIGITAÇÃO FIXO ACIMA DO TECLADO */}
            <View style={styles.chatInputContainer}>
              <TextInput
                style={styles.chatInput}
                value={inputText}
                onChangeText={setInputText}
                placeholder={t('type_something', 'Digite sua mensagem...')}
                placeholderTextColor="#94A3B8"
                multiline
                maxLength={250}
              />
              <TouchableOpacity 
                style={[styles.chatSendButton, !inputText.trim() && styles.chatSendButtonDisabled]} 
                onPress={sendMessage}
                disabled={!inputText.trim()}
              >
                <Ionicons name="send" size={18} color="#FFF" style={styles.sendIcon} />
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.5)', 
  },
  chatContainer: {
    flex: 1,
    marginTop: Platform.OS === 'ios' ? 48 : 36,
    backgroundColor: '#FFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 10,
    overflow: 'hidden',
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  chatHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    backgroundColor: '#FFF',
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
    marginTop: 1,
  },
  closeButton: {
    backgroundColor: '#F1F5F9',
    padding: 6,
    borderRadius: 20,
  },
  messageList: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  messageRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 14,
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
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
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
    lineHeight: 21,
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
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#E2E8F0',
  },
  avatarPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 24 : 14,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    backgroundColor: '#FFFFFF',
    gap: 10,
  },
  chatInput: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    minHeight: 44,
    maxHeight: 100,
    fontSize: 15,
    color: '#0F172A',
  },
  chatSendButton: {
    backgroundColor: '#0F172A',
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chatSendButtonDisabled: {
    backgroundColor: '#CBD5E1',
  },
  sendIcon: {
    marginLeft: 2, 
  },
});