import React, { useEffect, useRef, useState } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, Image, Vibration } from 'react-native';
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
    } catch (e) {
      // Ignora durante desmontagem da tela
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

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>Nova Solicitação!</Text>
            <View style={styles.timerBadge}>
              <Text style={styles.timerText}>{timeLeft}s</Text>
            </View>
          </View>

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

          <View style={styles.fareRow}>
            <Text style={styles.fareLabel}>Valor:</Text>
            <Text style={styles.fareValue}>{displayFare} XOF</Text>
          </View>

          <View style={styles.buttonGroup}>
            <TouchableOpacity style={[styles.btn, styles.btnReject]} onPress={handleRejectPress} activeOpacity={0.8}>
              <Text style={styles.btnRejectText}>Recusar</Text>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.btn, styles.btnAccept]} onPress={handleAcceptPress} activeOpacity={0.8}>
              <Text style={styles.btnAcceptText}>Aceitar Corrida</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  card: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 18, fontWeight: '700', color: '#111' },
  timerBadge: { backgroundColor: '#D32F2F', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  timerText: { color: '#FFFFFF', fontWeight: '700', fontSize: 14 },
  passengerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  avatar: { width: 48, height: 48, borderRadius: 24, marginRight: 12 },
  avatarPlaceholder: { backgroundColor: '#1976D2', justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#FFF', fontSize: 18, fontWeight: '700' },
  passengerDetails: { flex: 1 },
  passengerName: { fontSize: 16, fontWeight: '600' },
  rating: { color: '#F57C00', fontSize: 14, fontWeight: '600', marginTop: 2 },
  routeBox: { backgroundColor: '#F5F5F5', padding: 12, borderRadius: 8, marginBottom: 16 },
  label: { fontSize: 10, fontWeight: '700', color: '#666', marginBottom: 2 },
  stopLabel: { color: '#E65100' },
  address: { fontSize: 14, color: '#222' },
  divider: { height: 1, backgroundColor: '#E0E0E0', marginVertical: 8 },
  fareRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  fareLabel: { fontSize: 15, color: '#555' },
  fareValue: { fontSize: 22, fontWeight: '800', color: '#2E7D32' },
  buttonGroup: { flexDirection: 'row', gap: 12 },
  btn: { flex: 1, paddingVertical: 14, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  btnReject: { backgroundColor: '#FFEBEE' },
  btnRejectText: { color: '#C62828', fontWeight: '700', fontSize: 16 },
  btnAccept: { backgroundColor: '#2E7D32' },
  btnAcceptText: { color: '#FFFFFF', fontWeight: '700', fontSize: 16 },
});