import React, { useState, useRef, useEffect } from 'react';
import { 
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, 
  ActivityIndicator, ScrollView, Platform, StatusBar,
  Animated, Dimensions, TouchableWithoutFeedback, Keyboard
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

export function Login() {
  // 🛡️ Estados de Autenticação (Apenas Telefone)
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  
  // 🛡️ Estados de UI & Modal
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isForgotModalVisible, setForgotModalVisible] = useState(false);
  const [recoveryPhone, setRecoveryPhone] = useState('');
  const [recoveryLoading, setRecoveryLoading] = useState(false);

  // ⌨️ Monitor Dinâmico da Altura do Teclado
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  // 🛡️ Animações
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(40)).current;

  const navigation = useNavigation<any>();
  const { signIn } = useAuth();
  const { t } = useTranslation();

  useEffect(() => {
    // Escuta a abertura e fecho do teclado em tempo real no Android/iOS
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => {
      setKeyboardHeight(0);
    });

    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      })
    ]).start();

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // ==========================================
  // 🚀 FUNÇÃO DE LOGIN PADRÃO (POR TELEFONE)
  // ==========================================
  async function handleLogin() {
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    
    if (!cleanPhone) {
      return Alert.alert(t('warning_title', 'Atenção ⚠️'), t('login_fill_phone', 'Digite seu número de telefone.'));
    }
    if (!password) {
      return Alert.alert(t('warning_title', 'Atenção ⚠️'), t('login_fill_password', 'Digite sua senha.'));
    }

    setLoading(true);
    try {
      const payload = { phone: `+245${cleanPhone}`, password };
      
      const response = await api.post('/passengers/login', payload);
      const { accessToken, refreshToken, passenger } = response.data;
      
      await signIn(passenger, accessToken, refreshToken);
      navigation.replace('Home');
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || error.response?.data?.message || t('server_error_msg', 'Erro no servidor. Verifique suas credenciais.');
      Alert.alert(t('error_title', 'Falha no Acesso'), errorMessage);
    } finally {
      setLoading(false);
    }
  }

  // ==========================================
  // 🔐 RECUPERAÇÃO DE SENHA (POR TELEFONE/SMS)
  // ==========================================
  async function handleRecoverPassword() {
    const cleanRecoveryPhone = recoveryPhone.replace(/[^0-9]/g, '');

    if (!cleanRecoveryPhone) {
      return Alert.alert(t('warning_title', 'Atenção ⚠️'), 'Informe o número de telefone cadastrado.');
    }

    setRecoveryLoading(true);
    try {
      const payload = { phone: `+245${cleanRecoveryPhone}` };

      await api.post('/passengers/forgot-password', payload);
      
      Alert.alert(
        t('success_title', 'Instruções Enviadas! ✉️'), 
        'Enviamos o código de verificação por SMS para o seu número via Termii.'
      );
      setForgotModalVisible(false);
      setRecoveryPhone('');
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || error.response?.data?.message || t('server_error_msg', 'Erro ao processar solicitação.');
      Alert.alert(t('error_title', 'Erro'), errorMessage);
    } finally {
      setRecoveryLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0F172A" translucent />
      
      <View style={styles.backgroundBlob1} />
      <View style={styles.backgroundBlob2} />

      <ScrollView  
        contentContainerStyle={[
          styles.scrollContainer,
          { paddingBottom: keyboardHeight > 0 ? keyboardHeight + 20 : 40 }
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
          
          {/* HEADER BRANDING */}
          <View style={styles.headerDecoration}>
            <View style={styles.brandBadge}>
              <Ionicons name="car-sport" size={38} color="#0F172A" />
            </View>
            <Text style={styles.brandTitle}>Nobai<Text style={styles.brandHighlight}>245</Text></Text>
            <Text style={styles.subtitle}>{t('brand_subtitle', 'Mobilidade Padrão Enterprise')}</Text>
          </View>

          {/* CARD PRINCIPAL */}
          <View style={styles.glassCard}>

            {/* INPUT TELEFONE */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>{t('phone_number_label', 'Número de Telefone')}</Text>
              <View style={styles.inputContainer}>
                <View style={styles.prefixContainer}>
                  <Text style={styles.prefixText}>+245</Text>
                  <View style={styles.prefixDivider} />
                </View>
                <TextInput
                  style={styles.input}
                  placeholder="950000000"
                  placeholderTextColor="#94A3B8"
                  value={phone}
                  onChangeText={(text) => setPhone(text.replace(/[^0-9]/g, ''))}
                  keyboardType="phone-pad"
                  maxLength={9}
                />
              </View>
            </View>

            {/* SENHA */}
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>{t('password_label', 'Senha')}</Text>
              <View style={styles.inputContainer}>
                <Ionicons name="lock-closed-outline" size={20} color="#64748B" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder={t('password_placeholder', '••••••••')}
                  placeholderTextColor="#94A3B8"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeIcon}>
                  <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={22} color="#64748B" />
                </TouchableOpacity>
              </View>
            </View>

            {/* ESQUECEU A SENHA */}
            <TouchableOpacity 
              style={styles.forgotPasswordContainer} 
              onPress={() => setForgotModalVisible(true)}
              activeOpacity={0.7}
            >
              <Text style={styles.forgotPasswordText}>{t('forgot_password', 'Esqueceu sua senha?')}</Text>
            </TouchableOpacity>

            {/* BOTÃO LOGIN */}
            <TouchableOpacity 
              style={[styles.button, loading && styles.buttonDisabled]} 
              onPress={handleLogin} 
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color="#0F172A" />
              ) : (
                <View style={styles.buttonContent}>
                  <Text style={styles.buttonText}>{t('login_btn', 'Acessar Conta')}</Text>
                  <Ionicons name="chevron-forward-circle" size={20} color="#0F172A" style={{ marginLeft: 8 }} />
                </View>
              )}
            </TouchableOpacity>

          </View>

          {/* REGISTRO */}
          <TouchableOpacity 
            style={styles.linkButton} 
            onPress={() => navigation.navigate('Register')}
            activeOpacity={0.7}
          >
            <Text style={styles.linkText}>
              {t('no_account_yet', 'Ainda não faz parte?')} <Text style={styles.linkTextBold}>{t('register_now', 'Crie uma conta')}</Text>
            </Text>
          </TouchableOpacity>
        </Animated.View>
      </ScrollView>

      {/* 🔐 OVERLAY INLINE DE RECUPERAÇÃO COM ELEVAÇÃO EM TEMPO REAL PELO TECLADO */}
      {isForgotModalVisible && (
        <View style={styles.modalOverlay}>
          <TouchableWithoutFeedback onPress={() => { Keyboard.dismiss(); setForgotModalVisible(false); }}>
            <View style={styles.backdrop} />
          </TouchableWithoutFeedback>
          <View style={[styles.modalContent, { marginBottom: keyboardHeight }]}>
            <ScrollView 
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              <View style={styles.modalHeader}>
                <View style={styles.modalIconContainer}>
                  <MaterialCommunityIcons name="lock-reset" size={32} color="#EAB308" />
                </View>
                <TouchableOpacity 
                  onPress={() => { Keyboard.dismiss(); setForgotModalVisible(false); }} 
                  style={styles.closeModalButton}
                >
                  <Ionicons name="close" size={24} color="#64748B" />
                </TouchableOpacity>
              </View>

              <Text style={styles.modalTitle}>{t('recover_password_title', 'Recuperar Senha')}</Text>
              <Text style={styles.modalSubtitle}>
                Informe seu número de telefone cadastrado para receber o código OTP de verificação.
              </Text>

              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>{t('phone_number_label', 'Número de Telefone')}</Text>
                <View style={styles.inputContainer}>
                  <View style={styles.prefixContainer}>
                    <Text style={styles.prefixText}>+245</Text>
                    <View style={styles.prefixDivider} />
                  </View>
                  <TextInput
                    style={styles.input}
                    placeholder="950000000"
                    placeholderTextColor="#94A3B8"
                    value={recoveryPhone}
                    onChangeText={(text) => setRecoveryPhone(text.replace(/[^0-9]/g, ''))}
                    keyboardType="phone-pad"
                    maxLength={9}
                  />
                </View>
              </View>

              <TouchableOpacity 
                style={[styles.button, recoveryLoading && styles.buttonDisabled, { marginTop: 16, marginBottom: 12 }]} 
                onPress={handleRecoverPassword} 
                disabled={recoveryLoading}
                activeOpacity={0.8}
              >
                {recoveryLoading ? (
                  <ActivityIndicator color="#0F172A" />
                ) : (
                  <Text style={styles.buttonText}>Enviar Código OTP</Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  backgroundBlob1: { position: 'absolute', top: -100, right: -50, width: 300, height: 300, borderRadius: 150, backgroundColor: 'rgba(234, 179, 8, 0.15)' },
  backgroundBlob2: { position: 'absolute', bottom: -50, left: -100, width: 250, height: 250, borderRadius: 125, backgroundColor: 'rgba(56, 189, 248, 0.08)' },
  scrollContainer: { flexGrow: 1, paddingHorizontal: 24, paddingTop: Platform.OS === 'android' ? 50 : 30, paddingBottom: 40 },
  headerDecoration: { alignItems: 'center', marginBottom: 24 },
  brandBadge: { width: 68, height: 68, borderRadius: 22, backgroundColor: '#EAB308', justifyContent: 'center', alignItems: 'center', marginBottom: 12, shadowColor: '#EAB308', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 8 },
  brandTitle: { fontSize: 34, fontWeight: '900', color: '#FFFFFF', letterSpacing: -1 },
  brandHighlight: { color: '#EAB308' },
  subtitle: { fontSize: 14, color: '#94A3B8', marginTop: 6, fontWeight: '500', letterSpacing: 0.5 },
  glassCard: { backgroundColor: '#1E293B', borderRadius: 28, padding: 22, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.1)', shadowColor: '#000', shadowOffset: { width: 0, height: 20 }, shadowOpacity: 0.3, shadowRadius: 30, elevation: 10 },
  inputGroup: { marginBottom: 18 },
  inputLabel: { fontSize: 12, fontWeight: '600', color: '#CBD5E1', marginBottom: 8, marginLeft: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  inputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0F172A', borderWidth: 1, borderColor: '#334155', borderRadius: 16, paddingHorizontal: 16, height: 56 },
  inputIcon: { marginRight: 12 },
  prefixContainer: { flexDirection: 'row', alignItems: 'center' },
  prefixText: { fontSize: 16, color: '#FFFFFF', fontWeight: '600' },
  prefixDivider: { height: 24, width: 1, backgroundColor: '#334155', marginHorizontal: 12 },
  input: { flex: 1, fontSize: 16, color: '#FFFFFF', fontWeight: '500' },
  eyeIcon: { padding: 4 },
  forgotPasswordContainer: { alignSelf: 'flex-end', marginBottom: 20 },
  forgotPasswordText: { color: '#38BDF8', fontSize: 14, fontWeight: '600' },
  button: { backgroundColor: '#EAB308', height: 56, borderRadius: 16, justifyContent: 'center', alignItems: 'center', shadowColor: '#EAB308', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 6 },
  buttonDisabled: { opacity: 0.6 },
  buttonContent: { flexDirection: 'row', alignItems: 'center' },
  buttonText: { color: '#0F172A', fontSize: 16, fontWeight: '800', letterSpacing: 0.5 },
  linkButton: { marginTop: 20, alignItems: 'center' },
  linkText: { color: '#94A3B8', fontSize: 15 },
  linkTextBold: { color: '#EAB308', fontWeight: '700' },
  
  // 🔐 OVERLAY DE RECUPERAÇÃO ELEVADO
  modalOverlay: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(15, 23, 42, 0.85)', justifyContent: 'flex-end', zIndex: 999 },
  backdrop: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 },
  modalContent: { backgroundColor: '#1E293B', borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 24, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.1)' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  modalIconContainer: { width: 52, height: 52, borderRadius: 16, backgroundColor: 'rgba(234, 179, 8, 0.1)', justifyContent: 'center', alignItems: 'center' },
  closeModalButton: { padding: 8, backgroundColor: '#0F172A', borderRadius: 20 },
  modalTitle: { fontSize: 22, fontWeight: '800', color: '#FFFFFF', marginBottom: 6 },
  modalSubtitle: { fontSize: 13, color: '#94A3B8', lineHeight: 18, marginBottom: 18 },
}); 