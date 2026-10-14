import React, { useEffect, useRef, useState } from 'react';
import { 
  Modal, View, Text, StyleSheet, TouchableOpacity, Image, 
  Vibration, Platform, ScrollView 
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Audio } from 'expo-av';

export interface StopData {
  address: string;
  lat: number;
  lng: number;
}

export interface RideRequestData {
  rideId: string;
  passengerName: string;
  passengerPhoto?: string;
  passengerRating?: number;
  originAddress: string;
  destinationAddress: string;
  fareXOF?: string | number;
  priceXof?: string | number;
  stops?: StopData[];
  extraStopAddress?: string;
  paymentMethod: string;
  vehicleType: string;
}

interface IncomingRideModalProps {
  visible: boolean;
  rideData: RideRequestData | null;
  onAccept: (rideId: string) => void;
  onReject: (rideId: string) => void;
  timeoutSeconds?: number;
}

export function IncomingRideModal({
  visible,
  rideData,
  onAccept,
  onReject,
  timeoutSeconds = 15,
}: IncomingRideModalProps) {
  const insets = useSafeAreaInsets();
  const [timeLeft, setTimeLeft] = useState(timeoutSeconds);
  const soundRef = useRef<Audio.Sound | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    async function playAlertSound() {
      try {
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          shouldDuckAndroid: true,
        });

        const { sound } = await Audio.Sound.createAsync(
          require('../../assets/sounds/alert.mp3'),
          { shouldPlay: true, isLooping: true }
        );
        soundRef.current = sound;
      } catch (err) {
        console.warn('⚠️ [AUDIO ALERT] Erro ao carregar/tocar áudio:', err);
      }
    }

    if (visible && rideData) {
      setTimeLeft(timeoutSeconds);
      playAlertSound();
      Vibration.vibrate([500, 500, 500, 500], true);

      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            handleTimeout();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      stopAlertAndVibration();
    }

    return () => {
      stopAlertAndVibration();
    };
  }, [visible, rideData?.rideId]);

  async function stopAlertAndVibration() {
    Vibration.cancel();

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    try {
      if (soundRef.current) {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }
    } catch {
      // Ignora erro durante desmontagem do modal
    }
  }

  function handleTimeout() {
    stopAlertAndVibration();
    if (rideData) onReject(rideData.rideId);
  }

  function handleAcceptPress() {
    stopAlertAndVibration();
    if (rideData) onAccept(rideData.rideId);
  }

  function handleRejectPress() {
    stopAlertAndVibration();
    if (rideData) onReject(rideData.rideId);
  }

  if (!visible || !rideData) return null;

  const displayFare = rideData.fareXOF ?? rideData.priceXof ?? 0;
  const hasStops = (rideData.stops && rideData.stops.length > 0) || Boolean(rideData.extraStopAddress);

  // Recuo dinâmico inferior para botões virtuais do Android e barra de gestos do iOS
  const dynamicBottomPadding = Math.max((insets?.bottom || 0) + 16, Platform.OS === 'android' ? 28 : 16);

  return (
    <Modal 
      visible={visible} 
      transparent 
      animationType="slide" 
      statusBarTranslucent
      onRequestClose={handleRejectPress}
    >
      <View style={styles.overlay}>
        <View style={[styles.card, { paddingBottom: dynamicBottomPadding }]}>
          <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
            {/* CABEÇALHO COM TIMER */}
            <View style={styles.header}>
              <Text style={styles.title}>Nova Solicitação!</Text>
              <View style={styles.timerBadge}>
                <Text style={styles.timerText}>{timeLeft}s</Text>
              </View>
            </View>

            {/* DADOS DO PASSAGEIRO */}
            <View style={styles.passengerRow}>
              {rideData.passengerPhoto ? (
                <Image source={{ uri: rideData.passengerPhoto }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarPlaceholder]}>
                  <Text style={styles.avatarText}>{rideData.passengerName?.charAt(0) || 'P'}</Text>
                </View>
              )}
              <View style={styles.passengerDetails}>
                <Text style={styles.passengerName}>{rideData.passengerName || 'Passageiro'}</Text>
                <Text style={styles.rating}>★ {rideData.passengerRating?.toFixed(1) || '5.0'}</Text>
              </View>
            </View>

            {/* CAIXA DE ROTA */}
            <View style={styles.routeBox}>
              <Text style={styles.label}>EMBARQUE</Text>
              <Text style={styles.address} numberOfLines={1}>{rideData.originAddress}</Text>

              {hasStops && (
                <>
                  <View style={styles.divider} />
                  <Text style={[styles.label, styles.stopLabel]}>PARADA INTERMEDIÁRIA</Text>
                  {rideData.stops && rideData.stops.length > 0 ? (
                    rideData.stops.map((stop, idx) => (
                      <Text key={idx} style={styles.address} numberOfLines={1}>
                        • {stop.address}
                      </Text>
                    ))
                  ) : (
                    <Text style={styles.address} numberOfLines={1}>
                      • {rideData.extraStopAddress}
                    </Text>
                  )}
                </>
              )}

              <View style={styles.divider} />

              <Text style={styles.label}>DESTINO</Text>
              <Text style={styles.address} numberOfLines={1}>{rideData.destinationAddress}</Text>
            </View>

            {/* VALOR DA CORRIDA */}
            <View style={styles.fareRow}>
              <Text style={styles.fareLabel}>Valor:</Text>
              <Text style={styles.fareValue}>{displayFare} XOF</Text>
            </View>

            {/* BOTÕES DE AÇÃO */}
            <View style={styles.buttonGroup}>
              <TouchableOpacity style={[styles.btn, styles.btnReject]} onPress={handleRejectPress} activeOpacity={0.8}>
                <Text style={styles.btnRejectText}>Recusar</Text>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.btn, styles.btnAccept]} onPress={handleAcceptPress} activeOpacity={0.85}>
                <Text style={styles.btnAcceptText}>Aceitar Corrida</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { 
    flex: 1, 
    backgroundColor: 'rgba(15, 23, 42, 0.6)', 
    justifyContent: 'flex-end' 
  },
  card: { 
    backgroundColor: '#FFFFFF', 
    borderTopLeftRadius: 24, 
    borderTopRightRadius: 24, 
    paddingHorizontal: 20,
    paddingTop: 20,
    maxHeight: '88%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 12,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 18, fontWeight: '800', color: '#0F172A' },
  timerBadge: { backgroundColor: '#DC2626', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  timerText: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 },
  passengerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  avatar: { width: 48, height: 48, borderRadius: 24, marginRight: 12 },
  avatarPlaceholder: { backgroundColor: '#0284C7', justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#FFF', fontSize: 18, fontWeight: '800' },
  passengerDetails: { flex: 1 },
  passengerName: { fontSize: 16, fontWeight: '700', color: '#0F172A' },
  rating: { color: '#D97706', fontSize: 13, fontWeight: '700', marginTop: 2 },
  routeBox: { backgroundColor: '#F8FAFC', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', marginBottom: 16 },
  label: { fontSize: 10, fontWeight: '800', color: '#64748B', marginBottom: 2 },
  stopLabel: { color: '#EA580C' },
  address: { fontSize: 13, color: '#1E293B', fontWeight: '500' },
  divider: { height: 1, backgroundColor: '#E2E8F0', marginVertical: 8 },
  fareRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
  fareLabel: { fontSize: 15, color: '#475569', fontWeight: '600' },
  fareValue: { fontSize: 22, fontWeight: '900', color: '#059669' },
  buttonGroup: { flexDirection: 'row', gap: 12 },
  btn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  btnReject: { backgroundColor: '#FEE2E2' },
  btnRejectText: { color: '#DC2626', fontWeight: '800', fontSize: 15 },
  btnAccept: { backgroundColor: '#059669' },
  btnAcceptText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },
});