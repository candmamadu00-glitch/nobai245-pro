import React, { useState, useEffect } from 'react';
import { 
  View, Text, StyleSheet, TouchableOpacity, 
  ScrollView, Platform, StatusBar, Alert 
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import { Ionicons } from '@expo/vector-icons';
import { useBilingualVoice } from '../hooks/useBilingualVoice';

export const STORAGE_VOICE_MODE_KEY = '@nobai245:driver_voice_mode';
export type VoiceMode = 'BOTH' | 'CRI' | 'PT' | 'OFF';

// 🏎️ Mapeamento do ícone/imagem do veículo por tipo e cor (.jpg)
function getVehicle3DIconAsset(vehicleType?: string, vehicleColor?: string) {
  const type = (vehicleType || 'PARTICULAR').toUpperCase().trim();
  const color = (vehicleColor || 'BRANCO').toUpperCase().trim();

  // 1. Tipos de Veículos Especiais
  if (type === 'MOTO') {
    return require('../../assets/images/vehicles/moto.jpg');
  }
  if (type === 'TOCA_TOCA' || type === 'VAN') {
    return require('../../assets/images/vehicles/toca_toca.jpg');
  }
  if (type === 'TAXI') {
    return require('../../assets/images/vehicles/taxi_yellow.jpg');
  }

  // 2. Carros Particulares / Aluguel mapeados por Cor
  switch (color) {
    case 'BLACK':
    case 'PRETO':
      return require('../../assets/images/vehicles/car_black.jpg');

    case 'BLUE':
    case 'AZUL':
      return require('../../assets/images/vehicles/car_blue.jpg');

    case 'RED':
    case 'VERMELHO':
      return require('../../assets/images/vehicles/car_red.jpg');

    case 'ORANGE':
    case 'LARANJA':
      return require('../../assets/images/vehicles/car_orange.jpg');

    case 'GREEN':
    case 'VERDE':
      return require('../../assets/images/vehicles/car_green.jpg');

    case 'GRAY':
    case 'SILVER':
    case 'CINZA':
    case 'PRATA':
      return require('../../assets/images/vehicles/car_gray.jpg');

    case 'BROWN':
    case 'CASTANHO':
    case 'MARROM':
      return require('../../assets/images/vehicles/car_brown.jpg');

    case 'YELLOW':
    case 'AMARELO':
      return require('../../assets/images/vehicles/car_yellow.jpg');

    case 'WHITE':
    case 'BRANCO':
    default:
      return require('../../assets/images/vehicles/car_white.jpg');
  }
}
export function VehicleSettings() {
  const navigation = useNavigation<any>();
  const { driver } = useAuth();
  const insets = useSafeAreaInsets();
  const { speakInstruction } = useBilingualVoice();

  const [voiceMode, setVoiceMode] = useState<VoiceMode>('BOTH');

  useEffect(() => {
    async function loadVoicePreference() {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_VOICE_MODE_KEY);
        if (saved) setVoiceMode(saved as VoiceMode);
      } catch (err) {
        console.error('Erro ao carregar preferência de voz:', err);
      }
    }
    loadVoicePreference();
  }, []);

  const handleSelectVoiceMode = async (mode: VoiceMode) => {
    try {
      setVoiceMode(mode);
      await AsyncStorage.setItem(STORAGE_VOICE_MODE_KEY, mode);
      console.log(`✅ [CONFIG] Modo de voz alterado para: ${mode}`);
    } catch (err) {
      Alert.alert('Erro', 'Não foi possível guardar a preferência de voz.');
    }
  };

  const handleTestVoice = (modeToTest: VoiceMode) => {
    console.log(`🧪 [TESTE VOZ] Testando modo: ${modeToTest}`);
    speakInstruction('new_ride', 'Nova viagem encontrada', modeToTest);
  };

  const dynamicTopPadding = Math.max((insets?.top || 0) + 6, Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 6 : 14);
  const dynamicBottomPadding = Math.max((insets?.bottom || 0) + 16, Platform.OS === 'android' ? 28 : 16);

  const voiceOptions: { key: VoiceMode; label: string; sub: string }[] = [
    { key: 'BOTH', label: 'Português + Crioulo (Padrão)', sub: 'Instrução em Português seguida de Crioulo' },
    { key: 'CRI', label: 'Apenas Crioulo', sub: 'Instruções exclusivamente em Crioulo de Bissau' },
    { key: 'PT', label: 'Apenas Português', sub: 'Instruções no padrão em Português' },
    { key: 'OFF', label: 'Desativado', sub: 'Sem orientação por voz durante a navegação' },
  ];

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFF" translucent />

      {/* HEADER */}
      <View style={[styles.header, { paddingTop: dynamicTopPadding }]}>
        <TouchableOpacity 
          onPress={() => navigation.goBack()} 
          style={styles.backButton}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="arrow-back" size={24} color="#059669" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Configurações do Motorista</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView 
        contentContainerStyle={[
          styles.content, 
          { paddingBottom: dynamicBottomPadding + 20 }
        ]} 
        showsVerticalScrollIndicator={false}
      >
        {/* CARD ORIENTAÇÃO POR VOZ */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.iconBox}>
              <Ionicons name="volume-high" size={22} color="#059669" />
            </View>
            <Text style={styles.cardTitle}>Orientação por Voz</Text>
          </View>

          <Text style={styles.cardSubtitle}>
            Escolha como prefere ouvir os avisos de navegação e novas corridas:
          </Text>

          {voiceOptions.map((opt) => {
            const isSelected = voiceMode === opt.key;
            return (
              <View key={opt.key} style={[styles.voiceOptionCard, isSelected && styles.voiceOptionCardSelected]}>
                <TouchableOpacity
                  style={styles.touchArea}
                  onPress={() => handleSelectVoiceMode(opt.key)}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name={isSelected ? 'radio-button-on' : 'radio-button-off'}
                    size={22}
                    color={isSelected ? '#059669' : '#9CA3AF'}
                  />
                  <View style={styles.textContainer}>
                    <Text style={[styles.optionLabel, isSelected && styles.optionLabelSelected]}>
                      {opt.label}
                    </Text>
                    <Text style={styles.optionSub}>{opt.sub}</Text>
                  </View>
                </TouchableOpacity>

                {/* BOTÃO DE TESTAR VOZ */}
                {opt.key !== 'OFF' && (
                  <TouchableOpacity
                    style={styles.testBtn}
                    onPress={() => handleTestVoice(opt.key)}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="play-circle" size={18} color="#059669" />
                    <Text style={styles.testBtnText}>Testar</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
        </View>

        {/* CARD DADOS DO VEÍCULO */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.iconBox}>
              <Ionicons name="car" size={22} color="#059669" />
            </View>
            <Text style={styles.cardTitle}>Dados do Veículo</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.label}>Marca / Modelo</Text>
            <Text style={styles.value}>{(driver as any)?.vehicleBrand || 'Não informado'}</Text>
          </View>

          <View style={styles.infoRow}>
            <Text style={styles.label}>Cor do Veículo</Text>
            <Text style={styles.value}>{(driver as any)?.vehicleColor || 'Não informada'}</Text>
          </View>

          <View style={[styles.infoRow, { borderBottomWidth: 0, paddingBottom: 0 }]}>
            <Text style={styles.label}>Placa Cadastrada</Text>
            <Text style={styles.plateBadge}>{driver?.vehiclePlate || 'N/A'}</Text>
          </View>
        </View>

        {/* CARD DOCUMENTAÇÃO */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View style={styles.iconBox}>
              <Ionicons name="document-text" size={22} color="#059669" />
            </View>
            <Text style={styles.cardTitle}>Documentação</Text>
          </View>

          <View style={[styles.infoRow, { borderBottomWidth: 0, paddingBottom: 0 }]}>
            <Text style={styles.label}>Nº do Documento</Text>
            <Text style={styles.value}>{(driver as any)?.documentNumber || 'Não informado'}</Text>
          </View>

          <View style={styles.statusBox}>
            <Ionicons name="checkmark-circle" size={20} color="#059669" />
            <Text style={styles.statusText}>Documentos verificados e aprovados pela central.</Text>
          </View>
        </View>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F4F4F5' },
  header: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between', 
    paddingHorizontal: 16, 
    paddingBottom: 14, 
    backgroundColor: '#FFF', 
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    elevation: 2 
  },
  backButton: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#1F2937' },
  content: { padding: 16 },
  card: { 
    backgroundColor: '#FFF', 
    padding: 20, 
    borderRadius: 16, 
    marginBottom: 16, 
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  cardSubtitle: { fontSize: 12, color: '#6B7280', marginBottom: 14 },
  iconBox: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#ECFDF5', justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  cardTitle: { fontSize: 16, fontWeight: '800', color: '#111827' },
  voiceOptionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#F9FAFB',
    padding: 12,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  voiceOptionCardSelected: {
    borderColor: '#059669',
    backgroundColor: '#ECFDF5',
  },
  touchArea: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  textContainer: { marginLeft: 10, flex: 1 },
  optionLabel: { color: '#374151', fontSize: 13, fontWeight: '600' },
  optionLabelSelected: { color: '#065F46', fontWeight: '800' },
  optionSub: { color: '#6B7280', fontSize: 11, marginTop: 2 },
  testBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#059669',
    gap: 4,
  },
  testBtnText: { fontSize: 11, fontWeight: '700', color: '#059669' },
  infoRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F3F4F6', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 13, color: '#6B7280', fontWeight: '600' },
  value: { fontSize: 14, color: '#111827', fontWeight: '700' },
  plateBadge: { backgroundColor: '#111827', color: '#FFF', fontWeight: '800', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, fontSize: 13 },
  statusBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#ECFDF5', padding: 12, borderRadius: 10, marginTop: 14, gap: 8 },
  statusText: { fontSize: 12, color: '#065F46', fontWeight: '700', flex: 1 },
});