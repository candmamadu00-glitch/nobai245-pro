import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, 
  ActivityIndicator, KeyboardAvoidingView, ScrollView, Platform, StatusBar, Keyboard 
} from 'react-native';
import { api } from '../services/api';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { PrivacyPolicyModal } from '../components/PrivacyPolicyModal';

export function Register() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { t } = useTranslation();
  const isMountedRef = useRef(true);

  // Dados recebidos do Google Sign-In (se aplicável)
  const googleData = route.params?.googleData;
  const isGoogleFlow = !!googleData;

  const [fullName, setFullName] = useState(googleData?.name || googleData?.fullName || '');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [isModalVisible, setIsModalVisible] = useState(false);

  const [isOtpStep, setIsOtpStep] = useState(false);
  const [otpCode, setOtpCode] = useState('');

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (googleData?.name || googleData?.fullName) {
      setFullName(googleData.name || googleData.fullName);
    }
  }, [googleData]);

  const cleanPhoneInput = useCallback((text: string) => {
    return text.replace(/\D/g, '');
  }, []);

  const validateInputs = (): boolean => {
    const cleanName = fullName.trim();
    if (!cleanName || cleanName.split(' ').filter(Boolean).length < 2) {
      Alert.alert(
        t('invalid_name_title', 'Nome Inválido'), 
        t('invalid_name_msg', 'Por favor, insira pelo menos nome e sobrenome.')
      );
      return false;
    }

    const cleanDigits = cleanPhoneInput(phone);
    if (cleanDigits.length !== 9 || !cleanDigits.startsWith('9')) {
      Alert.alert(
        t('invalid_phone_title', 'Telefone Inválido'), 
        t('phone_length_error', 'O número de telefone da Guiné-Bissau deve ter 9 dígitos e começar com 9 (ex: 95XXXXXXX).')
      );
      return false;
    }

    if (!isGoogleFlow && password.length < 6) {
      Alert.alert(
        t('short_password_title', 'Senha Curta'), 
        t('short_password_msg', 'Sua senha deve ter no mínimo 6 caracteres.')
      );
      return false;
    }

    if (!acceptedTerms) {
      Alert.alert(
        t('pending_terms_title', 'Termos Pendentes'), 
        t('pending_terms_msg', 'Você deve aceitar as Políticas de Privacidade para criar uma conta.')
      );
      return false;
    }

    return true;
  };

  async function handleRegister() {
    Keyboard.dismiss();

    if (!validateInputs() || loading) return;

    setLoading(true);
    try {
      const cleanDigits = cleanPhoneInput(phone);
      const formattedPhone = `+245${cleanDigits}`;
      
      if (isGoogleFlow) {
        await api.post('/passengers/auth/google/complete', {
          phone: formattedPhone,
          googleData,
          fullName: fullName.trim()
        });
      } else {
        await api.post('/passengers/register', { 
          fullName: fullName.trim(), 
          phone: formattedPhone, 
          password 
        });
      }
      
      if (isMountedRef.current) {
        setIsOtpStep(true); 
      }
    } catch (error: any) {
      if (!isMountedRef.current) return;
      const errorMessage = 
        error.response?.data?.error || 
        error.response?.data?.message || 
        t('register_server_error', 'Erro ao conectar com o servidor. Verifique sua conexão de rede.');
      Alert.alert(t('register_error_title', 'Erro no Cadastro'), errorMessage);
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }

  async function handleVerifyOTP() {
    if (otpCode.length < 4) {
      return Alert.alert(
        t('invalid_code_title', 'Código Inválido'), 
        t('invalid_code_msg', 'Digite o código completo de 4 dígitos.')
      );
    }
    
    setLoading(true);
    try {
      const cleanDigits = cleanPhoneInput(phone);
      await api.post('/passengers/verify-otp', { 
        phone: `+245${cleanDigits}`, 
        otp: otpCode.trim() 
      });
      
      Alert.alert(
        t('success_otp_title', '🎉 Sucesso!'), 
        t('account_verified_msg', 'Conta verificada com sucesso! Faça login para prosseguir.')
      );
      
      if (isMountedRef.current) {
        setFullName('');
        setPhone('');
        setPassword('');
        setOtpCode('');
        setIsOtpStep(false);
      }
      navigation.navigate('Login');
    } catch (error: any) {
      if (!isMountedRef.current) return;
      const errorMessage = error.response?.data?.error || error.response?.data?.message || t('incorrect_code_msg', 'O código digitado é inválido ou expirou.');
      Alert.alert(t('incorrect_code_title', 'Código Incorreto'), errorMessage);
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }

  async function handleResendOTP() {
    setResendLoading(true);
    try {
      const cleanDigits = cleanPhoneInput(phone);
      await api.post('/passengers/request-otp', {
        phone: `+245${cleanDigits}`
      });
      Alert.alert('Novo Código Enviado', 'Um novo SMS de verificação foi enviado para o seu telemóvel.');
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || error.response?.data?.message || 'Não foi possível enviar um novo código SMS no momento.';
      Alert.alert('Erro ao Reenviar', errorMessage);
    } finally {
      if (isMountedRef.current) {
        setResendLoading(false);
      }
    }
  }

  if (isOtpStep) {
    return (
      <View style={styles.otpContainer}>
        <StatusBar barStyle="dark-content" backgroundColor="#F8FAFC" />
        <Ionicons name="chatbubble-ellipses-outline" size={64} color="#EAB308" style={{ marginBottom: 24 }} />
        <Text style={styles.title}>{t('verify_number_title', 'Verifique seu Número')}</Text>
        <Text style={styles.subtitle}>
          {t('otp_sent_sub', 'Enviamos um código SMS de 4 dígitos para')} +245 {phone}
        </Text>
        
        <TextInput
          style={styles.otpInput}
          placeholder="0000"
          placeholderTextColor="#94A3B8"
          value={otpCode}
          onChangeText={(val) => setOtpCode(val.replace(/\D/g, ''))}
          keyboardType="number-pad"
          maxLength={4}
          autoFocus
        />

        <TouchableOpacity 
          style={styles.button} 
          onPress={handleVerifyOTP} 
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading ? (
            <ActivityIndicator color="#1A202C" />
          ) : (
            <Text style={styles.buttonText}>{t('confirm_code_btn', 'Confirmar Código')}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity 
          style={[styles.resendButton, resendLoading && { opacity: 0.6 }]} 
          onPress={handleResendOTP}
          disabled={resendLoading}
        >
          {resendLoading ? (
            <ActivityIndicator color="#EAB308" size="small" />
          ) : (
            <Text style={styles.resendText}>Reenviar código por SMS</Text>
          )}
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.linkButton} onPress={() => setIsOtpStep(false)}>
          <Text style={styles.linkText}>{t('correct_phone_btn', 'Corrigir número de telefone')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView 
      style={styles.keyboardView} 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <StatusBar barStyle="dark-content" backgroundColor="#F8FAFC" />
      <ScrollView 
        contentContainerStyle={styles.scrollContainer}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity 
          style={styles.backButton} 
          onPress={() => navigation.goBack()}
        >
          <Ionicons name="arrow-back" size={24} color="#0F172A" />
        </TouchableOpacity>

        <View style={styles.header}>
          <Text style={styles.title}>
            {isGoogleFlow ? 'Concluir Registo' : t('create_account_title', 'Criar Conta')}
          </Text>
          <Text style={styles.subtitle}>
            {isGoogleFlow 
              ? 'Insira o seu número de telefone para associar à sua conta Google' 
              : t('register_subtitle_desc', 'Viaje e envie entregas com total segurança por Bissau')}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.inputLabel}>{t('full_name', 'Nome Completo')}</Text>
          <View style={styles.inputContainer}>
            <Ionicons name="person-outline" size={20} color="#64748B" style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              placeholder={t('full_name_placeholder', 'Seu nome e sobrenome')}
              placeholderTextColor="#94A3B8"
              value={fullName}
              onChangeText={setFullName}
              autoCapitalize="words"
              autoCorrect={false}
            />
          </View>

          <Text style={styles.inputLabel}>{t('phone_number_label', 'Número de Telefone')}</Text>
          <View style={styles.inputContainer}>
            <Ionicons name="call-outline" size={20} color="#64748B" style={styles.inputIcon} />
            <Text style={styles.prefixText}>+245</Text>
            <TextInput
              style={styles.input}
              placeholder="950000000"
              placeholderTextColor="#94A3B8"
              value={phone}
              onChangeText={(text) => setPhone(cleanPhoneInput(text))}
              keyboardType="number-pad"
              maxLength={9}
            />
          </View>

          {!isGoogleFlow && (
            <>
              <Text style={styles.inputLabel}>{t('secure_password_label', 'Senha Segura')}</Text>
              <View style={styles.inputContainer}>
                <Ionicons name="lock-closed-outline" size={20} color="#64748B" style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder={t('min_password_placeholder', 'Mínimo 6 caracteres')}
                  placeholderTextColor="#94A3B8"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeIcon}>
                  <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={20} color="#64748B" />
                </TouchableOpacity>
              </View>
            </>
          )}

          <View style={styles.termsContainer}>
            <TouchableOpacity 
              style={styles.checkbox} 
              onPress={() => setAcceptedTerms(!acceptedTerms)}
              activeOpacity={0.8}
            >
              <Ionicons 
                name={acceptedTerms ? "checkbox" : "square-outline"} 
                size={22} 
                color={acceptedTerms ? "#EAB308" : "#94A3B8"} 
              />
            </TouchableOpacity>
            <Text style={styles.termsText}>
              {t('read_and_accept', 'Eu li e aceito as')}{' '}
              <Text style={styles.termsLink} onPress={() => setIsModalVisible(true)}>
                {t('privacy_and_geolocation_policy', 'Políticas de Privacidade e Geolocalização')}
              </Text>.
            </Text>
          </View>

          <TouchableOpacity 
            style={[styles.button, (!acceptedTerms || loading) && styles.buttonDisabled]} 
            onPress={handleRegister} 
            disabled={loading || !acceptedTerms}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color="#1A202C" />
            ) : (
              <Text style={styles.buttonText}>
                {isGoogleFlow ? 'Concluir e Enviar OTP' : t('register_passenger_btn', 'Cadastrar Passageiro')}
              </Text>
            )}
          </TouchableOpacity>
        </View>

        <TouchableOpacity 
          style={styles.linkButton} 
          onPress={() => navigation.navigate('Login')}
          activeOpacity={0.7}
        >
          <Text style={styles.linkText}>
            {t('already_have_account', 'Já possui uma conta?')}{' '}
            <Text style={styles.linkTextBold}>{t('do_login', 'Faça Login')}</Text>
          </Text>
        </TouchableOpacity>
      </ScrollView>

      <PrivacyPolicyModal 
        visible={isModalVisible} 
        onClose={() => setIsModalVisible(false)} 
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardView: { flex: 1, backgroundColor: '#F8FAFC' },
  scrollContainer: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 50, paddingBottom: 40 },
  backButton: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#FFF', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 20 },
  header: { marginBottom: 24 },
  title: { fontSize: 28, fontWeight: '800', color: '#0F172A', letterSpacing: -0.5 },
  subtitle: { fontSize: 14, color: '#64748B', marginTop: 6, lineHeight: 20 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 24, padding: 24, borderWidth: 1, borderColor: '#F1F5F9', shadowColor: '#0F172A', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.04, shadowRadius: 16, elevation: 3 },
  inputLabel: { fontSize: 13, fontWeight: '600', color: '#475569', marginBottom: 8 },
  inputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 14, paddingHorizontal: 14, marginBottom: 18, height: 52 },
  inputIcon: { marginRight: 10 },
  prefixText: { fontSize: 15, color: '#0F172A', fontWeight: '600', marginRight: 8 },
  input: { flex: 1, fontSize: 15, color: '#0F172A', fontWeight: '500' },
  eyeIcon: { padding: 4 },
  termsContainer: { flexDirection: 'row', alignItems: 'center', marginBottom: 18, marginTop: 4 },
  checkbox: { marginRight: 8 },
  termsText: { flex: 1, fontSize: 13, color: '#475569', lineHeight: 18 },
  termsLink: { color: '#0F172A', fontWeight: '700', textDecorationLine: 'underline' },
  button: { backgroundColor: '#EAB308', height: 52, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginTop: 6, shadowColor: '#EAB308', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 4 },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#1A202C', fontSize: 16, fontWeight: '700' },
  resendButton: { marginTop: 16, padding: 8, alignItems: 'center' },
  resendText: { color: '#EAB308', fontWeight: '700', fontSize: 14 },
  linkButton: { marginTop: 20, alignItems: 'center' },
  linkText: { color: '#64748B', fontSize: 14 },
  linkTextBold: { color: '#0F172A', fontWeight: '700' },
  otpContainer: { flex: 1, backgroundColor: '#F8FAFC', justifyContent: 'center', padding: 24, alignItems: 'center' },
  otpInput: { backgroundColor: '#FFF', borderWidth: 2, borderColor: '#EAB308', borderRadius: 16, fontSize: 32, letterSpacing: 12, textAlign: 'center', padding: 16, width: '100%', marginBottom: 24, color: '#0F172A', fontWeight: 'bold' },
});