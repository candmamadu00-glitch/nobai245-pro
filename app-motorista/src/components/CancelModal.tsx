import React, { useState } from 'react';
import { 
  Modal, View, Text, TouchableOpacity, TextInput, StyleSheet, Alert, 
  KeyboardAvoidingView, Platform, Keyboard, TouchableWithoutFeedback 
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface CancelModalProps {
  visible: boolean;
  userType: 'PASSENGER' | 'DRIVER';
  isPenaltyApplicable?: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}

const REASONS_PASSENGER = [
  'Motorista demorando muito',
  'Mudei de ideia / Não preciso mais',
  'Endereço de partida errado',
  'Outro motivo',
];

const REASONS_DRIVER = [
  'Passageiro não apareceu no local',
  'Pneu furado / Problema no veículo',
  'Local de embarque perigoso',
  'Outro motivo',
];

export function CancelModal({ 
  visible, 
  userType, 
  isPenaltyApplicable = false, 
  onConfirm, 
  onClose 
}: CancelModalProps) {
  const insets = useSafeAreaInsets();
  const [selectedReason, setSelectedReason] = useState('');
  const [customReason, setCustomReason] = useState('');

  const reasons = userType === 'PASSENGER' ? REASONS_PASSENGER : REASONS_DRIVER;

  function resetInternalState() {
    setSelectedReason('');
    setCustomReason('');
  }

  function handleConfirm() {
    const finalReason = selectedReason === 'Outro motivo' ? customReason.trim() : selectedReason;
    
    if (selectedReason === 'Outro motivo' && !finalReason) {
      Alert.alert('Motivo Obrigatório', 'Por favor, descreva o motivo do cancelamento.');
      return;
    }
    
    if (!finalReason) return;
    onConfirm(finalReason);
    resetInternalState();
  }

  function handleClose() {
    resetInternalState();
    onClose();
  }

  // Cálculo dinâmico para garantir margem de segurança na barra inferior do Android/iOS
  const dynamicBottomPadding = Math.max((insets?.bottom || 0) + 16, Platform.OS === 'android' ? 28 : 16);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <KeyboardAvoidingView 
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.backdrop} />
        </TouchableWithoutFeedback>

        <View style={[styles.container, { paddingBottom: dynamicBottomPadding }]}>
          <Text style={styles.title}>Cancelar Corrida?</Text>
          
          {isPenaltyApplicable && userType === 'PASSENGER' && (
            <View style={styles.warningBox}>
              <Text style={styles.warningText}>
                ⚠️ Já se passaram 2 minutos ou o motorista já chegou. Será cobrada uma taxa de cancelamento de 500 XOF.
              </Text>
            </View>
          )}

          <Text style={styles.subtitle}>Selecione o motivo do cancelamento:</Text>

          {reasons.map((reason) => (
            <TouchableOpacity
              key={reason}
              style={[styles.reasonOption, selectedReason === reason && styles.reasonSelected]}
              onPress={() => setSelectedReason(reason)}
              activeOpacity={0.8}
            >
              <Text style={[styles.reasonText, selectedReason === reason && styles.reasonTextSelected]}>
                {reason}
              </Text>
            </TouchableOpacity>
          ))}

          {selectedReason === 'Outro motivo' && (
            <TextInput
              style={styles.input}
              placeholder="Descreva o motivo..."
              placeholderTextColor="#94A3B8"
              value={customReason}
              onChangeText={setCustomReason}
              multiline
              maxLength={150}
            />
          )}

          <TouchableOpacity 
            style={[styles.confirmButton, !selectedReason && styles.disabledButton]} 
            onPress={handleConfirm}
            disabled={!selectedReason}
            activeOpacity={0.85}
          >
            <Text style={styles.confirmButtonText}>Confirmar Cancelamento</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.backButton} onPress={handleClose} activeOpacity={0.7}>
            <Text style={styles.backButtonText}>Voltar e Continuar Corrida</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { 
    flex: 1, 
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
  },
  container: { 
    backgroundColor: '#FFF', 
    borderTopLeftRadius: 24, 
    borderTopRightRadius: 24, 
    paddingHorizontal: 20, 
    paddingTop: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 12,
  },
  title: { fontSize: 18, fontWeight: '900', color: '#0F172A', marginBottom: 4 },
  subtitle: { fontSize: 13, color: '#64748B', marginBottom: 14 },
  warningBox: { backgroundColor: '#FEF2F2', borderColor: '#FCA5A5', borderWidth: 1, padding: 10, borderRadius: 12, marginBottom: 12 },
  warningText: { color: '#991B1B', fontSize: 12, fontWeight: '700', lineHeight: 16 },
  reasonOption: { paddingVertical: 12, paddingHorizontal: 14, borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, marginBottom: 8, backgroundColor: '#F8FAFC' },
  reasonSelected: { backgroundColor: '#0284C7', borderColor: '#0284C7' },
  reasonText: { color: '#334155', fontSize: 13, fontWeight: '600' },
  reasonTextSelected: { color: '#FFF', fontWeight: '800' },
  input: { backgroundColor: '#F1F5F9', borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 12, padding: 12, minHeight: 48, maxHeight: 90, marginBottom: 10, fontSize: 13, color: '#0F172A' },
  confirmButton: { backgroundColor: '#EF4444', paddingVertical: 14, borderRadius: 14, alignItems: 'center', marginTop: 8 },
  disabledButton: { backgroundColor: '#CBD5E1' },
  confirmButtonText: { color: '#FFF', fontWeight: '800', fontSize: 15 },
  backButton: { paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  backButtonText: { color: '#64748B', fontWeight: '800', fontSize: 13 },
});