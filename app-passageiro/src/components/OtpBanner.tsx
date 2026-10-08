import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';

interface Props {
  otpCode: string;
  status: 'ACCEPTED' | 'ARRIVED' | 'IN_PROGRESS' | string;
}

export const OtpBanner: React.FC<Props> = ({ otpCode, status }) => {
  const { t } = useTranslation();

  if (!otpCode || status === 'IN_PROGRESS' || status === 'SEARCHING') return null;

  const isArrived = status === 'ARRIVED';

  return (
    <View style={[styles.container, isArrived && styles.arrivedContainer]}>
      <Text style={[styles.title, isArrived && styles.arrivedTitle]}>
        {isArrived 
          ? t('driver_arrived_title', '📍 O Motorista Chegou!') 
          : t('security_code_title', '🔑 Código de Segurança')}
      </Text>
      
      <Text style={styles.subtitle}>
        {isArrived 
          ? t('inform_pin_arrived', 'Informe este PIN ao motorista para iniciar o percurso:') 
          : t('inform_pin_boarding', 'Forneça este código ao motorista ao embarcar:')}
      </Text>

      <View style={styles.otpBox}>
        {otpCode.split('').map((digit, index) => (
          <View key={index} style={[styles.digitBox, isArrived && styles.arrivedDigitBox]}>
            <Text style={[styles.digitText, isArrived && styles.arrivedDigitText]}>
              {digit}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFF8E1',
    borderColor: '#FFA000',
    borderWidth: 1.5,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginHorizontal: 16,
    marginVertical: 10,
  },
  arrivedContainer: {
    backgroundColor: '#E8F5E9',
    borderColor: '#2E7D32',
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#E65100',
    marginBottom: 4,
  },
  arrivedTitle: {
    color: '#1B5E20',
  },
  subtitle: {
    fontSize: 13,
    color: '#555',
    textAlign: 'center',
    marginBottom: 12,
  },
  otpBox: {
    flexDirection: 'row',
    gap: 10,
  },
  digitBox: {
    width: 48,
    height: 52,
    backgroundColor: '#FFF',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    borderWidth: 1,
    borderColor: '#FFE082',
  },
  arrivedDigitBox: {
    borderColor: '#A5D6A7',
    backgroundColor: '#FFF',
  },
  digitText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#F57C00',
  },
  arrivedDigitText: {
    color: '#2E7D32',
  },
});