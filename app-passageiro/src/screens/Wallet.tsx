import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, ActivityIndicator, Alert, RefreshControl,
  Platform, StatusBar, Linking, KeyboardAvoidingView
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import { socket, connectPassengerSocket } from '../services/passengerSocket';

type ProviderType = 'ORANGE_MONEY' | 'MTN_MOMO';

interface WalletTransaction {
  id: string;
  type: string;
  status: string;
  paymentMethod?: string;
  amount: number;
  reference: string;
  description?: string;
  createdAt: string;
}

const QUICK_AMOUNTS = [1000, 2500, 5000, 10000];

export function Wallet() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { user, updateUserContext, refreshPassengerProfile } = useAuth();
  const isMountedRef = useRef(true);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [balance, setBalance] = useState<number>(Number(user?.walletBalance || 0));
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);

  // Recarga Mobile Money
  const [rechargeProvider, setRechargeProvider] = useState<ProviderType>(
    user?.paymentProvider === 'MTN_MOMO' ? 'MTN_MOMO' : 'ORANGE_MONEY'
  );
  const [rechargeAmount, setRechargeAmount] = useState<string>('2500');
  const [rechargePhone, setRechargePhone] = useState<string>(() => {
    const raw = String(user?.paymentAccountNumber || user?.phone || '').replace(/\D/g, '');
    return raw.startsWith('245') ? raw.slice(3) : raw;
  });
  const [submittingRecharge, setSubmittingRecharge] = useState(false);
  const [pendingCheckoutUrl, setPendingCheckoutUrl] = useState<string | null>(null);

  // Conta Padrão
  const [defaultProvider, setDefaultProvider] = useState<ProviderType>(
    user?.paymentProvider === 'MTN_MOMO' ? 'MTN_MOMO' : 'ORANGE_MONEY'
  );
  const [defaultAccountPhone, setDefaultAccountPhone] = useState<string>(() => {
    const raw = String(user?.paymentAccountNumber || user?.phone || '').replace(/\D/g, '');
    return raw.startsWith('245') ? raw.slice(3) : raw;
  });
  const [savingDefault, setSavingDefault] = useState(false);

  const loadFinance = useCallback(async () => {
    try {
      const res = await api.get('/passengers/finance');
      if (!isMountedRef.current) return;
      const data = res.data || {};
      const newBal = Number(data.walletBalance ?? user?.walletBalance ?? 0);
      setBalance(newBal);
      updateUserContext({
        walletBalance: newBal,
        paymentProvider: data.paymentProvider || user?.paymentProvider,
        paymentAccountNumber: data.paymentAccountNumber || user?.paymentAccountNumber,
      });
      if (Array.isArray(data.transactions)) {
        setTransactions(data.transactions);
      }
      if (data.paymentProvider === 'ORANGE_MONEY' || data.paymentProvider === 'MTN_MOMO') {
        setDefaultProvider(data.paymentProvider);
      }
      if (data.paymentAccountNumber) {
        const clean = String(data.paymentAccountNumber).replace(/\D/g, '');
        setDefaultAccountPhone(clean.startsWith('245') ? clean.slice(3) : clean);
      }
    } catch (error: any) {
      console.warn('⚠️ [WALLET PASSAGEIRO] Falha ao carregar financeiro:', error?.message);
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [user?.paymentAccountNumber, user?.paymentProvider, user?.phone, user?.walletBalance]);

  useEffect(() => {
    isMountedRef.current = true;
    loadFinance();
    if (!socket.connected) connectPassengerSocket();

    const onWalletUpdated = (payload: any) => {
      if (!isMountedRef.current) return;
      if (payload?.walletBalance !== undefined) {
        const updatedBal = Number(payload.walletBalance);
        setBalance(updatedBal);
        updateUserContext({ walletBalance: updatedBal });
      }
      setPendingCheckoutUrl(null);
      loadFinance();
    };

    const onWalletFailed = (payload: any) => {
      if (!isMountedRef.current) return;
      setPendingCheckoutUrl(null);
      Alert.alert(
        'Pagamento Não Concluído',
        payload?.message || 'A transação Mobile Money foi recusada ou expirada.'
      );
      loadFinance();
    };

    socket.on('wallet:updated', onWalletUpdated);
    socket.on('wallet:payment_failed', onWalletFailed);

    return () => {
      isMountedRef.current = false;
      socket.off('wallet:updated', onWalletUpdated);
      socket.off('wallet:payment_failed', onWalletFailed);
    };
  }, [loadFinance]);

  const validateBissauOperator = (provider: ProviderType, phone9: string): string | null => {
    if (phone9.length !== 9) {
      return 'Informe um número Mobile Money válido de 9 dígitos da Guiné-Bissau.';
    }
    if (provider === 'ORANGE_MONEY' && !phone9.startsWith('95')) {
      return 'Números Orange Money começam com 95.';
    }
    if (provider === 'MTN_MOMO' && !phone9.startsWith('96') && !phone9.startsWith('97')) {
      return 'Números Telecel (antigo MTN) começam com 96 ou 97.';
    }
    return null;
  };

  async function handleRecharge() {
    const amountNum = Math.round(Number(rechargeAmount.replace(/\D/g, '')));
    if (!amountNum || amountNum < 500) {
      return Alert.alert('Valor Inválido', 'O valor mínimo para recarga é de 500 XOF.');
    }

    const clean9 = rechargePhone.replace(/\D/g, '').replace(/^245/, '');
    const validationErr = validateBissauOperator(rechargeProvider, clean9);
    if (validationErr) {
      return Alert.alert('Número Incompatível', validationErr);
    }

    setSubmittingRecharge(true);
    try {
      const res = await api.post('/passengers/wallet/recharge', {
        amount: amountNum,
        provider: rechargeProvider,
        phone: `245${clean9}`,
      });

      const paymentUrl = res.data?.paymentUrl;
      if (paymentUrl) {
        setPendingCheckoutUrl(paymentUrl);
        Alert.alert(
          'Autorizar Pagamento',
          'Vamos abrir a página segura da operadora para você confirmar o pagamento com seu PIN.',
          [
            { text: 'Cancelar', style: 'cancel' },
            { text: 'Abrir Agora', onPress: () => Linking.openURL(paymentUrl).catch(() => {}) },
          ]
        );
        Linking.openURL(paymentUrl).catch(() => {});
      } else {
        Alert.alert(
          '📲 Confirme no seu Celular',
          res.data?.message ||
            'Enviamos a solicitação para o seu telefone. Digite os 4 dígitos do seu PIN para concluir a recarga.'
        );
      }
      loadFinance();
    } catch (error: any) {
      Alert.alert(
        'Falha na Recarga',
        error?.response?.data?.message ||
          error?.response?.data?.error ||
          'Não foi possível iniciar a cobrança Mobile Money.'
      );
    } finally {
      if (isMountedRef.current) setSubmittingRecharge(false);
    }
  }

  async function handleSaveDefaultMethod() {
    const clean9 = defaultAccountPhone.replace(/\D/g, '').replace(/^245/, '');
    const validationErr = validateBissauOperator(defaultProvider, clean9);
    if (validationErr) {
      return Alert.alert('Número Incompatível', validationErr);
    }

    setSavingDefault(true);
    try {
      await api.put('/passengers/payment-method', {
        paymentProvider: defaultProvider,
        paymentAccountNumber: `245${clean9}`,
      });
      updateUserContext({
        paymentProvider: defaultProvider,
        paymentAccountNumber: `245${clean9}`,
      });
      await refreshPassengerProfile();
      Alert.alert('Conta Salva ✅', 'Seu método Mobile Money padrão foi atualizado com sucesso!');
    } catch (error: any) {
      Alert.alert(
        'Erro ao Salvar',
        error?.response?.data?.error || 'Não foi possível salvar sua conta padrão.'
      );
    } finally {
      if (isMountedRef.current) setSavingDefault(false);
    }
  }

  const formatMoney = (val: number) =>
    Math.round(Number(val || 0)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} • ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return { label: 'Concluído', color: '#10B981', bg: 'rgba(16, 185, 129, 0.16)' };
      case 'FAILED':
      case 'CANCELLED':
        return { label: 'Não concluído', color: '#EF4444', bg: 'rgba(239, 68, 68, 0.16)' };
      default:
        return { label: 'Pendente', color: '#F59E0B', bg: 'rgba(245, 158, 11, 0.16)' };
    }
  };

  const topPad = Math.max((insets?.top || 0) + 8, Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 8 : 16);

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar barStyle="light-content" backgroundColor="#0F172A" translucent />

      <View style={[styles.header, { paddingTop: topPad }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconBtn}>
          <Ionicons name="arrow-back" size={22} color="#F8FAFC" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Carteira & Pagamentos</Text>
        <TouchableOpacity
          onPress={() => {
            setRefreshing(true);
            loadFinance();
          }}
          style={styles.iconBtn}
        >
          <Ionicons name="refresh" size={20} color="#EAB308" />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: Math.max((insets?.bottom || 0) + 28, 36) }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              loadFinance();
            }}
            tintColor="#EAB308"
          />
        }
        keyboardShouldPersistTaps="handled"
      >
        {/* CARTÃO LUXURY NÔ BAI WALLET */}
        <LinearGradient
          colors={['#1E293B', '#0F172A']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.walletCard}
        >
          <View style={styles.walletTopRow}>
            <View style={styles.walletBadge}>
              <Ionicons name="sparkles" size={13} color="#EAB308" />
              <Text style={styles.walletBadgeText}>NÔ BAI WALLET</Text>
            </View>
            <Ionicons name="shield-checkmark" size={20} color="#10B981" />
          </View>

          <Text style={styles.balanceCaption}>Saldo Disponível</Text>
          <Text style={styles.balanceAmount}>
            {formatMoney(balance)} <Text style={styles.balanceCurrency}>XOF</Text>
          </Text>
          <Text style={styles.walletHint}>
            Pagamentos via Orange Money, Telecel (MTN) e Dinheiro em toda Guiné-Bissau.
          </Text>
        </LinearGradient>

        {pendingCheckoutUrl && (
          <View style={styles.pendingBanner}>
            <Ionicons name="open-outline" size={20} color="#FF7900" />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={styles.pendingTitle}>Confirmação Pendente</Text>
              <Text style={styles.pendingSub}>Conclua a autorização na janela da operadora.</Text>
            </View>
            <TouchableOpacity
              style={styles.pendingBtn}
              onPress={() => Linking.openURL(pendingCheckoutUrl).catch(() => {})}
            >
              <Text style={styles.pendingBtnText}>Abrir</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* SEÇÃO 1: RECARREGAR CARTEIRA */}
        <Text style={styles.sectionTitle}>Recarregar Carteira Digital</Text>
        <View style={styles.card}>
          <Text style={styles.label}>Escolha a Operadora</Text>
          <View style={styles.providerRow}>
            <TouchableOpacity
              style={[
                styles.providerBtn,
                rechargeProvider === 'ORANGE_MONEY' && { borderColor: '#FF7900', backgroundColor: 'rgba(255, 121, 0, 0.14)' },
              ]}
              onPress={() => setRechargeProvider('ORANGE_MONEY')}
            >
              <Ionicons name="phone-portrait" size={18} color="#FF7900" />
              <Text style={styles.providerText}>Orange Money</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.providerBtn,
                rechargeProvider === 'MTN_MOMO' && { borderColor: '#EAB308', backgroundColor: 'rgba(234, 179, 8, 0.14)' },
              ]}
              onPress={() => setRechargeProvider('MTN_MOMO')}
            >
              <Ionicons name="wallet" size={18} color="#EAB308" />
              <Text style={styles.providerText}>Telecel / MTN</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>Valor da Recarga (XOF)</Text>
          <View style={styles.quickAmountsRow}>
            {QUICK_AMOUNTS.map((amt) => (
              <TouchableOpacity
                key={amt}
                style={[styles.amountChip, Number(rechargeAmount) === amt && styles.amountChipActive]}
                onPress={() => setRechargeAmount(String(amt))}
              >
                <Text style={[styles.amountChipText, Number(rechargeAmount) === amt && styles.amountChipTextActive]}>
                  {formatMoney(amt)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.inputBox}>
            <Text style={styles.prefixText}>XOF</Text>
            <TextInput
              style={styles.input}
              value={rechargeAmount}
              onChangeText={(v) => setRechargeAmount(v.replace(/\D/g, ''))}
              keyboardType="number-pad"
              placeholder="2500"
              placeholderTextColor="#64748B"
            />
          </View>

          <Text style={styles.label}>
            Número {rechargeProvider === 'ORANGE_MONEY' ? 'Orange Money (95...)' : 'Telecel / MTN (96 ou 97...)'}
          </Text>
          <View style={styles.inputBox}>
            <Text style={styles.prefixText}>🇬🇼 +245</Text>
            <TextInput
              style={styles.input}
              value={rechargePhone}
              onChangeText={(v) => setRechargePhone(v.replace(/\D/g, '').slice(0, 9))}
              keyboardType="number-pad"
              maxLength={9}
              placeholder={rechargeProvider === 'ORANGE_MONEY' ? '955000000' : '966000000'}
              placeholderTextColor="#64748B"
            />
          </View>

          <TouchableOpacity
            style={[styles.primaryBtn, submittingRecharge && { opacity: 0.7 }]}
            onPress={handleRecharge}
            disabled={submittingRecharge}
          >
            {submittingRecharge ? (
              <ActivityIndicator color="#0F172A" />
            ) : (
              <>
                <Ionicons name="flash" size={18} color="#0F172A" />
                <Text style={styles.primaryBtnText}>
                  Recarregar {rechargeAmount ? `${formatMoney(Number(rechargeAmount))} XOF` : ''}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* SEÇÃO 2: CONTA MOBILE MONEY PADRÃO */}
        <Text style={styles.sectionTitle}>Conta Mobile Money Padrão</Text>
        <View style={styles.card}>
          <Text style={styles.helperText}>
            Este número será preenchido automaticamente quando você escolher pagamento digital nas suas viagens.
          </Text>

          <View style={styles.providerRow}>
            <TouchableOpacity
              style={[
                styles.providerBtn,
                defaultProvider === 'ORANGE_MONEY' && { borderColor: '#FF7900', backgroundColor: 'rgba(255, 121, 0, 0.14)' },
              ]}
              onPress={() => setDefaultProvider('ORANGE_MONEY')}
            >
              <Text style={styles.providerText}>Orange Money</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.providerBtn,
                defaultProvider === 'MTN_MOMO' && { borderColor: '#EAB308', backgroundColor: 'rgba(234, 179, 8, 0.14)' },
              ]}
              onPress={() => setDefaultProvider('MTN_MOMO')}
            >
              <Text style={styles.providerText}>Telecel / MTN</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.inputBox}>
            <Text style={styles.prefixText}>🇬🇼 +245</Text>
            <TextInput
              style={styles.input}
              value={defaultAccountPhone}
              onChangeText={(v) => setDefaultAccountPhone(v.replace(/\D/g, '').slice(0, 9))}
              keyboardType="number-pad"
              maxLength={9}
              placeholder="955000000"
              placeholderTextColor="#64748B"
            />
          </View>

          <TouchableOpacity
            style={[styles.secondaryBtn, savingDefault && { opacity: 0.7 }]}
            onPress={handleSaveDefaultMethod}
            disabled={savingDefault}
          >
            {savingDefault ? (
              <ActivityIndicator color="#F8FAFC" />
            ) : (
              <Text style={styles.secondaryBtnText}>Salvar Conta Padrão</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* SEÇÃO 3: EXTRATO FINANCEIRO */}
        <Text style={styles.sectionTitle}>Histórico de Pagamentos</Text>
        {loading ? (
          <ActivityIndicator size="large" color="#EAB308" style={{ marginTop: 20 }} />
        ) : transactions.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="receipt-outline" size={32} color="#64748B" />
            <Text style={styles.emptyTitle}>Nenhuma movimentação ainda</Text>
            <Text style={styles.emptySub}>Suas recargas e pagamentos de corridas aparecerão aqui.</Text>
          </View>
        ) : (
          transactions.map((tx) => {
            const st = getStatusBadge(tx.status);
            const isCredit = tx.type === 'DEPOSIT' || tx.type === 'REFUND' || tx.type === 'PROMO_CREDIT';
            return (
              <View key={tx.id} style={styles.txItem}>
                <View style={[styles.txIcon, { backgroundColor: isCredit ? 'rgba(16, 185, 129, 0.15)' : 'rgba(234, 179, 8, 0.15)' }]}>
                  <Ionicons
                    name={isCredit ? 'arrow-down-circle' : 'car-sport'}
                    size={20}
                    color={isCredit ? '#10B981' : '#EAB308'}
                  />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.txTitle} numberOfLines={1}>
                    {tx.description || (isCredit ? 'Recarga de Carteira' : 'Pagamento de Corrida')}
                  </Text>
                  <Text style={styles.txMeta}>
                    {tx.paymentMethod === 'ORANGE_MONEY'
                      ? 'Orange Money'
                      : tx.paymentMethod === 'MTN_MOMO'
                      ? 'Telecel / MTN'
                      : tx.paymentMethod === 'CASH'
                      ? 'Dinheiro'
                      : 'Carteira'}{' '}
                    • {formatDate(tx.createdAt)}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[styles.txAmount, { color: isCredit ? '#10B981' : '#F8FAFC' }]}>
                    {isCredit ? '+' : '-'}{formatMoney(tx.amount)} XOF
                  </Text>
                  <View style={[styles.statusPill, { backgroundColor: st.bg }]}>
                    <Text style={[styles.statusPillText, { color: st.color }]}>{st.label}</Text>
                  </View>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0F172A' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 14,
    backgroundColor: '#0F172A',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: { color: '#F8FAFC', fontSize: 17, fontWeight: '800' },
  walletCard: {
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(234, 179, 8, 0.35)',
    marginBottom: 18,
  },
  walletTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  walletBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(234, 179, 8, 0.14)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    gap: 5,
  },
  walletBadgeText: { color: '#EAB308', fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  balanceCaption: { color: '#94A3B8', fontSize: 12, fontWeight: '600', marginTop: 14 },
  balanceAmount: { color: '#F8FAFC', fontSize: 32, fontWeight: '900', marginTop: 2 },
  balanceCurrency: { color: '#EAB308', fontSize: 16, fontWeight: '800' },
  walletHint: { color: '#94A3B8', fontSize: 12, marginTop: 10, lineHeight: 17 },
  pendingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 121, 0, 0.14)',
    borderWidth: 1,
    borderColor: '#FF7900',
    borderRadius: 14,
    padding: 12,
    marginBottom: 16,
  },
  pendingTitle: { color: '#F8FAFC', fontWeight: '800', fontSize: 13 },
  pendingSub: { color: '#CBD5E1', fontSize: 11, marginTop: 2 },
  pendingBtn: { backgroundColor: '#FF7900', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  pendingBtnText: { color: '#FFF', fontWeight: '800', fontSize: 12 },
  sectionTitle: { color: '#F8FAFC', fontSize: 15, fontWeight: '800', marginBottom: 10, marginTop: 6 },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 18,
  },
  label: { color: '#CBD5E1', fontSize: 12, fontWeight: '700', marginBottom: 8, marginTop: 6 },
  helperText: { color: '#94A3B8', fontSize: 12, lineHeight: 17, marginBottom: 10 },
  providerRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  providerBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: '#0F172A',
  },
  providerText: { color: '#F8FAFC', fontWeight: '800', fontSize: 13 },
  quickAmountsRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  amountChip: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
  },
  amountChipActive: { borderColor: '#EAB308', backgroundColor: 'rgba(234, 179, 8, 0.16)' },
  amountChipText: { color: '#CBD5E1', fontSize: 12, fontWeight: '700' },
  amountChipTextActive: { color: '#EAB308', fontWeight: '900' },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 12,
    height: 48,
    marginBottom: 10,
  },
  prefixText: { color: '#EAB308', fontWeight: '800', fontSize: 14, marginRight: 8 },
  input: { flex: 1, color: '#F8FAFC', fontSize: 15, fontWeight: '700' },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#EAB308',
    height: 48,
    borderRadius: 12,
    marginTop: 6,
  },
  primaryBtnText: { color: '#0F172A', fontWeight: '900', fontSize: 15 },
  secondaryBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#334155',
    height: 44,
    borderRadius: 12,
    marginTop: 4,
  },
  secondaryBtnText: { color: '#F8FAFC', fontWeight: '800', fontSize: 14 },
  emptyCard: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  emptyTitle: { color: '#F8FAFC', fontWeight: '800', fontSize: 14, marginTop: 10 },
  emptySub: { color: '#94A3B8', fontSize: 12, textAlign: 'center', marginTop: 4 },
  txItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  txIcon: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  txTitle: { color: '#F8FAFC', fontWeight: '700', fontSize: 13 },
  txMeta: { color: '#94A3B8', fontSize: 11, marginTop: 3 },
  txAmount: { fontWeight: '900', fontSize: 13 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, marginTop: 4 },
  statusPillText: { fontSize: 10, fontWeight: '800' },
});
