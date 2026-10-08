import React, { useState, useEffect, useRef } from 'react';
import { 
  View, Text, TouchableOpacity, StyleSheet, Modal, 
  KeyboardAvoidingView, Platform, Keyboard,
  FlatList, TextInput, Image, TouchableWithoutFeedback
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Socket } from 'socket.io-client';
import { useTranslation } from 'react-i18next';
import { api } from '../services/api';

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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const flatListRef = useRef<FlatList>(null);

  // 1. Escuta novas mensagens via Socket
  useEffect(() => {
    if (!socket || !visible) return;

    const handleReceiveMessage = (msg: any) => {
      const formattedMsg: ChatMessage = {
        id: msg.id || String(Date.now()),
        sender: msg.sender === 'passenger' || msg.senderType === 'PASSENGER' ? 'passenger' : 'driver',
        text: msg.text || msg.message || msg.content || '',
        senderPhoto: msg.senderPhoto,
        createdAt: msg.createdAt || new Date().toISOString(),
      };
      setMessages((prev) => [...prev, formattedMsg]);
    };

    socket.on('chat:receive_message', handleReceiveMessage);

    return () => {
      socket.off('chat:receive_message', handleReceiveMessage);
    };
  }, [socket, visible]);

  // 2. Busca histórico HTTP de forma ULTRA SEGURA (Evita TypeError)
  useEffect(() => {
    if (visible && rideId) {
      api.get(`/rides/${rideId}/chat`)
        .then(response => {
          const data = response?.data;
          
          // 🛡️ Garante que extrai um Array independente do formato retornado pelo backend
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
            text: msg.message || msg.text || msg.content || '',
            createdAt: msg.createdAt,
          }));

          setMessages(history);
        })
        .catch(error => {
          console.warn("⚠️ Erro ao carregar histórico do chat:", error?.response?.data || error?.message);
          setMessages([]); // Mantém array vazio sem quebrar o app
        });
    } else if (!visible) {
      setMessages([]);
    }
  }, [visible, rideId]);

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
    if (photoUrl) {
      return <Image source={{ uri: photoUrl }} style={styles.avatarImage} />;
    }
    return (
      <View style={styles.avatarPlaceholder}>
        <Ionicons name="person" size={16} color="#64748B" />
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView 
        style={styles.chatOverlay} 
        behavior={Platform.OS === 'ios' ? 'padding' : 'padding'} 
        keyboardVerticalOffset={Platform.OS === 'android' ? 24 : 0} 
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
            keyExtractor={(item, index) => item.id || String(index)}
            contentContainerStyle={styles.messageList}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })}
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
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.4)', 
  },
  chatContainer: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    height: '90%',
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
    paddingBottom: 16,
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
    maxWidth: '72%',
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
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'android' ? 24 : 32, 
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
    marginBottom: 0, 
  },
  chatSendButtonDisabled: {
    backgroundColor: '#CBD5E1',
  },
  sendIcon: {
    marginLeft: 4, 
  },
});