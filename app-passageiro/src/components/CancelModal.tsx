import React, { useState, memo } from 'react';
import { 
  Modal, View, Text, TouchableOpacity, TextInput, 
  StyleSheet, ScrollView, KeyboardAvoidingView, Platform, Alert,
  Keyboard, TouchableWithoutFeedback 
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  const insets = useSafeAreaInsets();
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

  function resetInternalState() {
    setSelectedReasonKey('');
    setCustomReason('');
  }

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
    
    // 🔄 Reseta os campos do modal e dispara a confirmação sem atraso
    resetInternalState();
    onConfirm(finalReason);
  }
  function handleClose() {
    resetInternalState();
    onClose();
  }

  // Recuo dinâmico inferior para botões virtuais do Android e iOS
  const dynamicBottomPadding = Math.max((insets?.bottom || 0) + 16, Platform.OS === 'android' ? 28 : 16);

  return (
    <Modal 
      visible={visible} 
      transparent 
      animationType="slide"
      onRequestClose={handleClose}
    >
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
        style={styles.keyboardOverlay}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.overlay}>
            <ScrollView 
              contentContainerStyle={styles.scrollContainer} 
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <TouchableWithoutFeedback onPress={(e) => e.stopPropagation()}>
                <View style={[styles.container, { paddingBottom: dynamicBottomPadding }]}>
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
                        activeOpacity={0.8}
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
                      multiline
                      maxLength={150}
                    />
                  )}

                  <TouchableOpacity 
                    style={[styles.confirmButton, !selectedReasonKey && styles.disabledButton]} 
                    onPress={handleConfirm}
                    disabled={!selectedReasonKey}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.confirmButtonText}>{t('confirm_cancellation_btn', 'Confirmar Cancelamento')}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.backButton} onPress={handleClose} activeOpacity={0.7}>
                    <Text style={styles.backButtonText}>{t('keep_ride_btn', 'Voltar e Continuar Corrida')}</Text>
                  </TouchableOpacity>
                </View>
              </TouchableWithoutFeedback>
            </ScrollView>
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </Modal>
  );
});

const styles = StyleSheet.create({
  keyboardOverlay: { flex: 1 },
  overlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.6)' },
  scrollContainer: { flexGrow: 1, justifyContent: 'flex-end' },
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