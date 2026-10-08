import React, { useState } from 'react';
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

export function Register() {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);

  // Fase 1: Veículo e Pessoal
  const [fullName, setFullName] = useState('');
  const [vehicleType, setVehicleType] = useState('TAXI'); 
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehicleColor, setVehicleColor] = useState('');
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

  // Políticas de Privacidade
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [isPrivacyModalVisible, setPrivacyModalVisible] = useState(false);

  const navigation = useNavigation<any>();

  async function pickImage(setter: (uri: string) => void, title: string) {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      return Alert.alert('Permissão', 'Precisamos de acesso à galeria para enviar os documentos.');
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.7,
    });

    if (!result.canceled && result.assets && result.assets[0]?.uri) {
      setter(result.assets[0].uri);
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
    }
  }

  async function handleRegister() {
    const cleanPhone = phone.replace(/\D/g, '');
    if (!cleanPhone || cleanPhone.length !== 9) return Alert.alert('Atenção', 'Informe um número de telefone válido com 9 dígitos.');
    if (!password) return Alert.alert('Atenção', 'Crie sua senha segura.');
    if (!selfie || !licenseFront || !licenseBack) return Alert.alert('Fotos', 'Selfie e Carta de Condução são obrigatórias.');
    if (!privacyAccepted) return Alert.alert('Atenção', 'Você deve ler e aceitar as Políticas de Privacidade.');

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('fullName', fullName.trim());
      // 🛡️ BLINDAGEM: Garantia de formato do telefone para alinhamento com o Login (+245)
      formData.append('phone', `+245${cleanPhone}`);
      formData.append('password', password);
      formData.append('vehicleBrand', vehicleModel.trim());
      formData.append('vehicleModel', vehicleModel.trim());
      formData.append('vehiclePlate', vehiclePlate.trim().toUpperCase());
      formData.append('vehicleColor', vehicleColor.trim());
      formData.append('vehicleType', vehicleType);
      
      if (vehicleType === 'TOCA_TOCA') {
        formData.append('vehicleSeats', vehicleSeats);
      }
      
      formData.append('documentType', documentType);
      formData.append('documentNumber', documentNumber.trim().toUpperCase());

      const appendImage = (key: string, uri: string) => {
        const filename = uri.split('/').pop() || `${key}.jpg`;
        formData.append(key, { uri, name: filename, type: 'image/jpeg' } as any);
      };

      appendImage('selfie', selfie);
      appendImage('licenseFront', licenseFront);
      appendImage('licenseBack', licenseBack);

      const response = await api.post('/drivers/register', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      
      Alert.alert('🎉 Bem-vindo(a)!', response.data.message || 'Cadastro enviado para aprovação.');
      navigation.navigate('Login');
    } catch (error: any) {
      Alert.alert('Erro', error.response?.data?.error || 'Falha ao registrar.');
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
                <View style={[styles.progressBarFill, { width: `${(step / 3) * 100}%` }]} />
              </View>
              <Text style={styles.stepText}>Etapa {step} de 3</Text>
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
                      onPress={() => setVehicleType(type)}
                    >
                      <Text style={[styles.typeBadgeText, vehicleType === type && styles.typeBadgeTextActive]}>
                        {type.replace('_', ' ')}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <Text style={styles.inputLabel}>Nome Completo</Text>
                <TextInput style={styles.input} placeholder="Ex: Mamadu Candé" placeholderTextColor={theme.colors.textLight} value={fullName} onChangeText={setFullName} />
                
                <Text style={styles.inputLabel}>Marca e Modelo</Text>
                <TextInput style={styles.input} placeholder="Ex: Toyota Corolla / Hiace" placeholderTextColor={theme.colors.textLight} value={vehicleModel} onChangeText={setVehicleModel} />
                
                <View style={styles.row}>
                  <View style={{ flex: 1, marginRight: 6 }}>
                    <Text style={styles.inputLabel}>Cor</Text>
                    <TextInput style={styles.input} placeholder="Ex: Azul" placeholderTextColor={theme.colors.textLight} value={vehicleColor} onChangeText={setVehicleColor} />
                  </View>
                  <View style={{ flex: 1, marginLeft: 6 }}>
                    <Text style={styles.inputLabel}>Matrícula</Text>
                    <TextInput style={styles.input} placeholder="Ex: RGB-12-34" placeholderTextColor={theme.colors.textLight} value={vehiclePlate} onChangeText={setVehiclePlate} autoCapitalize="characters" />
                  </View>
                </View>

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

                <TouchableOpacity style={[styles.primaryBtn, loading && { opacity: 0.7 }]} onPress={handleRegister} disabled={loading}>
                  {loading ? <ActivityIndicator color="#0F2537" /> : <Text style={styles.primaryBtnText}>Finalizar Cadastro ✅</Text>}
                </TouchableOpacity>

                <TouchableOpacity style={styles.secondaryBtn} onPress={() => setStep(2)}>
                  <Text style={styles.secondaryBtnText}>Voltar</Text>
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