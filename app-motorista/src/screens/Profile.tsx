import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
  StatusBar,
  TextInput,
  Alert,
  ScrollView,
  ActivityIndicator,
  Modal,
  Image,
  KeyboardAvoidingView,
  Keyboard,
  TouchableWithoutFeedback,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';
import { changeLanguage, SUPPORTED_LANGUAGES } from '../services/i18n';

import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import { socket } from '../services/socket';
import { PrivacyPolicyModal } from '../components/PrivacyPolicyModal';
import { theme } from '../theme/theme';

type RootStackParamList = any;

const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://api.nobai245.com')
  .replace(/\/api\/?$/, '')
  .replace(/\/$/, '');

export interface LanguageOption {
  code: string;
  name: string;
  flag: string;
}

const LANGUAGES: readonly LanguageOption[] = [
  { code: 'pt', name: 'Português', flag: '🇵🇹' },
  { code: 'cri', name: 'Crioulo (Kriol)', flag: '🇬🇼' },
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'ru', name: 'Русский', flag: '🇷🇺' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
] as const;

type ProfileScreenNavigationProp = NativeStackNavigationProp<RootStackParamList>;

export interface FinanceData {
  walletBalance: number;
  todayEarned?: number;
  weeklyEarned?: number;
  totalEarned: number;
  totalRides: number;
  mobileMoneyAccount?: string;
  orangeNumber?: string;
  mtnNumber?: string;
}

export interface UpdateFormState {
  newFullName: string;
  newVehiclePlate: string;
  newVehicleBrand: string;
  newVehicleColor: string;
  newDocumentNumber: string;
}

const strip245 = (raw?: string | null): string => {
  if (!raw) return '';
  const digits = String(raw).replace(/\D/g, '');
  return digits.startsWith('245') ? digits.slice(3) : digits;
};

const formatLocalPhone = (raw?: string | null): string => {
  const nine = strip245(raw);
  if (nine.length !== 9) return nine ? `+245 ${nine}` : '';
  return `+245 ${nine.slice(0, 3)} ${nine.slice(3, 6)} ${nine.slice(6)}`;
};

export function Profile() {
  const { t, i18n } = useTranslation();
  const { driver, signOut, refreshDriverProfile } = useAuth();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<ProfileScreenNavigationProp>();
  const isMountedRef = useRef(true);

  const [financeData, setFinanceData] = useState<FinanceData | null>(null);
  const [hasPendingRequest, setHasPendingRequest] = useState<boolean>(false);
  const [imageTimestamp, setImageTimestamp] = useState<number>(Date.now());

  const [initialLoading, setInitialLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [networkError, setNetworkError] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [uploadingImage, setUploadingImage] = useState<boolean>(false);
  const [isSubmittingUpdate, setIsSubmittingUpdate] = useState<boolean>(false);

  const [isEditingPayment, setIsEditingPayment] = useState<boolean>(false);
  const [mmNumber, setMmNumber] = useState<string>('');
  const [mmProvider, setMmProvider] = useState<'ORANGE' | 'MTN'>('ORANGE');

  const [isUpdateModalVisible, setIsUpdateModalVisible] = useState<boolean>(false);
  const [isPrivacyModalVisible, setIsPrivacyModalVisible] = useState<boolean>(false);
  const [isLanguageModalVisible, setIsLanguageModalVisible] = useState<boolean>(false);

  const [updateData, setUpdateData] = useState<UpdateFormState>({
    newFullName: driver?.fullName || '',
    newVehiclePlate: driver?.vehiclePlate || '',
    newVehicleBrand: (driver as any)?.vehicleBrand || '',
    newVehicleColor: (driver as any)?.vehicleColor || '',
    newDocumentNumber: (driver as any)?.documentNumber || '',
  });

  const loadFinanceData = useCallback(async () => {
    try {
      const res = await api.get<FinanceData>('/drivers/finance');
      if (!isMountedRef.current) return;
      setFinanceData(res.data);
      setNetworkError(false);
    } catch {
      if (isMountedRef.current) setNetworkError(true);
    }
  }, []);

  const checkPendingRequest = useCallback(async () => {
    try {
      const res = await api.get<{ hasPendingRequest: boolean }>('/drivers/request-update/status');
      if (isMountedRef.current) {
        setHasPendingRequest(Boolean(res.data?.hasPendingRequest));
      }
    } catch {
      // Silencioso se offline
    }
  }, []);

  const syncAll = useCallback(async (isPull = false) => {
    if (isPull) setRefreshing(true);
    await Promise.allSettled([
      loadFinanceData(),
      checkPendingRequest(),
      refreshDriverProfile(),
    ]);
    if (isMountedRef.current) {
      setInitialLoading(false);
      setRefreshing(false);
    }
  }, [loadFinanceData, checkPendingRequest, refreshDriverProfile]);

  useEffect(() => {
    isMountedRef.current = true;
    syncAll(false);

    if (socket) {
      const onWalletUpdated = () => {
        if (isMountedRef.current) syncAll(false);
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
  }, [syncAll]);

  useFocusEffect(
    useCallback(() => {
      syncAll(false);
    }, [syncAll])
  );

  function formatMoney(value?: number | string): string {
    if (value === null || value === undefined) return '0';
    const num = Math.round(Number(value));
    if (isNaN(num)) return '0';
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  function handlePhoneChange(text: string) {
    const clean = text.replace(/\D/g, '').replace(/^245/, '').slice(0, 9);
    setMmNumber(clean);
  }

  function handleOpenEdit() {
    setIsEditingPayment(true);
    const cleanMtn = strip245(financeData?.mtnNumber || (driver as any)?.mtnNumber);
    const cleanOrange = strip245(
      financeData?.orangeNumber ||
      (driver as any)?.orangeNumber ||
      financeData?.mobileMoneyAccount ||
      (driver as any)?.paymentAccountNumber
    );

    if (cleanMtn && !cleanOrange) {
      setMmProvider('MTN');
      setMmNumber(cleanMtn);
    } else {
      setMmProvider('ORANGE');
      setMmNumber(cleanOrange);
    }
  }

  function handleProviderChange(provider: 'ORANGE' | 'MTN') {
    setMmProvider(provider);
    if (provider === 'MTN') {
      setMmNumber(strip245(financeData?.mtnNumber || (driver as any)?.mtnNumber));
    } else {
      setMmNumber(
        strip245(
          financeData?.orangeNumber ||
          (driver as any)?.orangeNumber ||
          financeData?.mobileMoneyAccount
        )
      );
    }
  }

  async function handlePickAndUploadImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permissão necessária', 'Conceda acesso à galeria para alterar sua foto de perfil.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
      base64: false,
    });

    if (!result.canceled && result.assets && result.assets[0]) {
      uploadProfileImage(result.assets[0].uri);
    }
  }

  async function uploadProfileImage(uri: string) {
    setUploadingImage(true);
    try {
      const formData = new FormData();
      const filename = uri.split('/').pop() || 'profile.jpg';
      const match = /\.(\w+)$/.exec(filename);
      const ext = match ? match[1].toLowerCase() : 'jpg';
      const type = ext === 'png' ? 'image/png' : 'image/jpeg';

      formData.append('profilePicture', {
        uri: Platform.OS === 'android' ? uri : uri.replace('file://', ''),
        name: filename,
        type,
      } as any);

      await api.patch('/drivers/profile/picture', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      await refreshDriverProfile();
      if (isMountedRef.current) {
        setImageTimestamp(Date.now());
      }
      Alert.alert('Sucesso ✅', 'Sua foto de perfil foi atualizada.');
    } catch (error: any) {
      const errorMessage =
        error.response?.data?.error ||
        error.response?.data?.message ||
        'Não foi possível atualizar sua foto no momento.';
      Alert.alert('Erro', errorMessage);
    } finally {
      if (isMountedRef.current) setUploadingImage(false);
    }
  }

  async function handleSavePaymentInfo() {
    const cleanNumber = strip245(mmNumber);
    const providerLabel = mmProvider === 'MTN' ? 'Telecel (antigo MTN)' : 'Orange Money';

    if (!cleanNumber) {
      return Alert.alert('Aviso', `Digite o número da sua conta ${providerLabel}.`);
    }
    if (cleanNumber.length !== 9) {
      return Alert.alert('Número Inválido', 'O número local deve conter exatamente 9 dígitos.');
    }

    const prefix = cleanNumber.substring(0, 2);
    if (mmProvider === 'ORANGE' && prefix !== '95') {
      return Alert.alert('Operadora Incompatível', 'Os números da Orange Money começam com 95.');
    }
    if (mmProvider === 'MTN' && !['96', '97'].includes(prefix)) {
      return Alert.alert('Operadora Incompatível', 'Os números da Telecel (antigo MTN) começam com 96 ou 97.');
    }

    setLoading(true);
    try {
      await api.put('/drivers/payment-info', {
        mobileMoneyNumber: cleanNumber,
        mobileMoneyProvider: mmProvider,
        paymentAccountNumber: cleanNumber,
        paymentProvider: mmProvider === 'MTN' ? 'MTN_MOMO' : 'ORANGE_MONEY',
      });

      Alert.alert('Conta Atualizada ✅', `Sua conta ${providerLabel} (+245 ${cleanNumber}) foi vinculada!`);
      setIsEditingPayment(false);
      await syncAll(false);
    } catch (error: any) {
      Alert.alert(
        'Falha no Cadastro',
        error.response?.data?.error ||
          error.response?.data?.message ||
          'Verifique sua conexão e tente novamente.'
      );
    } finally {
      if (isMountedRef.current) setLoading(false);
    }
  }

  function openUpdateModal() {
    setUpdateData({
      newFullName: driver?.fullName || '',
      newVehiclePlate: driver?.vehiclePlate || '',
      newVehicleBrand: (driver as any)?.vehicleBrand || '',
      newVehicleColor: (driver as any)?.vehicleColor || '',
      newDocumentNumber: (driver as any)?.documentNumber || '',
    });
    setIsUpdateModalVisible(true);
  }

  function hasFormChanged(): boolean {
    return (
      updateData.newFullName.trim() !== (driver?.fullName || '') ||
      updateData.newVehiclePlate.trim() !== (driver?.vehiclePlate || '') ||
      updateData.newVehicleBrand.trim() !== ((driver as any)?.vehicleBrand || '') ||
      updateData.newVehicleColor.trim() !== ((driver as any)?.vehicleColor || '') ||
      updateData.newDocumentNumber.trim() !== ((driver as any)?.documentNumber || '')
    );
  }

  async function handleRequestUpdate() {
    const payload = {
      newFullName: updateData.newFullName.trim(),
      newVehiclePlate: updateData.newVehiclePlate.trim().toUpperCase(),
      newVehicleBrand: updateData.newVehicleBrand.trim(),
      newVehicleColor: updateData.newVehicleColor.trim(),
      newDocumentNumber: updateData.newDocumentNumber.trim(),
    };

    if (!payload.newFullName || !payload.newVehiclePlate) {
      return Alert.alert('Campos Obrigatórios', 'Nome e Placa do veículo não podem ficar em branco.');
    }

    if (!hasFormChanged()) {
      return Alert.alert('Sem alterações', 'Altere pelo menos um campo antes de enviar o pedido.');
    }

    setIsSubmittingUpdate(true);
    try {
      await api.post('/drivers/request-update', payload);
      Alert.alert('Solicitação Enviada ✅', 'Nossa central analisará a atualização dos seus dados.');
      setIsUpdateModalVisible(false);
      setHasPendingRequest(true);
    } catch (error: any) {
      Alert.alert(
        'Erro',
        error.response?.data?.error ||
          error.response?.data?.message ||
          'Não foi possível enviar a solicitação.'
      );
    } finally {
      if (isMountedRef.current) setIsSubmittingUpdate(false);
    }
  }

  async function handleDeleteAccount() {
    Alert.alert(
      'Excluir Conta Permanentemente',
      'Tem certeza que deseja excluir sua conta? Você perderá o acesso ao app e seu histórico. Esta ação é irreversível.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Sim, Excluir Conta',
          style: 'destructive',
          onPress: async () => {
            try {
              setLoading(true);
              await api.delete('/drivers/delete-account');
              Alert.alert('Conta Excluída', 'Sua conta foi encerrada com sucesso.');
              signOut();
            } catch (error: any) {
              Alert.alert(
                'Erro ao excluir',
                error.response?.data?.error ||
                  error.response?.data?.message ||
                  'Não foi possível excluir a conta no momento.'
              );
            } finally {
              if (isMountedRef.current) setLoading(false);
            }
          },
        },
      ]
    );
  }

  const getStatusDisplay = () => {
    switch (driver?.status) {
      case 'APPROVED':
        return { text: t('status_approved', 'Conta Verificada • Ativa para Rodar'), color: '#10B981', bg: 'rgba(16,185,129,0.16)', icon: 'checkmark-circle' };
      case 'PENDING_APPROVAL':
        return { text: t('status_pending_approval', 'Documentos em Análise pela Central'), color: '#F59E0B', bg: 'rgba(245,158,11,0.18)', icon: 'time' };
      case 'REJECTED':
        return { text: t('status_rejected', 'Cadastro Rejeitado • Contate o Suporte'), color: '#EF4444', bg: 'rgba(239,68,68,0.18)', icon: 'close-circle' };
      case 'SUSPENDED':
        return { text: t('status_suspended', 'Conta Temporariamente Suspensa'), color: '#EF4444', bg: 'rgba(239,68,68,0.18)', icon: 'warning' };
      default:
        return { text: 'Em Verificação', color: '#CBD5E1', bg: 'rgba(255,255,255,0.12)', icon: 'help-circle' };
    }
  };

  const statusDisplay = getStatusDisplay();

  const formatImageUrl = (path?: string) => {
    if (!path) return undefined;
    const fullUrl = path.startsWith('http') ? path : `${API_URL}${path.startsWith('/') ? '' : '/'}${path}`;
    return `${fullUrl}?t=${imageTimestamp}`;
  };

  const profileImageUrl = formatImageUrl(driver?.profilePicture || undefined);
  const normalizedLang = i18n.language === 'gnb' ? 'cri' : i18n.language;
  const currentLang = LANGUAGES.find((l) => l.code === normalizedLang) || LANGUAGES[0];

  const walletBalance = Number(financeData?.walletBalance ?? driver?.walletBalance ?? 0);
  const ratingAverage = Number((driver as any)?.ratingAverage || 5.0).toFixed(1);
  const orangeDisplay = formatLocalPhone(financeData?.orangeNumber || (driver as any)?.orangeNumber);
  const mtnDisplay = formatLocalPhone(financeData?.mtnNumber || (driver as any)?.mtnNumber);
  const fallbackAccountDisplay = formatLocalPhone(
    financeData?.mobileMoneyAccount || (driver as any)?.paymentAccountNumber
  );

  const dynamicTopPadding = Math.max(
    (insets?.top || 0) + 6,
    Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 6 : 14
  );
  const dynamicBottomPadding = Math.max(
    (insets?.bottom || 0) + 16,
    Platform.OS === 'android' ? 28 : 16
  );

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={theme.colors.primaryDark} translucent />

      {/* HERO HEADER PREMIUM */}
      <View style={[styles.heroHeader, { paddingTop: dynamicTopPadding }]}>
        <View style={styles.headerTopBar}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.headerIconBtn}
            activeOpacity={0.8}
          >
            <Ionicons name="arrow-back" size={21} color="#FFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('profileTitle') || 'Perfil do Motorista'}</Text>
          <TouchableOpacity
            onPress={() => syncAll(true)}
            style={styles.headerIconBtn}
            activeOpacity={0.8}
          >
            <Ionicons name="reload" size={18} color="#FFCC00" />
          </TouchableOpacity>
        </View>

        {/* AVATAR + IDENTIDADE */}
        <View style={styles.avatarSection}>
          <TouchableOpacity
            onPress={handlePickAndUploadImage}
            disabled={uploadingImage}
            style={styles.avatarRing}
            activeOpacity={0.85}
          >
            {uploadingImage ? (
              <View style={styles.avatarPlaceholder}>
                <ActivityIndicator color="#FFCC00" size="large" />
              </View>
            ) : profileImageUrl ? (
              <Image source={{ uri: profileImageUrl }} style={styles.avatarImage} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Ionicons name="person" size={44} color="#94A3B8" />
              </View>
            )}
            <View style={styles.cameraBadge}>
              <Ionicons name="camera" size={14} color="#0F172A" />
            </View>
          </TouchableOpacity>

          <Text style={styles.driverName}>{driver?.fullName || 'Motorista Nô Bai'}</Text>
          <Text style={styles.driverPhone}>{formatLocalPhone(driver?.phone) || driver?.phone}</Text>

          {/* PILLS DE AVALIAÇÃO E STATUS */}
          <View style={styles.pillsRow}>
            <View style={styles.ratingPill}>
              <Ionicons name="star" size={13} color="#FFCC00" />
              <Text style={styles.ratingPillText}>{ratingAverage}</Text>
            </View>

            <View style={[styles.statusPill, { backgroundColor: statusDisplay.bg }]}>
              <Ionicons name={statusDisplay.icon as any} size={14} color={statusDisplay.color} />
              <Text style={[styles.statusPillText, { color: statusDisplay.color }]}>
                {statusDisplay.text}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {/* FOLHA DE CONTEÚDO */}
      <View style={styles.contentSheet}>
        {networkError && (
          <View style={styles.offlineBanner}>
            <Ionicons name="cloud-offline" size={18} color="#FFF" />
            <Text style={styles.offlineText}>Sem conexão. Exibindo dados em cache.</Text>
          </View>
        )}

        {initialLoading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={theme.colors.primaryDark} />
            <Text style={styles.loadingText}>Sincronizando perfil...</Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={[styles.scrollContent, { paddingBottom: dynamicBottomPadding + 24 }]}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => syncAll(true)}
                colors={[theme.colors.primaryDark]}
              />
            }
          >
            {hasPendingRequest && (
              <View style={styles.pendingInfoBanner}>
                <Ionicons name="time-outline" size={20} color="#1D4ED8" />
                <Text style={styles.pendingInfoText}>
                  Você possui uma solicitação de alteração cadastral em análise pela central.
                </Text>
              </View>
            )}

            {/* ALERTA SINCRONIZADO DE SALDO MÍNIMO (1.000 XOF) */}
            {walletBalance < 1000 && (
              <TouchableOpacity
                style={styles.lowBalanceCard}
                onPress={() => navigation.navigate('Wallet')}
                activeOpacity={0.85}
              >
                <Ionicons name="warning" size={22} color="#DC2626" />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={styles.lowBalanceTitle}>Saldo Abaixo do Mínimo (1.000 XOF)</Text>
                  <Text style={styles.lowBalanceSub}>
                    Saldo atual: {formatMoney(walletBalance)} XOF. Toque para recarregar e ficar online.
                  </Text>
                </View>
                <View style={styles.lowBalanceAction}>
                  <Text style={styles.lowBalanceActionText}>Recarregar</Text>
                </View>
              </TouchableOpacity>
            )}

            {/* GRID DE ACESSO RÁPIDO SINCRONIZADO */}
            <View style={styles.gridContainer}>
              <TouchableOpacity
                style={styles.gridCard}
                onPress={() => navigation.navigate('Wallet')}
                activeOpacity={0.85}
              >
                <View style={[styles.gridIconBox, { backgroundColor: '#ECFDF5' }]}>
                  <Ionicons name="wallet" size={19} color="#059669" />
                </View>
                <Text style={styles.gridTitle}>{t('wallet_balance', 'Saldo Carteira')}</Text>
                <Text
                  style={[
                    styles.gridValue,
                    { color: walletBalance < 1000 ? '#DC2626' : '#059669' },
                  ]}
                >
                  {formatMoney(walletBalance)} XOF
                </Text>
                <Text style={styles.gridActionHint}>Gerenciar & Recarregar →</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.gridCard}
                onPress={() => navigation.navigate('Earnings')}
                activeOpacity={0.85}
              >
                <View style={[styles.gridIconBox, { backgroundColor: '#FEF3C7' }]}>
                  <Ionicons name="trending-up" size={19} color="#D97706" />
                </View>
                <Text style={styles.gridTitle}>{t('total_accumulated', 'Total Acumulado')}</Text>
                <Text style={[styles.gridValue, { color: '#0F172A' }]}>
                  {formatMoney(financeData?.totalEarned || 0)} XOF
                </Text>
                <Text style={styles.gridActionHint}>{financeData?.totalRides || 0} viagens →</Text>
              </TouchableOpacity>
            </View>

            {/* CARTÃO DO VEÍCULO */}
            <Text style={styles.sectionTitle}>{t('registered_vehicle', 'Veículo Cadastrado')}</Text>
            <TouchableOpacity
              style={styles.vehicleCard}
              onPress={() => navigation.navigate('VehicleSettings')}
              activeOpacity={0.85}
            >
              <View style={styles.vehicleIconCircle}>
                <Ionicons name="car-sport" size={24} color="#0F172A" />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.vehicleTitle}>
                  {(driver as any)?.vehicleBrand || 'Veículo Nô Bai'}{' '}
                  {(driver as any)?.vehicleColor ? `• ${(driver as any).vehicleColor}` : ''}
                </Text>
                <View style={styles.plateRow}>
                  <View style={styles.plateBadge}>
                    <Text style={styles.plateText}>{driver?.vehiclePlate || 'SEM PLACA'}</Text>
                  </View>
                  {(driver as any)?.vehicleType && (
                    <Text style={styles.vehicleTypeTag}>{String((driver as any).vehicleType)}</Text>
                  )}
                </View>
              </View>
              <Ionicons name="chevron-forward" size={20} color="#94A3B8" />
            </TouchableOpacity>

            {/* CONTAS MOBILE MONEY DE RECEBIMENTO */}
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>{t('mobile_money_accounts', 'Contas Mobile Money')}</Text>
              {!isEditingPayment && (
                <TouchableOpacity onPress={handleOpenEdit} disabled={networkError}>
                  <Text style={styles.editLinkText}>{t('edit_account', 'Editar Conta')}</Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.paymentSummaryCard}>
              <View style={styles.mmRow}>
                <View style={[styles.mmDot, { backgroundColor: '#FF7900' }]} />
                <Text style={styles.mmLabel}>Orange Money:</Text>
                <Text style={styles.mmValue}>
                  {orangeDisplay || (!mtnDisplay && fallbackAccountDisplay) || 'Não configurado'}
                </Text>
              </View>

              <View style={[styles.mmRow, { marginTop: 8 }]}>
                <View style={[styles.mmDot, { backgroundColor: '#EAB308' }]} />
                <Text style={styles.mmLabel}>Telecel / MTN:</Text>
                <Text style={styles.mmValue}>{mtnDisplay || 'Não configurado'}</Text>
              </View>

              {isEditingPayment && (
                <View style={styles.editInlineBox}>
                  <Text style={styles.inputLabel}>Escolha a Operadora</Text>
                  <View style={styles.providerSelect}>
                    <TouchableOpacity
                      style={[
                        styles.providerBtn,
                        mmProvider === 'ORANGE' && styles.providerActiveOrange,
                      ]}
                      onPress={() => handleProviderChange('ORANGE')}
                    >
                      <Text
                        style={[
                          styles.providerText,
                          mmProvider === 'ORANGE' && { color: '#FFF' },
                        ]}
                      >
                        Orange Money
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.providerBtn,
                        mmProvider === 'MTN' && { backgroundColor: '#EAB308', borderColor: '#CA8A04' },
                      ]}
                      onPress={() => handleProviderChange('MTN')}
                    >
                      <Text
                        style={[
                          styles.providerText,
                          mmProvider === 'MTN' && { color: '#0F172A', fontWeight: '800' },
                        ]}
                      >
                        Telecel (MTN)
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.inputLabel}>
                    Número {mmProvider === 'MTN' ? 'Telecel / MTN (96 ou 97...)' : 'Orange Money (95...)'}
                  </Text>
                  <View style={styles.phoneInputContainer}>
                    <View style={styles.countryBadge}>
                      <Text style={styles.countryBadgeText}>🇬🇼 +245</Text>
                    </View>
                    <TextInput
                      style={styles.phoneInput}
                      placeholder={mmProvider === 'MTN' ? '966001122' : '955001122'}
                      placeholderTextColor="#94A3B8"
                      keyboardType="number-pad"
                      value={mmNumber}
                      onChangeText={handlePhoneChange}
                      maxLength={9}
                    />
                  </View>

                  <View style={styles.formActions}>
                    <TouchableOpacity
                      style={styles.cancelBtn}
                      onPress={() => setIsEditingPayment(false)}
                    >
                      <Text style={styles.cancelBtnText}>Cancelar</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.saveBtn, !mmNumber && { opacity: 0.6 }]}
                      onPress={handleSavePaymentInfo}
                      disabled={loading || !mmNumber}
                    >
                      {loading ? (
                        <ActivityIndicator color="#FFF" />
                      ) : (
                        <Text style={styles.saveBtnText}>Salvar Conta</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>

            <TouchableOpacity
              style={[styles.updateBtn, hasPendingRequest && styles.updateBtnDisabled]}
              onPress={openUpdateModal}
              disabled={hasPendingRequest || networkError}
              activeOpacity={0.85}
            >
              <Ionicons
                name={hasPendingRequest ? 'time-outline' : 'create-outline'}
                size={18}
                color={hasPendingRequest ? '#64748B' : '#0F172A'}
                style={{ marginRight: 8 }}
              />
              <Text style={[styles.updateBtnText, hasPendingRequest && styles.updateBtnTextDisabled]}>
                {hasPendingRequest
                  ? 'Alteração de Dados em Análise'
                  : 'Solicitar Alteração de Dados / Veículo'}
              </Text>
            </TouchableOpacity>

            {/* NAVEGAÇÃO & CONFIGURAÇÕES */}
            <Text style={styles.sectionTitle}>{t('activity_and_settings', 'Atividade & Configurações')}</Text>

            <View style={styles.seriesContainer}>
              <TouchableOpacity
                style={styles.seriesBtn}
                onPress={() => navigation.navigate('RideHistory')}
              >
                <View style={[styles.seriesIconBox, { backgroundColor: '#EEF2FF' }]}>
                  <Ionicons name="time" size={19} color="#4338CA" />
                </View>
                <Text style={styles.seriesBtnText}>{t('ride_history', 'Histórico de Corridas')}</Text>
                <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
              </TouchableOpacity>

              <View style={styles.seriesDivider} />

              <TouchableOpacity
                style={styles.seriesBtn}
                onPress={() => navigation.navigate('VehicleSettings')}
              >
                <View style={[styles.seriesIconBox, { backgroundColor: '#ECFDF5' }]}>
                  <Ionicons name="document-attach" size={19} color="#059669" />
                </View>
                <Text style={styles.seriesBtnText}>{t('vehicle_settings', 'Documentos & Configurações do Veículo')}</Text>
                <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
              </TouchableOpacity>

              <View style={styles.seriesDivider} />

              <TouchableOpacity
                style={styles.seriesBtn}
                onPress={() => navigation.navigate('SupportHelp')}
              >
                <View style={[styles.seriesIconBox, { backgroundColor: '#FEF3C7' }]}>
                  <Ionicons name="headset" size={19} color="#D97706" />
                </View>
                <Text style={styles.seriesBtnText}>{t('support_and_help_title', 'Central de Ajuda e Suporte')}</Text>
                <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
              </TouchableOpacity>

              <View style={styles.seriesDivider} />

              <TouchableOpacity
                style={styles.seriesBtn}
                onPress={() => setIsLanguageModalVisible(true)}
              >
                <View style={[styles.seriesIconBox, { backgroundColor: '#E0F2FE' }]}>
                  <Ionicons name="globe" size={19} color="#0284C7" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.seriesBtnText}>Idioma / Language</Text>
                  <Text style={styles.languageSelectedText}>
                    {currentLang.flag} {currentLang.name}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
              </TouchableOpacity>

              <View style={styles.seriesDivider} />

              <TouchableOpacity
                style={styles.seriesBtn}
                onPress={() => setIsPrivacyModalVisible(true)}
              >
                <View style={[styles.seriesIconBox, { backgroundColor: '#F1F5F9' }]}>
                  <Ionicons name="shield-checkmark" size={19} color="#475569" />
                </View>
                <Text style={styles.seriesBtnText}>{t('privacy_policy', 'Política de Privacidade')}</Text>
                <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            {/* ENCERRAMENTO */}
            <TouchableOpacity style={styles.logoutButton} onPress={signOut} activeOpacity={0.85}>
              <Ionicons name="log-out-outline" size={20} color="#DC2626" style={{ marginRight: 8 }} />
              <Text style={styles.logoutButtonText}>{t('logout') || 'Sair do Aplicativo'}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.deleteAccountBtn}
              onPress={handleDeleteAccount}
              activeOpacity={0.7}
            >
              <Ionicons name="trash-outline" size={15} color="#94A3B8" style={{ marginRight: 6 }} />
              <Text style={styles.deleteAccountText}>
                {t('deleteAccount') || 'Excluir Minha Conta Permanentemente'}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        )}
      </View>

      {/* MODAL DE SOLICITAÇÃO DE ALTERAÇÃO CADASTRAL */}
      <Modal
        visible={isUpdateModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setIsUpdateModalVisible(false)}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.modalOverlay}>
            <View style={styles.backdrop} />
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={styles.modalContainer}
            >
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalTitle}>Solicitar Alteração</Text>
                <TouchableOpacity onPress={() => setIsUpdateModalVisible(false)}>
                  <Ionicons name="close" size={24} color="#64748B" />
                </TouchableOpacity>
              </View>
              <Text style={styles.modalSubtitle}>
                Por segurança, alterações de nome, placa ou documento passam por validação rápida da central.
              </Text>

              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={styles.inputLabel}>Nome Completo</Text>
                <TextInput
                  style={styles.modalInput}
                  value={updateData.newFullName}
                  onChangeText={(v) => setUpdateData((p) => ({ ...p, newFullName: v }))}
                  placeholder="Nome completo"
                  placeholderTextColor="#94A3B8"
                />

                <Text style={styles.inputLabel}>Placa / Matrícula do Veículo</Text>
                <TextInput
                  style={styles.modalInput}
                  value={updateData.newVehiclePlate}
                  onChangeText={(v) => setUpdateData((p) => ({ ...p, newVehiclePlate: v }))}
                  autoCapitalize="characters"
                  placeholder="Ex: GB-1234-AA"
                  placeholderTextColor="#94A3B8"
                />

                <Text style={styles.inputLabel}>Marca / Modelo do Veículo</Text>
                <TextInput
                  style={styles.modalInput}
                  value={updateData.newVehicleBrand}
                  onChangeText={(v) => setUpdateData((p) => ({ ...p, newVehicleBrand: v }))}
                  placeholder="Ex: Toyota Corolla / Bajaj"
                  placeholderTextColor="#94A3B8"
                />

                <Text style={styles.inputLabel}>Cor do Veículo</Text>
                <TextInput
                  style={styles.modalInput}
                  value={updateData.newVehicleColor}
                  onChangeText={(v) => setUpdateData((p) => ({ ...p, newVehicleColor: v }))}
                  placeholder="Ex: Branco / Azul"
                  placeholderTextColor="#94A3B8"
                />

                <Text style={styles.inputLabel}>Número do Documento (BI / Carta)</Text>
                <TextInput
                  style={styles.modalInput}
                  value={updateData.newDocumentNumber}
                  onChangeText={(v) => setUpdateData((p) => ({ ...p, newDocumentNumber: v }))}
                  placeholder="Número do documento"
                  placeholderTextColor="#94A3B8"
                />

                <TouchableOpacity
                  style={[styles.saveBtn, { marginTop: 10 }, isSubmittingUpdate && { opacity: 0.7 }]}
                  onPress={handleRequestUpdate}
                  disabled={isSubmittingUpdate}
                >
                  {isSubmittingUpdate ? (
                    <ActivityIndicator color="#FFF" />
                  ) : (
                    <Text style={styles.saveBtnText}>Enviar Solicitação</Text>
                  )}
                </TouchableOpacity>
              </ScrollView>
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* MODAL DE IDIOMAS */}
      <Modal
        visible={isLanguageModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setIsLanguageModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.backdrop} />
          <View style={styles.languageModalContainer}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>{t('select_language', 'Idioma do Aplicativo')}</Text>
              <TouchableOpacity onPress={() => setIsLanguageModalVisible(false)}>
                <Ionicons name="close" size={24} color="#64748B" />
              </TouchableOpacity>
            </View>
            {LANGUAGES.map((lang) => (
              <TouchableOpacity
                key={lang.code}
                style={[
                  styles.languageOption,
                  i18n.language === lang.code && styles.languageOptionActive,
                ]}
                onPress={() => {
                  changeLanguage(lang.code);
                  setIsLanguageModalVisible(false);
                }}
              >
                <Text style={styles.languageFlag}>{lang.flag}</Text>
                <Text
                  style={[
                    styles.languageName,
                    i18n.language === lang.code && styles.languageNameActive,
                  ]}
                >
                  {lang.name}
                </Text>
                {i18n.language === lang.code && (
                  <Ionicons name="checkmark-circle" size={20} color="#059669" />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </Modal>

      <PrivacyPolicyModal
        visible={isPrivacyModalVisible}
        onClose={() => setIsPrivacyModalVisible(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.primaryDark },
  heroHeader: { paddingHorizontal: 20, paddingBottom: 22 },
  headerTopBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: { color: '#FFF', fontSize: 17, fontWeight: '800' },
  avatarSection: { alignItems: 'center', marginTop: 14 },
  avatarRing: {
    position: 'relative',
    padding: 3,
    borderRadius: 52,
    borderWidth: 2,
    borderColor: '#FFCC00',
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  avatarImage: { width: 88, height: 88, borderRadius: 44 },
  avatarPlaceholder: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#1E293B',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cameraBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: '#FFCC00',
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: theme.colors.primaryDark,
  },
  driverName: { color: '#FFF', fontSize: 19, fontWeight: '900', marginTop: 10 },
  driverPhone: { color: '#94A3B8', fontSize: 13, fontWeight: '600', marginTop: 2 },
  pillsRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap', justifyContent: 'center' },
  ratingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(255,204,0,0.16)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
  },
  ratingPillText: { color: '#FFCC00', fontSize: 12, fontWeight: '800' },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 16,
  },
  statusPillText: { fontSize: 12, fontWeight: '800' },
  contentSheet: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    overflow: 'hidden',
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#DC2626',
    paddingVertical: 8,
  },
  offlineText: { color: '#FFF', fontSize: 12, fontWeight: '700' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#64748B', fontSize: 13, marginTop: 10, fontWeight: '600' },
  scrollContent: { padding: 20 },
  pendingInfoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#DBEAFE',
    borderRadius: 14,
    padding: 12,
    marginBottom: 14,
  },
  pendingInfoText: { flex: 1, color: '#1E40AF', fontSize: 12, fontWeight: '700' },
  lowBalanceCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    borderRadius: 16,
    padding: 14,
    marginBottom: 16,
  },
  lowBalanceTitle: { color: '#DC2626', fontSize: 13, fontWeight: '800' },
  lowBalanceSub: { color: '#7F1D1D', fontSize: 11, marginTop: 2 },
  lowBalanceAction: {
    backgroundColor: '#DC2626',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    marginLeft: 8,
  },
  lowBalanceActionText: { color: '#FFF', fontSize: 11, fontWeight: '800' },
  gridContainer: { flexDirection: 'row', gap: 12, marginBottom: 18 },
  gridCard: {
    flex: 1,
    backgroundColor: '#FFF',
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  gridIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  gridTitle: { fontSize: 12, color: '#64748B', fontWeight: '600' },
  gridValue: { fontSize: 15, fontWeight: '900', marginTop: 2 },
  gridActionHint: { fontSize: 11, color: '#0284C7', fontWeight: '700', marginTop: 6 },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionTitle: { fontSize: 14, fontWeight: '800', color: '#334155', marginBottom: 10 },
  editLinkText: { color: '#059669', fontSize: 13, fontWeight: '800', marginBottom: 10 },
  vehicleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 18,
  },
  vehicleIconCircle: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: '#FEF3C7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  vehicleTitle: { color: '#0F172A', fontSize: 14, fontWeight: '800' },
  plateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 },
  plateBadge: {
    backgroundColor: '#0F172A',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 6,
  },
  plateText: { color: '#FFCC00', fontSize: 11, fontWeight: '900', letterSpacing: 0.6 },
  vehicleTypeTag: { color: '#64748B', fontSize: 11, fontWeight: '700' },
  paymentSummaryCard: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 14,
  },
  mmRow: { flexDirection: 'row', alignItems: 'center' },
  mmDot: { width: 9, height: 9, borderRadius: 5, marginRight: 8 },
  mmLabel: { color: '#64748B', fontSize: 13, fontWeight: '600', width: 112 },
  mmValue: { color: '#0F172A', fontSize: 13, fontWeight: '800', flex: 1 },
  editInlineBox: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  inputLabel: { fontSize: 12, fontWeight: '700', color: '#475569', marginBottom: 6, marginTop: 6 },
  providerSelect: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  providerBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
  },
  providerActiveOrange: { backgroundColor: '#FF7900' },
  providerText: { fontSize: 12, fontWeight: '700', color: '#334155' },
  phoneInputContainer: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  countryBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 12,
    borderRadius: 10,
    justifyContent: 'center',
  },
  countryBadgeText: { fontSize: 13, fontWeight: '700', color: '#0F172A' },
  phoneInput: {
    flex: 1,
    height: 44,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  formActions: { flexDirection: 'row', gap: 10 },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
  },
  cancelBtnText: { fontSize: 13, fontWeight: '700', color: '#475569' },
  saveBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#059669',
    alignItems: 'center',
  },
  saveBtnText: { fontSize: 13, fontWeight: '800', color: '#FFF' },
  updateBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFF',
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    marginBottom: 20,
  },
  updateBtnDisabled: { opacity: 0.6 },
  updateBtnText: { fontSize: 13, fontWeight: '800', color: '#0F172A' },
  updateBtnTextDisabled: { color: '#64748B' },
  seriesContainer: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 20,
  },
  seriesBtn: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  seriesIconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  seriesBtnText: { fontSize: 14, fontWeight: '700', color: '#0F172A', flex: 1 },
  seriesDivider: { height: 1, backgroundColor: '#F1F5F9', marginHorizontal: 14 },
  languageSelectedText: { fontSize: 12, color: '#059669', fontWeight: '700', marginTop: 2 },
  logoutButton: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FEE2E2',
    paddingVertical: 14,
    borderRadius: 14,
    marginBottom: 10,
  },
  logoutButtonText: { color: '#DC2626', fontWeight: '800', fontSize: 14 },
  deleteAccountBtn: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 10,
  },
  deleteAccountText: { color: '#94A3B8', fontWeight: '700', fontSize: 12 },
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15, 23, 42, 0.6)' },
  modalContainer: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    maxHeight: '88%',
  },
  modalHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  modalTitle: { fontSize: 18, fontWeight: '900', color: '#0F172A' },
  modalSubtitle: { fontSize: 12, color: '#64748B', marginBottom: 12, lineHeight: 17 },
  modalInput: {
    height: 44,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
    marginBottom: 8,
  },
  languageModalContainer: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
  },
  languageOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    marginBottom: 6,
    backgroundColor: '#F8FAFC',
  },
  languageOptionActive: {
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  languageFlag: { fontSize: 20, marginRight: 12 },
  languageName: { fontSize: 14, fontWeight: '700', color: '#334155', flex: 1 },
  languageNameActive: { color: '#059669', fontWeight: '800' },
});
