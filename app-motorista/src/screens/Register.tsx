import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { 
  View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, 
  ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform, Image, StatusBar 
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { api } from '../services/api';
import * as ImagePicker from 'expo-image-picker';
import { Feather, Ionicons } from '@expo/vector-icons';
import { PrivacyPolicyModal } from '../components/PrivacyPolicyModal';
import { theme } from '../theme/theme';
import {
  VEHICLE_COLOR_OPTIONS,
  getVehicle3DIconAsset,
  getDefaultColorForCategory,
  getVehicleCategoryLabel,
  resolveVehicleColorKey,
} from '../utils/vehicleAssets';


export function Register() {
  const { t } = useTranslation();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);

  // Fase 1: Veículo e Pessoal
  const [fullName, setFullName] = useState('');
  const [vehicleType, setVehicleType] = useState('TAXI'); 
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehicleColor, setVehicleColor] = useState('Amarelo');
  const [colorManuallyEdited, setColorManuallyEdited] = useState(false);

  const [vehiclePlate, setVehiclePlate] = useState('');
  const [vehicleSeats, setVehicleSeats] = useState('');

  // Fase 2: Documentos
  const [documentType, setDocumentType] = useState('BI'); 
  const [documentNumber, setDocumentNumber] = useState('');

  // Fase 3: Contato e Fotos
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [selfie, setSelfie] = useState<string | null>(null);
  const [licenseFront, setLicenseFront] = useState<string | null>(null);
  const [licenseBack, setLicenseBack] = useState<string | null>(null);

  // Fase 4: Código SMS OTP
  const [otpCode, setOtpCode] = useState('');
  const [resendTimer, setResendTimer] = useState(60);
  const [canResend, setCanResend] = useState(false);

  // Políticas de Privacidade
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [isPrivacyModalVisible, setPrivacyModalVisible] = useState(false);

  const navigation = useNavigation<any>();

  // Temporizador para reenvio do código SMS
  useEffect(() => {
    let timer: ReturnType<typeof setInterval>;
    if (step === 4 && resendTimer > 0) {
      setCanResend(false);
      timer = setInterval(() => {
        setResendTimer((prev) => prev - 1);
      }, 1000);
    } else if (resendTimer === 0) {
      setCanResend(true);
    }
    return () => clearInterval(timer);
  }, [step, resendTimer]);

  /**
   * Menu de captura de imagem com opções de Câmera ou Galeria
   */
  function pickImage(setter: (uri: string) => void, title: string) {
    Alert.alert(
      `Enviar ${title}`,
      'Escolha como deseja enviar a imagem do seu documento ou foto:',
      [
        {
          text: '📷 Tirar Foto Agora',
          onPress: async () => {
            try {
              const permission = await ImagePicker.requestCameraPermissionsAsync();
              if (!permission.granted) {
                return Alert.alert('Permissão Negada', 'Precisamos de acesso à câmara para capturar a foto.');
              }

              const result = await ImagePicker.launchCameraAsync({
                mediaTypes: ['images'],
                allowsEditing: true,
                quality: 0.8,
              });

              if (!result.canceled && result.assets && result.assets[0]?.uri) {
                setter(result.assets[0].uri);
              }
            } catch (error) {
              console.error('Erro ao abrir câmera:', error);
              Alert.alert('Erro', 'Não foi possível abrir a câmara do dispositivo.');
            }
          },
        },
        {
          text: '🖼️ Escolher da Galeria',
          onPress: async () => {
            try {
              const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
              if (!permission.granted) {
                return Alert.alert('Permissão Negada', 'Precisamos de acesso à galeria para selecionar a imagem.');
              }

              const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                allowsEditing: true,
                quality: 0.8,
              });

              if (!result.canceled && result.assets && result.assets[0]?.uri) {
                setter(result.assets[0].uri);
              }
            } catch (error) {
              console.error('Erro ao abrir galeria:', error);
              Alert.alert('Erro', 'Não foi possível acessar a galeria de fotos.');
            }
          },
        },
        {
          text: 'Cancelar',
          style: 'cancel',
        },
      ],
      { cancelable: true }
    );
  }

  const registrationOtpTokenRef = React.useRef<string>('');

  async function handleSendOtp() {
    const cleanPhone = phone.replace(/\D/g, '');
    if (!cleanPhone || cleanPhone.length !== 9) {
      return Alert.alert('Atenção', 'Informe um número de telefone válido com 9 dígitos.');
    }
    if (!password || password.length < 6) {
      return Alert.alert('Atenção', 'Crie uma senha segura com no mínimo 6 caracteres.');
    }
    if (!selfie || !licenseFront || !licenseBack) {
      return Alert.alert('Fotos', 'Selfie e Carta de Condução são obrigatórias.');
    }
    if (!privacyAccepted) {
      return Alert.alert('Atenção', 'Você deve ler e aceitar as Políticas de Privacidade.');
    }

    setSendingOtp(true);
    try {
      const res = await api.post('/drivers/request-registration-otp', { phone: `+245${cleanPhone}` });
      if (res.data?.otpToken) {
        registrationOtpTokenRef.current = res.data.otpToken;
      }
      setResendTimer(60);
      setStep(4);
    } catch (error: any) {
      const errorMessage =
        error.response?.data?.error ||
        error.response?.data?.message ||
        'Não foi possível enviar o código SMS. Verifique o número e tente novamente.';
      Alert.alert('Erro no Envio de SMS', errorMessage);
    } finally {
      setSendingOtp(false);
    }
  }


  function handleNextStep() {
    if (step === 1) {
      if (!fullName || !vehicleModel || !vehiclePlate || !vehicleColor) {
        return Alert.alert('Atenção', 'Preencha todos os dados básicos para avançar.');
      }
      if (vehicleType === 'TOCA_TOCA' && !vehicleSeats) {
        return Alert.alert('Atenção', 'Informe a capacidade de passageiros do Toca-Toca.');
      }
      setStep(2);
    } else if (step === 2) {
      if (!documentNumber) {
        return Alert.alert('Atenção', 'O número do documento é obrigatório.');
      }
      setStep(3);
    } else if (step === 3) {
      handleSendOtp();
    }
  }

  async function handleRegister() {
    const cleanPhone = phone.replace(/\D/g, '');
    const cleanOtp = otpCode.trim();

    if (!cleanOtp || cleanOtp.length !== 6) {
      return Alert.alert('Atenção', 'Digite o código de verificação SMS de 6 dígitos.');
    }

    setLoading(true);

    try {
      const formData = new FormData();
      formData.append('fullName', fullName.trim());
      formData.append('phone', `+245${cleanPhone}`);
      formData.append('password', password);
      formData.append('vehicleBrand', vehicleModel.trim());
      formData.append('vehicleModel', vehicleModel.trim());
      formData.append('vehiclePlate', vehiclePlate.trim().toUpperCase());
      formData.append('vehicleColor', vehicleColor.trim());
      formData.append('vehicleType', vehicleType);
      formData.append('otpCode', cleanOtp);
      if (registrationOtpTokenRef.current) {
        formData.append('otpToken', registrationOtpTokenRef.current);
      }

      
      if (vehicleType === 'TOCA_TOCA') {
        formData.append('vehicleSeats', vehicleSeats);
      }
      
      formData.append('documentType', documentType);
      formData.append('documentNumber', documentNumber.trim().toUpperCase());

      const appendImage = (key: string, uri: string) => {
        const filename = uri.split('/').pop() || `${key}.jpg`;
        const match = /\.(\w+)$/.exec(filename);
        const ext = match ? match[1].toLowerCase() : 'jpg';
        const type = ext === 'png' ? 'image/png' : 'image/jpeg';

        formData.append(key, {
          uri: uri,
          name: filename,
          type,
        } as any);
      };

      appendImage('selfie', selfie!);
      appendImage('licenseFront', licenseFront!);
      appendImage('licenseBack', licenseBack!);

      const response = await api.post('/drivers/register', formData, {
        headers: {
          'Accept': 'application/json',
        },
        transformRequest: (data) => data,
      });

      console.log('=== ✅ [DEBUG CADASTRO] SUCESSO ===', response.data);
      
      Alert.alert(
        '🎉 Cadastro Concluído com Sucesso!',
        'Seus dados e documentos foram enviados para nossa equipe de análise.\n\n' +
        '📋 Status: Em Verificação\n' +
        '⏱️ Tempo estimado: Ativação em até 24 horas\n\n' +
        'Assim que seu perfil for aprovado, você receberá uma notificação e poderá entrar online para começar a faturar com a Nô Bai 245!',
        [
          {
            text: 'Ir para a Tela Inicial',
            onPress: () => navigation.navigate('Login'),
          },
        ],
        { cancelable: false }
      );
    } catch (error: any) {
      console.log('=== ❌ [DEBUG CADASTRO] ERRO RETORNADO PELA API ===');
      console.log('Status HTTP:', error.response?.status);
      console.log('Resposta do Servidor:', JSON.stringify(error.response?.data, null, 2));

      Alert.alert('Erro no Cadastro', error.response?.data?.error || error.response?.data?.message || 'Falha ao registrar.');
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
            <Text style={styles.appTitle}>Crie sua Conta</Text>
            <Text style={styles.appSubtitle}>Junte-se à Nô Bai 245 e aumente seu faturamento</Text>
          </View>

          <View style={styles.formCard}>
            <View style={styles.progressContainer}>
              <View style={styles.progressBarBg}>
                <View style={[styles.progressBarFill, { width: `${(step / 4) * 100}%` }]} />
              </View>
              <Text style={styles.stepText}>Etapa {step} de 4</Text>
            </View>

            {step === 1 && (
              <>
                <Text style={styles.sectionTitle}>1. Dados do Veículo & Pessoal</Text>
                
                <Text style={styles.inputLabel}>Categoria do Veículo</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.typeScroll} contentContainerStyle={{ paddingRight: 10 }}>
                  {['TAXI', 'PARTICULAR', 'MOTO_CARRO', 'MOTO', 'TOCA_TOCA'].map((type) => (
                    <TouchableOpacity 
                      key={type} 
                      style={[styles.typeBadge, vehicleType === type && styles.typeBadgeActive]} 
                      onPress={() => {
                        setVehicleType(type);
                        if (!colorManuallyEdited || !vehicleColor.trim()) {
                          setVehicleColor(getDefaultColorForCategory(type));
                        }
                      }}
                    >
                      <Text style={[styles.typeBadgeText, vehicleType === type && styles.typeBadgeTextActive]}>
                        {getVehicleCategoryLabel(type)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8FAFC', borderRadius: 14, padding: 12, marginBottom: 14, borderWidth: 1, borderColor: '#E2E8F0' }}>
                  <Image source={getVehicle3DIconAsset(vehicleType, vehicleColor)} style={{ width: 58, height: 58, marginRight: 12 }} resizeMode="contain" />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 12, fontWeight: '800', color: '#0F2537', textTransform: 'uppercase' }}>
                      {getVehicleCategoryLabel(vehicleType)} • {vehicleColor.trim() || getDefaultColorForCategory(vehicleType)}
                    </Text>
                    <Text style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
                      {resolveVehicleColorKey(vehicleColor) || ['MOTO', 'MOTO_CARRO', 'TOCA_TOCA'].includes(vehicleType)
                        ? 'Assim seu veículo aparecerá para você e para o passageiro'
                        : 'Cor personalizada (usará ícone padrão da categoria no mapa)'}
                    </Text>
                  </View>
                </View>

                <Text style={styles.inputLabel}>Nome Completo</Text>
                <TextInput style={styles.input} placeholder="Ex: Mamadu Candé" placeholderTextColor={theme.colors.textLight} value={fullName} onChangeText={setFullName} />

                <Text style={styles.inputLabel}>Marca e Modelo</Text>
                <TextInput style={styles.input} placeholder="Ex: Toyota Corolla / Hiace" placeholderTextColor={theme.colors.textLight} value={vehicleModel} onChangeText={setVehicleModel} />

                <View style={styles.row}>
                  <View style={{ flex: 1, marginRight: 6 }}>
                    <Text style={styles.inputLabel}>Cor do Veículo</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="Ex: Azul"
                      placeholderTextColor={theme.colors.textLight}
                      value={vehicleColor}
                      onChangeText={(txt) => {
                        setColorManuallyEdited(true);
                        setVehicleColor(txt);
                      }}
                    />
                  </View>
                  <View style={{ flex: 1, marginLeft: 6 }}>
                    <Text style={styles.inputLabel}>Matrícula</Text>
                    <TextInput style={styles.input} placeholder="Ex: RGB-12-34" placeholderTextColor={theme.colors.textLight} value={vehiclePlate} onChangeText={setVehiclePlate} autoCapitalize="characters" />
                  </View>
                </View>

                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }} contentContainerStyle={{ paddingRight: 10 }}>
                  {VEHICLE_COLOR_OPTIONS.map((opt) => {
                    const isSelected = resolveVehicleColorKey(vehicleColor) === opt.key;
                    return (
                      <TouchableOpacity
                        key={opt.key}
                        onPress={() => {
                          setColorManuallyEdited(true);
                          setVehicleColor(opt.label);
                        }}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          borderRadius: 20,
                          marginRight: 8,
                          backgroundColor: isSelected ? '#0F2537' : '#F1F5F9',
                          borderWidth: 1,
                          borderColor: isSelected ? '#0F2537' : '#CBD5E1',
                        }}
                      >
                        <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: opt.hex, marginRight: 6, borderWidth: 1, borderColor: opt.borderHex || 'rgba(0,0,0,0.2)' }} />
                        <Text style={{ fontSize: 12, fontWeight: '700', color: isSelected ? '#FFFFFF' : '#334155' }}>
                          {opt.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>


                {vehicleType === 'TOCA_TOCA' && (
                  <>
                    <Text style={styles.inputLabel}>Capacidade de Passageiros</Text>
                    <TextInput style={styles.input} placeholder="Nº de lugares disponíveis" placeholderTextColor={theme.colors.textLight} value={vehicleSeats} onChangeText={setVehicleSeats} keyboardType="numeric" />
                  </>
                )}

                <TouchableOpacity style={styles.primaryBtn} onPress={handleNextStep}>
                  <Text style={styles.primaryBtnText}>Continuar</Text>
                  <Feather name="arrow-right" size={18} color="#0F2537" />
                </TouchableOpacity>
              </>
            )}

            {step === 2 && (
              <>
                <Text style={styles.sectionTitle}>2. Documentação Oficial</Text>
                
                <Text style={styles.inputLabel}>Tipo de Documento</Text>
                <View style={styles.docTypeContainer}>
                  {[{id: 'BI', label: 'B.I.'}, {id: 'PASSPORT', label: 'Passaporte'}, {id: 'MIGRATORY_CARD', label: 'Cartão Residente'}].map((doc) => (
                    <TouchableOpacity 
                      key={doc.id} 
                      style={[styles.docTypeButton, documentType === doc.id && styles.typeBadgeActive]} 
                      onPress={() => setDocumentType(doc.id)}
                    >
                      <Text style={[styles.docTypeText, documentType === doc.id && styles.typeBadgeTextActive]}>{doc.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.inputLabel}>Número do Documento</Text>
                <TextInput style={styles.input} placeholder={`Número do ${documentType === 'BI' ? 'B.I.' : 'Documento'}`} placeholderTextColor={theme.colors.textLight} value={documentNumber} onChangeText={setDocumentNumber} autoCapitalize="characters" />

                <TouchableOpacity style={styles.primaryBtn} onPress={handleNextStep}>
                  <Text style={styles.primaryBtnText}>Continuar</Text>
                  <Feather name="arrow-right" size={18} color="#0F2537" />
                </TouchableOpacity>

                <TouchableOpacity style={styles.secondaryBtn} onPress={() => setStep(1)}>
                  <Text style={styles.secondaryBtnText}>Voltar</Text>
                </TouchableOpacity>
              </>
            )}

            {step === 3 && (
              <>
                <Text style={styles.sectionTitle}>3. Fotos & Acesso</Text>

                <Text style={styles.inputLabel}>Anexar Documentos Claros</Text>
                <View style={styles.photoGrid}>
                  <TouchableOpacity style={[styles.photoBox, selfie && styles.photoBoxSuccess]} onPress={() => pickImage(setSelfie, 'Selfie')}>
                    {selfie ? <Image source={{ uri: selfie }} style={styles.previewImg} /> : <><Ionicons name="camera-outline" size={24} color={theme.colors.primaryDark} /><Text style={styles.photoBoxText}>Selfie</Text></>}
                  </TouchableOpacity>
                  
                  <TouchableOpacity style={[styles.photoBox, licenseFront && styles.photoBoxSuccess]} onPress={() => pickImage(setLicenseFront, 'Frente da Carta')}>
                    {licenseFront ? <Image source={{ uri: licenseFront }} style={styles.previewImg} /> : <><Ionicons name="card-outline" size={24} color={theme.colors.primaryDark} /><Text style={styles.photoBoxText}>Carta (Frente)</Text></>}
                  </TouchableOpacity>

                  <TouchableOpacity style={[styles.photoBox, licenseBack && styles.photoBoxSuccess]} onPress={() => pickImage(setLicenseBack, 'Verso da Carta')}>
                    {licenseBack ? <Image source={{ uri: licenseBack }} style={styles.previewImg} /> : <><Ionicons name="document-text-outline" size={24} color={theme.colors.primaryDark} /><Text style={styles.photoBoxText}>Carta (Verso)</Text></>}
                  </TouchableOpacity>
                </View>

                <Text style={styles.inputLabel}>Número de Telefone</Text>
                <View style={styles.inputPhoneContainer}>
                  <View style={styles.prefixBadge}>
                    <Text style={styles.prefixText}>🇬🇼 +245</Text>
                  </View>
                  <TextInput style={styles.inputPhoneFlex} placeholder="Ex: 955800991" placeholderTextColor={theme.colors.textLight} value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={9} />
                </View>

                <Text style={styles.inputLabel}>Crie uma Senha Segura</Text>
                <TextInput style={styles.input} placeholder="Sua senha" placeholderTextColor={theme.colors.textLight} value={password} onChangeText={setPassword} secureTextEntry />

                <View style={styles.privacyContainer}>
                  <TouchableOpacity 
                    style={[styles.checkbox, privacyAccepted && styles.checkboxActive]} 
                    onPress={() => setPrivacyAccepted(!privacyAccepted)}
                  >
                    {privacyAccepted && <Feather name="check" size={14} color="#FFF" />}
                  </TouchableOpacity>
                  <Text style={styles.privacyText}>
                    Eu li e concordo com as{' '}
                    <Text style={styles.privacyLink} onPress={() => setPrivacyModalVisible(true)}>
                      Políticas de Privacidade
                    </Text>
                  </Text>
                </View>

                <TouchableOpacity style={[styles.primaryBtn, sendingOtp && { opacity: 0.7 }]} onPress={handleNextStep} disabled={sendingOtp}>
                  {sendingOtp ? <ActivityIndicator color="#0F2537" /> : (
                    <>
                      <Text style={styles.primaryBtnText}>Receber Código SMS 📩</Text>
                      <Feather name="arrow-right" size={18} color="#0F2537" />
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity style={styles.secondaryBtn} onPress={() => setStep(2)}>
                  <Text style={styles.secondaryBtnText}>Voltar</Text>
                </TouchableOpacity>
              </>
            )}

            {step === 4 && (
              <>
                <Text style={styles.sectionTitle}>4. Verificação por SMS</Text>
                <Text style={styles.otpSubtitle}>
                  Enviamos um código de verificação de 6 dígitos para o número{' '}
                  <Text style={{ fontWeight: '800', color: theme.colors.textPrimary }}>+245 {phone}</Text>
                </Text>

                <Text style={styles.inputLabel}>Código de 6 dígitos</Text>
                <TextInput 
                  style={styles.otpInput} 
                  placeholder="000000" 
                  placeholderTextColor={theme.colors.textLight} 
                  value={otpCode} 
                  onChangeText={setOtpCode} 
                  keyboardType="number-pad" 
                  maxLength={6} 
                />

                <TouchableOpacity 
                  style={[styles.resendBtn, !canResend && { opacity: 0.5 }]} 
                  onPress={handleSendOtp} 
                  disabled={!canResend}
                >
                  <Text style={styles.resendText}>
                    {canResend ? '🔄 Reenviar Código SMS' : `Aguarde ${resendTimer}s para reenviar`}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity style={[styles.primaryBtn, loading && { opacity: 0.7 }]} onPress={handleRegister} disabled={loading}>
                  {loading ? <ActivityIndicator color="#0F2537" /> : <Text style={styles.primaryBtnText}>Finalizar Cadastro ✅</Text>}
                </TouchableOpacity>

                <TouchableOpacity style={styles.secondaryBtn} onPress={() => setStep(3)}>
                  <Text style={styles.secondaryBtnText}>Voltar e Alterar Dados</Text>
                </TouchableOpacity>
              </>
            )}

            <TouchableOpacity style={styles.loginLink} onPress={() => navigation.navigate('Login')}>
              <Text style={styles.loginText}>Já possui conta? <Text style={styles.loginTextBold}>Faça Login</Text></Text>
            </TouchableOpacity>

          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <PrivacyPolicyModal visible={isPrivacyModalVisible} onClose={() => setPrivacyModalVisible(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.primaryDark },
  scrollContainer: { 
    flexGrow: 1, 
    padding: 20, 
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 30) + 10 : 30,
    paddingBottom: 30 
  },
  heroHeader: { alignItems: 'center', marginBottom: 20 },
  appTitle: { fontSize: 26, fontWeight: '900', color: '#FFF' },
  appSubtitle: { fontSize: 13, color: '#94A3B8', marginTop: 2, fontWeight: '600' },
  formCard: { 
    backgroundColor: theme.colors.surfaceWhite, 
    padding: 22, 
    borderRadius: theme.borderRadius.xl, 
    ...theme.shadows.floating 
  },
  progressContainer: { marginBottom: 20 },
  progressBarBg: { height: 6, backgroundColor: '#E2E8F0', borderRadius: 3, overflow: 'hidden', marginBottom: 6 },
  progressBarFill: { height: '100%', backgroundColor: theme.colors.accentOrange },
  stepText: { fontSize: 12, color: theme.colors.textSecondary, fontWeight: '700', textAlign: 'right' },
  sectionTitle: { fontSize: 17, fontWeight: '900', color: theme.colors.textPrimary, marginBottom: 16 },
  otpSubtitle: { fontSize: 13, color: theme.colors.textSecondary, marginBottom: 16, lineHeight: 18 },
  inputLabel: { fontSize: 13, fontWeight: '700', color: theme.colors.textPrimary, marginBottom: 6 },
  typeScroll: { flexDirection: 'row', marginBottom: 16 },
  typeBadge: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F1F5F9', marginRight: 8, borderWidth: 1, borderColor: theme.colors.border },
  typeBadgeActive: { backgroundColor: theme.colors.primaryDark, borderColor: theme.colors.primaryDark },
  typeBadgeText: { fontSize: 12, fontWeight: '700', color: theme.colors.textSecondary },
  typeBadgeTextActive: { color: '#FFF' },
  docTypeContainer: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  docTypeButton: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: theme.colors.border, alignItems: 'center' },
  docTypeText: { fontSize: 12, fontWeight: '700', color: theme.colors.textSecondary },
  input: { backgroundColor: '#F8FAFC', borderWidth: 1.5, borderColor: theme.colors.border, borderRadius: theme.borderRadius.md, paddingHorizontal: 14, height: 50, fontSize: 14, fontWeight: '600', color: theme.colors.textPrimary, marginBottom: 14 },
  otpInput: { backgroundColor: '#F8FAFC', borderWidth: 2, borderColor: theme.colors.accentOrange, borderRadius: theme.borderRadius.md, textAlign: 'center', height: 56, fontSize: 24, fontWeight: '900', letterSpacing: 8, color: theme.colors.textPrimary, marginBottom: 14 },
  resendBtn: { alignItems: 'center', marginBottom: 14, paddingVertical: 8 },
  resendText: { fontSize: 13, fontWeight: '800', color: theme.colors.primaryBlue },
  row: { flexDirection: 'row' },
  inputPhoneContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8FAFC', borderWidth: 1.5, borderColor: theme.colors.border, borderRadius: theme.borderRadius.md, marginBottom: 14, paddingHorizontal: 12, height: 50 },
  prefixBadge: { backgroundColor: '#E2E8F0', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, marginRight: 8 },
  prefixText: { fontSize: 13, fontWeight: '800', color: theme.colors.textPrimary },
  inputPhoneFlex: { flex: 1, fontSize: 14, fontWeight: '600', color: theme.colors.textPrimary, height: '100%' },
  photoGrid: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  photoBox: { flex: 1, height: 90, backgroundColor: '#F8FAFC', borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#CBD5E1', borderRadius: theme.borderRadius.md, justifyContent: 'center', alignItems: 'center' },
  photoBoxSuccess: { borderStyle: 'solid', borderColor: theme.colors.emeraldGreen, backgroundColor: '#ECFDF5' },
  photoBoxText: { fontSize: 11, color: theme.colors.textPrimary, fontWeight: '700', marginTop: 4 },
  previewImg: { width: '100%', height: '100%', borderRadius: theme.borderRadius.md, resizeMode: 'cover' },
  privacyContainer: { flexDirection: 'row', alignItems: 'center', marginVertical: 14 },
  checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: '#CBD5E1', alignItems: 'center', justifyContent: 'center', marginRight: 8, backgroundColor: '#F8FAFC' },
  checkboxActive: { backgroundColor: theme.colors.emeraldGreen, borderColor: theme.colors.emeraldGreen },
  privacyText: { fontSize: 13, color: theme.colors.textSecondary, flex: 1 },
  privacyLink: { color: theme.colors.primaryBlue, fontWeight: '800', textDecorationLine: 'underline' },
  primaryBtn: { 
    flexDirection: 'row', 
    backgroundColor: theme.colors.accentYellow, 
    height: 52, 
    borderRadius: theme.borderRadius.md, 
    justifyContent: 'center', 
    alignItems: 'center', 
    gap: 8,
    marginTop: 8,
    shadowColor: theme.colors.accentYellow, 
    shadowOffset: { width: 0, height: 4 }, 
    shadowOpacity: 0.3, 
    shadowRadius: 8, 
    elevation: 4 
  },
  primaryBtnText: { color: '#0F2537', fontSize: 15, fontWeight: '900', textTransform: 'uppercase' },
  secondaryBtn: { height: 44, justifyContent: 'center', alignItems: 'center', marginTop: 4 },
  secondaryBtnText: { color: theme.colors.textSecondary, fontSize: 14, fontWeight: '700' },
  loginLink: { marginTop: 20, alignItems: 'center' },
  loginText: { color: theme.colors.textSecondary, fontSize: 13 },
  loginTextBold: { color: theme.colors.accentOrange, fontWeight: '800' },
});