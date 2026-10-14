import React, { useState, useEffect } from 'react';
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
  TouchableWithoutFeedback
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useTranslation } from 'react-i18next';

// Contextos e Serviços
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';

// Componentes
import { PrivacyPolicyModal } from '../components/PrivacyPolicyModal';

// Tipagem de Rotas
import { RootStackParamList } from '../routes/app.routes';

// Configuração segura do URL da API
const API_URL = process.env.EXPO_PUBLIC_API_URL || (__DEV__ ? 'http://192.168.18.29:3333' : '');

// Estrutura do objeto de idioma
export interface LanguageOption {
  code: string;
  name: string;
  flag: string;
}

// LISTA DE IDIOMAS SUPORTADOS (Imutável)
const LANGUAGES: readonly LanguageOption[] = [
  { code: 'pt', name: 'Português', flag: '🇵🇹' },
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'gnb', name: 'Crioulo (Kriol)', flag: '🇬🇼' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'ru', name: 'Русский', flag: '🇷🇺' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
] as const;

type ProfileScreenNavigationProp = NativeStackNavigationProp<RootStackParamList>;

// --- INTERFACES DE DADOS ---
export interface FinanceData {
  walletBalance: number;
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

// --- DECLARAÇÃO DO COMPONENTE ---
export function Profile() {
  const { t, i18n } = useTranslation();
  const { driver, signOut, refreshDriverProfile } = useAuth();
  const insets = useSafeAreaInsets();
  
  const navigation = useNavigation<ProfileScreenNavigationProp>();

  // --- ESTADOS DE DADOS ---
  const [financeData, setFinanceData] = useState<FinanceData | null>(null);
  const [hasPendingRequest, setHasPendingRequest] = useState<boolean>(false);
  
  // --- ESTADOS DE CARREGAMENTO E REDE ---
  const [initialLoading, setInitialLoading] = useState<boolean>(true);
  const [networkError, setNetworkError] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [uploadingImage, setUploadingImage] = useState<boolean>(false);
  const [isSubmittingUpdate, setIsSubmittingUpdate] = useState<boolean>(false);

  // --- ESTADOS DE UI (Modais e Edição) ---
  const [isEditingPayment, setIsEditingPayment] = useState<boolean>(false);
  const [mmNumber, setMmNumber] = useState<string>('');
  const [mmProvider, setMmProvider] = useState<'ORANGE' | 'MTN'>('ORANGE');

  const [isUpdateModalVisible, setIsUpdateModalVisible] = useState<boolean>(false);
  const [isPrivacyModalVisible, setIsPrivacyModalVisible] = useState<boolean>(false);
  const [isLanguageModalVisible, setIsLanguageModalVisible] = useState<boolean>(false);

  // --- ESTADO DO FORMULÁRIO ---
  const [updateData, setUpdateData] = useState<UpdateFormState>({
    newFullName: driver?.fullName || '',
    newVehiclePlate: driver?.vehiclePlate || '',
    newVehicleBrand: driver?.vehicleBrand || '',
    newVehicleColor: driver?.vehicleColor || '',
    newDocumentNumber: driver?.documentNumber || '',
  });

  // --- EFEITOS E CARREGAMENTO INICIAL ---
  useEffect(() => {
    loadInitialData();
  }, []);

  async function loadInitialData() {
    setInitialLoading(true);
    setNetworkError(false);
    await Promise.allSettled([loadFinanceData(), checkPendingRequest()]);
    setInitialLoading(false);
  }

  async function loadFinanceData() {
    try {
      const res = await api.get<FinanceData>('/drivers/finance');
      setFinanceData(res.data);
    } catch (error) {
      console.error('Erro ao buscar finanças:', error);
      setNetworkError(true);
    }
  }

  async function checkPendingRequest() {
    try {
      const res = await api.get<{ hasPendingRequest: boolean }>('/drivers/request-update/status');
      setHasPendingRequest(res.data.hasPendingRequest);
    } catch (error) {
      console.error('Erro ao checar solicitação de alteração:', error);
    }
  }

  // --- UTILITÁRIOS DE FORMATAÇÃO ---
  function formatMoney(value?: number | string): string {
    if (value === null || value === undefined) return '0';
    const num = Number(value);
    if (isNaN(num)) return '0';
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  function handlePhoneChange(text: string) {
    const numericOnly = text.replace(/\D/g, '');
    setMmNumber(numericOnly);
  }

  function handleOpenEdit() {
    setIsEditingPayment(true);
    if (financeData?.mtnNumber) {
      setMmProvider('MTN');
      setMmNumber(financeData.mtnNumber);
    } else {
      setMmProvider('ORANGE');
      setMmNumber(financeData?.orangeNumber || '');
    }
  }

  function handleProviderChange(provider: 'ORANGE' | 'MTN') {
    setMmProvider(provider);
    if (provider === 'ORANGE') {
      setMmNumber(financeData?.orangeNumber || '');
    } else {
      setMmNumber(financeData?.mtnNumber || '');
    }
  }

  // --- UPLOAD DA FOTO DE PERFIL ---
  async function handlePickAndUploadImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permissão necessária', 'Conceda acesso à galeria para alterar sua foto de perfil.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.1,
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
      const type = match ? `image/${match[1]}` : `image/jpeg`;

      formData.append('profilePicture', {
        uri: Platform.OS === 'android' ? uri : uri.replace('file://', ''),
        name: filename,
        type,
      } as any);

      await api.patch('/drivers/profile/picture', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      await refreshDriverProfile();
      Alert.alert('Sucesso!', 'Sua foto de perfil foi atualizada com sucesso.');
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || error.response?.data?.message || 'Não foi possível atualizar sua foto no momento.';
      Alert.alert('Erro', errorMessage);
    } finally {
      setUploadingImage(false);
    }
  }

  // --- SALVAR INFORMAÇÕES DE PAGAMENTO ---
  async function handleSavePaymentInfo() {
    const cleanNumber = mmNumber.trim();

    if (!cleanNumber) {
      return Alert.alert('Aviso', 'Digite o número da sua conta Mobile Money.');
    }
    if (cleanNumber.length !== 9) {
      return Alert.alert('Número Inválido', 'O número local deve conter exatamente 9 dígitos numéricos.');
    }

    const prefix = cleanNumber.substring(0, 2);
    const orangePrefixes = ['95']; 
    const mtnPrefixes = ['96', '97']; 

    if (mmProvider === 'ORANGE' && !orangePrefixes.includes(prefix)) {
      return Alert.alert('Operadora Incompatível', 'Os números da Orange Money geralmente começam com 95.');
    }

    if (mmProvider === 'MTN' && !mtnPrefixes.includes(prefix)) {
      return Alert.alert('Operadora Incompatível', `Os números da MTN MoMo geralmente começam com ${mtnPrefixes.join(' ou ')}.`);
    }

    setLoading(true);
    try {
      await api.put('/drivers/payment-info', {
        mobileMoneyNumber: cleanNumber,
        mobileMoneyProvider: mmProvider
      });
      
      Alert.alert('Sucesso', 'Sua conta de recebimento automático foi atualizada!');
      setIsEditingPayment(false);
      await refreshDriverProfile();
      await loadFinanceData(); 
    } catch (error: any) {
      Alert.alert(
        'Falha no Cadastro', 
        error.response?.data?.message || 'Verifique sua conexão ou tente novamente mais tarde.'
      );
    } finally {
      setLoading(false);
    }
  }

  // --- SOLICITAÇÃO DE ALTERAÇÃO DE DADOS ---
  function openUpdateModal() {
    setUpdateData({
      newFullName: driver?.fullName || '',
      newVehiclePlate: driver?.vehiclePlate || '',
      newVehicleBrand: driver?.vehicleBrand || '',
      newVehicleColor: driver?.vehicleColor || '',
      newDocumentNumber: driver?.documentNumber || ''
    });
    setIsUpdateModalVisible(true);
  }

  function hasFormChanged(): boolean {
    return (
      updateData.newFullName.trim() !== (driver?.fullName || '') ||
      updateData.newVehiclePlate.trim() !== (driver?.vehiclePlate || '') ||
      updateData.newVehicleBrand.trim() !== (driver?.vehicleBrand || '') ||
      updateData.newVehicleColor.trim() !== (driver?.vehicleColor || '') ||
      updateData.newDocumentNumber.trim() !== (driver?.documentNumber || '')
    );
  }

  async function handleRequestUpdate() {
    const payload = {
      newFullName: updateData.newFullName.trim(),
      newVehiclePlate: updateData.newVehiclePlate.trim(),
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
      Alert.alert('Sucesso', 'Sua solicitação foi enviada para análise da central.');
      setIsUpdateModalVisible(false);
      setHasPendingRequest(true);
    } catch (error: any) {
      Alert.alert('Erro', error.response?.data?.error || error.response?.data?.message || 'Não foi possível enviar a solicitação.');
    } finally {
      setIsSubmittingUpdate(false);
    }
  }

  // --- EXCLUSÃO DE CONTA ---
  async function handleDeleteAccount() {
    Alert.alert(
      'Excluir Conta Permanentemente',
      'Tem certeza que deseja excluir sua conta? Você perderá o acesso ao app e seu saldo não resgatado poderá ser retido. Esta ação é irreversível.',
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
                error.response?.data?.error || error.response?.data?.message || 'Não foi possível excluir a conta no momento.'
              );
            } finally {
              setLoading(false);
            }
          } 
        }
      ]
    );
  }

  const getStatusDisplay = () => {
    switch (driver?.status) {
      case 'APPROVED': return { text: 'Conta Ativa para Rodar', color: '#059669', bg: '#D1FAE5', icon: 'checkmark-circle' };
      case 'PENDING_APPROVAL': return { text: 'Documentos em Análise', color: '#D97706', bg: '#FEF3C7', icon: 'time' };
      case 'REJECTED': return { text: 'Cadastro Rejeitado', color: '#DC2626', bg: '#FEE2E2', icon: 'close-circle' };
      case 'SUSPENDED': return { text: 'Conta Suspensa', color: '#DC2626', bg: '#FEE2E2', icon: 'warning' };
      default: return { text: 'Desconhecido', color: '#4B5563', bg: '#F3F4F6', icon: 'help-circle' };
    }
  };

  const statusDisplay = getStatusDisplay();
  const formatImageUrl = (path?: string) => path ? (path.startsWith('http') ? path : `${API_URL}${path.startsWith('/') ? '' : '/'}${path}`) : undefined;
  const profileImageUrl = formatImageUrl(driver?.profilePicture || undefined);
  const currentLang = LANGUAGES.find(l => l.code === i18n.language) || LANGUAGES[0];

  // Cálculos dinâmicos para recuo seguro em topo e rodapé (Android e iOS)
  const dynamicTopPadding = Math.max((insets?.top || 0) + 6, Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 6 : 14);
  const dynamicBottomPadding = Math.max((insets?.bottom || 0) + 16, Platform.OS === 'android' ? 28 : 16);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFF" translucent />
      
      {/* HEADER */}
      <View style={[styles.header, { paddingTop: dynamicTopPadding }]}>
        <TouchableOpacity 
          onPress={() => navigation.goBack()} 
          style={styles.backButton}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={24} color="#059669" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {t('profileTitle') || 'Meu Perfil'}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      {/* BANNER DE SEM CONEXÃO */}
      {networkError && (
        <View style={styles.offlineBanner}>
          <Ionicons name="cloud-offline" size={20} color="#FFF" />
          <Text style={styles.offlineText}>Sem conexão. Alguns dados podem estar desatualizados.</Text>
        </View>
      )}

      {initialLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#059669" />
          <Text style={styles.loadingText}>Carregando perfil...</Text>
        </View>
      ) : (
        <ScrollView 
          contentContainerStyle={[styles.content, { paddingBottom: dynamicBottomPadding + 20 }]} 
          showsVerticalScrollIndicator={false}
        >
          {/* FOTO E CABEÇALHO */}
          <View style={styles.profileHeader}>
            <TouchableOpacity 
              onPress={handlePickAndUploadImage} 
              disabled={uploadingImage} 
              style={styles.imageContainer}
              activeOpacity={0.8}
            >
              {uploadingImage ? (
                <View style={styles.imagePlaceholder}>
                  <ActivityIndicator color="#059669" size="large" />
                </View>
              ) : profileImageUrl ? (
                <Image source={{ uri: profileImageUrl }} style={styles.profileImage} />
              ) : (
                <View style={styles.imagePlaceholder}>
                  <Ionicons name="person" size={50} color="#9CA3AF" />
                </View>
              )}
              <View style={styles.cameraBadge}>
                <Ionicons name="camera" size={16} color="#FFF" />
              </View>
            </TouchableOpacity>
            <Text style={styles.profileName}>{driver?.fullName}</Text>
            <Text style={styles.profilePhone}>{driver?.phone}</Text>
          </View>

          {/* STATUS DA CONTA */}
          <View style={[styles.statusBanner, { backgroundColor: statusDisplay.bg }]}>
            <Ionicons name={statusDisplay.icon as any} size={22} color={statusDisplay.color} />
            <Text style={[styles.statusText, { color: statusDisplay.color }]}>
              {statusDisplay.text}
            </Text>
          </View>

          {hasPendingRequest && (
            <View style={[styles.statusBanner, { backgroundColor: '#DBEAFE', marginTop: -6 }]}>
              <Ionicons name="information-circle" size={22} color="#1D4ED8" />
              <Text style={[styles.statusText, { color: '#1D4ED8', flex: 1 }]}>
                Você tem uma solicitação de alteração em análise pela central.
              </Text>
            </View>
          )}

          {/* DASHBOARD QUADRINHOS */}
          <View style={styles.gridContainer}>
            <TouchableOpacity 
              style={styles.gridCard} 
              onPress={() => navigation.navigate('Wallet' as never)}
              activeOpacity={0.85}
            >
              <View style={[styles.gridIconBox, { backgroundColor: '#ECFDF5' }]}>
                <Ionicons name="card" size={18} color="#059669" />
              </View>
              <Text style={styles.gridTitle}>Carteira</Text>
              <Text style={[
                styles.gridValue, 
                { color: (financeData?.walletBalance || 0) < 0 ? '#DC2626' : '#059669' }
              ]}>
                {formatMoney(financeData?.walletBalance)} XOF
              </Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.gridCard} 
              onPress={handleOpenEdit}
              disabled={networkError}
              activeOpacity={0.85}
            >
              <View style={[styles.gridIconBox, { backgroundColor: '#FFF7ED' }]}>
                <Ionicons name="wallet" size={18} color="#FF6600" />
              </View>
              <Text style={styles.gridTitle}>Recebimento</Text>
              <Text style={styles.gridValue} numberOfLines={1} adjustsFontSizeToFit>
                {financeData?.mobileMoneyAccount ? `+245 ${financeData.mobileMoneyAccount}` : 'Configurar'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.gridCard} 
              onPress={() => navigation.navigate('VehicleSettings' as never)}
              activeOpacity={0.85}
            >
              <View style={[styles.gridIconBox, { backgroundColor: '#F3F4F6' }]}>
                <Ionicons name="car" size={18} color="#4B5563" />
              </View>
              <Text style={styles.gridTitle}>Veículo</Text>
              <Text style={styles.gridValuePlate}>{driver?.vehiclePlate || 'Pendente'}</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.gridCard} 
              onPress={() => navigation.navigate('RideHistory' as never)}
              activeOpacity={0.85}
            >
              <View style={[styles.gridIconBox, { backgroundColor: '#E0E7FF' }]}>
                <Ionicons name="list" size={18} color="#4338CA" />
              </View>
              <Text style={styles.gridTitle}>Corridas</Text>
              <Text style={styles.gridValueSecondary}>{financeData?.totalRides || 0} viagens</Text>
            </TouchableOpacity>
          </View>

          {(financeData?.walletBalance || 0) < 0 && (
            <View style={{ marginBottom: 16 }}>
              <Text style={styles.warningText}>⚠️ Saldo negativo. Recarregue para evitar bloqueios.</Text>
            </View>
          )}

          {/* FORMULÁRIO DE EDIÇÃO DE RECEBIMENTO */}
          {isEditingPayment && (
            <View style={styles.editFormContainer}>
              <Text style={styles.cardTitle}>Configurar Recebimento</Text>
              <Text style={styles.infoText}>Os ganhos entram nesta conta Mobile Money.</Text>
              
              <Text style={styles.inputLabel}>1. Escolha a Operadora:</Text>
              <View style={styles.providerSelect}>
                <TouchableOpacity style={[styles.providerBtn, mmProvider === 'ORANGE' && styles.providerActiveOrange]} onPress={() => handleProviderChange('ORANGE')}>
                  <Text style={[styles.providerText, mmProvider === 'ORANGE' && { color: '#FFF' }]}>Orange Money</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.providerBtn, mmProvider === 'MTN' && styles.providerActiveMtn]} onPress={() => handleProviderChange('MTN')}>
                  <Text style={[styles.providerText, mmProvider === 'MTN' && { color: '#FFF' }]}>MTN MoMo</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.inputLabel}>2. Número da Conta:</Text>
              <View style={styles.phoneInputContainer}>
                <View style={styles.countryBadge}>
                  <Text style={styles.countryBadgeText}>🇬🇼 +245</Text>
                </View>
                <TextInput 
                  style={styles.phoneInput} 
                  placeholder="955 001 122" 
                  placeholderTextColor="#9CA3AF"
                  keyboardType="number-pad" 
                  value={mmNumber} 
                  onChangeText={handlePhoneChange} 
                  maxLength={9}
                />
              </View>
              
              <View style={styles.formActions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setIsEditingPayment(false)}>
                  <Text style={styles.cancelBtnText}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.saveBtn, !mmNumber && { opacity: 0.7 }]} onPress={handleSavePaymentInfo} disabled={loading || !mmNumber}>
                  {loading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveBtnText}>Salvar Conta</Text>}
                </TouchableOpacity>
              </View>
            </View>
          )}

          <TouchableOpacity 
            style={[styles.updateBtn, hasPendingRequest && styles.updateBtnDisabled, { marginBottom: 20 }]} 
            onPress={openUpdateModal}
            disabled={hasPendingRequest || networkError}
            activeOpacity={0.85}
          >
            <Text style={[styles.updateBtnText, hasPendingRequest && styles.updateBtnTextDisabled]}>
              {hasPendingRequest ? 'Alteração de Dados em Andamento' : 'Solicitar Alteração de Dados'}
            </Text>
          </TouchableOpacity>

          {/* CONFIGURAÇÕES EM SÉRIE */}
          <Text style={styles.sectionTitle}>Configurações</Text>
          
          <View style={styles.seriesContainer}>
            <TouchableOpacity style={styles.seriesBtn} onPress={() => navigation.navigate('SupportHelp' as never)}>
              <View style={styles.seriesIconBox}><Ionicons name="headset-outline" size={20} color="#4B5563" /></View>
              <Text style={styles.seriesBtnText}>Central de Ajuda e Suporte</Text>
              <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
            </TouchableOpacity>

            <View style={styles.seriesDivider} />

            <TouchableOpacity style={styles.seriesBtn} onPress={() => setIsLanguageModalVisible(true)}>
              <View style={styles.seriesIconBox}><Ionicons name="globe-outline" size={20} color="#4B5563" /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.seriesBtnText}>Idioma / Language</Text>
                <Text style={styles.languageSelectedText}>{currentLang.flag} {currentLang.name}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
            </TouchableOpacity>

            <View style={styles.seriesDivider} />

            <TouchableOpacity style={styles.seriesBtn} onPress={() => setIsPrivacyModalVisible(true)}>
              <View style={styles.seriesIconBox}><Ionicons name="shield-checkmark-outline" size={20} color="#4B5563" /></View>
              <Text style={styles.seriesBtnText}>Política de Privacidade</Text>
              <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
            </TouchableOpacity>
          </View>

          {/* AÇÕES DE SAÍDA */}
          <TouchableOpacity style={styles.logoutButton} onPress={signOut} activeOpacity={0.85}>
            <Ionicons name="log-out-outline" size={20} color="#DC2626" style={{ marginRight: 8 }} />
            <Text style={styles.logoutButtonText}>{t('logout') || 'Sair do Aplicativo'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.deleteAccountBtn} onPress={handleDeleteAccount} activeOpacity={0.7}>
            <Ionicons name="trash-outline" size={20} color="#991B1B" style={{ marginRight: 8 }} />
            <Text style={styles.deleteAccountText}>{t('deleteAccount') || 'Excluir Minha Conta'}</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* MODAL DE ALTERAÇÃO DE DADOS */}
      <Modal visible={isUpdateModalVisible} transparent={true} animationType="slide" onRequestClose={() => setIsUpdateModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.backdrop} />
          </TouchableWithoutFeedback>

          <View style={[styles.modalContainer, { paddingBottom: dynamicBottomPadding }]}>
            <Text style={styles.modalTitle}>Solicitar Alteração</Text>
            <Text style={styles.modalSubtitle}>Modifique apenas os campos que precisa atualizar.</Text>
            
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={styles.inputLabel}>Nome Completo</Text>
              <TextInput style={styles.modalInput} value={updateData.newFullName} onChangeText={(t) => setUpdateData({...updateData, newFullName: t})} placeholderTextColor="#9CA3AF" />
              
              <Text style={styles.inputLabel}>Nº Documento (BI / Passaporte)</Text>
              <TextInput style={styles.modalInput} value={updateData.newDocumentNumber} onChangeText={(t) => setUpdateData({...updateData, newDocumentNumber: t})} placeholderTextColor="#9CA3AF" />
              
              <Text style={styles.inputLabel}>Marca / Modelo do Veículo</Text>
              <TextInput style={styles.modalInput} value={updateData.newVehicleBrand} onChangeText={(t) => setUpdateData({...updateData, newVehicleBrand: t})} placeholderTextColor="#9CA3AF" />
              
              <Text style={styles.inputLabel}>Cor do Veículo</Text>
              <TextInput style={styles.modalInput} value={updateData.newVehicleColor} onChangeText={(t) => setUpdateData({...updateData, newVehicleColor: t})} placeholderTextColor="#9CA3AF" />
              
              <Text style={styles.inputLabel}>Placa do Veículo</Text>
              <TextInput style={styles.modalInput} value={updateData.newVehiclePlate} onChangeText={(t) => setUpdateData({...updateData, newVehiclePlate: t})} placeholderTextColor="#9CA3AF" />
            </ScrollView>

            <View style={[styles.formActions, { marginTop: 16 }]}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setIsUpdateModalVisible(false)} disabled={isSubmittingUpdate}>
                <Text style={styles.cancelBtnText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleRequestUpdate} disabled={isSubmittingUpdate}>
                {isSubmittingUpdate ? <ActivityIndicator color="#FFF" /> : <Text style={styles.saveBtnText}>Enviar Pedido</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* MODAL SELETOR DE IDIOMA */}
      <Modal visible={isLanguageModalVisible} transparent={true} animationType="fade" onRequestClose={() => setIsLanguageModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <TouchableWithoutFeedback onPress={() => setIsLanguageModalVisible(false)}>
            <View style={styles.backdrop} />
          </TouchableWithoutFeedback>

          <View style={[styles.languageModalContainer, { paddingBottom: dynamicBottomPadding + 10 }]}>
            <Text style={styles.modalTitle}>Selecione o Idioma</Text>
            <Text style={styles.modalSubtitle}>Select your preferred language</Text>
            {LANGUAGES.map((item) => {
              const isSelected = i18n.language === item.code;
              return (
                <TouchableOpacity 
                  key={item.code} 
                  style={[styles.languageOption, isSelected && styles.languageOptionActive]} 
                  onPress={() => { i18n.changeLanguage(item.code); setIsLanguageModalVisible(false); }}
                >
                  <Text style={styles.languageFlag}>{item.flag}</Text>
                  <Text style={[styles.languageName, isSelected && styles.languageNameActive]}>{item.name}</Text>
                  {isSelected && <Ionicons name="checkmark-circle" size={22} color="#059669" />}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </Modal>

      <PrivacyPolicyModal visible={isPrivacyModalVisible} onClose={() => setIsPrivacyModalVisible(false)} />
    </View>
  );
}

// --- ESTILOS DO COMPONENTE ---
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F4F4F5' },
  header: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justify: 'space-between', 
    paddingHorizontal: 16, 
    paddingBottom: 14, 
    backgroundColor: '#FFF', 
    borderBottomWidth: 1, 
    borderBottomColor: '#E5E7EB', 
    elevation: 2 
  },
  backButton: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#1F2937' },
  
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, fontSize: 15, color: '#6B7280', fontWeight: '500' },
  
  offlineBanner: { backgroundColor: '#DC2626', flexDirection: 'row', alignItems: 'center', padding: 10, justifyContent: 'center', gap: 8 },
  offlineText: { color: '#FFF', fontSize: 13, fontWeight: '600' },
  content: { padding: 16 },

  profileHeader: { alignItems: 'center', marginBottom: 20, marginTop: 4 },
  imageContainer: { position: 'relative', marginBottom: 10 },
  profileImage: { width: 100, height: 100, borderRadius: 50, borderWidth: 3, borderColor: '#059669' },
  imagePlaceholder: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#E5E7EB', alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#D1D5DB' },
  cameraBadge: { position: 'absolute', bottom: 0, right: 0, backgroundColor: '#059669', width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFF' },
  profileName: { fontSize: 20, fontWeight: 'bold', color: '#111827' },
  profilePhone: { fontSize: 15, color: '#6B7280', marginTop: 2 },
  
  statusBanner: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 12, marginBottom: 14, gap: 8 },
  statusText: { fontWeight: 'bold', fontSize: 14 },

  gridContainer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', marginBottom: 8 },
  gridCard: {
    width: '48%',
    backgroundColor: '#FFF',
    padding: 16,
    borderRadius: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    elevation: 1,
  },
  gridIconBox: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  gridTitle: { fontSize: 13, color: '#6B7280', fontWeight: '600', marginBottom: 4 },
  gridValue: { fontSize: 15, fontWeight: '900', color: '#059669' },
  gridValuePlate: { fontSize: 14, fontWeight: '800', color: '#1F2937' },
  gridValueSecondary: { fontSize: 13, fontWeight: '700', color: '#4338CA' },
  
  warningText: { color: '#DC2626', fontSize: 12, fontWeight: '600' },
  editFormContainer: { backgroundColor: '#FFF', padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#E5E7EB', marginBottom: 16 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: '#111827', marginBottom: 4 },
  infoText: { fontSize: 12, color: '#6B7280', marginBottom: 12 },
  inputLabel: { fontSize: 13, fontWeight: '700', color: '#374151', marginBottom: 6, marginTop: 8 },
  providerSelect: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  providerBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#E5E7EB', alignItems: 'center', backgroundColor: '#F9FAFB' },
  providerActiveOrange: { backgroundColor: '#FF6600', borderColor: '#FF6600' },
  providerActiveMtn: { backgroundColor: '#EAB308', borderColor: '#EAB308' },
  providerText: { fontSize: 12, fontWeight: '700', color: '#374151' },
  phoneInputContainer: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 10, backgroundColor: '#F9FAFB', overflow: 'hidden' },
  countryBadge: { backgroundColor: '#E5E7EB', paddingHorizontal: 12, paddingVertical: 12 },
  countryBadgeText: { fontSize: 13, fontWeight: '800', color: '#1F2937' },
  phoneInput: { flex: 1, paddingHorizontal: 12, fontSize: 14, color: '#111827' },
  formActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  cancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: '#F3F4F6', alignItems: 'center' },
  cancelBtnText: { color: '#4B5563', fontWeight: '700', fontSize: 13 },
  saveBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: '#059669', alignItems: 'center' },
  saveBtnText: { color: '#FFF', fontWeight: '800', fontSize: 13 },
  updateBtn: { backgroundColor: '#FFF', borderWidth: 1, borderColor: '#059669', paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  updateBtnDisabled: { borderColor: '#D1D5DB', backgroundColor: '#F3F4F6' },
  updateBtnText: { color: '#059669', fontWeight: '800', fontSize: 13 },
  updateBtnTextDisabled: { color: '#9CA3AF' },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: '#1F2937', marginBottom: 12, marginTop: 8 },
  seriesContainer: { backgroundColor: '#FFF', borderRadius: 16, borderWidth: 1, borderColor: '#E5E7EB', marginBottom: 20, overflow: 'hidden' },
  seriesBtn: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  seriesIconBox: { width: 32, height: 32, borderRadius: 8, backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center' },
  seriesBtnText: { flex: 1, fontSize: 14, fontWeight: '600', color: '#1F2937' },
  seriesDivider: { height: 1, backgroundColor: '#F3F4F6', marginLeft: 58 },
  languageSelectedText: { fontSize: 11, color: '#059669', fontWeight: '700', marginTop: 2 },
  logoutButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FEE2E2', paddingVertical: 14, borderRadius: 12, marginBottom: 10 },
  logoutButtonText: { color: '#DC2626', fontWeight: '800', fontSize: 14 },
  deleteAccountBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
  deleteAccountText: { color: '#991B1B', fontWeight: '700', fontSize: 13 },
  
  modalOverlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15, 23, 42, 0.5)' },
  modalContainer: { backgroundColor: '#FFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '85%' },
  modalTitle: { fontSize: 18, fontWeight: '900', color: '#111827', marginBottom: 4 },
  modalSubtitle: { fontSize: 12, color: '#6B7280', marginBottom: 16 },
  modalInput: { borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 10, padding: 12, fontSize: 14, color: '#111827', backgroundColor: '#F9FAFB', marginBottom: 10 },
  
  languageModalContainer: { backgroundColor: '#FFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 },
  languageOption: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F3F4F6', gap: 12 },
  languageOptionActive: { backgroundColor: '#ECFDF5', borderRadius: 12, paddingHorizontal: 12, borderBottomWidth: 0, marginVertical: 2 },
  languageFlag: { fontSize: 20 },
  languageName: { flex: 1, fontSize: 14, fontWeight: '600', color: '#374151' },
  languageNameActive: { color: '#059669', fontWeight: '800' },
});