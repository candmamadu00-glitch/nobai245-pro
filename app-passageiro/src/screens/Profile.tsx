import React, { useState, useEffect, useRef } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  StatusBar, 
  Platform, 
  TextInput, 
  Alert, 
  ScrollView, 
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Keyboard,
  Modal
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import { PrivacyPolicyModal } from '../components/PrivacyPolicyModal';

const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://api.nobai245.com').replace(/\/api\/?$/, '');

const formatPhotoUrl = (path?: string | null) => {
  if (!path || typeof path !== 'string') return undefined;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const cleanBase = API_URL.replace(/\/$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${cleanBase}${cleanPath}`;
};

const LANGUAGES = [
  { code: 'pt', label: 'Português', flag: '🇵🇹' },
  { code: 'cri', label: 'Kriol (Guiné-Bissau)', flag: '🇬🇼' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'ru', label: 'Русский', flag: '🇷🇺' },
];

export function Profile() {
  const { user, signOut, updateUserContext } = useAuth();
  const navigation = useNavigation<any>();
  const { t, i18n } = useTranslation();
  const isMountedRef = useRef(true);

  const [fullName, setFullName] = useState(user?.fullName || '');
  const [email, setEmail] = useState(user?.email || '');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  const [paymentProvider, setPaymentProvider] = useState<'ORANGE_MONEY' | 'MTN_MOMO' | null>(
    (user?.paymentProvider as 'ORANGE_MONEY' | 'MTN_MOMO') || null
  );
  const [accountNumber, setAccountNumber] = useState(user?.paymentAccountNumber || '');
  const [isSavingPayment, setIsSavingPayment] = useState(false);

  const [isPrivacyModalOpen, setIsPrivacyModalOpen] = useState(false);
  const [isLangModalOpen, setIsLangModalOpen] = useState(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  async function handlePickImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        t('permission_needed', 'Permissão necessária'), 
        t('photo_permission_msg', 'Precisamos de acesso às suas fotos para alterar o avatar.')
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]?.uri) {
      setSelectedImage(result.assets[0].uri);
    }
  }

  function handleSignOut() {
    signOut();
  }

  function handleDeleteAccount() {
    Alert.alert(
      t('delete_account_title', 'Excluir Conta'),
      t('delete_account_confirm', 'Tem certeza de que deseja excluir sua conta? Esta ação é permanente e você perderá seu histórico e dados salvos.'),
      [
        { text: t('back_btn', 'Cancelar'), style: 'cancel' },
        {
          text: t('delete_permanently', 'Excluir definitivamente'),
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete('/passengers/me');
              Alert.alert(
                t('account_deleted', 'Conta excluída'), 
                t('account_deleted_msg', 'Sua conta foi removida com sucesso.')
              );
              signOut();
            } catch (error: any) {
              if (!isMountedRef.current) return;
              Alert.alert(
                t('error_title', 'Erro'), 
                error?.response?.data?.error || error?.response?.data?.message || t('delete_account_error', 'Não foi possível excluir a conta. Tente novamente mais tarde.')
              );
            }
          },
        },
      ]
    );
  }

  async function handleSaveProfileInfo() {
    if (!fullName.trim()) {
      return Alert.alert(
        t('warning_title', 'Atenção ⚠️'), 
        t('inform_full_name', 'Informe seu nome completo.')
      );
    }
    Keyboard.dismiss();

    setIsSavingProfile(true);
    try {
      const formData = new FormData();
      formData.append('fullName', fullName.trim());
      if (email.trim()) formData.append('email', email.trim().toLowerCase());

      if (selectedImage) {
        const filename = selectedImage.split('/').pop() || 'avatar.jpg';
        const match = /\.(\w+)$/.exec(filename);
        const type = match ? `image/${match[1]}` : 'image/jpeg';

        formData.append('avatar', {
          uri: selectedImage,
          name: filename,
          type,
        } as any);
      }

      const response = await api.put('/passengers/me', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        transformRequest: (data) => data,
      });

      const updatedPassenger = response.data?.passenger || response.data?.user;

      if (updatedPassenger && updateUserContext) {
        updateUserContext(updatedPassenger);
      }

      if (isMountedRef.current) {
        setSelectedImage(null);
      }
      
      Alert.alert(
        t('success', 'Sucesso'), 
        t('data_updated', 'Seus dados foram atualizados!')
      );
    } catch (error: any) {
      if (!isMountedRef.current) return;
      Alert.alert(
        t('error_title', 'Erro'), 
        error?.response?.data?.error || error?.response?.data?.message || t('update_profile_error', 'Não foi possível atualizar seus dados pessoais.')
      );
    } finally {
      if (isMountedRef.current) {
        setIsSavingProfile(false);
      }
    }
  }

  async function handleSavePaymentInfo() {
    if (!paymentProvider) {
      return Alert.alert(
        t('warning_title', 'Atenção ⚠️'), 
        t('select_provider_msg', 'Selecione uma operadora (Orange ou MTN).')
      );
    }
    if (!accountNumber || accountNumber.trim().length < 8) {
      return Alert.alert(
        t('warning_title', 'Atenção ⚠️'), 
        t('invalid_account_number', 'Digite um número de conta válido.')
      );
    }
    Keyboard.dismiss();

    setIsSavingPayment(true);
    try {
      const response = await api.put('/passengers/payment-method', { 
        paymentProvider, 
        paymentAccountNumber: accountNumber.trim() 
      });
      
      if (updateUserContext) {
        updateUserContext({ 
          paymentProvider, 
          paymentAccountNumber: accountNumber.trim() 
        });
      }
      
      Alert.alert(
        t('success', 'Sucesso'), 
        t('payment_updated', 'Sua forma de pagamento padrão foi atualizada!')
      );
    } catch (error: any) {
      if (!isMountedRef.current) return;
      Alert.alert(
        t('error_title', 'Erro'), 
        error?.response?.data?.error || error?.response?.data?.message || t('payment_update_error', 'Não foi possível salvar as informações de pagamento.')
      );
    } finally {
      if (isMountedRef.current) {
        setIsSavingPayment(false);
      }
    }
  }

  const handleSelectLanguage = (code: string) => {
    i18n.changeLanguage(code);
    setIsLangModalOpen(false);
  };

  const currentLangObj = LANGUAGES.find(l => l.code === i18n.language) || LANGUAGES[0];
  const avatarUri = selectedImage || formatPhotoUrl(user?.profilePicture);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#F8FAFC" />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#1A202C" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('my_profile', 'Meu Perfil')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView 
        style={{ flex: 1 }} 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
            <View style={styles.avatarContainer}>
              <TouchableOpacity activeOpacity={0.8} onPress={handlePickImage} style={styles.avatarWrapper}>
                {avatarUri ? (
                  <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
                ) : (
                  <View style={styles.avatarFallback}>
                    <Ionicons name="person" size={40} color="#A0AEC0" />
                  </View>
                )}
                <View style={styles.cameraBadge}>
                  <Ionicons name="camera" size={16} color="#FFF" />
                </View>
              </TouchableOpacity>
              <Text style={styles.userName}>{user?.fullName || t('passenger', 'Passageiro')}</Text>
              <View style={styles.ratingContainer}>
                <Ionicons name="star" size={16} color="#EAB308" />
                <Text style={styles.ratingText}>
                  {Number(user?.ratingAverage || 5.0).toFixed(1)}
                </Text>
              </View>
            </View>

            <View style={styles.walletCard}>
              <Ionicons name="wallet-outline" size={22} color="#854D0E" />
              <View style={styles.walletInfo}>
                <Text style={styles.walletLabel}>{t('wallet_balance', 'Saldo da Carteira')}</Text>
                <Text style={styles.walletValue}>
                  {Number(user?.walletBalance || 0).toLocaleString('pt-PT', { minimumFractionDigits: 2 })} XOF
                </Text>
              </View>
            </View>

            {/* Configuração de Idioma */}
            <TouchableOpacity style={styles.historyButton} onPress={() => setIsLangModalOpen(true)}>
              <View style={styles.historyButtonLeft}>
                <View style={[styles.iconBox, { backgroundColor: '#E0E7FF' }]}>
                  <Ionicons name="language" size={22} color="#4338CA" />
                </View>
                <View>
                  <Text style={styles.historyButtonText}>{t('select_language', 'Idioma')}</Text>
                  <Text style={styles.subText}>{currentLangObj.flag} {currentLangObj.label}</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#A0AEC0" />
            </TouchableOpacity>

            <Text style={styles.sectionTitle}>{t('edit_personal_data', 'Editar Dados Pessoais')}</Text>
            <View style={styles.formCard}>
              <Text style={styles.inputLabel}>{t('full_name', 'Nome Completo')}</Text>
              <View style={styles.inputContainer}>
                <Ionicons name="person-outline" size={20} color="#A0AEC0" />
                <TextInput 
                  style={styles.input} 
                  value={fullName} 
                  onChangeText={setFullName}
                  editable={!isSavingProfile}
                />
              </View>

              <Text style={styles.inputLabel}>{t('email_label', 'E-mail')}</Text>
              <View style={styles.inputContainer}>
                <Ionicons name="mail-outline" size={20} color="#A0AEC0" />
                <TextInput 
                  style={styles.input} 
                  value={email} 
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  placeholder={t('email_placeholder', 'seu@email.com')}
                  placeholderTextColor="#A0AEC0"
                  editable={!isSavingProfile}
                />
              </View>

              <Text style={styles.inputLabel}>{t('phone_unalterable', 'Telefone (Não alterável)')}</Text>
              <View style={[styles.inputContainer, styles.disabledInputContainer]}>
                <Ionicons name="call-outline" size={20} color="#94A3B8" />
                <TextInput 
                  style={[styles.input, styles.disabledInput]} 
                  value={user?.phone || ''} 
                  editable={false} 
                />
                <Ionicons name="lock-closed" size={16} color="#94A3B8" />
              </View>

              <TouchableOpacity 
                style={[styles.saveButton, isSavingProfile && styles.saveButtonDisabled]} 
                onPress={handleSaveProfileInfo} 
                disabled={isSavingProfile}
              >
                {isSavingProfile ? <ActivityIndicator color="#1A202C" /> : <Text style={styles.saveButtonText}>{t('save_personal_data', 'Salvar Dados Pessoais')}</Text>}
              </TouchableOpacity>
            </View>

            <Text style={styles.sectionTitle}>{t('setup_payment', 'Configurar Pagamento')}</Text>
            <View style={styles.formCard}>
              <Text style={styles.inputLabel}>{t('mobile_money_provider', 'Operadora (Mobile Money)')}</Text>
              <View style={styles.providerContainer}>
                <TouchableOpacity 
                  style={[styles.providerButton, paymentProvider === 'ORANGE_MONEY' && styles.providerButtonActive]} 
                  onPress={() => setPaymentProvider('ORANGE_MONEY')}
                  disabled={isSavingPayment}
                >
                  <Text style={[styles.providerText, paymentProvider === 'ORANGE_MONEY' && styles.providerTextActive]}>Orange Money</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.providerButton, paymentProvider === 'MTN_MOMO' && styles.providerButtonActive]} 
                  onPress={() => setPaymentProvider('MTN_MOMO')}
                  disabled={isSavingPayment}
                >
                  <Text style={[styles.providerText, paymentProvider === 'MTN_MOMO' && styles.providerTextActive]}>MTN MoMo</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.inputLabel}>{t('account_phone_number', 'Número da Conta / Telefone')}</Text>
              <View style={styles.inputContainer}>
                <Ionicons name="phone-portrait-outline" size={20} color="#A0AEC0" />
                <TextInput 
                  style={styles.input} 
                  keyboardType="phone-pad" 
                  value={accountNumber} 
                  onChangeText={setAccountNumber} 
                  maxLength={15}
                  editable={!isSavingPayment}
                />
              </View>

              <TouchableOpacity 
                style={[styles.saveButton, isSavingPayment && styles.saveButtonDisabled]} 
                onPress={handleSavePaymentInfo} 
                disabled={isSavingPayment}
              >
                {isSavingPayment ? <ActivityIndicator color="#1A202C" /> : <Text style={styles.saveButtonText}>{t('save_payment', 'Salvar Pagamento')}</Text>}
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.historyButton} onPress={() => navigation.navigate('EmergencyContacts')}>
              <View style={styles.historyButtonLeft}>
                <View style={[styles.iconBox, { backgroundColor: '#FEE2E2' }]}>
                  <Ionicons name="shield-checkmark" size={22} color="#EF4444" />
                </View>
                <Text style={styles.historyButtonText}>{t('emergency_contacts', 'Contatos de Emergência')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#A0AEC0" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.historyButton} onPress={() => navigation.navigate('RideHistory')}>
              <View style={styles.historyButtonLeft}>
                <View style={styles.iconBox}>
                  <Ionicons name="time" size={22} color="#EAB308" />
                </View>
                <Text style={styles.historyButtonText}>{t('my_rides', 'Minhas Corridas')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#A0AEC0" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.historyButton} onPress={() => navigation.navigate('HelpCenter')}>
              <View style={styles.historyButtonLeft}>
                <View style={[styles.iconBox, { backgroundColor: '#FEF3C7' }]}>
                  <Ionicons name="help-buoy" size={22} color="#D97706" />
                </View>
                <Text style={styles.historyButtonText}>{t('help_center', 'Central de Ajuda')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#A0AEC0" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.historyButton} onPress={() => setIsPrivacyModalOpen(true)}>
              <View style={styles.historyButtonLeft}>
                <View style={[styles.iconBox, { backgroundColor: '#E0F2FE' }]}>
                  <Ionicons name="document-text" size={22} color="#0284C7" />
                </View>
                <Text style={styles.historyButtonText}>{t('privacy_policy', 'Políticas de Privacidade')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#A0AEC0" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.logoutButton} onPress={handleSignOut}>
              <Ionicons name="log-out-outline" size={22} color="#EF4444" style={{ marginRight: 8 }} />
              <Text style={styles.logoutButtonText}>{t('logout', 'Sair da conta')}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.deleteAccountButton} onPress={handleDeleteAccount}>
              <Ionicons name="trash-outline" size={18} color="#94A3B8" style={{ marginRight: 6 }} />
              <Text style={styles.deleteAccountButtonText}>{t('delete_my_account', 'Excluir minha conta')}</Text>
            </TouchableOpacity>

            <View style={{ height: 40 }} />
          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>

      <PrivacyPolicyModal 
        visible={isPrivacyModalOpen} 
        onClose={() => setIsPrivacyModalOpen(false)} 
      />

      {/* Modal de Seleção de Idioma */}
      <Modal visible={isLangModalOpen} transparent animationType="slide" onRequestClose={() => setIsLangModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.langModalContainer}>
            <View style={styles.langModalHeader}>
              <Text style={styles.langModalTitle}>{t('select_language', 'Idioma')}</Text>
              <TouchableOpacity onPress={() => setIsLangModalOpen(false)}>
                <Ionicons name="close" size={24} color="#0F172A" />
              </TouchableOpacity>
            </View>
            {LANGUAGES.map((lang) => (
              <TouchableOpacity 
                key={lang.code} 
                style={[styles.langOption, i18n.language === lang.code && styles.langOptionActive]}
                onPress={() => handleSelectLanguage(lang.code)}
              >
                <Text style={styles.langOptionText}>{lang.flag}  {lang.label}</Text>
                {i18n.language === lang.code && <Ionicons name="checkmark-circle" size={20} color="#4338CA" />}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 16, backgroundColor: '#F8FAFC' },
  backButton: { padding: 8 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#1A202C' },
  content: { flex: 1, paddingHorizontal: 20, marginTop: 10 },
  avatarContainer: { alignItems: 'center', marginBottom: 20 },
  avatarWrapper: { position: 'relative', marginBottom: 12 },
  avatarFallback: { width: 90, height: 90, borderRadius: 45, backgroundColor: '#E2E8F0', justifyContent: 'center', alignItems: 'center' },
  avatarImage: { width: 90, height: 90, borderRadius: 45, backgroundColor: '#CBD5E1' },
  cameraBadge: { position: 'absolute', bottom: 0, right: 0, backgroundColor: '#1E293B', padding: 6, borderRadius: 14, borderWidth: 2, borderColor: '#F8FAFC' },
  userName: { fontSize: 20, fontWeight: '700', color: '#1A202C', marginBottom: 4 },
  ratingContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF08A', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  ratingText: { fontSize: 14, fontWeight: '600', color: '#854D0E', marginLeft: 4 },
  walletCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF9C3', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: '#FEF08A', marginBottom: 16 },
  walletInfo: { marginLeft: 12 },
  walletLabel: { fontSize: 12, fontWeight: '600', color: '#854D0E' },
  walletValue: { fontSize: 18, fontWeight: '800', color: '#1A202C', marginTop: 2 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#1A202C', marginBottom: 12, marginLeft: 4 },
  formCard: { backgroundColor: '#FFF', borderRadius: 16, padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2, marginBottom: 24 },
  inputLabel: { fontSize: 13, fontWeight: '600', color: '#4A5568', marginBottom: 8 },
  inputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10, paddingHorizontal: 12, marginBottom: 16 },
  disabledInputContainer: { backgroundColor: '#F1F5F9', borderColor: '#CBD5E1' },
  input: { flex: 1, height: 48, marginLeft: 10, fontSize: 15, color: '#1A202C' },
  disabledInput: { color: '#64748B' },
  providerContainer: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  providerButton: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0', backgroundColor: '#F8FAFC', alignItems: 'center' },
  providerButtonActive: { borderColor: '#EAB308', backgroundColor: '#FEF08A' },
  providerText: { fontSize: 14, fontWeight: '600', color: '#718096' },
  providerTextActive: { color: '#1A202C', fontWeight: '700' },
  saveButton: { backgroundColor: '#EAB308', paddingVertical: 14, borderRadius: 10, alignItems: 'center', marginTop: 4 },
  saveButtonDisabled: { opacity: 0.7 },
  saveButtonText: { fontSize: 15, fontWeight: '700', color: '#1A202C' },
  historyButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#FFF', borderRadius: 16, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  historyButtonLeft: { flexDirection: 'row', alignItems: 'center' },
  iconBox: { backgroundColor: '#FEF9C3', padding: 8, borderRadius: 10, marginRight: 12 },
  historyButtonText: { fontSize: 16, fontWeight: '600', color: '#1A202C' },
  subText: { fontSize: 12, color: '#64748B', marginTop: 2 },
  logoutButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FEE2E2', paddingVertical: 16, borderRadius: 12, marginTop: 12, marginBottom: 12 },
  logoutButtonText: { color: '#EF4444', fontSize: 16, fontWeight: '700' },
  deleteAccountButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
  deleteAccountButtonText: { color: '#64748B', fontSize: 14, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  langModalContainer: { backgroundColor: '#FFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  langModalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  langModalTitle: { fontSize: 18, fontWeight: '700', color: '#0F172A' },
  langOption: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  langOptionActive: { backgroundColor: '#F5F3FF' },
  langOptionText: { fontSize: 16, fontWeight: '600', color: '#0F172A' },
});