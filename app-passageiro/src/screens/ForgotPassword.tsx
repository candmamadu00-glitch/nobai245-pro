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
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../services/api';

export function ForgotPassword() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();

  const initialPhone = String(route.params?.initialPhone || '').replace(/\D/g, '').slice(0, 9);

  const [phone, setPhone] = useState(initialPhone);
  const [otp, setOtp] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [timer, setTimer] = useState(initialPhone.length === 9 ? 60 : 0);

  useEffect(() => {
    if (timer <= 0) return;
    const interval = setInterval(() => setTimer((prev) => Math.max(0, prev - 1)), 1000);
    return () => clearInterval(interval);
  }, [timer]);

  async function handleResendSms() {
    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length !== 9) {
      return Alert.alert('Atenção ⚠️', 'Informe um número válido da Guiné-Bissau com 9 dígitos.');
    }

    setResending(true);
    try {
      await api.post('/passengers/forgot-password', { phone: `+245${cleanPhone}` });
      setTimer(60);
      Alert.alert('Código Enviado 📩', `Enviamos um novo código SMS de 4 dígitos para +245 ${cleanPhone}.`);
    } catch (error: any) {
      const msg = error.response?.data?.error || error.response?.data?.message || 'Não foi possível enviar o SMS agora.';
      Alert.alert('Erro', msg);
    } finally {
      setResending(false);
    }
  }

  async function handleResetPassword() {
    const cleanPhone = phone.replace(/\D/g, '');
    const cleanOtp = otp.replace(/\D/g, '');

    if (cleanPhone.length !== 9) {
      return Alert.alert('Atenção ⚠️', 'Informe um número de telefone válido com 9 dígitos.');
    }
    if (cleanOtp.length !== 4) {
      return Alert.alert('Código Incompleto', 'Digite o código SMS de 4 dígitos que você recebeu.');
    }
    if (newPassword.length < 6) {
      return Alert.alert('Senha Curta', 'A nova senha deve ter no mínimo 6 caracteres.');
    }
    if (newPassword !== confirmPassword) {
      return Alert.alert('Senhas Diferentes', 'A nova senha e a confirmação não coincidem.');
    }

    setLoading(true);
    try {
      await api.post('/passengers/reset-password', {
        phone: `+245${cleanPhone}`,
        otp: cleanOtp,
        newPassword,
      });

      Alert.alert('Senha Alterada! 🎉', 'Sua senha foi redefinida com sucesso. Faça login para continuar.', [
        { text: 'Ir para Login', onPress: () => navigation.navigate('Login') },
      ]);
    } catch (error: any) {
      const msg = error.response?.data?.error || error.response?.data?.message || 'Código inválido ou expirado.';
      Alert.alert('Erro ao Redefinir', msg);
    } finally {
      setLoading(false);
    }
  }

  const topPad = Math.max((insets?.top || 0) + 12, Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 12 : 20);
  const bottomPad = Math.max((insets?.bottom || 0) + 24, 32);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0F172A" translucent />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingTop: topPad, paddingBottom: bottomPad }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.8}>
            <Ionicons name="arrow-back" size={22} color="#F8FAFC" />
          </TouchableOpacity>

          <Text style={styles.title}>Redefinir Senha</Text>
          <Text style={styles.subtitle}>
            Digite o código SMS de 4 dígitos enviado para o seu número e crie uma nova senha.
          </Text>

          <View style={styles.card}>
            <Text style={styles.label}>Telefone (+245)</Text>
            <View style={styles.phoneRow}>
              <View style={styles.prefixBadge}>
                <Text style={styles.prefixText}>🇬🇼 +245</Text>
              </View>
              <TextInput
                style={styles.phoneInput}
                placeholder="95 000 000"
                placeholderTextColor="#64748B"
                keyboardType="phone-pad"
                maxLength={9}
                value={phone}
                onChangeText={(txt) => setPhone(txt.replace(/\D/g, '').slice(0, 9))}
              />
            </View>

            <Text style={styles.label}>Código SMS (4 dígitos)</Text>
            <TextInput
              style={styles.otpInput}
              placeholder="0000"
              placeholderTextColor="#64748B"
              keyboardType="number-pad"
              maxLength={4}
              value={otp}
              onChangeText={(txt) => setOtp(txt.replace(/\D/g, '').slice(0, 4))}
              autoFocus={initialPhone.length === 9}
            />

            <TouchableOpacity
              style={[styles.resendBtn, (timer > 0 || resending) && { opacity: 0.6 }]}
              onPress={handleResendSms}
              disabled={timer > 0 || resending}
            >
              <Text style={styles.resendText}>
                {resending
                  ? 'Enviando SMS...'
                  : timer > 0
                  ? `Aguarde ${timer}s para reenviar o código`
                  : '🔄 Enviar / Reenviar código SMS'}
              </Text>
            </TouchableOpacity>

            <Text style={styles.label}>Nova Senha</Text>
            <View style={styles.passwordBox}>
              <TextInput
                style={styles.passwordInput}
                placeholder="Mínimo 6 caracteres"
                placeholderTextColor="#64748B"
                secureTextEntry={!showPassword}
                value={newPassword}
                onChangeText={setNewPassword}
              />
              <TouchableOpacity onPress={() => setShowPassword((v) => !v)} style={styles.eyeBtn}>
                <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            <Text style={styles.label}>Confirmar Nova Senha</Text>
            <View style={styles.passwordBox}>
              <TextInput
                style={styles.passwordInput}
                placeholder="Repita a nova senha"
                placeholderTextColor="#64748B"
                secureTextEntry={!showConfirmPassword}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
              />
              <TouchableOpacity onPress={() => setShowConfirmPassword((v) => !v)} style={styles.eyeBtn}>
                <Ionicons name={showConfirmPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.submitBtn, loading && { opacity: 0.7 }]}
              onPress={handleResetPassword}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator color="#0F172A" />
              ) : (
                <Text style={styles.submitText}>Salvar Nova Senha</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  scroll: { flexGrow: 1, paddingHorizontal: 22 },
  backBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(30, 41, 59, 0.9)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  title: { fontSize: 28, fontWeight: '800', color: '#F8FAFC', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#94A3B8', lineHeight: 20, marginBottom: 22 },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.15)',
  },
  label: { color: '#CBD5E1', fontSize: 13, fontWeight: '700', marginBottom: 6, marginTop: 12 },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
    overflow: 'hidden',
  },
  prefixBadge: {
    paddingHorizontal: 12,
    paddingVertical: 14,
    backgroundColor: 'rgba(234, 179, 8, 0.12)',
    borderRightWidth: 1,
    borderRightColor: '#334155',
  },
  prefixText: { color: '#EAB308', fontWeight: '800', fontSize: 14 },
  phoneInput: { flex: 1, color: '#F8FAFC', fontSize: 16, paddingHorizontal: 12, paddingVertical: 12 },
  otpInput: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#EAB308',
    color: '#F8FAFC',
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 10,
    textAlign: 'center',
    paddingVertical: 12,
  },
  resendBtn: { alignSelf: 'center', paddingVertical: 10 },
  resendText: { color: '#38BDF8', fontSize: 13, fontWeight: '700' },
  passwordBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#334155',
  },
  passwordInput: { flex: 1, color: '#F8FAFC', fontSize: 15, paddingHorizontal: 14, paddingVertical: 12 },
  eyeBtn: { paddingHorizontal: 12 },
  submitBtn: {
    backgroundColor: '#EAB308',
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 22,
  },
  submitText: { color: '#0F172A', fontSize: 16, fontWeight: '800' },
});
