import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  Modal,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import { changeLanguage, SUPPORTED_LANGUAGES } from '../services/i18n';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import { socket } from '../services/passengerSocket';
import { PrivacyPolicyModal } from '../components/PrivacyPolicyModal';

const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://api.nobai245.com').replace(/\/api\/?$/, '');

type ProviderType = 'ORANGE_MONEY' | 'MTN_MOMO';

const formatPhotoUrl = (path?: string | null, timestamp?: number) => {
  if (!path || typeof path !== 'string') return undefined;
  let fullUrl = path;
  if (!path.startsWith('http://') && !path.startsWith('https://')) {
    const cleanBase = API_URL.replace(/\/$/, '');
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    fullUrl = `${cleanBase}${cleanPath}`;
  }
  return timestamp ? `${fullUrl}?t=${timestamp}` : fullUrl;
};

const strip245 = (raw?: string | null): string => {
  if (!raw) return '';
  const digits = String(raw).replace(/\D/g, '');
  return digits.startsWith('245') ? digits.slice(3) : digits;
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
  const { user, signOut, updateUserContext, refreshPassengerProfile } = useAuth();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { t, i18n } = useTranslation();
  const isMountedRef = useRef(true);

  const [refreshing, setRefreshing] = useState(false);
  const [fullName, setFullName] = useState(user?.fullName || '');
  const [email, setEmail] = useState(user?.email || '');
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [imageTimestamp, setImageTimestamp] = useState<number>(Date.now());
  const [isSavingProfile, setIsSavingProfile] = useState(false);

  const [paymentProvider, setPaymentProvider] = useState<ProviderType>(
    user?.paymentProvider === 'MTN_MOMO' ? 'MTN_MOMO' : 'ORANGE_MONEY'
  );
  const [accountNumber, setAccountNumber] = useState<string>(() =>
    strip245(user?.paymentAccountNumber || user?.phone)
  );
  const [isSavingPayment, setIsSavingPayment] = useState(false);

  const [isPrivacyModalOpen, setIsPrivacyModalOpen] = useState(false);
  const [isLangModalOpen, setIsLangModalOpen] = useState(false);

  const syncProfile = useCallback(async (isPull = false) => {
    if (isPull) setRefreshing(true);
    try {
      await refreshPassengerProfile();
    } finally {
      if (isMountedRef.current) setRefreshing(false);
    }
  }, [refreshPassengerProfile]);

  useEffect(() => {
    isMountedRef.current = true;
    syncProfile(false);

    if (socket) {
      const onWalletUpdated = (payload: any) => {
        if (!isMountedRef.current) return;
        if (payload?.walletBalance !== undefined) {
          updateUserContext({ walletBalance: Number(payload.walletBalance) });
        }
        syncProfile(false);
      };
      socket.on('wallet:updated', onWalletUpdated);
      return () => {
        isMountedRef.current = false;
        socket.off('wallet:updated', onWalletUpdated);
      };
    }

    return () => {
      isMountedRef.current = false;
    };
  }, [syncProfile, updateUserContext]);

  useFocusEffect(
    useCallback(() => {
      syncProfile(false);
    }, [syncProfile])
  );

  useEffect(() => {
    if (user?.fullName && !fullName) setFullName(user.fullName);
    if (user?.email && !email) setEmail(user.email);
    if (user?.paymentProvider === 'ORANGE_MONEY' || user?.paymentProvider === 'MTN_MOMO') {
      setPaymentProvider(user.paymentProvider);
    }
    if (user?.paymentAccountNumber) {
      setAccountNumber(strip245(user.paymentAccountNumber));
    }
  }, [user?.fullName, user?.email, user?.paymentProvider, user?.paymentAccountNumber]);

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
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (!result.canceled && result.assets[0]?.uri) {
      setSelectedImage(result.assets[0].uri);
    }
  }

  function handleDeleteAccount() {
    Alert.alert(
      t('delete_account_title', 'Excluir Conta'),
      t(
        'delete_account_confirm',
        'Tem certeza de que deseja excluir sua conta? Esta ação é permanente e você perderá seu histórico e dados salvos.'
      ),
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
                error?.response?.data?.error ||
                  error?.response?.data?.message ||
                  t('delete_account_error', 'Não foi possível excluir a conta. Tente novamente mais tarde.')
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
        t('warning_title', 'Atenção'),
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
        const ext = match ? match[1].toLowerCase() : 'jpg';
        const type = ext === 'png' ? 'image/png' : 'image/jpeg';
        const formattedUri =
          Platform.OS === 'android' ? selectedImage : selectedImage.replace('file://', '');

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
        updateUserContext(updatedPassenger);
      }

      if (isMountedRef.current) {
        setSelectedImage(null);
        setImageTimestamp(Date.now());
      }

      Alert.alert(t('success', 'Sucesso ✅'), t('data_updated', 'Seus dados foram atualizados!'));
    } catch (error: any) {
      if (!isMountedRef.current) return;
      Alert.alert(
        t('error_title', 'Erro'),
        error?.response?.data?.error ||
          error?.response?.data?.message ||
          t('update_profile_error', 'Não foi possível atualizar seus dados pessoais.')
      );
    } finally {
      if (isMountedRef.current) setIsSavingProfile(false);
    }
  }

  async function handleSavePaymentInfo() {
    Keyboard.dismiss();
    const clean9 = strip245(accountNumber);

    if (clean9.length !== 9) {
      return Alert.alert(
        'Número Inválido',
        'Informe um número Mobile Money válido de 9 dígitos da Guiné-Bissau.'
      );
    }
    if (paymentProvider === 'ORANGE_MONEY' && !clean9.startsWith('95')) {
      return Alert.alert('Operadora Incompatível', 'Números Orange Money começam com 95.');
    }
    if (paymentProvider === 'MTN_MOMO' && !clean9.startsWith('96') && !clean9.startsWith('97')) {
      return Alert.alert('Operadora Incompatível', 'Números Telecel (antigo MTN) começam com 96 ou 97.');
    }

    setIsSavingPayment(true);
    try {
      await api.put('/passengers/payment-method', {
        paymentProvider,
        paymentAccountNumber: `245${clean9}`,
      });

      updateUserContext({
        paymentProvider,
        paymentAccountNumber: `245${clean9}`,
      });
      await refreshPassengerProfile();

      Alert.alert(
        'Pagamento Atualizado ✅',
        `Conta ${paymentProvider === 'ORANGE_MONEY' ? 'Orange Money' : 'Telecel / MTN'} (+245 ${clean9}) salva como padrão!`
      );
    } catch (error: any) {
      if (!isMountedRef.current) return;
      Alert.alert(
        t('error_title', 'Erro'),
        error?.response?.data?.error ||
          t('payment_update_error', 'Não foi possível salvar as informações de pagamento.')
      );
    } finally {
      if (isMountedRef.current) setIsSavingPayment(false);
    }
  }

  const handleSelectLanguage = (code: string) => {
    changeLanguage(code);
    setIsLangModalOpen(false);
  };

  const normalizedLang = i18n.language === 'gnb' ? 'cri' : i18n.language;
  const currentLang = LANGUAGES.find((l) => l.code === normalizedLang) || LANGUAGES[0];
  const avatarUri = selectedImage || formatPhotoUrl(user?.profilePicture, imageTimestamp);
  const walletBalance = Math.round(Number(user?.walletBalance || 0));
  const topPad = Math.max(
    (insets?.top || 0) + 8,
    Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 8 : 16
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0F172A" translucent />

      {/* HERO HEADER LUXURY */}
      <View style={[styles.heroHeader, { paddingTop: topPad }]}>
        <View style={styles.headerTopRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerIconBtn} activeOpacity={0.75}>
            <Ionicons name="arrow-back" size={21} color="#F8FAFC" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('my_profile', 'Meu Perfil')}</Text>
          <TouchableOpacity onPress={() => syncProfile(true)} style={styles.headerIconBtn} activeOpacity={0.75}>
            <Ionicons name="refresh" size={19} color="#EAB308" />
          </TouchableOpacity>
        </View>

        <View style={styles.avatarContainer}>
          <TouchableOpacity activeOpacity={0.85} onPress={handlePickImage} style={styles.avatarWrapper}>
            <View style={styles.avatarGlowRing}>
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
              ) : (
                <View style={styles.avatarFallback}>
                  <Ionicons name="person" size={42} color="#94A3B8" />
                </View>
              )}
            </View>
            <View style={styles.cameraBadge}>
              <Ionicons name="camera" size={14} color="#0F172A" />
            </View>
          </TouchableOpacity>

          <Text style={styles.userName}>{user?.fullName || t('passenger', 'Passageiro')}</Text>
          <Text style={styles.userPhone}>{user?.phone || ''}</Text>

          <View style={styles.ratingBadgeContainer}>
            <Ionicons name="star" size={13} color="#EAB308" />
            <Text style={styles.ratingText}>{Number(user?.ratingAverage || 5.0).toFixed(1)}</Text>
            <Text style={styles.ratingSubtext}>• {t('vip_passenger', 'Passageiro Nô Bai')}</Text>
          </View>
        </View>
      </View>

      {/* FOLHA DE CONTEÚDO */}
      <View style={styles.contentSheet}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <ScrollView
              style={styles.content}
              contentContainerStyle={{ paddingBottom: Math.max((insets?.bottom || 0) + 28, 36) }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={() => syncProfile(true)}
                  colors={['#0F172A']}
                />
              }
            >
              {/* WALLET CARD */}
              <TouchableOpacity activeOpacity={0.9} onPress={() => navigation.navigate('Wallet')}>
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

                  <View style={{ marginTop: 12 }}>
                    <Text style={styles.walletLabel}>{t('wallet_balance', 'Saldo Disponível')}</Text>
                    <Text style={styles.walletValue}>
                      {walletBalance.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')}{' '}
                      <Text style={styles.walletCurrency}>XOF</Text>
                    </Text>
                  </View>

                  <View style={styles.walletFooterRow}>
                    <Text style={styles.walletFooterText}>{t('recharge_card_cta', 'Recarregar Saldo & Ver Extrato')}</Text>
                    <Ionicons name="chevron-forward" size={18} color="#EAB308" />
                  </View>
                </LinearGradient>
              </TouchableOpacity>

              {/* IDIOMA */}
              <TouchableOpacity
                style={styles.menuRowCard}
                activeOpacity={0.8}
                onPress={() => setIsLangModalOpen(true)}
              >
                <View style={styles.menuRowLeft}>
                  <View style={[styles.iconBox, { backgroundColor: '#EEF2FF' }]}>
                    <Ionicons name="language" size={20} color="#4338CA" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.menuRowTitle}>{t('select_language', 'Idioma do aplicativo')}</Text>
                    <Text style={styles.menuRowSubtext}>
                      {currentLang.flag}  {currentLang.label}
                    </Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
              </TouchableOpacity>

              {/* DADOS PESSOAIS */}
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
                    <Text style={styles.primarySaveButtonText}>
                      {t('save_personal_data', 'Atualizar Dados Pessoais')}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>

              {/* CONFIGURAR MOBILE MONEY PADRÃO (ATIVO E SINCRONIZADO) */}
              <Text style={styles.sectionTitle}>{t('setup_payment', 'Conta Mobile Money Padrão')}</Text>
              <View style={styles.formCard}>
                <Text style={styles.paymentHelperText}>
                  Selecione sua operadora preferida na Guiné-Bissau para recargas rápidas e pagamentos digitais:
                </Text>

                <View style={styles.providerContainer}>
                  <TouchableOpacity
                    style={[
                      styles.providerSquareButton,
                      paymentProvider === 'ORANGE_MONEY' && {
                        borderColor: '#FF7900',
                        backgroundColor: '#FFF7ED',
                      },
                    ]}
                    onPress={() => setPaymentProvider('ORANGE_MONEY')}
                    activeOpacity={0.8}
                  >
                    <Ionicons
                      name="phone-portrait"
                      size={22}
                      color={paymentProvider === 'ORANGE_MONEY' ? '#FF7900' : '#64748B'}
                      style={{ marginBottom: 4 }}
                    />
                    <Text style={styles.providerSquareText}>Orange Money</Text>
                    <Text style={styles.providerPrefixHint}>Prefixo 95</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.providerSquareButton,
                      paymentProvider === 'MTN_MOMO' && {
                        borderColor: '#EAB308',
                        backgroundColor: '#FEFCE8',
                      },
                    ]}
                    onPress={() => setPaymentProvider('MTN_MOMO')}
                    activeOpacity={0.8}
                  >
                    <Ionicons
                      name="wallet"
                      size={22}
                      color={paymentProvider === 'MTN_MOMO' ? '#CA8A04' : '#64748B'}
                      style={{ marginBottom: 4 }}
                    />
                    <Text style={styles.providerSquareText}>Telecel / MTN</Text>
                    <Text style={styles.providerPrefixHint}>Prefixos 96 ou 97</Text>
                  </TouchableOpacity>
                </View>

                <Text style={styles.inputLabel}>
                  Número {paymentProvider === 'ORANGE_MONEY' ? 'Orange Money (95...)' : 'Telecel / MTN (96 ou 97...)'}
                </Text>
                <View style={styles.inputContainer}>
                  <Text style={styles.countryPrefix}>🇬🇼 +245</Text>
                  <TextInput
                    style={styles.input}
                    keyboardType="number-pad"
                    value={accountNumber}
                    onChangeText={(v) => setAccountNumber(v.replace(/\D/g, '').replace(/^245/, '').slice(0, 9))}
                    maxLength={9}
                    placeholder={paymentProvider === 'ORANGE_MONEY' ? '955000000' : '966000000'}
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
                    <Text style={styles.primarySaveButtonText}>
                      {t('save_payment', 'Salvar Conta Mobile Money')}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>

              {/* NAVEGAÇÃO & SEGURANÇA */}
              <Text style={styles.sectionTitle}>{t('security_and_support', 'Vantagens, Segurança e Suporte')}</Text>

              <TouchableOpacity
                style={styles.menuRowCard}
                activeOpacity={0.8}
                onPress={() => navigation.navigate('Rewards')}
              >
                <View style={styles.menuRowLeft}>
                  <View style={[styles.iconBox, { backgroundColor: '#FEF3C7' }]}>
                    <Ionicons name="gift" size={20} color="#D97706" />
                  </View>
                  <Text style={styles.menuRowTitle}>{t('points_and_rewards', 'Pontos & Recompensas')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.menuRowCard}
                activeOpacity={0.8}
                onPress={() => navigation.navigate('EmergencyContacts')}
              >
                <View style={styles.menuRowLeft}>
                  <View style={[styles.iconBox, { backgroundColor: '#FEE2E2' }]}>
                    <Ionicons name="shield-checkmark" size={20} color="#EF4444" />
                  </View>
                  <Text style={styles.menuRowTitle}>{t('emergency_contacts', 'Contatos de Emergência')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.menuRowCard}
                activeOpacity={0.8}
                onPress={() => navigation.navigate('RideHistory')}
              >
                <View style={styles.menuRowLeft}>
                  <View style={[styles.iconBox, { backgroundColor: '#E0E7FF' }]}>
                    <Ionicons name="time" size={20} color="#4338CA" />
                  </View>
                  <Text style={styles.menuRowTitle}>{t('my_rides', 'Minhas Corridas')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.menuRowCard}
                activeOpacity={0.8}
                onPress={() => navigation.navigate('HelpCenter')}
              >
                <View style={styles.menuRowLeft}>
                  <View style={[styles.iconBox, { backgroundColor: '#F0FDF4' }]}>
                    <Ionicons name="help-buoy" size={20} color="#16A34A" />
                  </View>
                  <Text style={styles.menuRowTitle}>{t('help_center', 'Central de Ajuda')}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.menuRowCard}
                activeOpacity={0.8}
                onPress={() => setIsPrivacyModalOpen(true)}
              >
                <View style={styles.menuRowLeft}>
                  <View style={[styles.iconBox, { backgroundColor: '#E0F2FE' }]}>
                    <Ionicons name="document-text" size={20} color="#0284C7" />
                  </View>
                  <Text style={styles.menuRowTitle}>
                    {t('privacy_policy', 'Termos & Políticas de Privacidade')}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
              </TouchableOpacity>

              {/* ENCERRAMENTO */}
              <View style={{ marginTop: 14, gap: 8 }}>
                <TouchableOpacity style={styles.logoutButton} activeOpacity={0.85} onPress={signOut}>
                  <Ionicons name="log-out-outline" size={20} color="#EF4444" style={{ marginRight: 8 }} />
                  <Text style={styles.logoutButtonText}>{t('logout', 'Sair da Conta')}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.deleteAccountButton}
                  activeOpacity={0.7}
                  onPress={handleDeleteAccount}
                >
                  <Ionicons name="trash-outline" size={16} color="#94A3B8" style={{ marginRight: 6 }} />
                  <Text style={styles.deleteAccountButtonText}>
                    {t('delete_my_account', 'Excluir minha conta permanentemente')}
                  </Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </View>

      <PrivacyPolicyModal
        visible={isPrivacyModalOpen}
        onClose={() => setIsPrivacyModalOpen(false)}
      />

      {/* MODAL DE IDIOMAS */}
      <Modal
        visible={isLangModalOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setIsLangModalOpen(false)}
      >
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
                <Text style={styles.langOptionText}>
                  {lang.flag}   {lang.label}
                </Text>
                {i18n.language === lang.code && (
                  <Ionicons name="checkmark-circle" size={22} color="#EAB308" />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  heroHeader: { paddingHorizontal: 20, paddingBottom: 22, backgroundColor: '#0F172A' },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: { fontSize: 17, fontWeight: '800', color: '#F8FAFC' },
  avatarContainer: { alignItems: 'center', marginTop: 14 },
  avatarWrapper: { position: 'relative', marginBottom: 10 },
  avatarGlowRing: {
    padding: 3,
    borderRadius: 52,
    backgroundColor: '#1E293B',
    borderWidth: 2,
    borderColor: '#EAB308',
  },
  avatarFallback: {
    width: 86,
    height: 86,
    borderRadius: 43,
    backgroundColor: '#1E293B',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarImage: { width: 86, height: 86, borderRadius: 43, backgroundColor: '#334155' },
  cameraBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    backgroundColor: '#EAB308',
    padding: 7,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: '#0F172A',
  },
  userName: { fontSize: 19, fontWeight: '900', color: '#F8FAFC' },
  userPhone: { fontSize: 13, color: '#94A3B8', fontWeight: '600', marginTop: 2 },
  ratingBadgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(234, 179, 8, 0.14)',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    marginTop: 8,
    gap: 5,
  },
  ratingText: { color: '#EAB308', fontWeight: '800', fontSize: 13 },
  ratingSubtext: { color: '#CBD5E1', fontSize: 12, fontWeight: '600' },
  contentSheet: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    overflow: 'hidden',
  },
  content: { flex: 1, paddingHorizontal: 18, paddingTop: 18 },
  walletCardGradient: {
    borderRadius: 20,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(234, 179, 8, 0.35)',
  },
  walletCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  walletIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(234, 179, 8, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  walletChipBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(234, 179, 8, 0.14)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 16,
  },
  walletChipText: { color: '#EAB308', fontSize: 11, fontWeight: '800', letterSpacing: 0.6 },
  walletLabel: { color: '#94A3B8', fontSize: 12, fontWeight: '600' },
  walletValue: { color: '#F8FAFC', fontSize: 28, fontWeight: '900', marginTop: 2 },
  walletCurrency: { color: '#EAB308', fontSize: 15, fontWeight: '800' },
  walletFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  walletFooterText: { color: '#EAB308', fontWeight: '800', fontSize: 13 },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: '#334155', marginBottom: 10, marginTop: 6 },
  formCard: {
    backgroundColor: '#FFF',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 18,
  },
  inputLabel: { fontSize: 12, fontWeight: '700', color: '#475569', marginBottom: 6, marginTop: 6 },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingHorizontal: 12,
    height: 46,
    marginBottom: 8,
    gap: 8,
  },
  disabledInputContainer: { backgroundColor: '#F1F5F9', borderColor: '#E2E8F0' },
  input: { flex: 1, fontSize: 14, fontWeight: '700', color: '#0F172A' },
  disabledInput: { color: '#64748B' },
  countryPrefix: { color: '#0F172A', fontSize: 13, fontWeight: '800' },
  primarySaveButton: {
    backgroundColor: '#EAB308',
    height: 46,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  primarySaveButtonText: { color: '#0F172A', fontSize: 14, fontWeight: '900' },
  buttonDisabled: { opacity: 0.65 },
  paymentHelperText: { color: '#64748B', fontSize: 12, lineHeight: 17, marginBottom: 10 },
  providerContainer: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  providerSquareButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    backgroundColor: '#F8FAFC',
  },
  providerSquareText: { color: '#0F172A', fontSize: 13, fontWeight: '800' },
  providerPrefixHint: { color: '#64748B', fontSize: 11, fontWeight: '600', marginTop: 2 },
  menuRowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFF',
    borderRadius: 14,
    padding: 13,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 10,
  },
  menuRowLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 12 },
  iconBox: { width: 36, height: 36, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  menuRowTitle: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
  menuRowSubtext: { fontSize: 12, color: '#64748B', fontWeight: '600', marginTop: 2 },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEE2E2',
    height: 48,
    borderRadius: 14,
  },
  logoutButtonText: { color: '#DC2626', fontSize: 14, fontWeight: '800' },
  deleteAccountButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  deleteAccountButtonText: { color: '#94A3B8', fontSize: 12, fontWeight: '700' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'flex-end',
  },
  langModalContainer: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
  },
  langModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  langModalTitle: { fontSize: 17, fontWeight: '900', color: '#0F172A' },
  modalCloseIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  langOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    marginBottom: 8,
  },
  langOptionActive: {
    backgroundColor: '#FEFCE8',
    borderWidth: 1,
    borderColor: '#EAB308',
  },
  langOptionText: { fontSize: 14, fontWeight: '700', color: '#0F172A' },
});
