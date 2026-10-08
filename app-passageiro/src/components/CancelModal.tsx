import React, { useState, memo } from 'react';
import { 
  Modal, View, Text, TouchableOpacity, TextInput, 
  StyleSheet, ScrollView, KeyboardAvoidingView, Platform, Alert 
} from 'react-native';
import { useTranslation } from 'react-i18next';

interface CancelModalProps {
  visible: boolean;
  userType: 'PASSENGER' | 'DRIVER';
  isPenaltyApplicable?: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}

export const CancelModal = memo(function CancelModal({ 
  visible, 
  userType, 
  isPenaltyApplicable = false, 
  onConfirm, 
  onClose 
}: CancelModalProps) {
  const { t } = useTranslation();
  const [selectedReasonKey, setSelectedReasonKey] = useState('');
  const [customReason, setCustomReason] = useState('');

  const REASONS_PASSENGER = [
    { key: 'reason_driver_taking_long', defaultText: 'Motorista demorando muito' },
    { key: 'reason_changed_mind', defaultText: 'Mudei de ideia / Não preciso mais' },
    { key: 'reason_wrong_pickup_address', defaultText: 'Endereço de partida errado' },
    { key: 'reason_other', defaultText: 'Outro motivo' },
  ];

  const REASONS_DRIVER = [
    { key: 'reason_passenger_no_show', defaultText: 'Passageiro não apareceu no local' },
    { key: 'reason_vehicle_issue', defaultText: 'Pneu furado / Problema no veículo' },
    { key: 'reason_unsafe_pickup', defaultText: 'Local de embarque perigoso' },
    { key: 'reason_other', defaultText: 'Outro motivo' },
  ];

  const reasonsList = userType === 'PASSENGER' ? REASONS_PASSENGER : REASONS_DRIVER;

  function handleConfirm() {
    const selectedObj = reasonsList.find(r => r.key === selectedReasonKey);
    const translatedSelectedReason = selectedObj ? t(selectedObj.key, selectedObj.defaultText) : '';
    
    const finalReason = selectedReasonKey === 'reason_other' 
      ? customReason.trim() 
      : translatedSelectedReason;
    
    if (selectedReasonKey === 'reason_other' && !finalReason) {
      Alert.alert(
        t('required_reason_title', 'Motivo Obrigatório'), 
        t('describe_reason_msg', 'Por favor, descreva o motivo do cancelamento.')
      );
      return;
    }
    
    if (!finalReason) return;
    onConfirm(finalReason);
    resetInternalState();
  }

  function handleClose() {
    onClose();
    resetInternalState();
  }

  function resetInternalState() {
    setSelectedReasonKey('');
    setCustomReason('');
  }

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.overlay}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled">
            <View style={styles.container}>
              <Text style={styles.title}>{t('cancel_ride_title', 'Cancelar Corrida?')}</Text>
              
              {isPenaltyApplicable && userType === 'PASSENGER' && (
                <View style={styles.warningBox}>
                  <Text style={styles.warningText}>
                    {t('cancel_penalty_warning', '⚠️ Já se passaram 2 minutos. Será cobrada uma taxa de cancelamento de 500 XOF.')}
                  </Text>
                </View>
              )}

              <Text style={styles.subtitle}>{t('select_cancel_reason', 'Selecione o motivo do cancelamento:')}</Text>

              {reasonsList.map((item) => {
                const labelText = t(item.key, item.defaultText);
                const isSelected = selectedReasonKey === item.key;
                
                return (
                  <TouchableOpacity
                    key={item.key}
                    style={[styles.reasonOption, isSelected && styles.reasonSelected]}
                    onPress={() => setSelectedReasonKey(item.key)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.reasonText, isSelected && styles.reasonTextSelected]}>
                      {labelText}
                    </Text>
                  </TouchableOpacity>
                );
              })}

              {selectedReasonKey === 'reason_other' && (
                <TextInput
                  style={styles.input}
                  placeholder={t('describe_reason_placeholder', 'Descreva o motivo...')}
                  placeholderTextColor="#9CA3AF"
                  value={customReason}
                  onChangeText={setCustomReason}
                />
              )}

              <TouchableOpacity 
                style={[styles.confirmButton, !selectedReasonKey && styles.disabledButton]} 
                onPress={handleConfirm}
                disabled={!selectedReasonKey}
              >
                <Text style={styles.confirmButtonText}>{t('confirm_cancellation_btn', 'Confirmar Cancelamento')}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.backButton} onPress={handleClose}>
                <Text style={styles.backButtonText}>{t('keep_ride_btn', 'Voltar e Continuar Corrida')}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
});

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  scrollContainer: { flexGrow: 1, justifyContent: 'flex-end' },
  container: { backgroundColor: '#FFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24 },
  title: { fontSize: 20, fontWeight: 'bold', color: '#1F2937', marginBottom: 8 },
  subtitle: { fontSize: 14, color: '#4B5563', marginBottom: 12 },
  warningBox: { backgroundColor: '#FEF2F2', borderColor: '#EF4444', borderWidth: 1, padding: 12, borderRadius: 8, marginBottom: 12 },
  warningText: { color: '#991B1B', fontSize: 13, fontWeight: '600' },
  reasonOption: { padding: 12, borderWidth: 1, borderColor: '#E5E7EB', borderRadius: 8, marginBottom: 8 },
  reasonSelected: { backgroundColor: '#059669', borderColor: '#059669' },
  reasonText: { color: '#374151', fontSize: 14 },
  reasonTextSelected: { color: '#FFF', fontWeight: 'bold' },
  input: { backgroundColor: '#F3F4F6', borderRadius: 8, padding: 12, marginBottom: 12, marginTop: 4, color: '#1F2937' },
  confirmButton: { backgroundColor: '#DC2626', padding: 16, borderRadius: 8, alignItems: 'center', marginTop: 12 },
  disabledButton: { opacity: 0.5 },
  confirmButtonText: { color: '#FFF', fontWeight: 'bold', fontSize: 16 },
  backButton: { padding: 12, alignItems: 'center', marginTop: 8 },
  backButtonText: { color: '#4B5563', fontWeight: 'bold' },
});