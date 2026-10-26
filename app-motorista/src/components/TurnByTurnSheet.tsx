import React from 'react';
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
  isIntermediateStop?: boolean; // Identifica se é uma parada extra
  onConfirmStop?: () => void;   // Ação para pular para o próximo destino
}

export function TurnByTurnSheet({ visible, onClose, destination, isIntermediateStop, onConfirmStop }: TurnByTurnSheetProps) {
  if (!destination) return null;

  const handleNavigate = async (app: NavigationApp) => {
    onClose();
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
        <View style={styles.sheetContainer}>
          <View style={styles.dragIndicator} />

          <View style={styles.headerRow}>
            <View>
              <Text style={styles.title}>
                {isIntermediateStop ? 'Próxima Parada' : 'Navegação para o Destino'}
              </Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {destination.title}: {destination.address || 'Localização selecionada'}
              </Text>
            </View>
            {isIntermediateStop && (
              <View style={styles.stopBadge}>
                <Text style={styles.stopBadgeText}>Parada 1</Text>
              </View>
            )}
          </View>

          <View style={styles.optionsContainer}>
            {/* ... (Botões originais do Google Maps, Waze, Apple Maps permanecem iguais) ... */}
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
              <Text style={styles.cancelText}>Fechar Opções</Text>
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
  subtitle: { fontSize: 14, color: '#64748B', marginTop: 4 },
  optionsContainer: { marginVertical: 16 },
  cancelButton: { backgroundColor: '#F1F5F9', paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  cancelText: { color: '#0F172A', fontWeight: '700' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  stopBadge: { backgroundColor: '#DBEAFE', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  stopBadgeText: { color: '#1E40AF', fontSize: 12, fontWeight: '700' },
  confirmStopButton: { backgroundColor: '#10B981', paddingVertical: 12, borderRadius: 10, alignItems: 'center', marginTop: 12 },
  confirmStopText: { color: '#FFF', fontWeight: '700' },
});