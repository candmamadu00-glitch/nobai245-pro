import React, { useState } from 'react';
import { 
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, 
  ActivityIndicator, KeyboardAvoidingView, ScrollView, Platform, StatusBar, Image 
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { api } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { Feather } from '@expo/vector-icons';
import { theme } from '../theme/theme';

export function Login() {
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const navigation = useNavigation<any>();
  const { signIn } = useAuth();

  async function handleLogin() {
    const cleanPhone = phone.replace(/\D/g, '');
    
    if (!cleanPhone || cleanPhone.length !== 9 || !password) {
      return Alert.alert('Atenção', 'Informe um número de telefone válido (9 dígitos) e sua senha.');
    }

    setLoading(true);
    try {
      const response = await api.post('/drivers/login', { 
        phone: `+245${cleanPhone}`, 
        password 
      });
      const { accessToken, refreshToken, driver } = response.data;

      // 🛡️ O signIn atualiza o estado global e o Stack.Navigator transita para 'Home' automaticamente
      await signIn(driver, accessToken, refreshToken);
    } catch (error: any) {
      console.log('Erro do Login detalhado:', error?.response?.data || error?.message);
      
      const errorMessage = 
        error.response?.data?.error || 
        error.response?.data?.message || 
        (error.message === 'Network Error' 
          ? 'Não foi possível conectar ao servidor. Verifique sua conexão com a internet.' 
          : 'Falha de autenticação. Verifique os dados digitados.');

      Alert.alert('Erro no Login', errorMessage);
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={theme.colors.primaryDark} translucent />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          
          <View style={styles.heroHeader}>
            <View style={styles.logoBadgeContainer}>
              <Image 
                source={require('../../assets/icon.png')} 
                style={styles.logoImage}
              />
            </View>
            <Text style={styles.appTitle}>NÔ BAI <Text style={styles.highlightText}>245</Text></Text>
            <Text style={styles.appSubtitle}>Portal Oficial do Motorista</Text>
          </View>

          <View style={styles.formCard}>
            <Text style={styles.cardHeaderTitle}>Acessar Conta</Text>
            <Text style={styles.cardHeaderSub}>Informe seus dados para entrar no sistema</Text>

            <Text style={styles.label}>Número de Telefone</Text>
            <View style={styles.inputContainer}>
              <View style={styles.prefixBadge}>
                <Text style={styles.prefixText}>🇬🇼 +245</Text>
              </View>
              <TextInput
                style={styles.inputFlex}
                placeholder="Ex: 955800991"
                placeholderTextColor={theme.colors.textLight}
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                maxLength={9}
              />
            </View>

            <Text style={styles.label}>Senha Segura</Text>
            <View style={styles.inputContainer}>
              <Feather name="lock" size={18} color={theme.colors.textSecondary} style={styles.inputIcon} />
              <TextInput
                style={styles.inputFlex}
                placeholder="Sua senha"
                placeholderTextColor={theme.colors.textLight}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
              />
              <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeButton}>
                <Feather name={showPassword ? "eye" : "eye-off"} size={18} color={theme.colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <TouchableOpacity 
              style={styles.forgotPassword}
              onPress={() => navigation.navigate('ForgotPassword')}
            >
              <Text style={styles.forgotPasswordText}>Esqueceu a senha?</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.button, loading && styles.buttonDisabled]} 
              onPress={handleLogin} 
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color="#0F2537" />
              ) : (
                <Text style={styles.buttonText}>Acessar Conta</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={styles.registerLink} onPress={() => navigation.navigate('Register')}>
              <Text style={styles.registerText}>Não tem uma conta? <Text style={styles.registerTextBold}>Cadastre-se grátis</Text></Text>
            </TouchableOpacity>
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
    justifyContent: 'center', 
    padding: 20, 
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 30) + 20 : 40,
    paddingBottom: 30
  },
  heroHeader: { alignItems: 'center', marginBottom: 28 },
  logoBadgeContainer: { 
    width: 80, 
    height: 80, 
    borderRadius: 24, 
    backgroundColor: 'rgba(255, 255, 255, 0.1)', 
    justifyContent: 'center', 
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    marginBottom: 12,
    overflow: 'hidden'
  },
  logoImage: { width: '100%', height: '100%', resizeMode: 'cover' },
  appTitle: { fontSize: 30, fontWeight: '900', color: '#FFF', letterSpacing: 1 },
  highlightText: { color: theme.colors.accentYellow },
  appSubtitle: { fontSize: 13, color: '#94A3B8', marginTop: 4, fontWeight: '600' },
  formCard: { 
    backgroundColor: theme.colors.surfaceWhite, 
    padding: 24, 
    borderRadius: theme.borderRadius.xl, 
    ...theme.shadows.floating 
  },
  cardHeaderTitle: { fontSize: 20, fontWeight: '900', color: theme.colors.textPrimary, marginBottom: 4 },
  cardHeaderSub: { fontSize: 13, color: theme.colors.textSecondary, marginBottom: 24 },
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
    height: 54 
  },
  prefixBadge: { 
    backgroundColor: '#E2E8F0', 
    paddingHorizontal: 10, 
    paddingVertical: 6, 
    borderRadius: 8, 
    marginRight: 10 
  },
  prefixText: { fontSize: 14, fontWeight: '800', color: theme.colors.textPrimary },
  inputIcon: { marginRight: 10 },
  inputFlex: { flex: 1, fontSize: 15, fontWeight: '600', color: theme.colors.textPrimary, height: '100%' },
  eyeButton: { padding: 8 },
  forgotPassword: { alignSelf: 'flex-end', marginBottom: 20 },
  forgotPasswordText: { color: theme.colors.primaryBlue, fontSize: 13, fontWeight: '700' },
  button: { 
    backgroundColor: theme.colors.accentYellow, 
    height: 54, 
    borderRadius: theme.borderRadius.md, 
    justifyContent: 'center', 
    alignItems: 'center', 
    shadowColor: theme.colors.accentYellow, 
    shadowOffset: { width: 0, height: 6 }, 
    shadowOpacity: 0.3, 
    shadowRadius: 10, 
    elevation: 6 
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: { color: '#0F2537', fontSize: 15, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.5 },
  registerLink: { marginTop: 24, alignItems: 'center' },
  registerText: { color: theme.colors.textSecondary, fontSize: 14 },
  registerTextBold: { color: theme.colors.accentOrange, fontWeight: '800' },
});