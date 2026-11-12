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
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import { PrivacyPolicyModal } from '../components/PrivacyPolicyModal';

const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://api.nobai245.com').replace(/\/api\/?$/, '');

const formatPhotoUrl = (path?: string | null, timestamp?: number) => {
  if (!path || typeof path !== 'string') return undefined;
  let fullUrl = path;
  if (!path.startsWith('http://') && !path.startsWith('https://')) {
    const cleanBase = API_URL.replace(/\/$/, '');
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    fullUrl = `${cleanBase}${cleanPath}`;
  }
  const resultUrl = timestamp ? `${fullUrl}?t=${timestamp}` : fullUrl;
  console.log(`📸 [AVATAR_DEBUG] URL da foto formatada: "${resultUrl}"`);
  return resultUrl;
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
  const [imageTimestamp, setImageTimestamp] = useState<number>(Date.now());
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  const [accountNumber, setAccountNumber] = useState(user?.paymentAccountNumber || '');
  const [isSavingPayment, setIsSavingPayment] = useState(false);

  const [isPrivacyModalOpen, setIsPrivacyModalOpen] = useState(false);
  const [isLangModalOpen, setIsLangModalOpen] = useState(false);

  useEffect(() => {
    isMountedRef.current = true;
    console.log('👤 [PROFILE_DEBUG] Perfil do passageiro montado:', {
      id: user?.id,
      fullName: user?.fullName,
      phone: user?.phone,
      rating: user?.ratingAverage,
    });
    return () => {
      isMountedRef.current = false;
    };
  }, [user]);

  async function handlePickImage() {
    console.log('📸 [AVATAR_DEBUG] Solicitando permissão de galeria para alteração de foto...');
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      console.warn('⚠️ [AVATAR_DEBUG] Permissão de acesso à galeria negada.');
      Alert.alert(
        t('permission_needed', 'Permissão necessária'), 
        t('photo_permission_msg', 'Precisamos de acesso às suas fotos para alterar o avatar.')
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]?.uri) {
      console.log(`📸 [AVATAR_DEBUG] Foto selecionada na galeria: ${result.assets[0].uri}`);
      setSelectedImage(result.assets[0].uri);
    } else {
      console.log('📸 [AVATAR_DEBUG] Seleção de foto cancelada pelo usuário.');
    }
  }

  function handleSignOut() {
    console.log('🚪 [PROFILE_DEBUG] Passageiro solicitou encerramento de sessão.');
    signOut();
  }

  function handleDeleteAccount() {
    console.warn('⚠️ [DELETE_DEBUG] Solicitação de exclusão de conta iniciada.');
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
              console.log('🗑️ [DELETE_DEBUG] Enviando requisição DELETE /passengers/me');
              await api.delete('/passengers/me');
              console.log('✅ [DELETE_DEBUG] Conta excluída com sucesso.');
              Alert.alert(
                t('account_deleted', 'Conta excluída'), 
                t('account_deleted_msg', 'Sua conta foi removida com sucesso.')
              );
              signOut();
            } catch (error: any) {
              if (!isMountedRef.current) return;
              console.error('❌ [DELETE_DEBUG] Erro ao excluir conta:', error);
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
    console.log(`💾 [PROFILE_DEBUG] Atualizando perfil: "${fullName}" | Email: "${email}"`);

    try {
      const formData = new FormData();
      formData.append('fullName', fullName.trim());
      if (email.trim()) formData.append('email', email.trim().toLowerCase());

      if (selectedImage) {
        const filename = selectedImage.split('/').pop() || 'avatar.jpg';
        const match = /\.(\w+)$/.exec(filename);
        const ext = match ? match[1].toLowerCase() : 'jpg';
        const type = ext === 'png' ? 'image/png' : 'image/jpeg';
        const formattedUri = Platform.OS === 'android' ? selectedImage : selectedImage.replace('file://', '');

        console.log(`📸 [AVATAR_DEBUG] Anexando avatar ao formulário: ${filename} (${type})`);

        formData.append('profilePicture', {
          uri: formattedUri,
          name: filename,
          type,
        } as any);

        formData.append('avatar', {
          uri: formattedUri,
          name: filename,
          type,
        } as any);
      }

      const response = await api.put('/passengers/me', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      const updatedPassenger = response.data?.passenger || response.data?.user;

      if (updatedPassenger && updateUserContext) {
        console.log('✅ [PROFILE_DEBUG] Contexto de usuário atualizado:', updatedPassenger);
        updateUserContext(updatedPassenger);
      }

      if (isMountedRef.current) {
        setSelectedImage(null);
        setImageTimestamp(Date.now());
      }
      
      Alert.alert(
        t('success', 'Sucesso'), 
        t('data_updated', 'Seus dados foram atualizados!')
      );
    } catch (error: any) {
      if (!isMountedRef.current) return;
      console.error('❌ [PROFILE_DEBUG] Erro ao salvar dados pessoais:', error);
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
    Keyboard.dismiss();
    setIsSavingPayment(true);
    console.log(`💵 [PAYMENT_DEBUG] Salvando preferência de conta: "${accountNumber}"`);

    try {
      if (accountNumber.trim()) {
        await api.put('/passengers/payment-method', { 
          paymentProvider: null, 
          paymentAccountNumber: accountNumber.trim() 
        }).catch(() => null);
      }
      
      Alert.alert(
        'Forma de Pagamento 💵', 
        'No momento, o sistema está configurado para pagamentos exclusivamente em Dinheiro em Espécie diretamente ao motorista.'
      );
    } catch (error: any) {
      if (!isMountedRef.current) return;
      console.error('❌ [PAYMENT_DEBUG] Erro ao salvar dados de pagamento:', error);
      Alert.alert(
        t('error_title', 'Erro'), 
        t('payment_update_error', 'Não foi possível salvar as informações de pagamento.')
      );
    } finally {
      if (isMountedRef.current) {
        setIsSavingPayment(false);
      }
    }
  }

  const handleSelectLanguage = (code: string) => {
    console.log(`🌐 [LANG_DEBUG] Idioma do perfil alterado para: ${code}`);
    i18n.changeLanguage(code);
    setIsLangModalOpen(false);
  };

  const currentLangObj = LANGUAGES.find(l => l.code === i18n.language) || LANGUAGES[0];
  const avatarUri = selectedImage || formatPhotoUrl(user?.profilePicture, imageTimestamp);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#F8FAFC" />

      {/* HEADER ELEGANTE */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton} activeOpacity={0.7}>
          <Ionicons name="arrow-back" size={20} color="#0F172A" />
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
            {/* AVATAR & RATING PREMIUM */}
            <View style={styles.avatarContainer}>
              <TouchableOpacity activeOpacity={0.85} onPress={handlePickImage} style={styles.avatarWrapper}>
                <View style={styles.avatarGlowRing}>
                  {avatarUri ? (
                    <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
                  ) : (
                    <View style={styles.avatarFallback}>
                      <Ionicons name="person" size={44} color="#94A3B8" />
                    </View>
                  )}
                </View>
                <View style={styles.cameraBadge}>
                  <Ionicons name="camera" size={15} color="#0F172A" />
                </View>
              </TouchableOpacity>

              <Text style={styles.userName}>{user?.fullName || t('passenger', 'Passageiro')}</Text>

              <View style={styles.ratingBadgeContainer}>
                <Ionicons name="star" size={14} color="#EAB308" />
                <Text style={styles.ratingText}>
                  {Number(user?.ratingAverage || 5.0).toFixed(1)}
                </Text>
                <Text style={styles.ratingSubtext}>• Passageiro VIP</Text>
              </View>
            </View>

            {/* WALLET CARD ESTILO LUXURY CARD */}
            <LinearGradient
              colors={['#0F172A', '#1E293B']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.walletCardGradient}
            >
              <View style={styles.walletCardHeader}>
                <View style={styles.walletIconCircle}>
                  <Ionicons name="wallet" size={20} color="#EAB308" />
                </View>
                <View style={styles.walletChipBadge}>
                  <Ionicons name="sparkles" size={12} color="#EAB308" style={{ marginRight: 4 }} />
                  <Text style={styles.walletChipText}>NÔ BAI WALLET</Text>
                </View>
              </View>

              <View style={{ marginTop: 14 }}>
                <Text style={styles.walletLabel}>{t('wallet_balance', 'Saldo Disponível')}</Text>
                <Text style={styles.walletValue}>
                  {Number(user?.walletBalance || 0).toLocaleString('pt-PT', { minimumFractionDigits: 2 })} <Text style={styles.walletCurrency}>XOF</Text>
                </Text>
              </View>
            </LinearGradient>

            {/* SELEÇÃO DE IDIOMA */}
            <TouchableOpacity style={styles.menuRowCard} activeOpacity={0.8} onPress={() => setIsLangModalOpen(true)}>
              <View style={styles.menuRowLeft}>
                <View style={[styles.iconBox, { backgroundColor: '#EEF2FF' }]}>
                  <Ionicons name="language" size={20} color="#4338CA" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.menuRowTitle}>{t('select_language', 'Idioma do aplicativo')}</Text>
                  <Text style={styles.menuRowSubtext}>{currentLangObj.flag}  {currentLangObj.label}</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
            </TouchableOpacity>

            {/* EDITAR DADOS PESSOAIS */}
            <Text style={styles.sectionTitle}>{t('edit_personal_data', 'Dados Pessoais')}</Text>
            <View style={styles.formCard}>
              <Text style={styles.inputLabel}>{t('full_name', 'Nome Completo')}</Text>
              <View style={styles.inputContainer}>
                <Ionicons name="person-outline" size={18} color="#64748B" />
                <TextInput 
                  style={styles.input} 
                  value={fullName} 
                  onChangeText={setFullName}
                  editable={!isSavingProfile}
                  placeholderTextColor="#94A3B8"
                />
              </View>

              <Text style={styles.inputLabel}>{t('email_label', 'E-mail')}</Text>
              <View style={styles.inputContainer}>
                <Ionicons name="mail-outline" size={18} color="#64748B" />
                <TextInput 
                  style={styles.input} 
                  value={email} 
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  placeholder={t('email_placeholder', 'seu@email.com')}
                  placeholderTextColor="#94A3B8"
                  editable={!isSavingProfile}
                />
              </View>

              <Text style={styles.inputLabel}>{t('phone_unalterable', 'Telefone de Conta (Protegido)')}</Text>
              <View style={[styles.inputContainer, styles.disabledInputContainer]}>
                <Ionicons name="call-outline" size={18} color="#94A3B8" />
                <TextInput 
                  style={[styles.input, styles.disabledInput]} 
                  value={user?.phone || ''} 
                  editable={false} 
                />
                <Ionicons name="lock-closed" size={15} color="#94A3B8" />
              </View>

              <TouchableOpacity 
                style={[styles.primarySaveButton, isSavingProfile && styles.buttonDisabled]} 
                onPress={handleSaveProfileInfo} 
                disabled={isSavingProfile}
                activeOpacity={0.85}
              >
                {isSavingProfile ? (
                  <ActivityIndicator color="#0F172A" />
                ) : (
                  <Text style={styles.primarySaveButtonText}>{t('save_personal_data', 'Atualizar Dados Pessoais')}</Text>
                )}
              </TouchableOpacity>
            </View>

            {/* CONFIGURAR PAGAMENTO */}
            <Text style={styles.sectionTitle}>{t('setup_payment', 'Forma de Pagamento')}</Text>
            <View style={styles.formCard}>
              
              <View style={styles.cashNoticeBox}>
                <View style={styles.cashNoticeIconCircle}>
                  <Ionicons name="cash" size={18} color="#166534" />
                </View>
                <Text style={styles.cashNoticeText}>
                  Pagamentos temporariamente definidos como <Text style={{ fontWeight: '800' }}>Dinheiro em Espécie 💵</Text>. As operadoras Mobile Money estão em manutenção preventiva.
                </Text>
              </View>

              <Text style={styles.inputLabel}>{t('mobile_money_provider', 'Operadoras de Pagamento Móvel')}</Text>
              <View style={styles.providerContainer}>
                
                <TouchableOpacity 
                  style={styles.providerSquareButtonBlocked} 
                  onPress={() => {
                    Alert.alert(
                      'Aviso Nobai245 📲',
                      'O serviço de pagamento via Orange Money está temporariamente em fase de atualização técnica. No momento, o pagamento é feito diretamente em Dinheiro em Espécie.'
                    );
                  }}
                  activeOpacity={0.7}
                >
                  <Ionicons name="phone-portrait-outline" size={22} color="#94A3B8" style={{ marginBottom: 4 }} />
                  <Text style={styles.providerSquareText}>Orange Money</Text>
                  <View style={styles.badgeBlocked}>
                    <Text style={styles.badgeBlockedText}>Em Breve</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={styles.providerSquareButtonBlocked} 
                  onPress={() => {
                    Alert.alert(
                      'Aviso Nobai245 📲',
                      'O serviço de pagamento via MTN Mobile Money está temporariamente em fase de atualização técnica. No momento, o pagamento é feito diretamente em Dinheiro em Espécie.'
                    );
                  }}
                  activeOpacity={0.7}
                >
                  <Ionicons name="wallet-outline" size={22} color="#94A3B8" style={{ marginBottom: 4 }} />
                  <Text style={styles.providerSquareText}>Telecel (MTN)</Text>
                  <View style={styles.badgeBlocked}>
                    <Text style={styles.badgeBlockedText}>Em Breve</Text>
                  </View>
                </TouchableOpacity>
              </View>

              <Text style={styles.inputLabel}>{t('account_phone_number', 'Número da Conta / Telefone (Opcional)')}</Text>
              <View style={styles.inputContainer}>
                <Ionicons name="phone-portrait-outline" size={18} color="#64748B" />
                <TextInput 
                  style={styles.input} 
                  keyboardType="phone-pad" 
                  value={accountNumber} 
                  onChangeText={setAccountNumber} 
                  maxLength={15}
                  placeholder="Ex: 955000000"
                  placeholderTextColor="#94A3B8"
                  editable={!isSavingPayment}
                />
              </View>

              <TouchableOpacity 
                style={[styles.primarySaveButton, isSavingPayment && styles.buttonDisabled]} 
                onPress={handleSavePaymentInfo} 
                disabled={isSavingPayment}
                activeOpacity={0.85}
              >
                {isSavingPayment ? (
                  <ActivityIndicator color="#0F172A" />
                ) : (
                  <Text style={styles.primarySaveButtonText}>{t('save_payment', 'Salvar Pagamento')}</Text>
                )}
              </TouchableOpacity>
            </View>

            {/* OUTRAS NAVEGAÇÕES */}
            <Text style={styles.sectionTitle}>Segurança e Suporte</Text>

            <TouchableOpacity style={styles.menuRowCard} activeOpacity={0.8} onPress={() => navigation.navigate('EmergencyContacts')}>
              <View style={styles.menuRowLeft}>
                <View style={[styles.iconBox, { backgroundColor: '#FEE2E2' }]}>
                  <Ionicons name="shield-checkmark" size={20} color="#EF4444" />
                </View>
                <Text style={styles.menuRowTitle}>{t('emergency_contacts', 'Contatos de Emergência')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.menuRowCard} activeOpacity={0.8} onPress={() => navigation.navigate('RideHistory')}>
              <View style={styles.menuRowLeft}>
                <View style={[styles.iconBox, { backgroundColor: '#FEF3C7' }]}>
                  <Ionicons name="time" size={20} color="#D97706" />
                </View>
                <Text style={styles.menuRowTitle}>{t('my_rides', 'Minhas Corridas')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.menuRowCard} activeOpacity={0.8} onPress={() => navigation.navigate('HelpCenter')}>
              <View style={styles.menuRowLeft}>
                <View style={[styles.iconBox, { backgroundColor: '#F0FDF4' }]}>
                  <Ionicons name="help-buoy" size={20} color="#16A34A" />
                </View>
                <Text style={styles.menuRowTitle}>{t('help_center', 'Central de Ajuda')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.menuRowCard} activeOpacity={0.8} onPress={() => setIsPrivacyModalOpen(true)}>
              <View style={styles.menuRowLeft}>
                <View style={[styles.iconBox, { backgroundColor: '#E0F2FE' }]}>
                  <Ionicons name="document-text" size={20} color="#0284C7" />
                </View>
                <Text style={styles.menuRowTitle}>{t('privacy_policy', 'Termos & Políticas de Privacidade')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
            </TouchableOpacity>

            {/* BOTÕES DE ENCERRAMENTO */}
            <View style={{ marginTop: 12, gap: 8 }}>
              <TouchableOpacity style={styles.logoutButton} activeOpacity={0.85} onPress={handleSignOut}>
                <Ionicons name="log-out-outline" size={20} color="#EF4444" style={{ marginRight: 8 }} />
                <Text style={styles.logoutButtonText}>{t('logout', 'Sair da Conta')}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.deleteAccountButton} activeOpacity={0.7} onPress={handleDeleteAccount}>
                <Ionicons name="trash-outline" size={16} color="#94A3B8" style={{ marginRight: 6 }} />
                <Text style={styles.deleteAccountButtonText}>{t('delete_my_account', 'Excluir minha conta permanentemente')}</Text>
              </TouchableOpacity>
            </View>

            <View style={{ height: 40 }} />
          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>

      <PrivacyPolicyModal 
        visible={isPrivacyModalOpen} 
        onClose={() => setIsPrivacyModalOpen(false)} 
      />

      {/* MODAL DE IDIOMAS REDESENHADO */}
      <Modal visible={isLangModalOpen} transparent animationType="slide" onRequestClose={() => setIsLangModalOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.langModalContainer}>
            <View style={styles.langModalHeader}>
              <Text style={styles.langModalTitle}>{t('select_language', 'Selecione o Idioma')}</Text>
              <TouchableOpacity onPress={() => setIsLangModalOpen(false)} style={styles.modalCloseIcon}>
                <Ionicons name="close" size={20} color="#64748B" />
              </TouchableOpacity>
            </View>
            {LANGUAGES.map((lang) => (
              <TouchableOpacity 
                key={lang.code} 
                style={[styles.langOption, i18n.language === lang.code && styles.langOptionActive]}
                onPress={() => handleSelectLanguage(lang.code)}
                activeOpacity={0.7}
              >
                <Text style={styles.langOptionText}>{lang.flag}   {lang.label}</Text>
                {i18n.language === lang.code && <Ionicons name="checkmark-circle" size={22} color="#EAB308" />}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: '#F8FAFC' 
  },
  header: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between', 
    paddingHorizontal: 16, 
    paddingVertical: 14, 
    backgroundColor: '#F8FAFC',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9'
  },
  backButton: { 
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  headerTitle: { 
    fontSize: 17, 
    fontWeight: '800', 
    color: '#0F172A' 
  },
  content: { 
    flex: 1, 
    paddingHorizontal: 18, 
    marginTop: 8 
  },
  avatarContainer: { 
    alignItems: 'center', 
    marginVertical: 16 
  },
  avatarWrapper: { 
    position: 'relative', 
    marginBottom: 10 
  },
  avatarGlowRing: {
    padding: 3,
    borderRadius: 52,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#EAB308',
    elevation: 4,
    shadowColor: '#EAB308',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
  },
  avatarFallback: { 
    width: 90, 
    height: 90, 
    borderRadius: 45, 
    backgroundColor: '#F1F5F9', 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  avatarImage: { 
    width: 90, 
    height: 90, 
    borderRadius: 45, 
    backgroundColor: '#CBD5E1' 
  },
  cameraBadge: { 
    position: 'absolute', 
    bottom: 2, 
    right: 2, 
    backgroundColor: '#EAB308', 
    padding: 7, 
    borderRadius: 16, 
    borderWidth: 2, 
    borderColor: '#FFFFFF',
    elevation: 4
  },
  userName: { 
    fontSize: 20, 
    fontWeight: '800', 
    color: '#0F172A', 
    marginBottom: 4 
  },
  ratingBadgeContainer: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: '#FEF08A', 
    paddingHorizontal: 10, 
    paddingVertical: 4, 
    borderRadius: 12,
    gap: 4
  },
  ratingText: { 
    fontSize: 13, 
    fontWeight: '800', 
    color: '#854D0E'
  },
  ratingSubtext: {
    fontSize: 11,
    fontWeight: '600',
    color: '#854D0E'
  },
  walletCardGradient: { 
    borderRadius: 20, 
    padding: 18, 
    marginBottom: 18,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    borderWidth: 1,
    borderColor: '#334155'
  },
  walletCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  walletIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(234, 179, 8, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#EAB308'
  },
  walletChipBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)'
  },
  walletChipText: {
    color: '#EAB308',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1
  },
  walletLabel: { 
    fontSize: 12, 
    fontWeight: '600', 
    color: '#94A3B8' 
  },
  walletValue: { 
    fontSize: 24, 
    fontWeight: '900', 
    color: '#FFFFFF', 
    marginTop: 2 
  },
  walletCurrency: {
    fontSize: 14,
    color: '#EAB308',
    fontWeight: '800'
  },
  sectionTitle: { 
    fontSize: 14, 
    fontWeight: '800', 
    color: '#64748B', 
    marginBottom: 10, 
    marginLeft: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5
  },
  formCard: { 
    backgroundColor: '#FFFFFF', 
    borderRadius: 18, 
    padding: 16, 
    shadowColor: '#000', 
    shadowOffset: { width: 0, height: 2 }, 
    shadowOpacity: 0.04, 
    shadowRadius: 8, 
    elevation: 2, 
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#F1F5F9'
  },
  inputLabel: { 
    fontSize: 12, 
    fontWeight: '700', 
    color: '#475569', 
    marginBottom: 6 
  },
  inputContainer: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: '#F8FAFC', 
    borderWidth: 1, 
    borderColor: '#E2E8F0', 
    borderRadius: 12, 
    paddingHorizontal: 12, 
    marginBottom: 14,
    height: 48
  },
  disabledInputContainer: { 
    backgroundColor: '#F1F5F9', 
    borderColor: '#CBD5E1' 
  },
  input: { 
    flex: 1, 
    height: '100%', 
    marginLeft: 10, 
    fontSize: 14, 
    fontWeight: '600',
    color: '#0F172A' 
  },
  disabledInput: { 
    color: '#64748B' 
  },
  cashNoticeBox: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: '#DCFCE7', 
    borderWidth: 1, 
    borderColor: '#86EFAC', 
    borderRadius: 12, 
    padding: 12, 
    marginBottom: 16, 
    gap: 10 
  },
  cashNoticeIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(22, 101, 52, 0.15)',
    justifyContent: 'center',
    alignItems: 'center'
  },
  cashNoticeText: { 
    flex: 1, 
    fontSize: 12, 
    color: '#166534', 
    lineHeight: 17 
  },
  providerContainer: { 
    flexDirection: 'row', 
    gap: 10, 
    marginBottom: 14 
  },
  providerSquareButtonBlocked: { 
    flex: 1, 
    height: 80, 
    borderRadius: 12, 
    borderWidth: 1, 
    borderColor: '#CBD5E1', 
    backgroundColor: '#F8FAFC', 
    alignItems: 'center', 
    justifyContent: 'center', 
    opacity: 0.7 
  },
  providerSquareText: { 
    fontSize: 12, 
    fontWeight: '700', 
    color: '#64748B' 
  },
  badgeBlocked: { 
    backgroundColor: '#E2E8F0', 
    paddingHorizontal: 8, 
    paddingVertical: 2, 
    borderRadius: 6, 
    marginTop: 4 
  },
  badgeBlockedText: { 
    fontSize: 9, 
    fontWeight: '800', 
    color: '#64748B', 
    textTransform: 'uppercase' 
  },
  primarySaveButton: { 
    backgroundColor: '#EAB308', 
    height: 48, 
    borderRadius: 12, 
    justifyContent: 'center',
    alignItems: 'center', 
    marginTop: 4,
    elevation: 2,
    shadowColor: '#EAB308',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4
  },
  buttonDisabled: { 
    opacity: 0.7 
  },
  primarySaveButtonText: { 
    fontSize: 14, 
    fontWeight: '800', 
    color: '#0F172A' 
  },
  menuRowCard: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between', 
    backgroundColor: '#FFFFFF', 
    borderRadius: 16, 
    padding: 14, 
    marginBottom: 10, 
    shadowColor: '#000', 
    shadowOffset: { width: 0, height: 1 }, 
    shadowOpacity: 0.03, 
    shadowRadius: 6, 
    elevation: 1.5,
    borderWidth: 1,
    borderColor: '#F1F5F9'
  },
  menuRowLeft: { 
    flexDirection: 'row', 
    alignItems: 'center',
    flex: 1
  },
  iconBox: { 
    width: 38,
    height: 38,
    borderRadius: 12, 
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12 
  },
  menuRowTitle: { 
    fontSize: 14, 
    fontWeight: '700', 
    color: '#0F172A' 
  },
  menuRowSubtext: { 
    fontSize: 12, 
    color: '#64748B', 
    marginTop: 2 
  },
  logoutButton: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'center', 
    backgroundColor: '#FEE2E2', 
    paddingVertical: 14, 
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#FECDD3'
  },
  logoutButtonText: { 
    color: '#EF4444', 
    fontSize: 15, 
    fontWeight: '800' 
  },
  deleteAccountButton: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'center', 
    paddingVertical: 10 
  },
  deleteAccountButtonText: { 
    color: '#94A3B8', 
    fontSize: 13, 
    fontWeight: '600' 
  },
  modalOverlay: { 
    flex: 1, 
    backgroundColor: 'rgba(15, 23, 42, 0.65)', 
    justifyContent: 'flex-end' 
  },
  langModalContainer: { 
    backgroundColor: '#FFFFFF', 
    borderTopLeftRadius: 24, 
    borderTopRightRadius: 24, 
    padding: 20 
  },
  langModalHeader: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    marginBottom: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9'
  },
  langModalTitle: { 
    fontSize: 17, 
    fontWeight: '800', 
    color: '#0F172A' 
  },
  modalCloseIcon: {
    padding: 4,
    backgroundColor: '#F1F5F9',
    borderRadius: 14
  },
  langOption: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    paddingVertical: 14, 
    paddingHorizontal: 8,
    borderBottomWidth: 1, 
    borderBottomColor: '#F8FAFC' 
  },
  langOptionActive: { 
    backgroundColor: '#FEF9C3',
    borderRadius: 12
  },
  langOptionText: { 
    fontSize: 15, 
    fontWeight: '700', 
    color: '#0F172A' 
  },
});