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
  Platform
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useTranslation } from 'react-i18next';
import { api } from '../services/api';

interface SOSModalProps {
  visible: boolean;
  onClose: () => void;
  currentRideId?: string;
}

export function SOSModal({ visible, onClose, currentRideId }: SOSModalProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  const handleCallEmergency = () => {
    Linking.openURL('tel:112').catch(() => {
      Alert.alert(t('error_title', 'Erro'), t('cant_open_dialer', 'Não foi possível abrir o discador nativo.'));
    });
  };

  const handleSendLocationAlert = async () => {
    if (loading) return;
    
    setLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          t('permission_denied_title', 'Permissão Negada'), 
          t('sos_location_permission_msg', 'Precisamos da permissão de localização para disparar o SOS com precisão.')
        );
        setLoading(false);
        return;
      }

      // Utiliza precisão balanceada para não demorar demais na obtenção em casos de emergência
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const lat = Number(location.coords.latitude);
      const lng = Number(location.coords.longitude);

      if (isNaN(lat) || isNaN(lng)) {
        throw new Error(t('invalid_coords_captured', 'Coordenadas inválidas capturadas pelo dispositivo.'));
      }

      await api.post('/passengers/sos', {
        rideId: currentRideId ? String(currentRideId) : null,
        latitude: lat,
        longitude: lng,
        timestamp: new Date().toISOString(),
      });

      Alert.alert(
        t('alert_triggered_title', 'Alerta Disparado!'),
        t('alert_triggered_msg', 'Sua localização atual foi enviada para a central de segurança e contatos de emergência.')
      );
      onClose();
    } catch (error: any) {
      console.error('SOS Error:', error);
      Alert.alert(
        t('alert_error_title', 'Erro no Alerta'), 
        t('alert_network_error_msg', 'Não foi possível disparar o SOS via rede. Ligue imediatamente para o 112.')
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal 
      visible={visible} 
      transparent 
      animationType="fade" 
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={styles.content}>
          <View style={styles.iconBadge}>
            <Ionicons name="warning" size={36} color="#EF4444" />
          </View>

          <Text style={styles.title}>{t('sos_center_title', 'Central de Emergência SOS')}</Text>
          <Text style={styles.description}>
            {t('sos_center_desc', 'Se você estiver em perigo, utilize uma das opções abaixo para obter ajuda imediata.')}
          </Text>

          <TouchableOpacity 
            style={[styles.button, styles.sosButton, loading && styles.buttonDisabled]} 
            onPress={handleSendLocationAlert}
            disabled={loading}
            activeOpacity={0.8}
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <Ionicons name="location" size={22} color="#FFFFFF" />
                <Text style={styles.buttonTextBold}>{t('send_my_location_btn', 'Enviar Minha Localização')}</Text>
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.button, styles.phoneButton]} 
            onPress={handleCallEmergency}
            disabled={loading}
            activeOpacity={0.7}
          >
            <Ionicons name="call" size={22} color="#0F172A" />
            <Text style={styles.buttonTextDark}>{t('call_police_btn', 'Ligar para Polícia (112)')}</Text>
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.cancelButton} 
            onPress={onClose}
            disabled={loading}
            hitSlop={{ top: 10, bottom: 10, left: 20, right: 20 }}
          >
            <Text style={styles.cancelText}>{t('cancel_alert_btn', 'Cancelar Alerta')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { 
    flex: 1, 
    backgroundColor: 'rgba(15, 23, 42, 0.75)', 
    justifyContent: 'center', 
    alignItems: 'center', 
    padding: 20 
  },
  content: { 
    width: '100%', 
    backgroundColor: '#FFFFFF', 
    borderRadius: 24, 
    padding: 28, 
    alignItems: 'center',
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.1, shadowRadius: 15 },
      android: { elevation: 10 },
    }),
  },
  iconBadge: { 
    width: 72, 
    height: 72, 
    borderRadius: 36, 
    backgroundColor: '#FEF2F2', 
    justifyContent: 'center', 
    alignItems: 'center', 
    marginBottom: 20 
  },
  title: { 
    fontSize: 22, 
    fontWeight: '800', 
    color: '#0F172A', 
    textAlign: 'center', 
    marginBottom: 10 
  },
  description: { 
    fontSize: 15, 
    color: '#475569', 
    textAlign: 'center', 
    marginBottom: 30, 
    lineHeight: 22 
  },
  button: { 
    width: '100%', 
    height: 56, 
    borderRadius: 16, 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'center', 
    gap: 10, 
    marginBottom: 14 
  },
  buttonDisabled: {
    opacity: 0.7
  },
  sosButton: { 
    backgroundColor: '#EF4444' 
  },
  phoneButton: { 
    backgroundColor: '#F1F5F9' 
  },
  buttonTextBold: { 
    color: '#FFFFFF', 
    fontSize: 16, 
    fontWeight: '700' 
  },
  buttonTextDark: { 
    color: '#0F172A', 
    fontSize: 16, 
    fontWeight: '700' 
  },
  cancelButton: { 
    marginTop: 12, 
    paddingVertical: 12 
  },
  cancelText: { 
    color: '#64748B', 
    fontSize: 15, 
    fontWeight: '600' 
  },
});