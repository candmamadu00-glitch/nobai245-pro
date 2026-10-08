import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert,
  ActivityIndicator, KeyboardAvoidingView, ScrollView, Platform, StatusBar
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { api } from '../services/api';
import { Feather } from '@expo/vector-icons';
import { theme } from '../theme/theme';

export function ForgotPassword() {
  const navigation = useNavigation<any>();

  const [step, setStep] = useState<1 | 2>(1);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [timer, setTimer] = useState(0);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (timer > 0) {
      interval = setInterval(() => setTimer((prev) => prev - 1), 1000);
    }
    return () => clearInterval(interval);
  }, [timer]);

  const handlePhoneChange = (text: string) => {
    const cleaned = text.replace(/\D/g, '').slice(0, 9);
    setPhone(cleaned);
  };

  async function handleSendCode() {
    if (phone.length !== 9) {
      return Alert.alert('Atenção', 'Informe um número de telefone válido com 9 dígitos.');
    }

    setLoading(true);
    try {
      const formattedPhone = `+245${phone}`;
      await api.post('/drivers/forgot-password', { phone: formattedPhone });
      
      Alert.alert('Código Enviado', `Um SMS com o código foi enviado para +245 ${phone}.`);
      setStep(2);
      setTimer(60);
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || 'Erro ao enviar código SMS.';
      Alert.alert('Erro', errorMessage);
    } finally {
      setLoading(false);
    }
  }

  async function handleResetPassword() {
    if (code.length !== 6) {
      return Alert.alert('Atenção', 'Digite o código de 6 dígitos enviado por SMS.');
    }
    if (newPassword.length < 6) {
      return Alert.alert('Atenção', 'A nova senha deve ter no mínimo 6 caracteres.');
    }

    setLoading(true);
    try {
      const formattedPhone = `+245${phone}`;
      await api.post('/drivers/reset-password', {
        phone: formattedPhone,
        code,
        newPassword,
      });

      Alert.alert('Sucesso! 🎉', 'Sua senha foi redefinida com sucesso.', [
        { text: 'Ir para Login', onPress: () => navigation.navigate('Login') }
      ]);
    } catch (error: any) {
      const errorMessage = error.response?.data?.error || 'Erro ao redefinir senha.';
      Alert.alert('Erro', errorMessage);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={theme.colors.primaryDark} translucent />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
          
          <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
            <Feather name="arrow-left" size={24} color="#FFF" />
          </TouchableOpacity>

          <View style={styles.header}>
            <Text style={styles.title}>Recuperar Senha</Text>
            <Text style={styles.subtitle}>
              {step === 1
                ? 'Insira o seu número de telefone registrado para receber o código SMS.'
                : `Digite o código de 6 dígitos enviado para +245 ${phone} e informe sua nova senha.`}
            </Text>
          </View>

          <View style={styles.formCard}>
            {step === 1 ? (
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
                  />
                </View>

                <TouchableOpacity
                  style={[styles.button, (loading || phone.length !== 9) && styles.buttonDisabled]}
                  onPress={handleSendCode}
                  disabled={loading || phone.length !== 9}
                >
                  {loading ? <ActivityIndicator color="#0F2537" /> : <Text style={styles.buttonText}>Enviar SMS</Text>}
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.label}>Código SMS (6 dígitos)</Text>
                <View style={styles.inputContainer}>
                  <Feather name="key" size={18} color={theme.colors.textSecondary} style={styles.inputIcon} />
                  <TextInput
                    style={styles.inputFlex}
                    placeholder="Ex: 123456"
                    placeholderTextColor={theme.colors.textLight}
                    value={code}
                    onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
                    keyboardType="number-pad"
                    maxLength={6}
                  />
                </View>

                <Text style={styles.label}>Nova Senha</Text>
                <View style={styles.inputContainer}>
                  <Feather name="lock" size={18} color={theme.colors.textSecondary} style={styles.inputIcon} />
                  <TextInput
                    style={styles.inputFlex}
                    placeholder="Sua nova senha"
                    placeholderTextColor={theme.colors.textLight}
                    value={newPassword}
                    onChangeText={setNewPassword}
                    secureTextEntry={!showPassword}
                  />
                  <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeButton}>
                    <Feather name={showPassword ? 'eye' : 'eye-off'} size={18} color={theme.colors.textSecondary} />
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={[styles.button, loading && styles.buttonDisabled]}
                  onPress={handleResetPassword}
                  disabled={loading}
                >
                  {loading ? <ActivityIndicator color="#0F2537" /> : <Text style={styles.buttonText}>Redefinir Senha</Text>}
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.resendContainer}
                  onPress={handleSendCode}
                  disabled={timer > 0 || loading}
                >
                  <Text style={[styles.resendText, timer > 0 && { color: theme.colors.textLight }]}>
                    {timer > 0 ? `Reenviar SMS em ${timer}s` : 'Não recebeu? Reenviar código'}
                  </Text>
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
    padding: 20,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 30) + 10 : 30,
    paddingBottom: 30,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  header: { marginBottom: 24 },
  title: { fontSize: 26, fontWeight: '900', color: '#FFF', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#94A3B8', lineHeight: 20 },
  formCard: {
    backgroundColor: theme.colors.surfaceWhite,
    padding: 24,
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
    marginBottom: 18,
    paddingHorizontal: 12,
    height: 54,
  },
  prefixBadge: {
    backgroundColor: '#E2E8F0',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginRight: 10,
  },
  prefixText: { fontSize: 14, fontWeight: '800', color: theme.colors.textPrimary },
  inputIcon: { marginRight: 10 },
  inputFlex: { flex: 1, fontSize: 15, fontWeight: '600', color: theme.colors.textPrimary, height: '100%' },
  eyeButton: { padding: 8 },
  button: {
    backgroundColor: theme.colors.accentYellow,
    height: 54,
    borderRadius: theme.borderRadius.md,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#0F2537', fontSize: 14, fontWeight: '900', textTransform: 'uppercase' },
  resendContainer: { marginTop: 20, alignItems: 'center' },
  resendText: { fontSize: 13, color: theme.colors.primaryBlue, fontWeight: '700' },
});