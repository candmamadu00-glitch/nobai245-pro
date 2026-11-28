import React, { useEffect, useState, useCallback, useRef } from 'react';
import { 
  View, Text, StyleSheet, FlatList, TouchableOpacity, 
  StatusBar, RefreshControl, ActivityIndicator, Image
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { api } from '../services/api';

const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://api.nobai245.com').replace(/\/api\/?$/, '');

const formatPhotoUrl = (path?: string) => {
  if (!path || typeof path !== 'string') return undefined;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  const cleanBase = API_URL.replace(/\/$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${cleanBase}${cleanPath}`;
};

interface Driver {
  fullName: string;
  vehicleBrand?: string;
  vehiclePlate?: string;
  profilePicture?: string;
}

interface Ride {
  id: string;
  createdAt: string;
  originAddress: string;
  destinationAddress: string;
  originLat?: number;
  originLng?: number;
  destinationLat?: number;
  destinationLng?: number;
  distanceKm?: number;
  paymentMethod?: string;
  vehicleType?: string;
  priceXof: number;
  status: string;
  driver?: Driver | null;
  ratings?: { stars: number }[];
}

export function RideHistory() {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();

  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchHistory = useCallback(async (pageNumber = 1, isRefresh = false) => {
    if (isMountedRef.current && pageNumber === 1) setFetchError(null);
    const requestOnce = () => api.get('/passengers/rides', { params: { page: pageNumber, limit: 10 } });
    try {
      let response;
      try {
        response = await requestOnce();
      } catch (firstErr: any) {
        if (firstErr?.response?.status === 401) throw firstErr;
        await new Promise((r) => setTimeout(r, 1200));
        response = await requestOnce();
      }
      
      if (!isMountedRef.current) return;

      const historyData: Ride[] = 
        response.data?.rides || 
        response.data?.history || 
        (Array.isArray(response.data) ? response.data : []);
      
      setHasMore(historyData.length >= 10);
      setRides(prev => isRefresh ? historyData : [...prev, ...historyData]);
      setPage(pageNumber);
      setFetchError(null);
    } catch (error: any) {
      if (!isMountedRef.current || error?.response?.status === 401) return;
      
      const errorMessage = 
        error.response?.data?.error ||
        error.response?.data?.message || 
        t('history_error_msg', 'Não foi possível carregar o histórico agora. Arraste para baixo ou toque para tentar novamente.');
      
      if (pageNumber === 1) {
        setFetchError(errorMessage);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    }
  }, [t]);

  useEffect(() => {
    fetchHistory(1, true);
  }, [fetchHistory]);

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    fetchHistory(1, true);
  }, [fetchHistory]);

  const handleLoadMore = () => {
    if (!loadingMore && hasMore && !loading && !refreshing) {
      setLoadingMore(true);
      fetchHistory(page + 1);
    }
  };

  const handleRepeatRide = useCallback((item: Ride) => {
    const dLat = Number(item.destinationLat);
    const dLng = Number(item.destinationLng);
    const oLat = Number(item.originLat);
    const oLng = Number(item.originLng);
    const hasDest = !isNaN(dLat) && !isNaN(dLng) && dLat !== 0 && dLng !== 0;
    const hasOrig = !isNaN(oLat) && !isNaN(oLng) && oLat !== 0 && oLng !== 0;

    navigation.navigate('Home', {
      repeatRide: {
        originAddress: item.originAddress || '',
        originLat: hasOrig ? oLat : undefined,
        originLng: hasOrig ? oLng : undefined,
        destinationAddress: item.destinationAddress || '',
        destinationLat: hasDest ? dLat : undefined,
        destinationLng: hasDest ? dLng : undefined,
      },
    });
  }, [navigation]);

  const getStatusConfig = useCallback((status: string = '') => {
    const normalized = status.toUpperCase();
    const configs: Record<string, { color: string; bg: string; text: string }> = {
      FINISHED: { color: '#059669', bg: '#ECFDF5', text: t('status_completed', 'Concluída') },
      COMPLETED: { color: '#059669', bg: '#ECFDF5', text: t('status_completed', 'Concluída') },
      CANCELLED: { color: '#DC2626', bg: '#FEF2F2', text: t('status_cancelled', 'Cancelada') },
      CANCELED: { color: '#DC2626', bg: '#FEF2F2', text: t('status_cancelled', 'Cancelada') },
      IN_PROGRESS: { color: '#2563EB', bg: '#EFF6FF', text: t('status_in_progress', 'Em Andamento') },
      PENDING: { color: '#D97706', bg: '#FFFBEB', text: t('status_pending', 'Pendente') },
      ACCEPTED: { color: '#0284C7', bg: '#F0F9FF', text: t('status_accepted', 'Aceita') },
    };
    return configs[normalized] || { color: '#475569', bg: '#F1F5F9', text: status || t('status_pending', 'Pendente') };
  }, [t]);

  const renderRide = useCallback(({ item }: { item: Ride }) => {
    const rating = item.ratings?.[0]?.stars;
    const statusConfig = getStatusConfig(item.status);
    const rideDate = new Date(item.createdAt);
    const photoUri = formatPhotoUrl(item.driver?.profilePicture);

    const formattedDate = !isNaN(rideDate.getTime()) 
      ? `${rideDate.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} ${t('at_time', 'às')} ${rideDate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
      : t('date_unavailable', 'Data Indisponível');

    const canRepeat = Boolean(item.destinationAddress && Number(item.destinationLat) !== 0 && Number(item.destinationLng) !== 0);

    return (
      <TouchableOpacity 
        style={styles.card} 
        activeOpacity={0.85}
        onPress={() => navigation.navigate('RideDetails', { rideId: item.id, ride: item })}
      >
        <View style={styles.cardHeader}>
          <View style={styles.dateRow}>
            <Ionicons name="calendar-outline" size={14} color="#64748B" />
            <Text style={styles.dateText}>{formattedDate}</Text>
          </View>
          <View style={[styles.statusBadgeContainer, { backgroundColor: statusConfig.bg }]}>
            <Text style={[styles.statusBadgeText, { color: statusConfig.color }]}>
              {statusConfig.text}
            </Text>
          </View>
        </View>

        {item.driver && (
          <View style={styles.driverSection}>
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={styles.driverAvatarFallback} resizeMode="cover" />
            ) : (
              <View style={styles.driverAvatarFallback}>
                <Ionicons name="person" size={20} color="#64748B" />
              </View>
            )}
            
            <View style={styles.driverInfo}>
              <Text style={styles.driverName}>{item.driver.fullName}</Text>
              <Text style={styles.carInfo}>
                {item.driver.vehicleBrand ? `${item.driver.vehicleBrand} • ` : ''}{item.driver.vehiclePlate || t('plate_ni', 'Placa N/I')}
              </Text>
            </View>
            {rating ? (
              <View style={styles.ratingBox}>
                <Ionicons name="star" size={13} color="#EAB308" />
                <Text style={styles.ratingText}>{rating}</Text>
              </View>
            ) : null}
          </View>
        )}

        <View style={styles.routeContainer}>
          <View style={styles.routePoint}>
            <View style={styles.dotYellow} />
            <Text style={styles.addressText} numberOfLines={1}>
              {item.originAddress || t('origin_not_informed', 'Origem não informada')}
            </Text>
          </View>
          <View style={styles.routeLine} />
          <View style={styles.routePoint}>
            <View style={styles.dotBlack} />
            <Text style={styles.addressText} numberOfLines={1}>
              {item.destinationAddress || t('destination_not_informed', 'Destino não informado')}
            </Text>
          </View>
        </View>

        <View style={styles.cardFooter}>
          <View>
            <Text style={styles.priceLabel}>{t('total_amount', 'Valor Total')}</Text>
            <Text style={styles.priceValue}>
              {Number(item.priceXof || 0).toLocaleString('pt-PT')} XOF
            </Text>
          </View>

          {canRepeat ? (
            <TouchableOpacity
              style={styles.repeatButton}
              activeOpacity={0.8}
              onPress={() => handleRepeatRide(item)}
            >
              <Ionicons name="refresh" size={15} color="#0F172A" />
              <Text style={styles.repeatButtonText}>{t('repeat_ride', 'Pedir novamente')}</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.detailsPill}>
              <Text style={styles.detailsPillText}>{t('view_receipt', 'Recibo')}</Text>
              <Ionicons name="chevron-forward" size={14} color="#64748B" />
            </View>
          )}
        </View>
      </TouchableOpacity>
    );
  }, [navigation, getStatusConfig, handleRepeatRide, t]);

  const keyExtractor = useCallback((item: Ride, index: number) => {
    return item.id ? `ride-${item.id}` : `index-${index}`;
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
      
      <View style={styles.header}>
        <TouchableOpacity 
          onPress={() => navigation.goBack()} 
          style={styles.backButton} 
          activeOpacity={0.7}
          accessibilityLabel="Voltar"
        >
          <Ionicons name="arrow-back" size={22} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('my_rides', 'Minhas Corridas')}</Text>
        <View style={{ width: 38 }} />
      </View>

      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#EAB308" />
        </View>
      ) : (
        <>
          {fetchError ? (
            <TouchableOpacity
              onPress={() => fetchHistory(1, true)}
              activeOpacity={0.85}
              style={{ marginHorizontal: 16, marginTop: 12, padding: 12, borderRadius: 14, backgroundColor: '#FEF3C7', borderWidth: 1, borderColor: '#F59E0B', flexDirection: 'row', alignItems: 'center', gap: 10 }}
            >
              <Ionicons name="refresh-circle" size={22} color="#B45309" />
              <Text style={{ flex: 1, color: '#92400E', fontSize: 13, fontWeight: '600' }}>{fetchError}</Text>
            </TouchableOpacity>
          ) : null}
        <FlatList
          data={rides}
          keyExtractor={keyExtractor}
          renderItem={renderRide}
          contentContainerStyle={styles.listContainer}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl 
              refreshing={refreshing} 
              onRefresh={handleRefresh} 
              tintColor="#EAB308" 
              colors={['#EAB308']} 
            />
          }
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          ListFooterComponent={loadingMore ? <ActivityIndicator color="#EAB308" style={{ marginVertical: 16 }} /> : null}
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconCircle}>
                <Ionicons name="car-sport-outline" size={32} color="#94A3B8" />
              </View>
              <Text style={styles.emptyTitle}>{t('no_rides_found', 'Nenhuma viagem encontrada')}</Text>
              <Text style={styles.emptyText}>
                {t('no_rides_desc', 'Quando você realizar corridas ou envios, seus recibos aparecerão aqui.')}
              </Text>
            </View>
          }
        />
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  header: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between', 
    paddingHorizontal: 20, 
    paddingVertical: 14, 
    backgroundColor: '#FFFFFF', 
    borderBottomWidth: 1, 
    borderBottomColor: '#F1F5F9' 
  },
  backButton: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#F1F5F9', justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#0F172A' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  listContainer: { padding: 16, flexGrow: 1 },
  card: { 
    backgroundColor: '#FFFFFF', 
    borderRadius: 22, 
    padding: 18, 
    marginBottom: 14, 
    borderWidth: 1, 
    borderColor: '#E2E8F0', 
    shadowColor: '#0F172A', 
    shadowOffset: { width: 0, height: 4 }, 
    shadowOpacity: 0.04, 
    shadowRadius: 12, 
    elevation: 2 
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dateText: { fontSize: 12.5, color: '#64748B', fontWeight: '600', textTransform: 'capitalize' },
  statusBadgeContainer: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusBadgeText: { fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4 },
  driverSection: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    marginBottom: 14, 
    paddingBottom: 14, 
    borderBottomWidth: 1, 
    borderBottomColor: '#F1F5F9' 
  },
  driverAvatarFallback: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#F1F5F9', justifyContent: 'center', alignItems: 'center' },
  driverInfo: { marginLeft: 12, flex: 1 },
  driverName: { fontSize: 15, fontWeight: '800', color: '#0F172A' },
  carInfo: { fontSize: 12, color: '#64748B', marginTop: 2, fontWeight: '500' },
  ratingBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF9C3', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  ratingText: { marginLeft: 4, fontSize: 12, fontWeight: '800', color: '#854D0E' },
  routeContainer: { marginBottom: 14 },
  routePoint: { flexDirection: 'row', alignItems: 'center' },
  dotYellow: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#EAB308', marginLeft: 2 },
  dotBlack: { width: 10, height: 10, borderRadius: 2, backgroundColor: '#0F172A', marginLeft: 2 },
  routeLine: { width: 2, height: 14, backgroundColor: '#E2E8F0', marginLeft: 6, marginVertical: 4 },
  addressText: { flex: 1, marginLeft: 12, fontSize: 13.5, color: '#334155', fontWeight: '600' },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#F8FAFC', padding: 12, borderRadius: 14 },
  priceLabel: { fontSize: 11, color: '#64748B', fontWeight: '600', textTransform: 'uppercase' },
  priceValue: { fontSize: 16, fontWeight: '900', color: '#0F172A', marginTop: 1 },
  repeatButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#EAB308', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 12, gap: 6 },
  repeatButtonText: { fontSize: 12.5, fontWeight: '800', color: '#0F172A' },
  detailsPill: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: '#E2E8F0', gap: 4 },
  detailsPillText: { fontSize: 12, fontWeight: '700', color: '#475569' },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', marginTop: 60 },
  emptyIconCircle: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#F1F5F9', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 16, fontWeight: '800', color: '#0F172A', marginBottom: 8 },
  emptyText: { fontSize: 14, color: '#64748B', textAlign: 'center', paddingHorizontal: 40, lineHeight: 20 },
});
