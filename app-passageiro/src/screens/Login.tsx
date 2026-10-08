import React, { useState, useRef, useEffect } from 'react';
import { 
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, 
  ActivityIndicator, KeyboardAvoidingView, ScrollView, Platform, StatusBar,
  Animated, Modal, Dimensions, TouchableWithoutFeedback
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';

const { width } = Dimensions.get('window');

export function Login() {
  // 🛡️ Estados de Autenticação
  const [loginMethod, setLoginMethod] = useState<'phone' | 'email'>('phone');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  
  // 🛡️ Estados de UI & Modal
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [isForgotModalVisible, setForgotModalVisible] = useState(false);
  const [recoveryMethod, setRecoveryMethod] = useState<'phone' | 'email'>('phone');
  const [recoveryPhone, setRecoveryPhone] = useState('');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryLoading, setRecoveryLoading] = useState(false);

  // 🛡️ Animações
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;

  const navigation = useNavigation<any>();
  const { signIn } = useAuth();
  const { t } = useTranslation();

  useEffect(() => {
    try {
      GoogleSignin.configure({
        webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
      });
    } catch (e) {
      console.warn('[GOOGLE SIGNIN] Erro ao configurar:', e);
    }

    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 800,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 50,
        friction: 7,
        useNativeDriver: true,
      })
    ]).start();
  }, []);

  // ==========================================
  // 🌐 LOGIN VIA GOOGLE
  // ==========================================
  async function handleGoogleLogin() {
    setLoading(true);
    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const response = await GoogleSignin.signIn();
      const idToken = response.data?.idToken || response.idToken;

      if (!idToken) {
        throw new Error('Não foi possível obter o token de validação do Google.');
      }

      const apiResponse = await api.post('/passengers/auth/google', { idToken });

      if (apiResponse.data.isNewUser) {
        Alert.alert(
          t('complete_registration', 'Concluir Cadastro'),
          t('google_phone_prompt', 'Sua conta Google foi autenticada. Informe seu número de telefone para ativar o perfil.')
        );
        return navigation.navigate('Register', { 
          googleData: apiResponse.data.googleData 
        });
      }

      const { accessToken, refreshToken, passenger } = apiResponse.data;
      await signIn(passenger, accessToken, refreshToken);
      navigation.replace('Home');
    } catch (error: any) {
      if (error.code === statusCodes.SIGN_IN_CANCELLED) {
        console.log('[GOOGLE] Login cancelado pelo utilizador');
      } else if (error.code === statusCodes.IN_PROGRESS) {
        console.log('[GOOGLE] Login em andamento');
      } else if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        Alert.alert(t('error_title', 'Falha no Acesso'), 'Google Play Services não disponível no dispositivo.');
      } else {
        const errorMessage = error.response?.data?.error || error.response?.data?.message || t('server_error_msg', 'Erro ao autenticar com o Google.');
        Alert.alert(t('error_title', 'Falha no Acesso'), errorMessage);
      }
    } finally {
      setLoading(false);
    }
  }

  // ==========================================
  // 🚀 FUNÇÃO DE LOGIN PADRÃO
  // ==========================================
  async function handleLogin() {
    const isPhoneLogin = loginMethod === 'phone';
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    
    if (isPhoneLogin && !cleanPhone) {
      return Alert.alert(t('warning_title', 'Atenção ⚠️'), t('login_fill_phone', 'Digite seu número de telefone.'));
    }
    if (!isPhoneLogin && !email.trim()) {
      return Alert.alert(t('warning_title', 'Atenção ⚠️'), t('login_fill_email', 'Digite seu e-mail.'));
    }
    if (!password) {
      return Alert.alert(t('warning_title', 'Atenção ⚠️'), t('login_fill_password', 'Digite sua senha.'));
    }

    setLoading(true);
    try {
      const payload = isPhoneLogin 
        ? { phone: `+245${cleanPhone}`, password }
        : { email: email.trim().toLowerCase(), password };
      
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
  // 🔐 RECUPERAÇÃO DE SENHA
  // ==========================================
  async function handleRecoverPassword() {
    const isPhoneRecovery = recoveryMethod === 'phone';
    const cleanRecoveryPhone = recoveryPhone.replace(/[^0-9]/g, '');

    if (isPhoneRecovery && !cleanRecoveryPhone) {
      return Alert.alert(t('warning_title', 'Atenção ⚠️'), 'Informe o número de telefone cadastrado.');
    }
    if (!isPhoneRecovery && !recoveryEmail.trim()) {
      return Alert.alert(t('warning_title', 'Atenção ⚠️'), t('fill_recovery_email', 'Informe o seu e-mail cadastrado.'));
    }

    setRecoveryLoading(true);
    try {
      const payload = isPhoneRecovery 
        ? { phone: `+245${cleanRecoveryPhone}` } 
        : { email: recoveryEmail.trim().toLowerCase() };

      await api.post('/passengers/forgot-password', payload);
      
      Alert.alert(
        t('success_title', 'Instruções Enviadas! ✉️'), 
        isPhoneRecovery 
          ? 'Enviamos o código de verificação por SMS para o seu número via Termii.'
          : t('recovery_success_msg', 'As instruções para redefinir sua senha foram enviadas para o seu e-mail.')
      );
      setForgotModalVisible(false);
      setRecoveryEmail('');
      setRecoveryPhone('');
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || error.response?.data?.message || t('server_error_msg', 'Erro ao processar solicitação.');
      Alert.alert(t('error_title', 'Erro'), errorMessage);
    } finally {
      setRecoveryLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView 
      style={styles.container} 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar barStyle="light-content" backgroundColor="#0F172A" />
      
      <View style={styles.backgroundBlob1} />
      <View style={styles.backgroundBlob2} />

      <ScrollView  
        contentContainerStyle={styles.scrollContainer}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
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
            
            {/* TABS DE SELEÇÃO */}
            <View style={styles.tabContainer}>
              <TouchableOpacity 
                style={[styles.tabButton, loginMethod === 'phone' && styles.tabButtonActive]}
                onPress={() => setLoginMethod('phone')}
                activeOpacity={0.8}
              >
                <Ionicons name="call" size={16} color={loginMethod === 'phone' ? '#0F172A' : '#94A3B8'} />
                <Text style={[styles.tabText, loginMethod === 'phone' && styles.tabTextActive]}>
                  Telefone
                </Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.tabButton, loginMethod === 'email' && styles.tabButtonActive]}
                onPress={() => setLoginMethod('email')}
                activeOpacity={0.8}
              >
                <Ionicons name="mail" size={16} color={loginMethod === 'email' ? '#0F172A' : '#94A3B8'} />
                <Text style={[styles.tabText, loginMethod === 'email' && styles.tabTextActive]}>
                  E-mail
                </Text>
              </TouchableOpacity>
            </View>

            {/* INPUT TELEFONE OU EMAIL */}
            {loginMethod === 'phone' ? (
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
            ) : (
              <View style={styles.inputGroup}>
                <Text style={styles.inputLabel}>{t('email_label', 'E-mail')}</Text>
                <View style={styles.inputContainer}>
                  <Ionicons name="mail-outline" size={20} color="#64748B" style={styles.inputIcon} />
                  <TextInput
                    style={styles.input}
                    placeholder="seu.nome@gmail.com"
                    placeholderTextColor="#94A3B8"
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
              </View>
            )}

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

            {/* DIVISOR */}
            <View style={styles.dividerContainer}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>{t('or_continue_with', 'ou continue com')}</Text>
              <View style={styles.dividerLine} />
            </View>

            {/* GOOGLE */}
            <TouchableOpacity 
              style={styles.googleButton} 
              onPress={handleGoogleLogin} 
              disabled={loading}
              activeOpacity={0.8}
            >
              <Ionicons name="logo-google" size={20} color="#FFFFFF" style={{ marginRight: 10 }} />
              <Text style={styles.googleButtonText}>{t('google_login_btn', 'Entrar com o Google')}</Text>
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

      {/* 🔐 MODAL DE RECUPERAÇÃO DE SENHA */}
      <Modal
        visible={isForgotModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setForgotModalVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setForgotModalVisible(false)}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
              <TouchableWithoutFeedback>
                <View style={styles.modalContent}>
                  <View style={styles.modalHeader}>
                    <View style={styles.modalIconContainer}>
                      <MaterialCommunityIcons name="lock-reset" size={32} color="#EAB308" />
                    </View>
                    <TouchableOpacity onPress={() => setForgotModalVisible(false)} style={styles.closeModalButton}>
                      <Ionicons name="close" size={24} color="#64748B" />
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.modalTitle}>{t('recover_password_title', 'Recuperar Senha')}</Text>
                  <Text style={styles.modalSubtitle}>
                    Selecione o método e informe os dados cadastrados para redefinir sua senha.
                  </Text>

                  {/* TABS DE RECUPERAÇÃO */}
                  <View style={styles.tabContainer}>
                    <TouchableOpacity 
                      style={[styles.tabButton, recoveryMethod === 'phone' && styles.tabButtonActive]}
                      onPress={() => setRecoveryMethod('phone')}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="call" size={16} color={recoveryMethod === 'phone' ? '#0F172A' : '#94A3B8'} />
                      <Text style={[styles.tabText, recoveryMethod === 'phone' && styles.tabTextActive]}>
                        Telefone
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={[styles.tabButton, recoveryMethod === 'email' && styles.tabButtonActive]}
                      onPress={() => setRecoveryMethod('email')}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="mail" size={16} color={recoveryMethod === 'email' ? '#0F172A' : '#94A3B8'} />
                      <Text style={[styles.tabText, recoveryMethod === 'email' && styles.tabTextActive]}>
                        E-mail
                      </Text>
                    </TouchableOpacity>
                  </View>

                  {/* INPUT TELEFONE OU EMAIL DE RECUPERAÇÃO */}
                  {recoveryMethod === 'phone' ? (
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
                  ) : (
                    <View style={styles.inputContainer}>
                      <Ionicons name="mail-outline" size={20} color="#64748B" style={styles.inputIcon} />
                      <TextInput
                        style={styles.input}
                        placeholder="seu.nome@gmail.com"
                        placeholderTextColor="#94A3B8"
                        value={recoveryEmail}
                        onChangeText={setRecoveryEmail}
                        keyboardType="email-address"
                        autoCapitalize="none"
                      />
                    </View>
                  )}

                  <TouchableOpacity 
                    style={[styles.button, recoveryLoading && styles.buttonDisabled, { marginTop: 24 }]} 
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
                </View>
              </TouchableWithoutFeedback>
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  backgroundBlob1: { position: 'absolute', top: -100, right: -50, width: 300, height: 300, borderRadius: 150, backgroundColor: 'rgba(234, 179, 8, 0.15)' },
  backgroundBlob2: { position: 'absolute', bottom: -50, left: -100, width: 250, height: 250, borderRadius: 125, backgroundColor: 'rgba(56, 189, 248, 0.08)' },
  scrollContainer: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 40, paddingBottom: 60 },
  headerDecoration: { alignItems: 'center', marginBottom: 30 },
  brandBadge: { width: 72, height: 72, borderRadius: 24, backgroundColor: '#EAB308', justifyContent: 'center', alignItems: 'center', marginBottom: 16, shadowColor: '#EAB308', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 8 },
  brandTitle: { fontSize: 36, fontWeight: '900', color: '#FFFFFF', letterSpacing: -1 },
  brandHighlight: { color: '#EAB308' },
  subtitle: { fontSize: 15, color: '#94A3B8', marginTop: 8, fontWeight: '500', letterSpacing: 0.5 },
  glassCard: { backgroundColor: '#1E293B', borderRadius: 28, padding: 24, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.1)', shadowColor: '#000', shadowOffset: { width: 0, height: 20 }, shadowOpacity: 0.3, shadowRadius: 30, elevation: 10 },
  tabContainer: { flexDirection: 'row', backgroundColor: '#0F172A', borderRadius: 16, padding: 4, marginBottom: 20 },
  tabButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 12 },
  tabButtonActive: { backgroundColor: '#EAB308', shadowColor: '#EAB308', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 4 },
  tabText: { fontSize: 14, fontWeight: '600', color: '#94A3B8', marginLeft: 6 },
  tabTextActive: { color: '#0F172A', fontWeight: '700' },
  inputGroup: { marginBottom: 20 },
  inputLabel: { fontSize: 13, fontWeight: '600', color: '#CBD5E1', marginBottom: 8, marginLeft: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  inputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0F172A', borderWidth: 1, borderColor: '#334155', borderRadius: 16, paddingHorizontal: 16, height: 56 },
  inputIcon: { marginRight: 12 },
  prefixContainer: { flexDirection: 'row', alignItems: 'center' },
  prefixText: { fontSize: 16, color: '#FFFFFF', fontWeight: '600' },
  prefixDivider: { height: 24, width: 1, backgroundColor: '#334155', marginHorizontal: 12 },
  input: { flex: 1, fontSize: 16, color: '#FFFFFF', fontWeight: '500' },
  eyeIcon: { padding: 4 },
  forgotPasswordContainer: { alignSelf: 'flex-end', marginBottom: 24 },
  forgotPasswordText: { color: '#38BDF8', fontSize: 14, fontWeight: '600' },
  button: { backgroundColor: '#EAB308', height: 56, borderRadius: 16, justifyContent: 'center', alignItems: 'center', shadowColor: '#EAB308', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 6 },
  buttonDisabled: { opacity: 0.6 },
  buttonContent: { flexDirection: 'row', alignItems: 'center' },
  buttonText: { color: '#0F172A', fontSize: 16, fontWeight: '800', letterSpacing: 0.5 },
  dividerContainer: { flexDirection: 'row', alignItems: 'center', marginVertical: 20 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#334155' },
  dividerText: { color: '#94A3B8', fontSize: 13, paddingHorizontal: 12, fontWeight: '500' },
  googleButton: { flexDirection: 'row', backgroundColor: '#0F172A', borderWidth: 1, borderColor: '#334155', height: 56, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  googleButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
  linkButton: { marginTop: 24, alignItems: 'center' },
  linkText: { color: '#94A3B8', fontSize: 15 },
  linkTextBold: { color: '#EAB308', fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.85)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#1E293B', borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 32, paddingBottom: Platform.OS === 'ios' ? 40 : 32, borderWidth: 1, borderColor: 'rgba(255, 255, 255, 0.1)' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  modalIconContainer: { width: 56, height: 56, borderRadius: 16, backgroundColor: 'rgba(234, 179, 8, 0.1)', justifyContent: 'center', alignItems: 'center' },
  closeModalButton: { padding: 8, backgroundColor: '#0F172A', borderRadius: 20 },
  modalTitle: { fontSize: 24, fontWeight: '800', color: '#FFFFFF', marginBottom: 8 },
  modalSubtitle: { fontSize: 14, color: '#94A3B8', lineHeight: 20, marginBottom: 20 },
});