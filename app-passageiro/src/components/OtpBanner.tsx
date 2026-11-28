import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
      <View style={[styles.badgeRow, isArrived && styles.arrivedBadgeRow]}>
        <Ionicons
          name={isArrived ? 'checkmark-circle' : 'shield-checkmark'}
          size={14}
          color={isArrived ? '#059669' : '#B45309'}
        />
        <Text style={[styles.title, isArrived && styles.arrivedTitle]}>
          {isArrived 
            ? t('driver_arrived_title', 'O Motorista Chegou!') 
            : t('security_code_title', 'Código de Embarque')}
        </Text>
      </View>
      
      <Text style={styles.subtitle}>
        {isArrived 
          ? t('inform_pin_arrived', 'Informe este PIN ao motorista para iniciar a viagem:') 
          : t('inform_pin_boarding', 'Mostre este código ao motorista ao embarcar:')}
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
    backgroundColor: '#FFFBEB',
    borderColor: '#F59E0B',
    borderWidth: 1.5,
    borderRadius: 22,
    padding: 16,
    alignItems: 'center',
    marginHorizontal: 16,
    marginVertical: 10,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
  },
  arrivedContainer: {
    backgroundColor: '#ECFDF5',
    borderColor: '#10B981',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
    marginBottom: 8,
  },
  arrivedBadgeRow: {
    backgroundColor: '#D1FAE5',
  },
  title: {
    fontSize: 13.5,
    fontWeight: '900',
    color: '#B45309',
  },
  arrivedTitle: {
    color: '#047857',
  },
  subtitle: {
    fontSize: 12.5,
    color: '#475569',
    textAlign: 'center',
    marginBottom: 14,
    lineHeight: 18,
    fontWeight: '600',
  },
  otpBox: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  digitBox: {
    width: 48,
    height: 54,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 3,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    borderWidth: 1.5,
    borderColor: '#FCD34D',
  },
  arrivedDigitBox: {
    borderColor: '#6EE7B7',
    backgroundColor: '#FFFFFF',
  },
  digitText: {
    fontSize: 23,
    fontWeight: '900',
    color: '#D97706',
  },
  arrivedDigitText: {
    color: '#059669',
  },
});
