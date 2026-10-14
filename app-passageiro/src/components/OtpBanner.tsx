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
  const digits = otpCode ? otpCode.toString().split('') : [];

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
        {digits.map((digit, index) => (
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
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    marginHorizontal: 16,
    marginVertical: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  arrivedContainer: {
    backgroundColor: '#E8F5E9',
    borderColor: '#2E7D32',
  },
  title: {
    fontSize: 16,
    fontWeight: '800',
    color: '#E65100',
    marginBottom: 4,
  },
  arrivedTitle: {
    color: '#1B5E20',
  },
  subtitle: {
    fontSize: 13,
    color: '#475569',
    textAlign: 'center',
    marginBottom: 12,
    lineHeight: 18,
  },
  otpBox: {
    flexDirection: 'row',
    gap: 10,
    justify: 'center',
    flexWrap: 'wrap',
  },
  digitBox: {
    width: 46,
    height: 52,
    backgroundColor: '#FFF',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    borderWidth: 1.5,
    borderColor: '#FFE082',
  },
  arrivedDigitBox: {
    borderColor: '#A5D6A7',
    backgroundColor: '#FFF',
  },
  digitText: {
    fontSize: 22,
    fontWeight: '900',
    color: '#F57C00',
  },
  arrivedDigitText: {
    color: '#2E7D32',
  },
});