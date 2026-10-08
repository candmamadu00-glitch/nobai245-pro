import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  TextInput,
  Modal,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../services/api';
import { getSocket } from '../services/socket';

export type TicketStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type TicketCategory =
  | 'PAYMENT_BILLING'
  | 'APP_ISSUE'
  | 'RIDE_PROBLEM'
  | 'SAFETY'
  | 'OTHER';

interface TicketMessage {
  id: string;
  sender: 'ADMIN' | 'PASSENGER' | 'DRIVER';
  message: string;
  createdAt: string;
}

interface Ticket {
  id: string;
  category: TicketCategory | string;
  priority?: TicketPriority;
  status: TicketStatus;
  description: string;
  rideId?: string | null;
  createdAt: string;
  messages: TicketMessage[];
}

const CATEGORIES: { label: string; value: TicketCategory }[] = [
  { label: 'Valores e Cobrança', value: 'PAYMENT_BILLING' },
  { label: 'Problema no App', value: 'APP_ISSUE' },
  { label: 'Problema na Corrida', value: 'RIDE_PROBLEM' },
  { label: 'Segurança', value: 'SAFETY' },
  { label: 'Outros', value: 'OTHER' },
];

export function SupportHelp({ navigation, route }: any) {
  const initialRideId = route?.params?.rideId || null;

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [category, setCategory] = useState<TicketCategory>('PAYMENT_BILLING');
  const [description, setDescription] = useState('');
  const [rideId, setRideId] = useState<string | null>(initialRideId);
  const [creating, setCreating] = useState(false);

  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [chatMessages, setChatMessages] = useState<TicketMessage[]>([]);
  const [inputMessage, setInputMessage] = useState('');
  const flatListRef = useRef<FlatList>(null);

  const socket = typeof getSocket === 'function' ? getSocket() : null;

  const fetchTickets = async () => {
    try {
      const response = await api.get('/drivers/tickets/my-tickets');
      setTickets(response.data || []);
    } catch (error: any) {
      console.log('Erro na requisição:', error);
      Alert.alert(
        'Erro',
        error.response?.data?.error || error.message || 'Falha ao carregar chamados.'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTickets();
  }, []);

  useEffect(() => {
    if (!selectedTicket || !socket) return;

    socket.emit?.('ticket:join', { ticketId: selectedTicket.id });

    const handleReceiveMessage = (newMessage: TicketMessage) => {
      if (!newMessage) return;
      setChatMessages((prev) => {
        if (newMessage.id && prev.some((m) => m.id === newMessage.id)) return prev;
        return [...prev, newMessage];
      });
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    };

    socket.on?.('ticket:receive_message', handleReceiveMessage);

    return () => {
      socket.off?.('ticket:receive_message', handleReceiveMessage);
    };
  }, [selectedTicket, socket]);

  const handleCreateTicket = async () => {
    if (description.trim().length < 10) {
      Alert.alert('Atenção', 'Descreva o problema com no mínimo 10 caracteres.');
      return;
    }

    setCreating(true);
    try {
      await api.post('/drivers/tickets', {
        category,
        description: description.trim(),
        rideId: rideId || undefined,
        priority: category === 'SAFETY' ? 'HIGH' : 'MEDIUM',
      });
      Alert.alert('Sucesso', 'Chamado aberto com sucesso!');
      setIsCreateModalOpen(false);
      setDescription('');
      setRideId(null);
      fetchTickets();
    } catch (error: any) {
      console.log('Erro ao criar chamado:', error);
      Alert.alert('Erro', error.response?.data?.error || 'Não foi possível criar o chamado.');
    } finally {
      setCreating(false);
    }
  };

  const handleOpenChat = (ticket: Ticket) => {
    setSelectedTicket(ticket);
    setChatMessages(ticket.messages || []);
  };

  const handleSendMessage = async () => {
    if (!inputMessage.trim() || !selectedTicket) return;

    const messageText = inputMessage.trim();
    setInputMessage('');

    if (socket && socket.connected) {
      socket.emit('ticket:send_message', {
        ticketId: selectedTicket.id,
        message: messageText,
        sender: 'DRIVER',
      });
    } else {
      try {
        const response = await api.post(`/drivers/tickets/${selectedTicket.id}/reply`, {
          message: messageText,
        });
        if (response.data) {
          setChatMessages((prev) => {
            if (response.data.id && prev.some((m) => m.id === response.data.id)) return prev;
            return [...prev, response.data];
          });
        }
      } catch (error) {
        Alert.alert('Erro', 'Falha ao enviar mensagem via rede.');
      }
    }
  };

  const getStatusBadge = (status: TicketStatus | string) => {
    switch (status) {
      case 'OPEN':
        return { label: 'Aberto', bg: '#FEF3C7', text: '#D97706' };
      case 'IN_PROGRESS':
        return { label: 'Em Análise', bg: '#E0F2FE', text: '#0284C7' };
      case 'RESOLVED':
        return { label: 'Resolvido', bg: '#D1FAE5', text: '#059669' };
      default:
        return { label: 'Fechado', bg: '#F3F4F6', text: '#6B7280' };
    }
  };

  const getCategoryLabel = (cat: string) => {
    const found = CATEGORIES.find((c) => c.value === cat);
    return found ? found.label : cat;
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color="#1F2937" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Suporte ao Motorista</Text>
        <TouchableOpacity onPress={() => setIsCreateModalOpen(true)}>
          <Ionicons name="add-circle-outline" size={26} color="#059669" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#059669" />
        </View>
      ) : tickets.length === 0 ? (
        <View style={styles.centerContainer}>
          <Ionicons name="headset-outline" size={56} color="#D1D5DB" />
          <Text style={styles.emptyTitle}>Nenhum chamado aberto</Text>
          <Text style={styles.emptySubtitle}>
            Precisa de ajuda com repasses, taxas ou viagens? Abra um chamado abaixo.
          </Text>
          <TouchableOpacity style={styles.createButton} onPress={() => setIsCreateModalOpen(true)}>
            <Text style={styles.createButtonText}>Novo Chamado</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={tickets}
          keyExtractor={(item, index) => (item.id ? `${item.id}-${index}` : String(index))}
          contentContainerStyle={{ padding: 16 }}
          renderItem={({ item }) => {
            const badge = getStatusBadge(item.status);
            return (
              <TouchableOpacity style={styles.ticketCard} onPress={() => handleOpenChat(item)}>
                <View style={styles.ticketHeader}>
                  <Text style={styles.ticketCategory}>{getCategoryLabel(item.category)}</Text>
                  <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
                    <Text style={[styles.statusText, { color: badge.text }]}>{badge.label}</Text>
                  </View>
                </View>

                {item.rideId && (
                  <Text style={styles.rideRefText}>Corrida ref: #{item.rideId.slice(-6)}</Text>
                )}

                <Text style={styles.ticketDescription} numberOfLines={2}>
                  {item.description}
                </Text>

                <View style={styles.ticketFooter}>
                  <Text style={styles.ticketDate}>
                    {new Date(item.createdAt).toLocaleDateString('pt-BR')}
                  </Text>
                  <Text style={styles.chatLink}>Ver conversa ({item.messages?.length || 0}) →</Text>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}

      {/* Modal Novo Chamado */}
      <Modal visible={isCreateModalOpen} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Novo Chamado de Suporte</Text>
              <TouchableOpacity onPress={() => setIsCreateModalOpen(false)}>
                <Ionicons name="close" size={24} color="#6B7280" />
              </TouchableOpacity>
            </View>

            <Text style={styles.label}>Categoria do Problema</Text>
            <View style={styles.categoryContainer}>
              {CATEGORIES.map((cat) => (
                <TouchableOpacity
                  key={cat.value}
                  style={[styles.categoryChip, category === cat.value && styles.categoryChipActive]}
                  onPress={() => setCategory(cat.value)}
                >
                  <Text
                    style={[
                      styles.categoryChipText,
                      category === cat.value && styles.categoryChipTextActive,
                    ]}
                  >
                    {cat.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {rideId && (
              <View style={styles.rideBadgeContainer}>
                <Ionicons name="car-outline" size={16} color="#059669" />
                <Text style={styles.rideBadgeText}>Vinculado à corrida #{rideId.slice(-6)}</Text>
                <TouchableOpacity onPress={() => setRideId(null)}>
                  <Ionicons name="close-circle" size={16} color="#9CA3AF" />
                </TouchableOpacity>
              </View>
            )}

            <Text style={styles.label}>Descrição Detalhada</Text>
            <TextInput
              style={styles.textArea}
              placeholder="Explique detalhadamente o que ocorreu..."
              multiline
              numberOfLines={4}
              value={description}
              onChangeText={setDescription}
            />

            <TouchableOpacity style={styles.submitButton} onPress={handleCreateTicket} disabled={creating}>
              {creating ? <ActivityIndicator color="#FFF" /> : <Text style={styles.submitButtonText}>Enviar Chamado</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modal Chat */}
      <Modal visible={!!selectedTicket} animationType="slide">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.container}
        >
          <View style={styles.header}>
            <TouchableOpacity onPress={() => setSelectedTicket(null)}>
              <Ionicons name="close" size={24} color="#1F2937" />
            </TouchableOpacity>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {selectedTicket ? getCategoryLabel(selectedTicket.category) : 'Suporte'}
            </Text>
            <View style={{ width: 24 }} />
          </View>

          <FlatList
            ref={flatListRef}
            data={chatMessages}
            keyExtractor={(item, index) => (item.id ? `${item.id}-${index}` : String(index))}
            contentContainerStyle={{ padding: 16 }}
            renderItem={({ item }) => {
              const isMe = item.sender === 'DRIVER';
              return (
                <View style={[styles.messageBubble, isMe ? styles.myMessage : styles.theirMessage]}>
                  <Text style={isMe ? styles.myMessageText : styles.theirMessageText}>{item.message}</Text>
                  <Text style={[styles.messageTime, isMe ? { color: '#D1FAE5' } : { color: '#9CA3AF' }]}>
                    {new Date(item.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
              );
            }}
          />

          <View style={styles.inputContainer}>
            <TextInput
              style={styles.chatInput}
              placeholder="Escreva uma mensagem..."
              value={inputMessage}
              onChangeText={setInputMessage}
            />
            <TouchableOpacity style={styles.sendButton} onPress={handleSendMessage}>
              <Ionicons name="send" size={18} color="#FFF" />
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// Objeto de sombra reutilizável
const floatingShadow = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 2 },
  shadowOpacity: 0.08,
  shadowRadius: 4,
  elevation: 3,
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#1F2937' },
  emptyTitle: { fontSize: 18, fontWeight: 'bold', color: '#374151', marginTop: 12 },
  emptySubtitle: { fontSize: 14, color: '#6B7280', textAlign: 'center', marginTop: 6, marginBottom: 20 },
  createButton: { backgroundColor: '#059669', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 8, ...floatingShadow },
  createButtonText: { color: '#FFF', fontWeight: 'bold' },
  ticketCard: {
    backgroundColor: '#FFF',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    ...floatingShadow,
  },
  ticketHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  ticketCategory: { fontSize: 15, fontWeight: 'bold', color: '#1F2937' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12 },
  statusText: { fontSize: 11, fontWeight: 'bold' },
  rideRefText: { fontSize: 11, color: '#059669', fontWeight: '600', marginTop: 4 },
  ticketDescription: { fontSize: 13, color: '#4B5563', marginVertical: 8 },
  ticketFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  ticketDate: { fontSize: 12, color: '#9CA3AF' },
  chatLink: { fontSize: 12, color: '#059669', fontWeight: 'bold' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#FFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#1F2937' },
  label: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 8 },
  categoryContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  categoryChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#D1D5DB' },
  categoryChipActive: { borderColor: '#059669', backgroundColor: '#ECFDF5' },
  categoryChipText: { fontSize: 12, color: '#4B5563' },
  categoryChipTextActive: { color: '#059669', fontWeight: 'bold' },
  rideBadgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginBottom: 16,
  },
  rideBadgeText: { fontSize: 12, color: '#047857', flex: 1, fontWeight: '500' },
  textArea: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    padding: 12,
    textAlignVertical: 'top',
    marginBottom: 20,
    fontSize: 14,
  },
  submitButton: { backgroundColor: '#059669', paddingVertical: 14, borderRadius: 8, alignItems: 'center', ...floatingShadow },
  submitButtonText: { color: '#FFF', fontWeight: 'bold', fontSize: 15 },
  messageBubble: { maxWidth: '80%', padding: 12, borderRadius: 12, marginBottom: 10 },
  myMessage: { alignSelf: 'flex-end', backgroundColor: '#059669', borderBottomRightRadius: 2 },
  theirMessage: { alignSelf: 'flex-start', backgroundColor: '#E5E7EB', borderBottomLeftRadius: 2 },
  myMessageText: { color: '#FFF', fontSize: 14 },
  theirMessageText: { color: '#1F2937', fontSize: 14 },
  messageTime: { fontSize: 10, marginTop: 4, alignSelf: 'flex-end' },
  inputContainer: {
    flexDirection: 'row',
    padding: 12,
    backgroundColor: '#FFF',
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
    alignItems: 'center',
    gap: 8,
  },
  chatInput: { flex: 1, borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  sendButton: { backgroundColor: '#059669', padding: 10, borderRadius: 20, justifyContent: 'center', alignItems: 'center', ...floatingShadow },
});