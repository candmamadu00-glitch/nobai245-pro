import React from 'react';
import { useTranslation } from 'react-i18next';
import { View, Text, StyleSheet, TouchableOpacity, Modal, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NavigationApp, openExternalNavigation } from '../utils/navigationHelper';

interface TurnByTurnSheetProps {
  visible: boolean;
  onClose: () => void;
  destination: {
    latitude: number;
    longitude: number;
    title: string;
    address?: string;
  } | null;
  isIntermediateStop?: boolean;
  onConfirmStop?: () => void;
  onSelectExternalApp?: (app: NavigationApp) => void;
}

export function TurnByTurnSheet({
  visible,
  onClose,
  destination,
  isIntermediateStop,
  onConfirmStop,
  onSelectExternalApp,
}: TurnByTurnSheetProps) {
  const { t } = useTranslation();
  if (!destination) return null;

  const handleNavigate = async (app: NavigationApp) => {
    onClose();
    if (onSelectExternalApp) {
      onSelectExternalApp(app);
    }
    await openExternalNavigation(
      {
        latitude: destination.latitude,
        longitude: destination.longitude,
        label: destination.title,
      },
      app
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <View style={styles.sheetContainer} onStartShouldSetResponder={() => true}>
          <View style={styles.dragIndicator} />

          <View style={styles.headerRow}>
            <View style={{ flex: 1, paddingRight: 8 }}>
              <Text style={styles.title}>
                {isIntermediateStop ? 'Próxima Parada' : 'Navegação Externa Sincronizada'}
              </Text>
              <Text style={styles.subtitle} numberOfLines={2}>
                {destination.title}: {destination.address || 'Localização selecionada'}
              </Text>
            </View>
            {isIntermediateStop && (
              <View style={styles.stopBadge}>
                <Text style={styles.stopBadgeText}>Parada 1</Text>
              </View>
            )}
          </View>

          <View style={styles.syncNoticeBox}>
            <Ionicons name="sync-circle" size={16} color="#0284C7" />
            <Text style={styles.syncNoticeText}>
              Rotas alternativas no Google Maps ou Waze são sincronizadas automaticamente com o passageiro.
            </Text>
          </View>

          <View style={styles.optionsContainer}>
            <TouchableOpacity
              style={styles.navOptionBtn}
              activeOpacity={0.85}
              onPress={() => handleNavigate('google-maps')}
            >
              <View style={[styles.navIconCircle, { backgroundColor: '#DCFCE7' }]}>
                <Ionicons name="navigate" size={20} color="#16A34A" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.navOptionTitle}>Google Maps</Text>
                <Text style={styles.navOptionSub}>Navegação com trânsito e rotas alternativas</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.navOptionBtn}
              activeOpacity={0.85}
              onPress={() => handleNavigate('waze')}
            >
              <View style={[styles.navIconCircle, { backgroundColor: '#E0F2FE' }]}>
                <Ionicons name="car-sport" size={20} color="#0284C7" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.navOptionTitle}>Waze</Text>
                <Text style={styles.navOptionSub}>Alertas da via e desvios em tempo real</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
            </TouchableOpacity>

            {Platform.OS === 'ios' && (
              <TouchableOpacity
                style={styles.navOptionBtn}
                activeOpacity={0.85}
                onPress={() => handleNavigate('apple-maps')}
              >
                <View style={[styles.navIconCircle, { backgroundColor: '#F1F5F9' }]}>
                  <Ionicons name="map" size={20} color="#0F172A" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.navOptionTitle}>Apple Maps</Text>
                  <Text style={styles.navOptionSub}>Navegação nativa iOS</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
              </TouchableOpacity>
            )}
          </View>

          {isIntermediateStop ? (
            <TouchableOpacity
              style={styles.confirmStopButton}
              onPress={() => {
                if (onConfirmStop) onConfirmStop();
                onClose();
              }}
            >
              <Ionicons name="checkmark-circle" size={20} color="#FFF" style={{ marginRight: 8 }} />
              <Text style={styles.confirmStopText}>Confirmar Parada e Seguir</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
              <Text style={styles.cancelText}>{t('close_options', 'Fechar Opções')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheetContainer: { backgroundColor: '#FFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 },
  dragIndicator: { width: 40, height: 4, backgroundColor: '#CBD5E1', borderRadius: 2, alignSelf: 'center', marginBottom: 12 },
  title: { fontSize: 18, fontWeight: '800', color: '#0F172A' },
  subtitle: { fontSize: 13, color: '#64748B', marginTop: 4 },
  syncNoticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0F9FF',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 12,
    gap: 8,
  },
  syncNoticeText: { flex: 1, fontSize: 12, color: '#0369A1', fontWeight: '600' },
  optionsContainer: { marginVertical: 14, gap: 10 },
  navOptionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 14,
    padding: 12,
    gap: 12,
  },
  navIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  navOptionTitle: { fontSize: 15, fontWeight: '800', color: '#0F172A' },
  navOptionSub: { fontSize: 12, color: '#64748B', marginTop: 2 },
  cancelButton: { backgroundColor: '#F1F5F9', paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 4 },
  cancelText: { color: '#0F172A', fontWeight: '700' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 },
  stopBadge: { backgroundColor: '#DBEAFE', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  stopBadgeText: { color: '#1E40AF', fontSize: 12, fontWeight: '700' },
  confirmStopButton: { backgroundColor: '#10B981', paddingVertical: 12, borderRadius: 10, alignItems: 'center', marginTop: 12 },
  confirmStopText: { color: '#FFF', fontWeight: '700' },
});
