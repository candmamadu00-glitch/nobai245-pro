import React, { useState } from 'react';
import { 
  View, Text, TouchableOpacity, StyleSheet, Switch, Alert, 
  ScrollView, Platform, StatusBar 
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { PrivacyPolicyModal } from '../components/PrivacyPolicyModal';

interface OnboardingProps {
  onComplete: () => void;
}

export function Onboarding({ onComplete }: OnboardingProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
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

    try {
      const { status: foregroundStatus } = await Location.requestForegroundPermissionsAsync();
      
      if (foregroundStatus === 'granted') {
        await Location.requestBackgroundPermissionsAsync().catch(() => {});
      }

      await AsyncStorage.setItem('@bai245:onboarding_complete', 'true');
      onComplete();
    } catch (error) {
      console.warn('Erro durante o processo de onboarding:', error);
      onComplete();
    }
  }

  // Recuos seguros para topo e rodapé (Android e iOS)
  const dynamicTopPadding = Math.max((insets?.top || 0) + 16, Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 12 : 20);
  const dynamicBottomPadding = Math.max((insets?.bottom || 0) + 20, Platform.OS === 'android' ? 28 : 20);

  return (
    <View style={styles.screenContainer}>
      <StatusBar barStyle="dark-content" backgroundColor="#F8FAFC" translucent />

      <ScrollView 
        contentContainerStyle={[
          styles.scrollContent, 
          { paddingTop: dynamicTopPadding, paddingBottom: dynamicBottomPadding }
        ]}
        showsVerticalScrollIndicator={false}
      >
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
          <TouchableOpacity onPress={() => setModalVisible(true)} style={styles.termsTextContainer} activeOpacity={0.7}>
            <Text style={styles.termsText}>
              {t('read_and_agree', 'Li e concordo com os')}{' '}
              <Text style={styles.linkText}>{t('terms_and_privacy_link', 'Termos de Uso e a Política de Privacidade')}</Text>.
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity 
          style={[styles.button, !termsAccepted && styles.buttonDisabled]} 
          onPress={handleAcceptAndRequestPermission}
          activeOpacity={0.85}
        >
          <Text style={styles.buttonText}>{t('accept_and_continue_btn', 'Aceitar e Continuar')}</Text>
        </TouchableOpacity>
      </ScrollView>

      <PrivacyPolicyModal 
        visible={modalVisible} 
        onClose={() => setModalVisible(false)} 
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screenContainer: { flex: 1, backgroundColor: '#F8FAFC' },
  scrollContent: { flexGrow: 1, paddingHorizontal: 24, justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '800', color: '#0F172A', marginBottom: 24, textAlign: 'center' },
  disclosureBox: { backgroundColor: '#EFF6FF', padding: 16, borderRadius: 14, marginBottom: 24, borderWidth: 1, borderColor: '#BFDBFE' },
  disclosureText: { fontSize: 14, color: '#334155', lineHeight: 22 },
  bold: { fontWeight: '800', color: '#0F172A' },
  termsContainer: { flexDirection: 'row', alignItems: 'center', marginBottom: 28 },
  termsTextContainer: { flex: 1, marginLeft: 12 },
  termsText: { fontSize: 13, color: '#475569', lineHeight: 18 },
  linkText: { color: '#2563EB', fontWeight: '700', textDecorationLine: 'underline' },
  button: { backgroundColor: '#EAB308', paddingVertical: 16, borderRadius: 14, alignItems: 'center' },
  buttonDisabled: { backgroundColor: '#CBD5E1' },
  buttonText: { color: '#0F172A', fontWeight: '800', fontSize: 16 }
});