import React, { useState } from 'react';
import { Modal, View, Text, TouchableOpacity, TextInput, StyleSheet, Alert } from 'react-native';

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

export function CancelModal({ visible, userType, isPenaltyApplicable = false, onConfirm, onClose }: CancelModalProps) {
  const [selectedReason, setSelectedReason] = useState('');
  const [customReason, setCustomReason] = useState('');

  const reasons = userType === 'PASSENGER' ? REASONS_PASSENGER : REASONS_DRIVER;

  //  Função para resetar os campos internos adicionada
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

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={styles.container}>
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
              value={customReason}
              onChangeText={setCustomReason}
            />
          )}

          <TouchableOpacity 
            style={[styles.confirmButton, !selectedReason && styles.disabledButton]} 
            onPress={handleConfirm}
            disabled={!selectedReason}
          >
            <Text style={styles.confirmButtonText}>Confirmar Cancelamento</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.backButton} onPress={handleClose}>
            <Text style={styles.backButtonText}>Voltar e Continuar Corrida</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  container: { backgroundColor: '#FFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24 },
  title: { fontSize: 20, fontWeight: 'bold', color: '#1F2937', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#4B5563', marginBottom: 12 },
  warningBox: { backgroundColor: '#FEF2F2', borderColor: '#EF4444', borderWidth: 1, padding: 12, borderRadius: 8, marginBottom: 12 },
  warningText: { color: '#991B1B', fontSize: 13, fontWeight: '600' },
  reasonOption: { padding: 12, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 8, marginBottom: 8 },
  reasonSelected: { backgroundColor: '#059669', borderColor: '#059669' },
  reasonText: { color: '#374151', fontSize: 14 },
  reasonTextSelected: { color: '#FFF', fontWeight: 'bold' },
  input: { backgroundColor: '#F3F4F6', borderRadius: 8, padding: 12, marginBottom: 12, marginTop: 4 },
  confirmButton: { backgroundColor: '#DC2626', padding: 16, borderRadius: 8, alignItems: 'center', marginTop: 12 },
  disabledButton: { opacity: 0.5 },
  confirmButtonText: { color: '#FFF', fontWeight: 'bold', fontSize: 16 },
  backButton: { padding: 12, alignItems: 'center', marginTop: 8 },
  backButtonText: { color: '#4B5563', fontWeight: 'bold' },
});