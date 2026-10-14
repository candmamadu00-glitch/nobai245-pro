import React, { useState } from 'react';
import { 
  Modal, 
  View, 
  Text, 
  TextInput, 
  TouchableOpacity, 
  StyleSheet, 
  KeyboardAvoidingView, 
  Platform,
  Keyboard,
  TouchableWithoutFeedback
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface Props {
  visible: boolean;
  onSubmitOtp: (otp: string) => void;
  onCancel: () => void;
}

export const StartRideOtpModal = ({ visible, onSubmitOtp, onCancel }: Props) => {
  const insets = useSafeAreaInsets();
  const [otp, setOtp] = useState('');

  const handleConfirm = () => {
    if (!otp.trim()) return;
    onSubmitOtp(otp.trim());
    setOtp(''); // Limpa o input após enviar
  };

  const handleCancel = () => {
    setOtp(''); // Limpa o input se cancelar
    onCancel();
  };

  // Recuo dinâmico para garantir distância segura dos botões do Android/iOS
  const dynamicBottomPadding = Math.max((insets?.bottom || 0) + 16, Platform.OS === 'android' ? 24 : 16);

  return (
    <Modal 
      visible={visible} 
      transparent 
      animationType="fade"
      onRequestClose={handleCancel}
    >
      <KeyboardAvoidingView 
        style={styles.keyboardContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={[styles.overlay, { paddingBottom: dynamicBottomPadding }]}>
            <TouchableWithoutFeedback onPress={(e) => e.stopPropagation()}>
              <View style={styles.modalContent}>
                <Text style={styles.title}>Digite o PIN da corrida</Text>
                <Text style={styles.subtitle}>
                  Solicite o código de 4 dígitos ao passageiro para iniciar a viagem.
                </Text>
                
                <TextInput
                  style={styles.input}
                  value={otp}
                  onChangeText={(text) => setOtp(text.replace(/\D/g, '').slice(0, 4))}
                  keyboardType="number-pad"
                  autoFocus={true}
                  maxLength={4}
                  placeholder="0000"
                  placeholderTextColor="#9CA3AF"
                />
                
                <View style={styles.buttonContainer}>
                  <TouchableOpacity 
                    style={[styles.button, styles.cancelButton]} 
                    onPress={handleCancel}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.cancelText}>Cancelar</Text>
                  </TouchableOpacity>
                  
                  <TouchableOpacity 
                    style={[
                      styles.button, 
                      styles.confirmButton, 
                      otp.length < 4 && styles.disabledButton
                    ]} 
                    onPress={handleConfirm}
                    disabled={otp.length < 4}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.confirmText}>Confirmar</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  keyboardContainer: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  modalContent: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#FFFFFF',
    padding: 22,
    borderRadius: 20,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
    marginBottom: 18,
  },
  input: {
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    fontSize: 26,
    fontWeight: '800',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 20,
    letterSpacing: 8,
  },
  buttonContainer: {
    flexDirection: 'row',
    gap: 10,
  },
  button: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {
    backgroundColor: '#F1F5F9',
  },
  confirmButton: {
    backgroundColor: '#059669',
  },
  disabledButton: {
    backgroundColor: '#CBD5E1',
  },
  cancelText: {
    color: '#475569',
    fontWeight: '800',
    fontSize: 14,
  },
  confirmText: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 14,
  },
});