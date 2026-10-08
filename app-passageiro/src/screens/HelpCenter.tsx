import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, StatusBar, Platform,
  TextInput, Alert, ScrollView, ActivityIndicator, Modal,
  KeyboardAvoidingView, Keyboard, Pressable, RefreshControl,
  TouchableWithoutFeedback
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { api } from '../services/api';
import { socket } from '../services/passengerSocket';

type TicketCategory = 'LOST_ITEM' | 'CHARGE_DISPUTE' | 'CONDUCT_REPORT' | 'OTHER';

interface TicketMessage {
  id: string;
  sender: 'ADMIN' | 'PASSENGER';
  message: string;
  createdAt: string;
}

interface Ticket {
  id: string;
  category: TicketCategory;
  description: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
  createdAt: string;
  messages?: TicketMessage[];
}

interface Ride {
  id: string;
  createdAt?: string;
  driver?: {
    fullName?: string;
  };
}

export function HelpCenter() {
  const navigation = useNavigation();
  const { t } = useTranslation();
  
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rides, setRides] = useState<Ride[]>([]);
  const [selectedRideId, setSelectedRideId] = useState<string>('');

  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<TicketCategory>('LOST_ITEM');
  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [chatModalVisible, setChatModalVisible] = useState(false);
  const [activeTicket, setActiveTicket] = useState<Ticket | null>(null);
  const [replyMessage, setReplyMessage] = useState('');
  const [isSendingReply, setIsSendingReply] = useState(false);
  const scrollViewRef = useRef<ScrollView>(null);

  useEffect(() => {
    fetchTickets();
  }, []);

  // Escuta mensagens e atualizações do chamado via WebSockets em tempo real
  useEffect(() => {
    if (!activeTicket?.id) return;

    socket.emit('ticket:join', { ticketId: activeTicket.id });

    const handleNewMessage = (payload: TicketMessage & { ticketId: string }) => {
      setTickets(prev => prev.map(t => {
        if (t.id === payload.ticketId) {
          const updatedMessages = t.messages ? [...t.messages, payload] : [payload];
          const updatedTicket = { ...t, messages: updatedMessages };
          if (activeTicket?.id === payload.ticketId) {
            setActiveTicket(updatedTicket);
          }
          return updatedTicket;
        }
        return t;
      }));
      setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
    };

    socket.on('ticket:receive_message', handleNewMessage);

    return () => {
      socket.off('ticket:receive_message', handleNewMessage);
    };
  }, [activeTicket?.id]);

  async function fetchTickets() {
    try {
      setLoading(true);

      const [ticketsResult, ridesResult] = await Promise.allSettled([
        api.get('/passengers/tickets/me'),
        api.get('/passengers/rides')
      ]);

      if (ticketsResult.status === 'fulfilled') {
        const fetchedTickets = Array.isArray(ticketsResult.value.data)
          ? ticketsResult.value.data
          : ticketsResult.value.data?.tickets || [];
        setTickets(fetchedTickets);
      }

      if (ridesResult.status === 'fulfilled') {
        const fetchedRides = Array.isArray(ridesResult.value.data)
          ? ridesResult.value.data
          : ridesResult.value.data?.rides || [];
        setRides(fetchedRides);

        if (fetchedRides.length > 0) {
          setSelectedRideId(fetchedRides[0].id);
        }
      }
    } catch (error) {
      console.error('❌ Erro ao carregar chamados:', error);
    } finally {
      setLoading(false);
    }
  }

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchTickets();
    setRefreshing(false);
  };

  function handleOpenCreateModal(category: TicketCategory) {
    setSelectedCategory(category);
    setDescription('');
    setCreateModalVisible(true);
  }

  function handleOpenChat(ticket: Ticket) {
    setActiveTicket(ticket);
    setChatModalVisible(true);
  }

  async function handleSubmitTicket() {
    const cleanDescription = description.trim();
    if (!cleanDescription || cleanDescription.length < 10) return;
    if (!selectedRideId) {
      Alert.alert('Atenção', 'Selecione uma corrida para vincular ao chamado.');
      return;
    }

    Keyboard.dismiss();
    setIsSubmitting(true);

    try {
      const response = await api.post('/passengers/tickets', { 
        category: selectedCategory, 
        description: cleanDescription,
        rideId: selectedRideId
      });
      setTickets(prev => [response.data, ...prev]);
      setCreateModalVisible(false);
      Alert.alert(t('ticket_sent_title', 'Chamado Enviado'), t('ticket_sent_msg', 'Sua solicitação foi registrada.'));
    } catch (error: any) {
      Alert.alert(t('error_title', 'Erro'), error?.response?.data?.error || t('ticket_create_error', 'Erro ao registrar chamado.'));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSendReply() {
    if (!replyMessage.trim() || !activeTicket || isSendingReply) return;
    
    const messageText = replyMessage.trim();
    setReplyMessage('');
    setIsSendingReply(true);

    try {
      // 1. Salva a resposta no Backend
      const response = await api.post(`/passengers/tickets/${activeTicket.id}/reply`, {
        message: messageText
      });

      const newMsg: TicketMessage = response.data;

      // 2. Atualiza os estados locais instantaneamente
      const updatedMessages = [...(activeTicket.messages || []), newMsg];
      const updatedTicket = { ...activeTicket, messages: updatedMessages };

      setActiveTicket(updatedTicket);
      setTickets(prev => prev.map(t => t.id === activeTicket.id ? updatedTicket : t));

      // 3. Emite o evento Socket para o Admin receber em tempo real
      socket.emit('ticket:send_message', {
        ticketId: activeTicket.id,
        message: messageText,
        sender: 'PASSENGER'
      });

      setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 100);
    } catch (error) {
      console.error('Erro ao enviar mensagem:', error);
      Alert.alert('Erro', 'Não foi possível enviar sua mensagem.');
      setReplyMessage(messageText);
    } finally {
      setIsSendingReply(false);
    }
  }

  function getCategoryLabel(category: TicketCategory) {
    switch (category) {
      case 'LOST_ITEM': return t('cat_lost_item', 'Objeto Esquecido');
      case 'CHARGE_DISPUTE': return t('cat_charge', 'Cobrança Incorreta');
      case 'CONDUCT_REPORT': return t('cat_conduct', 'Denúncia de Conduta');
      default: return t('cat_other', 'Outros Assuntos');
    }
  }

  function getStatusBadge(status: Ticket['status']) {
    switch (status) {
      case 'OPEN': return { label: t('status_open', 'Aberto'), bg: '#FEF3C7', color: '#92400E' };
      case 'IN_PROGRESS': return { label: t('status_progress', 'Em Análise'), bg: '#E0F2FE', color: '#0369A1' };
      case 'RESOLVED': return { label: t('status_resolved', 'Resolvido'), bg: '#DCFCE7', color: '#15803D' };
      default: return { label: t('status_closed', 'Fechado'), bg: '#F1F5F9', color: '#64748B' };
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor="#F8FAFC" />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('help_center', 'Central de Ajuda')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView 
        style={styles.content} 
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#EAB308']} />}
      >
        <Text style={styles.sectionTitle}>{t('how_can_we_help', 'Como podemos ajudar?')}</Text>
        
        <View style={styles.categoriesGrid}>
          {(['LOST_ITEM', 'CHARGE_DISPUTE', 'CONDUCT_REPORT', 'OTHER'] as TicketCategory[]).map((cat) => (
            <TouchableOpacity key={cat} style={styles.categoryCard} onPress={() => handleOpenCreateModal(cat)}>
              <View style={[styles.categoryIconBg, { backgroundColor: '#F1F5F9' }]}>
                <Ionicons name={cat === 'LOST_ITEM' ? 'briefcase-outline' : cat === 'CHARGE_DISPUTE' ? 'card-outline' : cat === 'CONDUCT_REPORT' ? 'alert-circle-outline' : 'help-circle-outline'} size={24} color="#0F172A" />
              </View>
              <Text style={styles.categoryTitle}>{getCategoryLabel(cat)}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionTitle}>{t('your_tickets', 'Seus Chamados')}</Text>
        
        {loading ? (
          <ActivityIndicator color="#EAB308" style={{ marginTop: 20 }} size="large" />
        ) : tickets.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>{t('no_tickets', 'Nenhum chamado aberto recentemente.')}</Text>
          </View>
        ) : (
          tickets.map((item) => {
            const badge = getStatusBadge(item.status);
            return (
              <TouchableOpacity key={item.id} style={styles.ticketCard} onPress={() => handleOpenChat(item)}>
                <View style={styles.ticketHeader}>
                  <Text style={styles.ticketCategory}>{getCategoryLabel(item.category)}</Text>
                  <View style={[styles.statusBadge, { backgroundColor: badge.bg }]}>
                    <Text style={[styles.statusBadgeText, { color: badge.color }]}>{badge.label}</Text>
                  </View>
                </View>
                <Text style={styles.ticketDescription} numberOfLines={2}>{item.description}</Text>
                <View style={styles.ticketFooter}>
                  <Text style={styles.ticketDate}>{new Date(item.createdAt).toLocaleDateString('pt-BR')}</Text>
                  <Text style={styles.viewChatText}>{t('view_chat', 'Ver conversa →')}</Text>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      {/* Modal Chat do Atendimento */}
      <Modal visible={chatModalVisible} animationType="slide" onRequestClose={() => setChatModalVisible(false)}>
        <SafeAreaView style={styles.chatContainer}>
          <View style={styles.chatHeader}>
            <TouchableOpacity onPress={() => setChatModalVisible(false)} style={styles.backButton}>
              <Ionicons name="close" size={28} color="#0F172A" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>{t('ticket_number', 'Chamado')} #{activeTicket?.id.substring(0,6).toUpperCase()}</Text>
            <View style={{ width: 40 }} />
          </View>

          <ScrollView 
            style={styles.chatBody} 
            ref={scrollViewRef}
            onContentSizeChange={() => scrollViewRef.current?.scrollToEnd({ animated: true })}
          >
            {/* Mensagem Inicial do Passageiro */}
            <View style={[styles.chatBubble, styles.chatBubbleRight]}>
              <Text style={styles.chatBubbleTextRight}>{activeTicket?.description}</Text>
            </View>

            {/* Respostas da equipe de Suporte e do Passageiro */}
            {activeTicket?.messages?.map((msg) => {
              const isPassenger = msg.sender === 'PASSENGER';
              return (
                <View key={msg.id} style={[styles.chatBubble, isPassenger ? styles.chatBubbleRight : styles.chatBubbleLeft]}>
                  {!isPassenger && <Text style={styles.adminLabel}>{t('support_team', 'Suporte Nobai')}</Text>}
                  <Text style={isPassenger ? styles.chatBubbleTextRight : styles.chatBubbleTextLeft}>
                    {msg.message}
                  </Text>
                </View>
              );
            })}
          </ScrollView>

          <KeyboardAvoidingView 
            behavior={Platform.OS === 'ios' ? 'padding' : undefined} 
            keyboardVerticalOffset={Platform.OS === 'ios' ? 10 : 0}
          >
            <View style={styles.inputContainer}>
              <TextInput
                style={styles.chatInput}
                placeholder={t('type_reply_placeholder', 'Digite sua resposta...')}
                value={replyMessage}
                onChangeText={setReplyMessage}
                multiline
              />
              <TouchableOpacity 
                style={[styles.sendBtn, isSendingReply && { opacity: 0.6 }]} 
                onPress={handleSendReply}
                disabled={isSendingReply}
              >
                {isSendingReply ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Ionicons name="send" size={20} color="#FFF" />
                )}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* Modal Criar Chamado */}
      <Modal visible={createModalVisible} animationType="slide" transparent onRequestClose={() => setCreateModalVisible(false)}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView 
              behavior={Platform.OS === 'ios' ? 'padding' : undefined} 
              style={{ width: '100%', justifyContent: 'flex-end' }}
            >
              <Pressable style={styles.modalContent} onPress={(e) => e.stopPropagation()}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>{getCategoryLabel(selectedCategory)}</Text>
                  <TouchableOpacity onPress={() => setCreateModalVisible(false)}>
                    <Ionicons name="close" size={24} color="#64748B" />
                  </TouchableOpacity>
                </View>

                <Text style={styles.inputLabel}>Selecione a Corrida</Text>
                {rides.length === 0 ? (
                  <Text style={styles.noRidesText}>Nenhuma corrida encontrada no histórico.</Text>
                ) : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
                    {rides.map((r) => (
                      <TouchableOpacity 
                        key={r.id} 
                        onPress={() => setSelectedRideId(r.id)}
                        style={[
                          styles.rideCard,
                          selectedRideId === r.id && styles.rideCardSelected
                        ]}
                      >
                        <Text style={styles.rideDate}>
                          {r.createdAt ? new Date(r.createdAt).toLocaleDateString('pt-BR') : 'Data N/A'}
                        </Text>
                        <Text style={styles.rideDriver}>
                          Motorista: {r.driver?.fullName || 'Não atribuído'}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                )}

                <Text style={styles.inputLabel}>{t('describe_problem', 'Descreva o ocorrido')}</Text>
                <TextInput
                  style={styles.textArea}
                  placeholder={t('ticket_description_placeholder', 'Conte com detalhes o que aconteceu...')}
                  placeholderTextColor="#94A3B8"
                  value={description}
                  onChangeText={setDescription}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                />

                <TouchableOpacity 
                  style={[styles.submitButton, (isSubmitting || description.trim().length < 10 || !selectedRideId) && styles.buttonDisabled]} 
                  onPress={handleSubmitTicket}
                  disabled={isSubmitting || description.trim().length < 10 || !selectedRideId}
                >
                  {isSubmitting ? (
                    <ActivityIndicator color="#0F172A" />
                  ) : (
                    <Text style={styles.submitButtonText}>{t('send_ticket_btn', 'Enviar Chamado')}</Text>
                  )}
                </TouchableOpacity>
              </Pressable>
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, backgroundColor: '#F8FAFC' },
  backButton: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#0F172A' },
  content: { flex: 1, paddingHorizontal: 20 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#0F172A', marginBottom: 14, marginTop: 10 },
  categoriesGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 24 },
  categoryCard: { width: '48%', backgroundColor: '#FFF', padding: 14, borderRadius: 16, borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 12 },
  categoryIconBg: { width: 42, height: 42, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  categoryTitle: { fontSize: 13, fontWeight: '700', color: '#0F172A', marginBottom: 4 },
  emptyCard: { backgroundColor: '#FFF', borderRadius: 16, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: '#E2E8F0' },
  emptyText: { color: '#64748B', fontSize: 13, marginTop: 8 },
  ticketCard: { backgroundColor: '#FFF', borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#E2E8F0' },
  ticketHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  ticketCategory: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  statusBadgeText: { fontSize: 11, fontWeight: '700' },
  ticketDescription: { fontSize: 13, color: '#475569', marginBottom: 10, lineHeight: 18 },
  ticketFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#F1F5F9', paddingTop: 10 },
  ticketDate: { fontSize: 11, color: '#94A3B8' },
  viewChatText: { fontSize: 12, fontWeight: '700', color: '#EAB308' },
  
  chatContainer: { flex: 1, backgroundColor: '#F8FAFC' },
  chatHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, borderBottomWidth: 1, borderBottomColor: '#E2E8F0', backgroundColor: '#FFF' },
  chatBody: { flex: 1, padding: 16 },
  chatBubble: { maxWidth: '80%', padding: 12, borderRadius: 16, marginBottom: 12 },
  chatBubbleRight: { alignSelf: 'flex-end', backgroundColor: '#EAB308', borderBottomRightRadius: 4 },
  chatBubbleLeft: { alignSelf: 'flex-start', backgroundColor: '#FFF', borderWidth: 1, borderColor: '#E2E8F0', borderBottomLeftRadius: 4 },
  chatBubbleTextRight: { color: '#0F172A', fontSize: 14 },
  chatBubbleTextLeft: { color: '#334155', fontSize: 14 },
  adminLabel: { fontSize: 11, fontWeight: '700', color: '#0284C7', marginBottom: 4 },
  inputContainer: { flexDirection: 'row', padding: 12, backgroundColor: '#FFF', borderTopWidth: 1, borderTopColor: '#E2E8F0', alignItems: 'center' },
  chatInput: { flex: 1, backgroundColor: '#F1F5F9', borderRadius: 20, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, minHeight: 40, maxHeight: 100, color: '#0F172A' },
  sendBtn: { backgroundColor: '#EAB308', width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', marginLeft: 12 },
  
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.5)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#FFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#0F172A' },
  inputLabel: { fontSize: 13, fontWeight: '600', color: '#475569', marginBottom: 8 },
  noRidesText: { fontSize: 12, color: '#94A3B8', marginBottom: 16, fontStyle: 'italic' },
  rideCard: { padding: 12, borderRadius: 10, borderWidth: 1, borderColor: '#CBD5E1', backgroundColor: '#FFF', marginRight: 8, minWidth: 140 },
  rideCardSelected: { borderColor: '#EAB308', backgroundColor: '#FEF9C3' },
  rideDate: { fontWeight: 'bold', fontSize: 12, color: '#0F172A' },
  rideDriver: { fontSize: 11, color: '#475569', marginTop: 2 },
  textArea: { backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, padding: 12, fontSize: 14, color: '#0F172A', minHeight: 100, marginBottom: 16 },
  submitButton: { backgroundColor: '#EAB308', paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  submitButtonText: { color: '#0F172A', fontWeight: '700', fontSize: 15 },
  buttonDisabled: { opacity: 0.5 }
});