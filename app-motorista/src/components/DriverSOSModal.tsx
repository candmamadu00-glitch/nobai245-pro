import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Alert,
  ActivityIndicator,
  Linking,
  Platform,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { api } from '../services/api';
import { useAudioRecorder } from '../hooks/useAudioRecorder';

interface DriverSOSModalProps {
  visible: boolean;
  onClose: () => void;
  currentRideId?: string | null;
}

export function DriverSOSModal({ visible, onClose, currentRideId }: DriverSOSModalProps) {
  const [loading, setLoading] = useState(false);
  const { isRecording, startRecording, stopRecording } = useAudioRecorder();

  // Função genérica para efetuar chamadas telefónicas
  const handleMakeCall = (phoneNumber: string, label: string) => {
    const cleanNumber = phoneNumber.replace(/\s+/g, '');
    Linking.openURL(`tel:${cleanNumber}`).catch(() => {
      Alert.alert('Erro', `Não foi possível abrir o discador para ${label}.`);
    });
  };

  const handleTriggerSOS = async () => {
    if (loading) return;
    setLoading(true);

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permissão Negada', 'A localização é necessária para disparar o alerta de emergência.');
        setLoading(false);
        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      // Disparo imediato do alerta com coordenadas GPS
      await api.post('/drivers/sos', {
        rideId: currentRideId ? String(currentRideId) : null,
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      });

      // Gravação e envio assíncrono de áudio
      await startRecording();

      setTimeout(async () => {
        try {
          const audioBase64 = await stopRecording();
          if (audioBase64) {
            await api.post('/drivers/sos', {
              rideId: currentRideId ? String(currentRideId) : null,
              latitude: location.coords.latitude,
              longitude: location.coords.longitude,
              audioBase64,
            });
          }
        } catch (err) {
          console.error('⚠️ [SOS AUDIO BACKUP ERR]:', err);
        }
      }, 15000);

      Alert.alert(
        '🚨 Alerta Disparado!',
        'Sua localização e gravação de emergência foram enviadas para a central de monitoramento em tempo real.'
      );
      onClose();
    } catch (error: any) {
      console.error('Erro SOS Driver:', error);
      Alert.alert(
        'Erro no SOS',
        'Não foi possível enviar o alerta via rede. Ligue imediatamente para a Central Administrativa (+245 955 219 149) ou Polícia (112).'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            <View style={styles.iconContainer}>
              <Ionicons name="shield-checkmark" size={38} color="#DC2626" />
            </View>

            <Text style={styles.title}>Central de Segurança do Motorista</Text>
            <Text style={styles.subtitle}>
              Em situações de risco ou emergência, acione o botão abaixo para notificar a central com áudio e GPS ao vivo.
            </Text>

            {/* BOTÃO PRINCIPAL DE SOS */}
            <TouchableOpacity
              style={[styles.sosBtn, loading && styles.disabledBtn]}
              onPress={handleTriggerSOS}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <>
                  <Ionicons name="radio" size={22} color="#FFF" />
                  <Text style={styles.sosBtnText}>
                    {isRecording ? 'Gravando e Enviando...' : 'Disparar SOS com Áudio'}
                  </Text>
                </>
              )}
            </TouchableOpacity>

            <Text style={styles.sectionHeader}>DISCAGEM RÁPIDA DE EMERGÊNCIA</Text>

            {/* CENTRAL ADMINISTRATIVA BAI 245 */}
            <TouchableOpacity
              style={[styles.callBtn, styles.adminCallBtn]}
              onPress={() => handleMakeCall('+245955219149', 'Central Administrativa')}
            >
              <Ionicons name="headset" size={20} color="#FFF" />
              <Text style={styles.adminCallBtnText}>Central Administ. (+245 955 219 149)</Text>
            </TouchableOpacity>

            {/* POLÍCIA */}
            <TouchableOpacity
              style={styles.callBtn}
              onPress={() => handleMakeCall('112', 'Polícia')}
            >
              <Ionicons name="call" size={20} color="#1F2937" />
              <Text style={styles.callBtnText}>Polícia Nacional (112)</Text>
            </TouchableOpacity>

            {/* BOMBEIROS */}
            <TouchableOpacity
              style={styles.callBtn}
              onPress={() => handleMakeCall('1313', 'Bombeiros')}
            >
              <Ionicons name="flame" size={20} color="#DC2626" />
              <Text style={styles.fireBtnText}>Bombeiros (1313)</Text>
            </TouchableOpacity>

            {/* SAÚDE / AMBULÂNCIA */}
            <TouchableOpacity
              style={styles.callBtn}
              onPress={() => handleMakeCall('1919', 'Emergência Médica')}
            >
              <Ionicons name="medkit" size={20} color="#059669" />
              <Text style={styles.healthBtnText}>Emergência Médica / Saúde (1919)</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.closeBtn} onPress={onClose} disabled={loading}>
              <Text style={styles.closeBtnText}>Cancelar / Fechar</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(17, 24, 39, 0.82)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  card: {
    width: '100%',
    maxHeight: '90%',
    backgroundColor: '#FFF',
    borderRadius: 20,
    padding: 20,
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.15, shadowRadius: 12 },
      android: { elevation: 8 },
    }),
  },
  scrollContent: {
    alignItems: 'center',
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#FEE2E2',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: { fontSize: 18, fontWeight: 'bold', color: '#111827', textAlign: 'center' },
  subtitle: { fontSize: 12, color: '#4B5563', textAlign: 'center', marginTop: 6, marginBottom: 16, lineHeight: 17 },
  sosBtn: {
    width: '100%',
    height: 50,
    backgroundColor: '#DC2626',
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 16,
  },
  disabledBtn: { opacity: 0.7 },
  sosBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 15 },
  sectionHeader: {
    alignSelf: 'flex-start',
    fontSize: 11,
    fontWeight: '700',
    color: '#6B7280',
    letterSpacing: 0.5,
    marginBottom: 10,
    marginTop: 4,
  },
  callBtn: {
    width: '100%',
    height: 48,
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 8,
  },
  adminCallBtn: {
    backgroundColor: '#059669',
  },
  adminCallBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 14 },
  callBtnText: { color: '#1F2937', fontWeight: 'bold', fontSize: 14 },
  fireBtnText: { color: '#DC2626', fontWeight: 'bold', fontSize: 14 },
  healthBtnText: { color: '#059669', fontWeight: 'bold', fontSize: 14 },
  closeBtn: { paddingVertical: 12, marginTop: 8 },
  closeBtnText: { color: '#6B7280', fontWeight: '600', fontSize: 14 },
});