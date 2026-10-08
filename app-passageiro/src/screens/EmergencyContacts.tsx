import React, { useState, useEffect, useCallback } from 'react';
import { 
  View, Text, StyleSheet, TouchableOpacity, StatusBar, Platform, 
  FlatList, TextInput, Alert, ActivityIndicator, Modal,
  KeyboardAvoidingView, Keyboard, ScrollView, Pressable
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { api } from '../services/api';

interface Contact { 
  id: string; 
  name: string; 
  phone: string; 
  relationship?: string; 
}

export function EmergencyContacts() {
  const navigation = useNavigation();
  const { t } = useTranslation();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [relationship, setRelationship] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const fetchContacts = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get('/passengers/emergency-contacts');
      setContacts(response.data || []);
    } catch (error: any) {
      Alert.alert(
        t('error_title', 'Erro de Conexão'), 
        t('error_fetch_contacts', 'Verifique sua internet. Não foi possível carregar os contatos.')
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { 
    fetchContacts(); 
  }, [fetchContacts]);

  function validateBissauPhone(inputPhone: string) {
    const digitsOnly = inputPhone.replace(/\D/g, '');
    const isGB = digitsOnly.startsWith('245') ? digitsOnly.slice(3) : digitsOnly;
    if (isGB.length === 9 && isGB.startsWith('9')) return `+245${isGB}`;
    return null;
  }

  async function handleAddContact() {
    const cleanName = name.trim();
    if (cleanName.length < 3) {
      return Alert.alert(t('invalid_name_title', 'Nome inválido'), t('invalid_name_msg', 'Informe um nome real.'));
    }
    
    const formattedPhone = validateBissauPhone(phone);
    if (!formattedPhone) {
      return Alert.alert(
        t('invalid_phone_title', 'Telefone inválido'), 
        t('invalid_phone_msg', 'Informe um número válido da Guiné-Bissau (ex: 955123456).')
      );
    }

    Keyboard.dismiss();
    setIsSaving(true);
    
    try {
      const payload = { 
        name: cleanName.substring(0, 50), 
        phone: formattedPhone, 
        relationship: relationship.trim().substring(0, 30) || t('family_friend', 'Familiar / Amigo') 
      };
      
      const response = await api.post('/passengers/emergency-contacts', payload);
      setContacts((prev) => [response.data, ...prev]);
      
      Alert.alert(t('success', 'Sucesso'), t('contact_added', 'Contato de emergência adicionado e sincronizado!'));
      resetForm();
      setIsModalOpen(false);
    } catch (error: any) {
      Alert.alert(
        t('error_title', 'Erro'), 
        error?.response?.data?.error || error?.response?.data?.message || t('contact_add_error', 'Falha ao salvar. Tente novamente.')
      );
    } finally {
      setIsSaving(false);
    }
  }

  function resetForm() { 
    setName(''); 
    setPhone(''); 
    setRelationship(''); 
  }

  const handleDeleteContact = useCallback((id: string) => {
    Alert.alert(
      t('remove_contact_title', 'Remover Contato'), 
      t('remove_contact_msg', 'Deseja remover este contato?'), 
      [
        { text: t('back_btn', 'Cancelar'), style: 'cancel' },
        { 
          text: t('remove_btn', 'Remover'), 
          style: 'destructive', 
          onPress: async () => {
            try {
              await api.delete(`/passengers/emergency-contacts/${id}`);
              setContacts((prev) => prev.filter((c) => c.id !== id));
            } catch (error) { 
              Alert.alert(t('error_title', 'Erro'), t('contact_add_error', 'Não foi possível remover.')); 
            }
          }
        }
      ]
    );
  }, [t]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="dark-content" backgroundColor="#F8FAFC" />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconButton}>
          <Ionicons name="arrow-back" size={24} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('emergency_contacts', 'Contatos de Emergência')}</Text>
        <TouchableOpacity onPress={() => setIsModalOpen(true)} style={styles.iconButton}>
          <Ionicons name="add-circle" size={28} color="#EAB308" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#EAB308" />
        </View>
      ) : (
        <FlatList
          data={contacts}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            <View style={styles.bannerContainer}>
              <View style={styles.iconBadge}>
                <Ionicons name="shield-checkmark" size={32} color="#10B981" />
              </View>
              <Text style={styles.title}>{t('safety_network', 'Rede de Segurança Blindada')}</Text>
              <Text style={styles.subtitle}>{t('safety_network_desc', 'Acione pessoas de confiança com um toque em caso de imprevistos.')}</Text>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Ionicons name="people-outline" size={48} color="#94A3B8" />
              <Text style={styles.emptyTitle}>{t('no_contacts', 'Nenhum contato adicionado')}</Text>
              <TouchableOpacity style={styles.stunningButton} activeOpacity={0.8} onPress={() => setIsModalOpen(true)}>
                <Text style={styles.stunningButtonText}>{t('add_contact_btn', 'Adicionar Contato Seguro')}</Text>
              </TouchableOpacity>
            </View>
          }
          renderItem={({ item }) => (
            <View style={styles.contactCard}>
              <View style={styles.avatarCircle}>
                <Ionicons name="person" size={20} color="#64748B" />
              </View>
              <View style={styles.contactInfo}>
                <Text style={styles.contactName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.contactPhone}>{item.phone}</Text>
                {item.relationship && (
                  <View style={styles.tag}>
                    <Text style={styles.contactRelation}>{item.relationship}</Text>
                  </View>
                )}
              </View>
              <TouchableOpacity onPress={() => handleDeleteContact(item.id)} style={styles.deleteButton} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="trash-outline" size={22} color="#EF4444" />
              </TouchableOpacity>
            </View>
          )}
        />
      )}

      <Modal visible={isModalOpen} animationType="slide" transparent onRequestClose={() => { if (!isSaving) { resetForm(); setIsModalOpen(false); } }}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Pressable style={styles.backdrop} onPress={Keyboard.dismiss} />
          <View style={styles.modalContent}>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 20 }}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{t('new_emergency_contact', 'Novo Contato')}</Text>
                <TouchableOpacity onPress={() => { resetForm(); setIsModalOpen(false); }} disabled={isSaving}>
                  <Ionicons name="close" size={24} color="#64748B" />
                </TouchableOpacity>
              </View>
              <Text style={styles.inputLabel}>{t('full_name', 'Nome Completo')}</Text>
              <TextInput style={styles.input} placeholder="Ex: Bacar Camará" value={name} onChangeText={setName} editable={!isSaving} />
              
              <Text style={styles.inputLabel}>{t('phone_whatsapp', 'Telefone (Guiné-Bissau)')}</Text>
              <TextInput style={styles.input} placeholder="Ex: 955123456" keyboardType="phone-pad" value={phone} onChangeText={setPhone} editable={!isSaving} />
              
              <Text style={styles.inputLabel}>{t('relationship_optional', 'Parentesco (Opcional)')}</Text>
              <TextInput style={styles.input} placeholder="Ex: Irmão, Mãe" value={relationship} onChangeText={setRelationship} editable={!isSaving} />
              
              <TouchableOpacity style={[styles.stunningButton, isSaving && styles.stunningButtonDisabled, { marginTop: 20 }]} onPress={handleAddContact} disabled={isSaving} activeOpacity={0.8}>
                {isSaving ? <ActivityIndicator color="#0F172A" /> : <Text style={styles.stunningButtonText}>{t('save_contact', 'Salvar Contato')}</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, backgroundColor: '#F8FAFC' },
  iconButton: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#0F172A' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContent: { paddingHorizontal: 20, paddingBottom: 40 },
  bannerContainer: { alignItems: 'center', marginVertical: 20 },
  iconBadge: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#D1FAE5', justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 20, fontWeight: '800', color: '#0F172A' },
  subtitle: { fontSize: 14, color: '#64748B', textAlign: 'center', marginTop: 6, lineHeight: 20, paddingHorizontal: 10 },
  emptyContainer: { alignItems: 'center', marginTop: 40 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: '#334155', marginTop: 12, marginBottom: 20 },
  stunningButton: { backgroundColor: '#EAB308', paddingVertical: 16, paddingHorizontal: 24, borderRadius: 16, alignItems: 'center', shadowColor: '#EAB308', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 5 },
  stunningButtonText: { color: '#0F172A', fontWeight: '800', fontSize: 16 },
  stunningButtonDisabled: { opacity: 0.6, shadowOpacity: 0 },
  contactCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#F1F5F9', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  avatarCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#F1F5F9', justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  contactInfo: { flex: 1 },
  contactName: { fontSize: 16, fontWeight: '700', color: '#0F172A' },
  contactPhone: { fontSize: 14, color: '#475569', marginTop: 4 },
  tag: { alignSelf: 'flex-start', backgroundColor: '#FEF9C3', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, marginTop: 8 },
  contactRelation: { fontSize: 11, color: '#B45309', fontWeight: '700' },
  deleteButton: { padding: 8, backgroundColor: '#FEF2F2', borderRadius: 10 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.6)', justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject },
  modalContent: { backgroundColor: '#FFF', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 24, paddingTop: 24, maxHeight: '90%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  modalTitle: { fontSize: 20, fontWeight: '800', color: '#0F172A' },
  inputLabel: { fontSize: 14, fontWeight: '600', color: '#475569', marginBottom: 8, marginTop: 12 },
  input: { backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 14, height: 54, paddingHorizontal: 16, fontSize: 16, color: '#0F172A' },
});