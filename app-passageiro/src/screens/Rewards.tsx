import React, { useEffect, useState, useCallback, useRef } from 'react';
import { 
  View, 
  Text, 
  StyleSheet, 
  TouchableOpacity, 
  ScrollView, 
  ActivityIndicator,
  RefreshControl,
  Alert 
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { api } from '../services/api';

interface Benefit {
  id: string;
  title: string;
  icon?: keyof typeof Ionicons.glyphMap;
  actionUrl?: string;
}

interface RewardsData {
  points: number;
  nextTierPoints: number;
  tierName: string;
  benefits: Benefit[];
}

export function Rewards() {
  const navigation = useNavigation();
  const { t } = useTranslation();
  const isMountedRef = useRef(true);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rewards, setRewards] = useState<RewardsData>({
    points: 0,
    nextTierPoints: 1000,
    tierName: t('bronze', 'Bronze'),
    benefits: []
  });

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fetchRewards = useCallback(async () => {
    try {
      const response = await api.get('/passengers/rewards');
      if (response.data && isMountedRef.current) {
        setRewards({
          points: Number(response.data.points || 0),
          nextTierPoints: Number(response.data.nextTierPoints || 1000),
          tierName: response.data.tierName || t('bronze', 'Bronze'),
          benefits: response.data.benefits || []
        });
      }
    } catch (error: any) {
      if (!isMountedRef.current) return;
      Alert.alert(
        t('error_title', 'Erro'), 
        t('error_fetch_rewards', 'Não foi possível carregar suas recompensas atualizadas.')
      );
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [t]);

  useEffect(() => {
    fetchRewards();
  }, [fetchRewards]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchRewards();
  };

  const progressPercentage = rewards.nextTierPoints > 0 
    ? Math.min((rewards.points / rewards.nextTierPoints) * 100, 100) 
    : 100;

  const pointsRemaining = Math.max(rewards.nextTierPoints - rewards.points, 0);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color="#FFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('club_title', 'Clube BAI 245')}</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#FDE047" />
        </View>
      ) : (
        <ScrollView 
          style={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor="#FDE047" colors={['#FDE047']} />
          }
        >
          <View style={styles.cardGold}>
            <Ionicons name="trophy" size={40} color="#854D0E" />
            <Text style={styles.nivelText}>{t('level_label', 'Nível')} {rewards.tierName}</Text>
            <Text style={styles.pontosText}>{rewards.points} {t('points_label', 'Pontos')}</Text>
            
            <View style={styles.progressContainer}>
              <View style={styles.trackBar}>
                <View style={[styles.fillBar, { width: `${progressPercentage}%` }]} />
              </View>

              <Text style={styles.progressText}>
                {pointsRemaining > 0 
                  ? t('points_remaining_msg', 'Faltam {{points}} pts para o próximo nível', { points: pointsRemaining })
                  : t('max_level_reached', 'Você atingiu o nível máximo!')}
              </Text>
            </View>
          </View>

          <Text style={styles.sectionTitle}>{t('unlocked_benefits', 'Benefícios Desbloqueados')}</Text>
          
          {rewards.benefits.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>
                {t('no_benefits_desc', 'Realize mais viagens para desbloquear novos benefícios!')}
              </Text>
            </View>
          ) : (
            rewards.benefits.map((benefit) => (
              <View key={benefit.id} style={styles.benefitItem}>
                <Ionicons name={benefit.icon || 'gift'} size={24} color="#EAB308" />
                <Text style={styles.benefitText}>{benefit.title}</Text>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1A202C' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 20 },
  backBtn: { padding: 8 },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#FFF' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  content: { flex: 1, padding: 20 },
  cardGold: { backgroundColor: '#FDE047', borderRadius: 20, padding: 24, alignItems: 'center', marginBottom: 30 },
  nivelText: { fontSize: 22, fontWeight: '900', color: '#854D0E', marginTop: 10 },
  pontosText: { fontSize: 16, fontWeight: '600', color: '#A16207', marginBottom: 20 },
  progressContainer: { width: '100%', marginTop: 10 },
  trackBar: { height: 10, backgroundColor: '#FEF9C3', borderRadius: 5, overflow: 'hidden' },
  fillBar: { height: '100%', backgroundColor: '#854D0E', borderRadius: 5 },
  progressText: { fontSize: 12, color: '#854D0E', textAlign: 'center', marginTop: 8, fontWeight: '500' },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#FFF', marginBottom: 16 },
  benefitItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#2D3748', padding: 16, borderRadius: 12, marginBottom: 12 },
  benefitText: { color: '#FFF', marginLeft: 12, fontSize: 15, fontWeight: '500' },
  emptyCard: { backgroundColor: '#2D3748', padding: 20, borderRadius: 12, alignItems: 'center' },
  emptyText: { color: '#A0AEC0', fontSize: 14, textAlign: 'center' }
});