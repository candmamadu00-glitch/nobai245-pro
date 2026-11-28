import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
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
  vehicleType?: string;
  distanceKm?: number;
  paymentMethod?: 'ORANGE_MONEY' | 'MTN_MOMO' | 'WALLET' | 'CASH' | 'CORPORATE' | 'CORPORATE_B2B' | string;
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
  const { t } = useTranslation();
  const ringtonePlayerRef = useRef<any>(null);

  useEffect(() => {
    if (visible && ride) {
      try {
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

  const safeTime = Math.max(0, Number(timeLeft || 0));
  const progressPct = Math.max(4, Math.min(100, (safeTime / 15) * 100));
  const timerColor = safeTime > 8 ? '#059669' : safeTime > 4 ? '#D97706' : '#DC2626';
  const timerBg = safeTime > 8 ? '#ECFDF5' : safeTime > 4 ? '#FEF3C7' : '#FEE2E2';

  const serviceLabel = ride.serviceType === 'DELIVERY'
    ? 'ENTREGA / ENCOMENDA'
    : ride.serviceType === 'RENTAL'
    ? 'ALUGUEL POR HORA'
    : String(ride.vehicleType || '').toUpperCase().includes('MOTO')
    ? 'MOTO-TÁXI'
    : 'CORRIDA NÔ BAI 245';

  const paymentLabel = (ride.paymentMethod === 'CORPORATE' || ride.paymentMethod === 'CORPORATE_B2B')
    ? 'Corporativo (Não cobrar)'
    : ride.paymentMethod === 'ORANGE_MONEY'
    ? 'Orange Money (Pago)'
    : ride.paymentMethod === 'MTN_MOMO'
    ? 'Telecel / MTN (Pago)'
    : ride.paymentMethod === 'WALLET'
    ? 'Carteira Digital (Pago)'
    : 'Dinheiro em Espécie';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onReject}
    >
      <View style={styles.overlay}>
        <View style={styles.container}>
          {/* BARRA DE CONTAGEM REGRESSIVA ANIMADA */}
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progressPct}%`, backgroundColor: timerColor }]} />
          </View>

          {/* CABEÇALHO DE CATEGORIA E CRONÔMETRO */}
          <View style={styles.topHeaderRow}>
            <View style={styles.serviceBadge}>
              <Ionicons
                name={ride.serviceType === 'DELIVERY' ? 'cube' : 'flash'}
                size={14}
                color="#0F172A"
              />
              <Text style={styles.serviceBadgeText}>{serviceLabel}</Text>
            </View>

            <View style={[styles.timerPill, { backgroundColor: timerBg, borderColor: timerColor }]}>
              <Ionicons name="time-outline" size={14} color={timerColor} />
              <Text style={[styles.timerText, { color: timerColor }]}>{safeTime}s</Text>
            </View>
          </View>

          {/* GANHO EM DESTAQUE + PASSAGEIRO */}
          <View style={styles.passengerRow}>
            {ride.passengerPhoto ? (
              <Image source={{ uri: ride.passengerPhoto }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Ionicons name="person" size={24} color="#0F172A" />
              </View>
            )}
            <View style={styles.passengerInfo}>
              <Text style={styles.passengerName} numberOfLines={1}>
                {ride.passengerName || 'Passageiro Nô Bai'}
              </Text>
              <View style={styles.ratingRow}>
                <View style={styles.ratingPill}>
                  <Ionicons name="star" size={12} color="#EAB308" />
                  <Text style={styles.ratingText}>
                    {Number(ride.passengerRating || 5.0).toFixed(1)}
                  </Text>
                </View>
                {typeof ride.distanceKm === 'number' && ride.distanceKm > 0 && (
                  <Text style={styles.distanceBadge}>{ride.distanceKm.toFixed(1)} km</Text>
                )}
              </View>
            </View>

            <View style={styles.priceContainer}>
              <Text style={styles.priceLabel}>GANHO</Text>
              <Text style={styles.priceValue}>{formatCurrency(ride.priceXof)}</Text>
              <Text style={styles.priceUnit}>XOF</Text>
            </View>
          </View>

          {/* ROTA DA CORRIDA */}
          <View style={styles.routeBox}>
            <View style={styles.routeItem}>
              <View style={styles.originDot} />
              <View style={{ flex: 1 }}>
                <Text style={styles.routeCaption}>EMBARQUE</Text>
                <Text style={styles.routeText} numberOfLines={2}>
                  {ride.originAddress || 'Ponto de Embarque'}
                </Text>
              </View>
            </View>

            {ride.stops && ride.stops.length > 0 && (
              <View style={styles.routeItem}>
                <Ionicons name="ellipsis-vertical" size={16} color="#D97706" />
                <Text style={styles.routeTextSub} numberOfLines={1}>
                  +{ride.stops.length} parada(s) intermediária(s)
                </Text>
              </View>
            )}

            <View style={styles.routeDivider} />

            <View style={styles.routeItem}>
              <View style={styles.destDot} />
              <View style={{ flex: 1 }}>
                <Text style={styles.routeCaption}>DESTINO</Text>
                <Text style={styles.routeText} numberOfLines={2}>
                  {ride.destinationAddress || 'Destino Final'}
                </Text>
              </View>
            </View>
          </View>

          {/* MÉTODO DE PAGAMENTO */}
          <View style={styles.paymentTag}>
            <Ionicons name="wallet-outline" size={15} color="#0F172A" />
            <Text style={styles.paymentText}>{paymentLabel}</Text>
          </View>

          {/* BOTÕES DE AÇÃO */}
          <View style={styles.actionsRow}>
            <TouchableOpacity 
              style={styles.rejectButton} 
              onPress={onReject} 
              activeOpacity={0.8}
            >
              <Ionicons name="close" size={22} color="#DC2626" />
              <Text style={styles.rejectText}>Recusar</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={styles.acceptButton} 
              onPress={onAccept} 
              activeOpacity={0.85}
            >
              <Ionicons name="checkmark-sharp" size={22} color="#FFF" />
              <Text style={styles.acceptText}>{t('accept_ride', 'Aceitar Corrida')}</Text>
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
    backgroundColor: 'rgba(15, 23, 42, 0.68)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingBottom: 24,
    paddingTop: 0,
    overflow: 'hidden',
  },
  progressTrack: {
    width: '100%',
    height: 6,
    backgroundColor: '#F1F5F9',
    marginBottom: 16,
  },
  progressFill: {
    height: '100%',
    borderTopRightRadius: 3,
    borderBottomRightRadius: 3,
  },
  topHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  serviceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FEF08A',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    gap: 6,
  },
  serviceBadgeText: { color: '#0F172A', fontWeight: '800', fontSize: 11.5, letterSpacing: 0.4 },
  timerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1.5,
    gap: 4,
  },
  timerText: { fontSize: 14, fontWeight: '900' },
  passengerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginBottom: 16,
  },
  avatar: { width: 52, height: 52, borderRadius: 26, borderWidth: 2, borderColor: '#EAB308' },
  avatarPlaceholder: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#F1F5F9',
    justifyContent: 'center',
    alignItems: 'center',
  },
  passengerInfo: { flex: 1, marginLeft: 12, paddingRight: 8 },
  passengerName: { fontSize: 16, fontWeight: '800', color: '#0F172A' },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  ratingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FEF9C3',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  ratingText: { fontSize: 12, fontWeight: '800', color: '#854D0E' },
  distanceBadge: { fontSize: 12, fontWeight: '700', color: '#64748B' },
  priceContainer: {
    alignItems: 'flex-end',
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  priceLabel: { fontSize: 9.5, fontWeight: '800', color: '#059669', letterSpacing: 0.5 },
  priceValue: { fontSize: 21, fontWeight: '900', color: '#047857', lineHeight: 24 },
  priceUnit: { fontSize: 10.5, fontWeight: '800', color: '#059669' },
  routeBox: {
    width: '100%',
    backgroundColor: '#F8FAFC',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 12,
  },
  routeItem: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  originDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: '#10B981' },
  destDot: { width: 11, height: 11, borderRadius: 3, backgroundColor: '#0F172A' },
  routeDivider: { height: 1, backgroundColor: '#E2E8F0', marginVertical: 10, marginLeft: 23 },
  routeCaption: { fontSize: 10, fontWeight: '800', color: '#94A3B8', letterSpacing: 0.5 },
  routeText: { fontSize: 13.5, fontWeight: '700', color: '#0F172A', marginTop: 1 },
  routeTextSub: { fontSize: 12, fontWeight: '700', color: '#D97706', flex: 1 },
  paymentTag: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
    gap: 6,
    marginBottom: 16,
  },
  paymentText: { fontSize: 12.5, color: '#334155', fontWeight: '700' },
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
    paddingVertical: 15,
    borderRadius: 16,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
    gap: 6,
  },
  rejectText: { color: '#DC2626', fontWeight: '800', fontSize: 15 },
  acceptButton: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 15,
    borderRadius: 16,
    backgroundColor: '#059669',
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
    gap: 6,
  },
  acceptText: { color: '#FFF', fontWeight: '800', fontSize: 16 },
});
