import React, { useState, useEffect } from 'react';
import { 
  View, Text, StyleSheet, TouchableOpacity, 
  ScrollView, Platform, StatusBar, ActivityIndicator, RefreshControl 
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { api } from '../services/api';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme/theme';

export function Wallet() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [financeData, setFinanceData] = useState<any>(null);

  useEffect(() => {
    fetchWalletData();
  }, []);

  async function fetchWalletData() {
    try {
      const res = await api.get('/drivers/finance');
      setFinanceData(res.data);
    } catch (error) {
      console.log('Erro ao carregar dados da carteira:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  function handleRefresh() {
    setRefreshing(true);
    fetchWalletData();
  }

  function formatMoney(value?: number | string) {
    if (value === null || value === undefined) return '0';
    const num = Number(value);
    if (isNaN(num)) return '0';
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  // Cálculos dinâmicos para recuo seguro em topo e rodapé (Android e iOS)
  const dynamicTopPadding = Math.max((insets?.top || 0) + 6, Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 6 : 14);
  const dynamicBottomPadding = Math.max((insets?.bottom || 0) + 16, Platform.OS === 'android' ? 28 : 16);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={theme.colors.primaryDark} translucent />
      
      {/* HEADER HERO ESTILO BANCO DIGITAL */}
      <View style={[styles.topHeaderContainer, { paddingTop: dynamicTopPadding }]}>
        <View style={styles.headerTopBar}>
          <TouchableOpacity 
            onPress={() => navigation.goBack()} 
            style={styles.backButton}
            activeOpacity={0.8}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="arrow-back" size={22} color="#FFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Ganhos e Carteira</Text>
          <TouchableOpacity 
            onPress={handleRefresh} 
            style={styles.refreshButton}
            activeOpacity={0.8}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="reload" size={18} color="#FFF" />
          </TouchableOpacity>
        </View>

        {/* VALOR DOS GANHOS DE HOJE */}
        <View style={styles.heroAmountBox}>
          <Text style={styles.heroLabel}>Ganhos de Hoje</Text>
          <Text style={styles.heroAmount}>
            {formatMoney(financeData?.todayEarned || 0)} <Text style={styles.heroCurrency}>XOF</Text>
          </Text>
        </View>

        {/* PILLS DE AÇÕES RÁPIDAS */}
        <View style={styles.quickPillRow}>
          <TouchableOpacity 
            style={styles.quickPill} 
            onPress={() => navigation.navigate('RideHistory')}
            activeOpacity={0.85}
          >
            <Ionicons name="receipt-outline" size={16} color="#FFF" />
            <Text style={styles.quickPillText}>Ver Extrato</Text>
          </TouchableOpacity>
          
          <TouchableOpacity 
            style={styles.quickPill} 
            onPress={() => navigation.navigate('Profile')}
            activeOpacity={0.85}
          >
            <Ionicons name="wallet-outline" size={16} color="#FFF" />
            <Text style={styles.quickPillText}>Conta Recebimento</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* FOLHA BRANCA SOBREPOSTA (WHITE CONTENT SHEET) */}
      <View style={styles.contentSheet}>
        <ScrollView 
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.scrollContent, 
            { paddingBottom: dynamicBottomPadding + 20 }
          ]}
          refreshControl={
            <RefreshControl 
              refreshing={refreshing} 
              onRefresh={handleRefresh} 
              colors={[theme.colors.primaryDark]} 
            />
          }
        >
          {loading ? (
            <ActivityIndicator size="large" color={theme.colors.primaryDark} style={{ marginTop: 40 }} />
          ) : (
            <>
              {/* GRID DE RECURSOS EM ÍCONES QUADRADOS SUAVES */}
              <Text style={styles.sectionTitle}>Resumo de Operações</Text>
              
              <View style={styles.iconGrid}>
                <View style={styles.gridItem}>
                  <View style={[styles.gridIconBox, { backgroundColor: '#E0F2FE' }]}>
                    <Ionicons name="calendar-outline" size={22} color="#0284C7" />
                  </View>
                  <Text style={styles.gridLabel}>Esta Semana</Text>
                  <Text style={styles.gridValue}>{formatMoney(financeData?.weeklyEarned || 0)} XOF</Text>
                </View>

                <View style={styles.gridItem}>
                  <View style={[styles.gridIconBox, { backgroundColor: '#D1FAE5' }]}>
                    <Ionicons name="trophy-outline" size={22} color="#059669" />
                  </View>
                  <Text style={styles.gridLabel}>Total Geral</Text>
                  <Text style={styles.gridValue}>{formatMoney(financeData?.totalEarned || 0)} XOF</Text>
                </View>
              </View>

              {/* CARD DE SALDO DE COMISSÃO */}
<View style={styles.card}>
  <View style={styles.cardHeader}>
    <Ionicons name="shield-checkmark" size={20} color={theme.colors.primaryDark} />
    <Text style={styles.cardTitle}>Saldo da Comissão do App</Text>
  </View>
  <Text style={styles.cardSub}>Mínimo de 1.000 XOF necessário para ficar Online</Text>

  <View style={styles.balanceRow}>
    <Text style={styles.balanceLabel}>Saldo de Recarga:</Text>
    <Text style={[
      styles.balanceValue, 
      { color: (financeData?.walletBalance || 0) < 1000 ? theme.colors.dangerRed : theme.colors.emeraldGreen }
    ]}>
      {formatMoney(financeData?.walletBalance || 0)} XOF
    </Text>
  </View>

  {(financeData?.walletBalance || 0) < 1000 && (
    <View style={styles.warningBox}>
      <Ionicons name="warning" size={18} color={theme.colors.dangerRed} />
      <Text style={styles.warningText}>
        Saldo inferior a 1.000 XOF. Recarregue para ficar online e receber viagens.
      </Text>
    </View>
  )}

  {/* 🚀 BOTÃO DE RECARGA DE SALDO */}
  <TouchableOpacity 
    style={styles.rechargeButton}
    onPress={() => {
      // Abre a tela ou modal de recarga via Orange Money / MTN MoMo
      navigation.navigate('TopUpWallet');
    }}
    activeOpacity={0.85}
  >
    <Ionicons name="add-circle-outline" size={20} color="#FFF" />
    <Text style={styles.rechargeButtonText}>Recarregar Saldo via Mobile Money</Text>
  </TouchableOpacity>
</View>

              {/* BANNER MOBILE MONEY */}
              <View style={styles.infoBanner}>
                <Ionicons name="checkmark-done-circle" size={22} color={theme.colors.emeraldGreen} />
                <Text style={styles.infoBannerText}>
                  Os seus ganhos são transferidos automaticamente para a sua conta Orange Money / MTN MoMo cadastrada.
                </Text>
              </View>
            </>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.primaryDark },
  topHeaderContainer: { 
    backgroundColor: theme.colors.primaryDark, 
    paddingHorizontal: 20, 
    paddingBottom: 28 
  },
  headerTopBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  backButton: { padding: 6, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 20 },
  refreshButton: { padding: 6, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: 20 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#FFF' },

  heroAmountBox: { alignItems: 'center', marginVertical: 6 },
  heroLabel: { fontSize: 12, color: '#94A3B8', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 },
  heroAmount: { fontSize: 36, fontWeight: '900', color: '#FFF', marginTop: 2 },
  heroCurrency: { fontSize: 18, fontWeight: 'bold', color: theme.colors.accentYellow },

  quickPillRow: { flexDirection: 'row', justifyContent: 'center', gap: 12, marginTop: 14 },
  quickPill: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: 'rgba(255,255,255,0.15)', 
    paddingHorizontal: 16, 
    paddingVertical: 10, 
    borderRadius: theme.borderRadius.pill,
    gap: 6 
  },
  quickPillText: { color: '#FFF', fontWeight: '700', fontSize: 12 },

  contentSheet: { 
    flex: 1, 
    backgroundColor: theme.colors.background, 
    borderTopLeftRadius: theme.borderRadius.xl, 
    borderTopRightRadius: theme.borderRadius.xl,
    overflow: 'hidden'
  },
  scrollContent: { padding: 20 },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: theme.colors.textPrimary, marginBottom: 12 },

  iconGrid: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  gridItem: { 
    flex: 1, 
    backgroundColor: theme.colors.surfaceWhite, 
    padding: 16, 
    borderRadius: theme.borderRadius.lg, 
    ...theme.shadows.card 
  },
  gridIconBox: { width: 42, height: 42, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
  gridLabel: { fontSize: 12, color: theme.colors.textSecondary, fontWeight: '600' },
  gridValue: { fontSize: 15, fontWeight: '900', color: theme.colors.textPrimary, marginTop: 4 },

  card: { 
    backgroundColor: theme.colors.surfaceWhite, 
    padding: 18, 
    borderRadius: theme.borderRadius.lg, 
    marginBottom: 16, 
    ...theme.shadows.card 
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 15, fontWeight: '800', color: theme.colors.textPrimary },
  cardSub: { fontSize: 12, color: theme.colors.textSecondary, marginTop: 2, marginBottom: 14 },
  balanceRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  balanceLabel: { fontSize: 13, color: theme.colors.textSecondary, fontWeight: '600' },
  balanceValue: { fontSize: 20, fontWeight: '900' },

  warningBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FEF2F2', padding: 12, borderRadius: 10, marginTop: 14, gap: 8 },
  warningText: { fontSize: 12, color: theme.colors.dangerRed, fontWeight: '600', flex: 1 },

  infoBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#ECFDF5', padding: 14, borderRadius: theme.borderRadius.md, gap: 10 },
  infoBannerText: { fontSize: 12, color: '#047857', fontWeight: '500', flex: 1, lineHeight: 17 },
  rechargeButton: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: theme.colors.primaryDark,
  paddingVertical: 12,
  borderRadius: theme.borderRadius.md,
  marginTop: 16,
  gap: 8,
},
rechargeButtonText: {
  color: '#FFF',
  fontWeight: '700',
  fontSize: 14,
},
});