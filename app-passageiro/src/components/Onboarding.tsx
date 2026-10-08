import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Switch, Alert } from 'react-native';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { PrivacyPolicyModal } from '../components/PrivacyPolicyModal';

interface OnboardingProps {
  onComplete: () => void;
}

export function Onboarding({ onComplete }: OnboardingProps) {
  const { t } = useTranslation();
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);

  async function handleAcceptAndRequestPermission() {
    if (!termsAccepted) {
      Alert.alert(
        t('warning_title', 'Aviso'), 
        t('accept_terms_warning', 'Por favor, aceite os Termos de Uso e Política de Privacidade para continuar.')
      );
      return;
    }

    const { status: foregroundStatus } = await Location.requestForegroundPermissionsAsync();
    
    if (foregroundStatus === 'granted') {
      await Location.requestBackgroundPermissionsAsync();
    }

    await AsyncStorage.setItem('@bai245:onboarding_complete', 'true');
    onComplete();
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('welcome_title', 'Bem-vindo ao Nobai245')}</Text>
      
      <View style={styles.disclosureBox}>
        <Text style={styles.disclosureText}>
          <Text style={styles.bold}>{t('gps_usage_title', 'Uso de Localização e GPS:')}</Text>{' '}
          {t('gps_disclosure_desc_1', 'Este aplicativo coleta dados de localização precisa para permitir o rastreamento de viagens, calcular rotas corretas, conectar você aos motoristas mais próximos e permitir o compartilhamento de rota com contatos de emergência,')}{' '}
          <Text style={styles.bold}>
            {t('gps_disclosure_desc_2', 'mesmo quando o aplicativo está fechado ou em segundo plano.')}
          </Text>
        </Text>
      </View>

      <View style={styles.termsContainer}>
        <Switch 
          value={termsAccepted} 
          onValueChange={setTermsAccepted}
          trackColor={{ false: '#CBD5E1', true: '#EAB308' }} 
        />
        <TouchableOpacity onPress={() => setModalVisible(true)} style={styles.termsTextContainer}>
          <Text style={styles.termsText}>
            {t('read_and_agree', 'Li e concordo com os')}{' '}
            <Text style={styles.linkText}>{t('terms_and_privacy_link', 'Termos de Uso e a Política de Privacidade')}</Text>.
          </Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity 
        style={[styles.button, !termsAccepted && styles.buttonDisabled]} 
        onPress={handleAcceptAndRequestPermission}
        activeOpacity={0.8}
      >
        <Text style={styles.buttonText}>{t('accept_and_continue_btn', 'Aceitar e Continuar')}</Text>
      </TouchableOpacity>

      <PrivacyPolicyModal 
        visible={modalVisible} 
        onClose={() => setModalVisible(false)} 
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: '#F8FAFC', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '700', color: '#0F172A', marginBottom: 24, textAlign: 'center' },
  disclosureBox: { backgroundColor: '#EFF6FF', padding: 16, borderRadius: 12, marginBottom: 24, borderWidth: 1, borderColor: '#BFDBFE' },
  disclosureText: { fontSize: 14, color: '#334155', lineHeight: 22 },
  bold: { fontWeight: '700', color: '#0F172A' },
  termsContainer: { flexDirection: 'row', alignItems: 'center', marginBottom: 32, paddingRight: 24 },
  termsTextContainer: { flex: 1, marginLeft: 12 },
  termsText: { fontSize: 14, color: '#475569', lineHeight: 20 },
  linkText: { color: '#2563EB', fontWeight: '600', textDecorationLine: 'underline' },
  button: { backgroundColor: '#EAB308', padding: 16, borderRadius: 12, alignItems: 'center' },
  buttonDisabled: { backgroundColor: '#94A3B8' },
  buttonText: { color: '#1A202C', fontWeight: '700', fontSize: 16 }
});