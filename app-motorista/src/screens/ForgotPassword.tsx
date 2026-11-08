import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  ScrollView,
  Platform,
  StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { api } from '../services/api';
import { Feather, Ionicons } from '@expo/vector-icons';
import { theme } from '../theme/theme';

export function ForgotPassword() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();

  // 1: Telefone | 2: Código OTP | 3: Nova Senha
  const [step, setStep] = useState<1 | 2 | 3>(1);

  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  const [loading, setLoading] = useState(false);
  const [timer, setTimer] = useState(0);

  // Cronômetro para reenviar SMS
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (timer > 0) {
      interval = setInterval(() => setTimer((prev) => prev - 1), 1000);
    }
    return () => clearInterval(interval);
  }, [timer]);

  const handlePhoneChange = (text: string) => {
    const cleaned = text.replace(/\D/g, '').slice(0, 9);
    setPhone(cleaned);
  };

  // ----------------------------------------------------
  // PASSO 1: Enviar Código SMS para o Telefone
  // ----------------------------------------------------
  async function handleSendCode() {
    if (phone.length !== 9) {
      return Alert.alert('Atenção', 'Informe um número de telefone válido de Guiné-Bissau com 9 dígitos.');
    }

    setLoading(true);
    try {
      const formattedPhone = `+245${phone}`;
      await api.post('/drivers/forgot-password', { phone: formattedPhone });
      
      Alert.alert('Código Enviado 📩', `Um SMS com o código de verificação foi enviado para +245 ${phone}.`);
      setStep(2);
      setTimer(60);
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || 'Erro ao enviar código SMS. Verifique o número informado.';
      Alert.alert('Erro', errorMessage);
    } finally {
      setLoading(false);
    }
  }

  // ----------------------------------------------------
  // PASSO 2: Validar Código de 6 Dígitos
  // ----------------------------------------------------
  function handleValidateCode() {
    if (code.length !== 6) {
      return Alert.alert('Código Incompleto', 'Digite o código de 6 dígitos que recebeu por SMS.');
    }
    // Avança para a definição da nova senha
    setStep(3);
  }

  // ----------------------------------------------------
  // PASSO 3: Redefinir a Senha no Backend
  // ----------------------------------------------------
  async function handleResetPassword() {
    if (newPassword.length < 6) {
      return Alert.alert('Senha Fraca', 'A nova senha deve conter no mínimo 6 caracteres.');
    }

    if (newPassword !== confirmPassword) {
      return Alert.alert('Senhas Divergentes', 'A nova senha e a confirmação não correspondem.');
    }

    setLoading(true);
    try {
      const formattedPhone = `+245${phone}`;
      await api.post('/drivers/reset-password', {
        phone: formattedPhone,
        code,
        newPassword,
      });

      Alert.alert('Sucesso! 🎉', 'Sua senha foi alterada com sucesso. Faça login com a nova senha.', [
        { text: 'Ir para Login', onPress: () => navigation.navigate('Login') }
      ]);
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || 'Erro ao redefinir senha. Verifique o código e tente novamente.';
      Alert.alert('Erro', errorMessage);
    } finally {
      setLoading(false);
    }
  }

  const dynamicTopPadding = Math.max((insets?.top || 0) + 10, Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 12 : 20);
  const dynamicBottomPadding = Math.max((insets?.bottom || 0) + 20, Platform.OS === 'android' ? 32 : 20);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={theme.colors.primaryDark} translucent />
      
      <KeyboardAvoidingView 
        style={{ flex: 1 }} 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView 
          contentContainerStyle={[
            styles.scrollContainer, 
            { paddingTop: dynamicTopPadding, paddingBottom: dynamicBottomPadding }
          ]} 
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* BOTÃO DE VOLTAR */}
          <TouchableOpacity 
            style={styles.backButton} 
            onPress={() => {
              if (step > 1) {
                setStep((prev) => (prev - 1) as 1 | 2 | 3);
              } else {
                navigation.goBack();
              }
            }}
            activeOpacity={0.8}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Feather name="arrow-left" size={22} color="#FFF" />
          </TouchableOpacity>

          {/* INDICADOR DE PASSO (PROGRESS BAR) */}
          <View style={styles.progressRow}>
            <View style={[styles.progressStep, step >= 1 && styles.progressStepActive]}>
              <Text style={[styles.progressStepText, step >= 1 && styles.progressStepTextActive]}>1. Telefone</Text>
            </View>
            <View style={styles.progressDivider} />
            <View style={[styles.progressStep, step >= 2 && styles.progressStepActive]}>
              <Text style={[styles.progressStepText, step >= 2 && styles.progressStepTextActive]}>2. Código SMS</Text>
            </View>
            <View style={styles.progressDivider} />
            <View style={[styles.progressStep, step >= 3 && styles.progressStepActive]}>
              <Text style={[styles.progressStepText, step >= 3 && styles.progressStepTextActive]}>3. Nova Senha</Text>
            </View>
          </View>

          {/* CABEÇALHO DINÂMICO */}
          <View style={styles.header}>
            <Text style={styles.title}>
              {step === 1 && 'Recuperar Senha'}
              {step === 2 && 'Digite o Código SMS'}
              {step === 3 && 'Criar Nova Senha'}
            </Text>
            <Text style={styles.subtitle}>
              {step === 1 && 'Insira o seu número de telefone registrado para receber o código de 6 dígitos.'}
              {step === 2 && `Informe o código enviado por mensagem para +245 ${phone}.`}
              {step === 3 && 'Crie uma nova senha segura para acessar sua conta digital.'}
            </Text>
          </View>

          {/* CARD DO FORMULÁRIO */}
          <View style={styles.formCard}>
            {/* ---------------------------------------------------- */}
            {/* ETAPA 1: INFORMAR TELEFONE                           */}
            {/* ---------------------------------------------------- */}
            {step === 1 && (
              <>
                <Text style={styles.label}>Número de Telefone</Text>
                <View style={styles.inputContainer}>
                  <View style={styles.prefixBadge}>
                    <Text style={styles.prefixText}>🇬🇼 +245</Text>
                  </View>
                  <TextInput
                    style={styles.inputFlex}
                    placeholder="Ex: 95 000 000"
                    placeholderTextColor={theme.colors.textLight}
                    value={phone}
                    onChangeText={handlePhoneChange}
                    keyboardType="phone-pad"
                    maxLength={9}
                    autoFocus
                  />
                </View>

                <TouchableOpacity
                  style={[styles.button, (loading || phone.length !== 9) && styles.buttonDisabled]}
                  onPress={handleSendCode}
                  disabled={loading || phone.length !== 9}
                  activeOpacity={0.85}
                >
                  {loading ? <ActivityIndicator color="#0F2537" /> : <Text style={styles.buttonText}>Enviar Código SMS ➔</Text>}
                </TouchableOpacity>
              </>
            )}

            {/* ---------------------------------------------------- */}
            {/* ETAPA 2: DIGITAR CÓDIGO SMS DE 6 DÍGITOS              */}
            {/* ---------------------------------------------------- */}
            {step === 2 && (
              <>
                <Text style={styles.label}>Código SMS (6 dígitos)</Text>
                <View style={[styles.inputContainer, styles.otpContainer]}>
                  <Feather name="key" size={20} color={theme.colors.primaryDark} style={styles.inputIcon} />
                  <TextInput
                    style={[styles.inputFlex, styles.otpInput]}
                    placeholder="000000"
                    placeholderTextColor={theme.colors.textLight}
                    value={code}
                    onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
                    keyboardType="number-pad"
                    maxLength={6}
                    autoFocus
                  />
                </View>

                <TouchableOpacity
                  style={[styles.button, (loading || code.length !== 6) && styles.buttonDisabled]}
                  onPress={handleValidateCode}
                  disabled={loading || code.length !== 6}
                  activeOpacity={0.85}
                >
                  <Text style={styles.buttonText}>Confirmar Código ➔</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.resendContainer}
                  onPress={handleSendCode}
                  disabled={timer > 0 || loading}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.resendText, timer > 0 && { color: theme.colors.textLight }]}>
                    {timer > 0 ? `Reenviar SMS em ${timer}s` : 'Não recebeu? Reenviar código SMS'}
                  </Text>
                </TouchableOpacity>
              </>
            )}

            {/* ---------------------------------------------------- */}
            {/* ETAPA 3: CRIAR NOVA SENHA                             */}
            {/* ---------------------------------------------------- */}
            {step === 3 && (
              <>
                <Text style={styles.label}>Nova Senha</Text>
                <View style={styles.inputContainer}>
                  <Feather name="lock" size={18} color={theme.colors.textSecondary} style={styles.inputIcon} />
                  <TextInput
                    style={styles.inputFlex}
                    placeholder="Mínimo 6 caracteres"
                    placeholderTextColor={theme.colors.textLight}
                    value={newPassword}
                    onChangeText={setNewPassword}
                    secureTextEntry={!showPassword}
                    autoFocus
                  />
                  <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeButton} activeOpacity={0.7}>
                    <Feather name={showPassword ? 'eye' : 'eye-off'} size={18} color={theme.colors.textSecondary} />
                  </TouchableOpacity>
                </View>

                <Text style={styles.label}>Confirmar Nova Senha</Text>
                <View style={styles.inputContainer}>
                  <Feather name="shield" size={18} color={theme.colors.textSecondary} style={styles.inputIcon} />
                  <TextInput
                    style={styles.inputFlex}
                    placeholder="Repita a nova senha"
                    placeholderTextColor={theme.colors.textLight}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    secureTextEntry={!showConfirmPassword}
                  />
                  <TouchableOpacity onPress={() => setShowConfirmPassword(!showConfirmPassword)} style={styles.eyeButton} activeOpacity={0.7}>
                    <Feather name={showConfirmPassword ? 'eye' : 'eye-off'} size={18} color={theme.colors.textSecondary} />
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={[styles.button, (loading || newPassword.length < 6 || newPassword !== confirmPassword) && styles.buttonDisabled]}
                  onPress={handleResetPassword}
                  disabled={loading || newPassword.length < 6 || newPassword !== confirmPassword}
                  activeOpacity={0.85}
                >
                  {loading ? <ActivityIndicator color="#0F2537" /> : <Text style={styles.buttonText}>Salvar Nova Senha 🎉</Text>}
                </TouchableOpacity>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.primaryDark },
  scrollContainer: {
    flexGrow: 1,
    paddingHorizontal: 20,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },

  // BARRA DE PROGRESSO DE PASSOS
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  progressStep: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  progressStepActive: {
    backgroundColor: theme.colors.accentYellow,
  },
  progressStepText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#94A3B8',
  },
  progressStepTextActive: {
    color: '#0F2537',
  },
  progressDivider: {
    flex: 1,
    height: 1.5,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    marginHorizontal: 4,
  },

  header: { marginBottom: 20 },
  title: { fontSize: 24, fontWeight: '900', color: '#FFF', marginBottom: 6 },
  subtitle: { fontSize: 13, color: '#94A3B8', lineHeight: 18 },
  formCard: {
    backgroundColor: theme.colors.surfaceWhite,
    padding: 20,
    borderRadius: theme.borderRadius.xl,
    ...theme.shadows.floating,
  },
  label: { fontSize: 13, fontWeight: '700', color: theme.colors.textPrimary, marginBottom: 8 },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
    marginBottom: 16,
    paddingHorizontal: 12,
    height: 52,
  },
  otpContainer: {
    borderColor: theme.colors.primaryDark,
    backgroundColor: '#F0F9FF',
  },
  otpInput: {
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 6,
    color: theme.colors.primaryDark,
  },
  prefixBadge: {
    backgroundColor: '#E2E8F0',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginRight: 10,
  },
  prefixText: { fontSize: 13, fontWeight: '800', color: theme.colors.textPrimary },
  inputIcon: { marginRight: 10 },
  inputFlex: { flex: 1, fontSize: 14, fontWeight: '600', color: theme.colors.textPrimary, height: '100%' },
  eyeButton: { padding: 8 },
  button: {
    backgroundColor: theme.colors.accentYellow,
    height: 52,
    borderRadius: theme.borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#0F2537', fontSize: 14, fontWeight: '900', textTransform: 'uppercase' },
  resendContainer: { marginTop: 18, alignItems: 'center' },
  resendText: { fontSize: 13, color: theme.colors.primaryBlue, fontWeight: '700' },
});