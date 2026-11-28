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
import { Ionicons } from '@expo/vector-icons';

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
    setOtp('');
  };

  const handleCancel = () => {
    setOtp('');
    onCancel();
  };

  const dynamicBottomPadding = Math.max((insets?.bottom || 0) + 16, Platform.OS === 'android' ? 24 : 16);
  const isReady = otp.length === 4;

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
                <View style={styles.shieldIconCircle}>
                  <Ionicons name="shield-checkmark" size={26} color="#059669" />
                </View>

                <Text style={styles.title}>Digite o PIN da corrida</Text>
                <Text style={styles.subtitle}>
                  Solicite o código de 4 dígitos ao passageiro para iniciar a viagem com segurança.
                </Text>
                
                <TextInput
                  style={[styles.input, isReady && styles.inputReady]}
                  value={otp}
                  onChangeText={(text) => setOtp(text.replace(/\D/g, '').slice(0, 4))}
                  keyboardType="number-pad"
                  autoFocus={true}
                  maxLength={4}
                  placeholder="• • • •"
                  placeholderTextColor="#94A3B8"
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
                      !isReady && styles.disabledButton
                    ]} 
                    onPress={handleConfirm}
                    disabled={!isReady}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.confirmText}>Iniciar Viagem</Text>
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
    backgroundColor: 'rgba(15, 23, 42, 0.72)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  modalContent: {
    width: '100%',
    maxWidth: 350,
    backgroundColor: '#FFFFFF',
    padding: 24,
    borderRadius: 28,
    alignItems: 'center',
    elevation: 16,
    shadowColor: '#020617',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
  },
  shieldIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  title: {
    fontSize: 19,
    fontWeight: '900',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: 20,
  },
  input: {
    width: '100%',
    borderWidth: 2,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 28,
    fontWeight: '900',
    color: '#0F172A',
    textAlign: 'center',
    marginBottom: 22,
    letterSpacing: 10,
  },
  inputReady: {
    borderColor: '#059669',
    backgroundColor: '#ECFDF5',
  },
  buttonContainer: {
    flexDirection: 'row',
    width: '100%',
    gap: 10,
  },
  button: {
    flex: 1,
    paddingVertical: 15,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButton: {
    backgroundColor: '#F1F5F9',
  },
  confirmButton: {
    backgroundColor: '#059669',
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  disabledButton: {
    backgroundColor: '#CBD5E1',
    shadowOpacity: 0,
    elevation: 0,
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
