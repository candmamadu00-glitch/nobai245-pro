import React, { useEffect, useRef } from 'react';
import { 
  View, Text, StyleSheet, Modal, TouchableOpacity, Image 
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { createAudioPlayer } from 'expo-audio';

interface Stop {
  address: string;
}

interface IncomingRideData {
  rideId: string;
  passengerId: string;
  passengerName?: string;
  passengerPhoto?: string;
  passengerRating?: number;
  pickupLat: number;
  pickupLng: number;
  originAddress?: string;
  destinationAddress?: string;
  serviceType?: 'RIDE' | 'DELIVERY' | 'RENTAL';
  paymentMethod?: 'ORANGE_MONEY' | 'MTN_MOMO' | 'WALLET' | 'CASH';
  priceXof?: number;
  stops?: Stop[];
}

interface IncomingRideModalProps {
  visible: boolean;
  ride: IncomingRideData | null;
  timeLeft: number;
  onAccept: () => void;
  onReject: () => void;
}

const formatCurrency = (val?: number | null): string => {
  const num = Number(val || 0);
  if (isNaN(num)) return '0';
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
};

export function IncomingRideModal({
  visible,
  ride,
  timeLeft,
  onAccept,
  onReject
}: IncomingRideModalProps) {
  const ringtonePlayerRef = useRef<any>(null);

  // Reproduz o áudio da chamada enquanto a corrida estiver em oferta no modal
  useEffect(() => {
    if (visible && ride) {
      try {
        // Certifique-se de que o arquivo esteja em src/assets/audio/ride_request.mp3
        const soundAsset = require('../../assets/audio/crioulo/new_ride.mp3');
        const player = createAudioPlayer(soundAsset);
        player.loop = true;
        player.play();
        ringtonePlayerRef.current = player;
      } catch (err) {
        console.error('[MODAL RIDE] Erro ao iniciar áudio da chamada:', err);
      }
    } else {
      if (ringtonePlayerRef.current) {
        try { ringtonePlayerRef.current.pause(); } catch (e) {}
        ringtonePlayerRef.current = null;
      }
    }

    return () => {
      if (ringtonePlayerRef.current) {
        try { ringtonePlayerRef.current.pause(); } catch (e) {}
        ringtonePlayerRef.current = null;
      }
    };
  }, [visible, ride]);

  if (!visible || !ride) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onReject}
    >
      <View style={styles.overlay}>
        <View style={styles.container}>
          
          {/* BANNER SUPERIOR */}
          <View style={[styles.badgeBanner, styles.normalBanner]}>
            <Ionicons name="flash-outline" size={18} color="#FFF" />
            <Text style={styles.badgeText}>🚗 NOVA SOLICITAÇÃO</Text>
          </View>

          {/* TEMPO RESTANTE */}
          <View style={styles.timerContainer}>
            <Text style={styles.timerText}>{timeLeft}s</Text>
          </View>

          {/* DADOS DO PASSAGEIRO */}
          <View style={styles.passengerRow}>
            {ride.passengerPhoto ? (
              <Image source={{ uri: ride.passengerPhoto }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Ionicons name="person" size={24} color="#059669" />
              </View>
            )}
            <View style={styles.passengerInfo}>
              <Text style={styles.passengerName}>{ride.passengerName || 'Passageiro'}</Text>
              <View style={styles.ratingRow}>
                <Ionicons name="star" size={14} color="#EAB308" />
                <Text style={styles.ratingText}>
                  {Number(ride.passengerRating || 5.0).toFixed(1)}
                </Text>
              </View>
            </View>
            <View style={styles.priceContainer}>
              <Text style={styles.priceValue}>{formatCurrency(ride.priceXof)}</Text>
              <Text style={styles.priceUnit}>XOF</Text>
            </View>
          </View>

          {/* ROTA DA CORRIDA */}
          <View style={styles.routeBox}>
            <View style={styles.routeItem}>
              <Ionicons name="location-sharp" size={18} color="#10B981" />
              <Text style={styles.routeText} numberOfLines={2}>
                {ride.originAddress || 'Ponto de Embarque'}
              </Text>
            </View>

            {ride.stops && ride.stops.length > 0 && (
              <View style={styles.routeItem}>
                <Ionicons name="ellipsis-vertical" size={18} color="#EAB308" />
                <Text style={styles.routeTextSub} numberOfLines={1}>
                  +{ride.stops.length} parada(s) no trajeto
                </Text>
              </View>
            )}

            <View style={styles.routeItem}>
              <Ionicons name="flag-sharp" size={18} color="#EF4444" />
              <Text style={styles.routeText} numberOfLines={2}>
                {ride.destinationAddress || 'Destino Final'}
              </Text>
            </View>
          </View>

          {/* MÉTODO DE PAGAMENTO */}
          <View style={styles.paymentTag}>
            <Ionicons name="wallet-outline" size={14} color="#6B7280" />
            <Text style={styles.paymentText}>
              Pagamento: {ride.paymentMethod === 'CASH' ? 'Dinheiro' : 'Mobile Money'}
            </Text>
          </View>

          {/* BOTÕES DE AÇÃO */}
          <View style={styles.actionsRow}>
            <TouchableOpacity 
              style={styles.rejectButton} 
              onPress={onReject} 
              activeOpacity={0.8}
            >
              <Ionicons name="close" size={24} color="#EF4444" />
              <Text style={styles.rejectText}>Recusar</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.acceptButton} 
              onPress={onAccept} 
              activeOpacity={0.85}
            >
              <Ionicons name="checkmark-sharp" size={24} color="#FFF" />
              <Text style={styles.acceptText}>Aceitar Corrida</Text>
            </TouchableOpacity>
          </View>

        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justify: 'flex-end',
  },
  container: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    alignItems: 'center',
  },
  badgeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 20,
    gap: 6,
    marginBottom: 12,
  },
  normalBanner: { backgroundColor: '#059669' },
  badgeText: { color: '#FFF', fontWeight: '800', fontSize: 12 },
  timerContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FEF3C7',
    borderWidth: 2,
    borderColor: '#F59E0B',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  timerText: { fontSize: 16, fontWeight: '900', color: '#D97706' },
  passengerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginBottom: 16,
  },
  avatar: { width: 50, height: 50, borderRadius: 25 },
  avatarPlaceholder: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#ECFDF5',
    justifyContent: 'center',
    alignItems: 'center',
  },
  passengerInfo: { flex: 1, marginLeft: 12 },
  passengerName: { fontSize: 16, fontWeight: '800', color: '#111827' },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  ratingText: { fontSize: 13, fontWeight: '700', color: '#4B5563' },
  priceContainer: { alignItems: 'flex-end' },
  priceValue: { fontSize: 20, fontWeight: '900', color: '#059669' },
  priceUnit: { fontSize: 11, fontWeight: '700', color: '#6B7280' },
  routeBox: {
    width: '100%',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    marginBottom: 12,
  },
  routeItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  routeText: { fontSize: 13, fontWeight: '600', color: '#374151', flex: 1 },
  routeTextSub: { fontSize: 12, fontWeight: '700', color: '#D97706', flex: 1 },
  paymentTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 16,
  },
  paymentText: { fontSize: 12, color: '#6B7280', fontWeight: '600' },
  actionsRow: {
    flexDirection: 'row',
    width: '100%',
    gap: 12,
  },
  rejectButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#FEE2E2',
    gap: 6,
  },
  rejectText: { color: '#DC2626', fontWeight: '800', fontSize: 15 },
  acceptButton: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#059669',
    gap: 6,
  },
  acceptText: { color: '#FFF', fontWeight: '800', fontSize: 15 },
});