import React, { useEffect, useState } from 'react';
import { 
  View, Text, StyleSheet, FlatList, TouchableOpacity, 
  ActivityIndicator, StatusBar, RefreshControl, Image 
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { api } from '../services/api';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://api.nobai245.com';

interface Ride {
  id: string;
  createdAt: string;
  originAddress: string;
  destinationAddress: string;
  priceXof: number;
  status: string;
  passenger?: {
    fullName: string;
    profilePicture?: string;
  } | null;
  ratings?: { stars: number }[];
}

function formatMoney(amount: number): string {
  const num = Math.round(Number(amount) || 0);
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function RideHistory() {
  const navigation = useNavigation();
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const formatImageUrl = (path?: string) => 
    path ? (path.startsWith('http') ? path : `${API_URL}${path.startsWith('/') ? '' : '/'}${path}`) : undefined;

  const fetchHistory = async (pageNumber: number, shouldRefresh = false) => {
    if (!hasMore && !shouldRefresh) return;

    try {
      const response = await api.get(`/drivers/finance?page=${pageNumber}&limit=10`);
      const rawData = response.data?.history || response.data?.rides || response.data;
      const historyData: Ride[] = Array.isArray(rawData) ? rawData : [];

      if (shouldRefresh) {
        setRides(historyData);
      } else {
        setRides(prev => [...prev, ...historyData]);
      }

      setHasMore(historyData.length >= 10);
    } catch (error) {
      console.error('Erro ao buscar histórico do motorista:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    fetchHistory(1, true);
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    setPage(1);
    setHasMore(true);
    fetchHistory(1, true);
  };

  const handleLoadMore = () => {
    if (!loadingMore && hasMore && !loading) {
      setLoadingMore(true);
      const nextPage = page + 1;
      setPage(nextPage);
      fetchHistory(nextPage, false);
    }
  };

  const getStatusConfig = (status: string) => {
    switch(status) {
      case 'FINISHED': 
      case 'COMPLETED': 
        return { text: 'Concluída', color: '#059669', bg: '#D1FAE5', icon: 'checkmark-circle' as const };
      case 'CANCELLED': 
        return { text: 'Cancelada', color: '#DC2626', bg: '#FEE2E2', icon: 'close-circle' as const };
      case 'IN_PROGRESS':
        return { text: 'Em Andamento', color: '#2563EB', bg: '#DBEAFE', icon: 'car-sport' as const };
      default: 
        return { text: status, color: '#D97706', bg: '#FEF3C7', icon: 'time' as const };
    }
  };

  const renderRide = ({ item }: { item: Ride }) => {
    const rating = item.ratings && item.ratings.length > 0 ? item.ratings[0].stars : null;
    const gain = Number(item.priceXof || 0) * 0.8;
    const statusConfig = getStatusConfig(item.status);
    const passengerPhoto = formatImageUrl(item.passenger?.profilePicture);

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.dateContainer}>
            <Ionicons name="calendar-outline" size={16} color="#6B7280" />
            <Text style={styles.dateText}>
              {new Date(item.createdAt).toLocaleDateString('pt-BR')} • {new Date(item.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: statusConfig.bg }]}>
            <Ionicons name={statusConfig.icon} size={14} color={statusConfig.color} style={{ marginRight: 4 }} />
            <Text style={[styles.statusBadgeText, { color: statusConfig.color }]}>
              {statusConfig.text}
            </Text>
          </View>
        </View>

        {item.passenger && (
          <View style={styles.passengerContainer}>
            {passengerPhoto ? (
               <Image source={{ uri: passengerPhoto }} style={styles.passengerAvatar} />
            ) : (
              <View style={styles.passengerAvatarPlaceholder}>
                <Ionicons name="person" size={20} color="#9CA3AF" />
              </View>
            )}
            <View style={styles.passengerInfo}>
              <Text style={styles.passengerName}>{item.passenger.fullName}</Text>
              <Text style={styles.passengerRole}>Passageiro</Text>
            </View>
            {rating && (
              <View style={styles.ratingBadge}>
                <Ionicons name="star" size={14} color="#D97706" />
                <Text style={styles.ratingText}>{rating.toFixed(1)}</Text>
              </View>
            )}
          </View>
        )}

        <View style={styles.routeContainer}>
          <View style={styles.routePoint}>
            <View style={styles.iconWrapperOrigin}>
              <View style={styles.innerDotOrigin} />
            </View>
            <Text style={styles.addressText} numberOfLines={2}>{item.originAddress}</Text>
          </View>
          <View style={styles.routeTimeline} />
          <View style={styles.routePoint}>
             <View style={styles.iconWrapperDest}>
               <Ionicons name="location-sharp" size={12} color="#FFF" />
             </View>
            <Text style={styles.addressText} numberOfLines={2}>{item.destinationAddress}</Text>
          </View>
        </View>

        <View style={styles.cardFooter}>
          <View style={styles.footerLeft}>
            <Ionicons name="wallet-outline" size={20} color="#6B7280" />
            <Text style={styles.priceLabel}>Ganho líquido</Text>
          </View>
          <Text style={[styles.priceValue, item.status === 'CANCELLED' && styles.priceValueCancelled]}>
            {formatMoney(gain)} XOF
          </Text>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFF" />
      
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#059669" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Histórico de Viagens</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#059669" />
          <Text style={styles.loadingText}>Buscando suas corridas...</Text>
        </View>
      ) : (
        <FlatList
          data={rides}
          keyExtractor={(item, index) => item.id || String(index)}
          renderItem={renderRide}
          contentContainerStyle={styles.listContainer}
          showsVerticalScrollIndicator={false}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.3}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#059669" colors={['#059669']} />
          }
          ListFooterComponent={
            loadingMore ? <ActivityIndicator size="small" color="#059669" style={{ marginVertical: 20 }} /> : null
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconCircle}>
                <Ionicons name="car-sport-outline" size={48} color="#9CA3AF" />
              </View>
              <Text style={styles.emptyTitle}>Sem histórico</Text>
              <Text style={styles.emptyText}>Você ainda não finalizou nenhuma corrida na plataforma.</Text>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F4F4F5' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 16, backgroundColor: '#FFF', elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 3, zIndex: 10 },
  backButton: { padding: 8, marginLeft: -8 },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#1F2937' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 16, color: '#6B7280', fontSize: 15, fontWeight: '500' },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', marginTop: 80, paddingHorizontal: 40 },
  emptyIconCircle: { width: 96, height: 96, borderRadius: 48, backgroundColor: '#E5E7EB', justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontWeight: 'bold', color: '#1F2937', marginBottom: 8 },
  emptyText: { color: '#6B7280', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  listContainer: { padding: 16, paddingBottom: 40 },
  card: { backgroundColor: '#FFF', borderRadius: 16, padding: 16, marginBottom: 16, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.06, shadowRadius: 8, borderWidth: 1, borderColor: '#F3F4F6' },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  dateContainer: { flexDirection: 'row', alignItems: 'center' },
  dateText: { fontSize: 14, color: '#4B5563', fontWeight: '600', marginLeft: 6 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusBadgeText: { fontSize: 12, fontWeight: '700' },
  passengerContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F9FAFB', padding: 12, borderRadius: 12, marginBottom: 16, borderWidth: 1, borderColor: '#F3F4F6' },
  passengerAvatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#E5E7EB' },
  passengerAvatarPlaceholder: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#E5E7EB', alignItems: 'center', justifyContent: 'center' },
  passengerInfo: { marginLeft: 12, flex: 1 },
  passengerName: { fontSize: 15, fontWeight: '700', color: '#1F2937', marginBottom: 2 },
  passengerRole: { fontSize: 12, color: '#6B7280', fontWeight: '500' },
  ratingBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF3C7', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  ratingText: { marginLeft: 4, fontSize: 13, fontWeight: '700', color: '#D97706' },
  routeContainer: { marginBottom: 20, paddingLeft: 4 },
  routePoint: { flexDirection: 'row', alignItems: 'center' },
  iconWrapperOrigin: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFE4E6', justifyContent: 'center', alignItems: 'center', zIndex: 2 },
  innerDotOrigin: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#E11D48' },
  iconWrapperDest: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#111827', justifyContent: 'center', alignItems: 'center', zIndex: 2 },
  routeTimeline: { width: 2, height: 20, backgroundColor: '#E5E7EB', marginLeft: 9, marginVertical: 2 },
  addressText: { flex: 1, marginLeft: 12, fontSize: 14, color: '#374151', lineHeight: 20, fontWeight: '500' },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 16, borderTopWidth: 1, borderTopColor: '#F3F4F6' },
  footerLeft: { flexDirection: 'row', alignItems: 'center' },
  priceLabel: { fontSize: 14, color: '#6B7280', fontWeight: '600', marginLeft: 6 },
  priceValue: { fontSize: 18, fontWeight: '900', color: '#059669' },
  priceValueCancelled: { color: '#9CA3AF', textDecorationLine: 'line-through' }
});