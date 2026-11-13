import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ScrollView, Platform, StatusBar, ActivityIndicator, RefreshControl,
  Modal, TextInput, Alert, Clipboard, Linking,
  KeyboardAvoidingView, TouchableWithoutFeedback, Keyboard
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../services/api';
import { socket } from '../services/socket';
import { useAuth } from '../contexts/AuthContext';
import { theme } from '../theme/theme';

type ProviderType = 'ORANGE_MONEY' | 'MTN_MOMO';
type RechargeTab = 'AUTO' | 'TXID';
type HistoryTab = 'RIDES' | 'TRANSACTIONS';

const QUICK_AMOUNTS = [1000, 2500, 5000, 10000];

export function Wallet() {
  const { t } = useTranslation();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { driver, refreshDriverProfile } = useAuth();
  const isMountedRef = useRef(true);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [financeData, setFinanceData] = useState<any>(null);

  // Abas do Extrato
  const [historyTab, setHistoryTab] = useState<HistoryTab>('RIDES');

  // Modal de Recarga
  const [isRechargeModalVisible, setIsRechargeModalVisible] = useState(false);
  const [rechargeTab, setRechargeTab] = useState<RechargeTab>('AUTO');

  // Recarga Automática via API
  const [rechargeProvider, setRechargeProvider] = useState<ProviderType>('ORANGE_MONEY');
  const [rechargeAmount, setRechargeAmount] = useState<string>('2500');
  const [rechargePhone, setRechargePhone] = useState<string>(() => {
    const raw = String(driver?.phone || '').replace(/\D/g, '');
    return raw.startsWith('245') ? raw.slice(3) : raw;
  });
  const [submittingRecharge, setSubmittingRecharge] = useState(false);
  const [pendingCheckoutUrl, setPendingCheckoutUrl] = useState<string | null>(null);

  // Resgate por TxID / SMS
  const [txId, setTxId] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [copiedProvider, setCopiedProvider] = useState<string | null>(null);

  const fetchWalletData = useCallback(async () => {
    try {
      const res = await api.get('/drivers/finance');
      if (!isMountedRef.current) return;
      const data = res.data || {};
      setFinanceData(data);

      refreshDriverProfile().catch(() => {});

      const preferredRaw = String(data.orangeNumber || data.mobileMoneyAccount || driver?.phone || '').replace(/\D/g, '');
      const clean9 = preferredRaw.startsWith('245') ? preferredRaw.slice(3) : preferredRaw;
      if (clean9.length === 9) {
        setRechargePhone((prev) => prev || clean9);
      }
    } catch (error: any) {
      console.error('❌ [WALLET_DRIVER] Erro ao carregar dados financeiros:', error?.response?.data || error?.message);
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [driver?.phone, refreshDriverProfile]);

  useEffect(() => {
    isMountedRef.current = true;
    fetchWalletData();

    if (socket) {
      const handleWalletUpdated = (data: any) => {
        if (!isMountedRef.current) return;
        setPendingCheckoutUrl(null);
        fetchWalletData();
        if (data?.message) {
          Alert.alert('Carteira Atualizada ✅', data.message);
        }
      };

      const handleWalletFailed = (data: any) => {
        if (!isMountedRef.current) return;
        setPendingCheckoutUrl(null);
        fetchWalletData();
        Alert.alert(
          'Pagamento Não Concluído',
          data?.message || 'A cobrança Mobile Money foi recusada ou expirou.'
        );
      };

      socket.on('wallet:updated', handleWalletUpdated);
      socket.on('wallet:payment_failed', handleWalletFailed);

      return () => {
        isMountedRef.current = false;
        socket.off('wallet:updated', handleWalletUpdated);
        socket.off('wallet:payment_failed', handleWalletFailed);
      };
    }

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchWalletData]);

  function handleRefresh() {
    setRefreshing(true);
    fetchWalletData();
  }

  function formatMoney(value?: number | string) {
    if (value === null || value === undefined) return '0';
    const num = Math.round(Number(value));
    if (isNaN(num)) return '0';
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  function formatDate(iso?: string) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} • ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  const toggleRechargeModal = (visible: boolean, defaultTab: RechargeTab = 'AUTO') => {
    setRechargeTab(defaultTab);
    setIsRechargeModalVisible(visible);
    if (!visible) {
      setTxId('');
      setCopiedProvider(null);
    }
  };

  function copyToClipboard(text: string, provider: string) {
    Clipboard.setString(text);
    setCopiedProvider(provider);
    setTimeout(() => {
      if (isMountedRef.current) setCopiedProvider(null);
    }, 3000);
  }

  const selectRechargeOperator = (provider: ProviderType) => {
    setRechargeProvider(provider);
    const preferredRaw = provider === 'ORANGE_MONEY'
      ? (financeData?.orangeNumber || financeData?.mobileMoneyAccount || driver?.phone || '')
      : (financeData?.mtnNumber || financeData?.mobileMoneyAccount || driver?.phone || '');
    const clean = String(preferredRaw).replace(/\D/g, '');
    const nine = clean.startsWith('245') ? clean.slice(3) : clean;
    if (nine.length === 9) {
      setRechargePhone(nine);
    }
  };

  const validateBissauOperator = (provider: ProviderType, phone9: string): string | null => {
    if (phone9.length !== 9) {
      return 'Informe um número Mobile Money válido de 9 dígitos da Guiné-Bissau.';
    }
    if (provider === 'ORANGE_MONEY' && !phone9.startsWith('95')) {
      return 'Números Orange Money começam com 95.';
    }
    if (provider === 'MTN_MOMO' && !phone9.startsWith('96') && !phone9.startsWith('97')) {
      return 'Números Telecel / MTN começam com 96 ou 97.';
    }
    return null;
  };

  async function handleAutoRecharge() {
    const amountNum = Math.round(Number(rechargeAmount.replace(/\D/g, '')));
    if (!amountNum || amountNum < 500) {
      return Alert.alert('Valor Inválido', 'O valor mínimo para recarga automática é de 500 XOF.');
    }

    const clean9 = rechargePhone.replace(/\D/g, '').replace(/^245/, '');
    const validationErr = validateBissauOperator(rechargeProvider, clean9);
    if (validationErr) {
      return Alert.alert('Número Incompatível', validationErr);
    }

    setSubmittingRecharge(true);
    try {
      const res = await api.post('/drivers/wallet/recharge', {
        amount: amountNum,
        provider: rechargeProvider,
        phone: `245${clean9}`,
      });

      const paymentUrl = res.data?.paymentUrl;
      toggleRechargeModal(false);

      if (paymentUrl) {
        setPendingCheckoutUrl(paymentUrl);
        Alert.alert(
          'Autorizar Recarga',
          'Vamos abrir a página segura da operadora para você confirmar o pagamento com seu PIN.',
          [
            { text: 'Depois', style: 'cancel' },
            { text: 'Abrir Agora', onPress: () => Linking.openURL(paymentUrl).catch(() => {}) },
          ]
        );
        Linking.openURL(paymentUrl).catch(() => {});
      } else {
        Alert.alert(
          '📲 Confirme no seu Telemóvel',
          res.data?.message ||
            'Enviamos a solicitação para o seu número. Digite os 4 dígitos do seu PIN para concluir a recarga.'
        );
      }
      fetchWalletData();
    } catch (error: any) {
      Alert.alert(
        'Falha na Recarga',
        error?.response?.data?.message ||
          error?.response?.data?.error ||
          'Não foi possível iniciar a recarga Mobile Money.'
      );
    } finally {
      if (isMountedRef.current) setSubmittingRecharge(false);
    }
  }

  async function handleClaimTxId() {
    const cleanTx = txId.trim();
    if (!cleanTx) {
      return Alert.alert('Atenção', 'Digite ou cole o código da transação (TxID) recebido por SMS.');
    }

    setClaiming(true);
    try {
      const res = await api.post('/drivers/wallet/claim', { txId: cleanTx });
      Alert.alert(
        '🎉 Recarga Confirmada!',
        res.data?.message || 'O saldo foi creditado com sucesso na sua carteira.',
        [{ text: 'OK', onPress: () => toggleRechargeModal(false) }]
      );
      fetchWalletData();
    } catch (error: any) {
      Alert.alert(
        'Falha no Resgate',
        error?.response?.data?.error || 'Código de transação não localizado ou já utilizado. Verifique os dígitos no SMS.'
      );
    } finally {
      if (isMountedRef.current) setClaiming(false);
    }
  }

  const getTxStatusBadge = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return { label: 'Concluído', color: '#059669', bg: '#D1FAE5' };
      case 'FAILED':
      case 'CANCELLED':
        return { label: 'Não concluído', color: '#DC2626', bg: '#FEE2E2' };
      default:
        return { label: 'Pendente', color: '#D97706', bg: '#FEF3C7' };
    }
  };

  const dynamicTopPadding = Math.max((insets?.top || 0) + 6, Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 6 : 14);
  const dynamicBottomPadding = Math.max((insets?.bottom || 0) + 16, Platform.OS === 'android' ? 28 : 16);

  const adminOrangeNumber = financeData?.adminOrangeNumber || '245957330790';
  const adminMtnNumber = financeData?.adminMtnNumber || '245960000000';
  const walletBalance = Number(financeData?.walletBalance || 0);
  const ridesList = Array.isArray(financeData?.history) ? financeData.history : [];
  const txList = Array.isArray(financeData?.transactions) ? financeData.transactions : [];

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={theme.colors.primaryDark} translucent />

      {/* HEADER HERO */}
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
          <Text style={styles.headerTitle}>{t('wallet_title', 'Ganhos e Carteira')}</Text>
          <TouchableOpacity
            onPress={handleRefresh}
            style={styles.refreshButton}
            activeOpacity={0.8}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="reload" size={18} color="#FFF" />
          </TouchableOpacity>
        </View>

        {/* FATURAMENTO DE HOJE */}
        <View style={styles.heroAmountBox}>
          <Text style={styles.heroLabel}>Faturamento Líquido de Hoje</Text>
          <Text style={styles.heroAmount}>
            {formatMoney(financeData?.todayEarned || 0)} <Text style={styles.heroCurrency}>XOF</Text>
          </Text>
          <Text style={styles.heroSubStats}>
            {financeData?.todayRides || 0} corridas hoje • Bruto {formatMoney(financeData?.todayGross || 0)} XOF
          </Text>
        </View>

        {/* PILLS DE AÇÕES RÁPIDAS */}
        <View style={styles.quickPillRow}>
          <TouchableOpacity
            style={[styles.quickPill, { backgroundColor: '#FFCC00' }]}
            onPress={() => toggleRechargeModal(true, 'AUTO')}
            activeOpacity={0.85}
          >
            <Ionicons name="flash" size={16} color="#0F172A" />
            <Text style={[styles.quickPillText, { color: '#0F172A', fontWeight: '800' }]}>{t('recharge_wallet', 'Recarregar Saldo')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.quickPill}
            onPress={() => navigation.navigate('Profile')}
            activeOpacity={0.85}
          >
            <Ionicons name="wallet-outline" size={16} color="#FFF" />
            <Text style={styles.quickPillText}>{t('my_profile', 'Minha Conta')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* FOLHA DE CONTEÚDO */}
      <View style={styles.contentSheet}>
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: dynamicBottomPadding + 24 }]}
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
              {pendingCheckoutUrl && (
                <View style={styles.pendingBanner}>
                  <Ionicons name="open-outline" size={20} color="#EA580C" />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={styles.pendingTitle}>Autorização Pendente</Text>
                    <Text style={styles.pendingSub}>Conclua o pagamento na janela da operadora.</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.pendingBtn}
                    onPress={() => Linking.openURL(pendingCheckoutUrl).catch(() => {})}
                  >
                    <Text style={styles.pendingBtnText}>Abrir</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* CARTEIRA DE CRÉDITOS */}
              <View style={styles.walletSectionHeader}>
                <Text style={styles.sectionTitle}>Saldo da Comissão do App</Text>
                <View style={styles.liveBadge}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveText}>Tempo Real</Text>
                </View>
              </View>

              <View style={styles.creditCard}>
                <View style={styles.creditTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.creditLabel}>Mínimo de 1.000 XOF para ficar Online</Text>
                    <Text
                      style={[
                        styles.creditBalance,
                        { color: walletBalance < 1000 ? theme.colors.dangerRed : theme.colors.emeraldGreen }
                      ]}
                    >
                      {formatMoney(walletBalance)} XOF
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={styles.rechargeBtn}
                    onPress={() => toggleRechargeModal(true, 'AUTO')}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="add-circle" size={18} color="#FFF" />
                    <Text style={styles.rechargeBtnText}>{t('recharge_now', 'Recarregar')}</Text>
                  </TouchableOpacity>
                </View>

                {walletBalance < 1000 && (
                  <View style={styles.warningBox}>
                    <Ionicons name="warning" size={16} color={theme.colors.dangerRed} />
                    <Text style={styles.warningText}>
                      Saldo inferior a 1.000 XOF. Recarregue para ficar online e receber viagens.
                    </Text>
                  </View>
                )}

                <View style={styles.creditDivider} />

                <View style={styles.creditFooter}>
                  <Ionicons name="shield-checkmark-outline" size={16} color="#059669" />
                  <Text style={styles.creditHint}>
                    Recargas via Orange Money ou Telecel/MTN caem automaticamente na sua carteira.
                  </Text>
                </View>
              </View>

              {/* RESUMO DE FATURAMENTO */}
              <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Resumo de Faturamento</Text>

              <View style={styles.iconGrid}>
                <View style={styles.gridItem}>
                  <View style={[styles.gridIconBox, { backgroundColor: '#E0F2FE' }]}>
                    <Ionicons name="calendar-outline" size={20} color="#0284C7" />
                  </View>
                  <Text style={styles.gridLabel}>Esta Semana</Text>
                  <Text style={styles.gridValue}>{formatMoney(financeData?.weeklyEarned || 0)} XOF</Text>
                  <Text style={styles.gridSub}>{financeData?.weeklyRides || 0} viagens</Text>
                </View>

                <View style={styles.gridItem}>
                  <View style={[styles.gridIconBox, { backgroundColor: '#D1FAE5' }]}>
                    <Ionicons name="trophy-outline" size={20} color="#059669" />
                  </View>
                  <Text style={styles.gridLabel}>Total Geral</Text>
                  <Text style={styles.gridValue}>{formatMoney(financeData?.totalEarned || 0)} XOF</Text>
                  <Text style={styles.gridSub}>{financeData?.totalRides || 0} viagens</Text>
                </View>

                <View style={styles.gridItem}>
                  <View style={[styles.gridIconBox, { backgroundColor: '#FEF3C7' }]}>
                    <Ionicons name="pie-chart-outline" size={20} color="#D97706" />
                  </View>
                  <Text style={styles.gridLabel}>Taxas Hoje</Text>
                  <Text style={styles.gridValue}>{formatMoney(financeData?.todayCommission || 0)} XOF</Text>
                  <Text style={styles.gridSub}>Comissão app</Text>
                </View>
              </View>

              {/* FECHAMENTO DIÁRIO */}
              <View style={styles.dailyClosingCard}>
                <View style={styles.closingHeader}>
                  <Ionicons name="analytics-outline" size={18} color="#1E293B" />
                  <Text style={styles.closingTitle}>Fechamento Diário (Hoje)</Text>
                </View>
                <View style={styles.closingRow}>
                  <Text style={styles.closingLabel}>Total Bruto Recebido (Dinheiro)</Text>
                  <Text style={styles.closingVal}>{formatMoney(financeData?.todayGross || 0)} XOF</Text>
                </View>
                <View style={styles.closingRow}>
                  <Text style={styles.closingLabel}>Comissão Descontada da Carteira</Text>
                  <Text style={[styles.closingVal, { color: '#DC2626' }]}>
                    -{formatMoney(financeData?.todayCommission || 0)} XOF
                  </Text>
                </View>
                <View style={styles.closingDivider} />
                <View style={styles.closingRow}>
                  <Text style={styles.closingNetLabel}>Ganho Líquido do Motorista</Text>
                  <Text style={styles.closingNetVal}>{formatMoney(financeData?.todayEarned || 0)} XOF</Text>
                </View>
              </View>

              {/* CONTAS OFICIAIS PARA TRANSFERÊNCIA DIRETA */}
              <Text style={[styles.sectionTitle, { marginTop: 20 }]}>{t('official_company_accounts', 'Contas Oficiais Nô Bai 245')}</Text>
              <View style={styles.adminAccountsCard}>
                <Text style={styles.adminAccountsHint}>
                  Para recarga por transferência direta (USSD), envie para uma das contas oficiais abaixo e valide o código SMS:
                </Text>

                <View style={styles.adminRow}>
                  <View style={[styles.opDot, { backgroundColor: '#FF7900' }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.adminOpName}>Orange Money Oficial</Text>
                    <Text style={styles.adminOpNum}>+{adminOrangeNumber}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.copySmallBtn}
                    onPress={() => copyToClipboard(adminOrangeNumber, 'ORANGE_CARD')}
                  >
                    <Ionicons
                      name={copiedProvider === 'ORANGE_CARD' ? 'checkmark' : 'copy-outline'}
                      size={14}
                      color={copiedProvider === 'ORANGE_CARD' ? '#059669' : '#1E293B'}
                    />
                    <Text style={styles.copySmallText}>
                      {copiedProvider === 'ORANGE_CARD' ? 'Copiado' : 'Copiar'}
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={[styles.adminRow, { borderBottomWidth: 0, paddingBottom: 0, marginBottom: 0 }]}>
                  <View style={[styles.opDot, { backgroundColor: '#EAB308' }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.adminOpName}>Telecel / MTN MoMo Oficial</Text>
                    <Text style={styles.adminOpNum}>+{adminMtnNumber}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.copySmallBtn}
                    onPress={() => copyToClipboard(adminMtnNumber, 'MTN_CARD')}
                  >
                    <Ionicons
                      name={copiedProvider === 'MTN_CARD' ? 'checkmark' : 'copy-outline'}
                      size={14}
                      color={copiedProvider === 'MTN_CARD' ? '#059669' : '#1E293B'}
                    />
                    <Text style={styles.copySmallText}>
                      {copiedProvider === 'MTN_CARD' ? 'Copiado' : 'Copiar'}
                    </Text>
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  style={styles.validateSmsLinkBtn}
                  onPress={() => toggleRechargeModal(true, 'TXID')}
                >
                  <Ionicons name="key-outline" size={16} color="#0284C7" />
                  <Text style={styles.validateSmsLinkText}>Já transferi — Validar Código SMS (TxID)</Text>
                </TouchableOpacity>
              </View>

              {/* HISTÓRICO AUDITÁVEL COM ABAS */}
              <View style={styles.historyTabsRow}>
                <TouchableOpacity
                  style={[styles.historyTabBtn, historyTab === 'RIDES' && styles.historyTabBtnActive]}
                  onPress={() => setHistoryTab('RIDES')}
                >
                  <Text style={[styles.historyTabText, historyTab === 'RIDES' && styles.historyTabTextActive]}>
                    Faturamentos ({ridesList.length})
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.historyTabBtn, historyTab === 'TRANSACTIONS' && styles.historyTabBtnActive]}
                  onPress={() => setHistoryTab('TRANSACTIONS')}
                >
                  <Text style={[styles.historyTabText, historyTab === 'TRANSACTIONS' && styles.historyTabTextActive]}>
                    Recargas & Extrato ({txList.length})
                  </Text>
                </TouchableOpacity>
              </View>

              {historyTab === 'RIDES' ? (
                ridesList.length === 0 ? (
                  <View style={styles.emptyBox}>
                    <Ionicons name="car-outline" size={30} color="#94A3B8" />
                    <Text style={styles.emptyTitle}>Nenhuma corrida registrada</Text>
                    <Text style={styles.emptySub}>Seus faturamentos por viagem aparecerão aqui.</Text>
                  </View>
                ) : (
                  ridesList.map((ride: any) => {
                    const isCompleted = ride.status === 'COMPLETED';
                    return (
                      <View key={ride.id} style={styles.historyCard}>
                        <View style={styles.historyTop}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.historyTitle} numberOfLines={1}>
                              {ride.passenger?.fullName || 'Passageiro Nô Bai'}
                            </Text>
                            <Text style={styles.historyDate}>{formatDate(ride.completedAt || ride.createdAt)}</Text>
                          </View>
                          <View style={{ alignItems: 'flex-end' }}>
                            <Text style={[styles.historyAmount, { color: isCompleted ? '#059669' : '#94A3B8' }]}>
                              {isCompleted ? `+${formatMoney(ride.driverEarnings || ride.priceXof)} XOF` : 'Cancelada'}
                            </Text>
                            {isCompleted && (
                              <Text style={styles.historyFeeMeta}>
                                Bruto {formatMoney(ride.priceXof)} • Taxa -{formatMoney(ride.platformFee)}
                              </Text>
                            )}
                          </View>
                        </View>
                        <Text style={styles.historyRoute} numberOfLines={1}>
                          📍 {ride.originAddress} → {ride.destinationAddress}
                        </Text>
                      </View>
                    );
                  })
                )
              ) : txList.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Ionicons name="receipt-outline" size={30} color="#94A3B8" />
                  <Text style={styles.emptyTitle}>Nenhuma movimentação na carteira</Text>
                  <Text style={styles.emptySub}>Suas recargas e débitos de comissão aparecerão aqui.</Text>
                </View>
              ) : (
                txList.map((tx: any) => {
                  const st = getTxStatusBadge(tx.status);
                  const isCredit = tx.type === 'DEPOSIT' || tx.type === 'REFUND' || tx.type === 'PROMO_CREDIT';
                  return (
                    <View key={tx.id} style={styles.historyCard}>
                      <View style={styles.historyTop}>
                        <View style={[styles.txCircle, { backgroundColor: isCredit ? '#D1FAE5' : '#FEF3C7' }]}>
                          <Ionicons
                            name={isCredit ? 'arrow-down-circle' : 'remove-circle'}
                            size={20}
                            color={isCredit ? '#059669' : '#D97706'}
                          />
                        </View>
                        <View style={{ flex: 1, marginLeft: 10 }}>
                          <Text style={styles.historyTitle} numberOfLines={1}>
                            {tx.description || (isCredit ? 'Recarga de Carteira' : 'Comissão de Corrida')}
                          </Text>
                          <Text style={styles.historyDate}>
                            {tx.paymentMethod === 'ORANGE_MONEY'
                              ? 'Orange Money'
                              : tx.paymentMethod === 'MTN_MOMO'
                              ? 'Telecel / MTN'
                              : 'Carteira'}{' '}
                            • {formatDate(tx.createdAt)}
                          </Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={[styles.historyAmount, { color: isCredit ? '#059669' : '#0F172A' }]}>
                            {isCredit ? '+' : '-'}{formatMoney(tx.amount)} XOF
                          </Text>
                          <View style={[styles.statusBadge, { backgroundColor: st.bg }]}>
                            <Text style={[styles.statusBadgeText, { color: st.color }]}>{st.label}</Text>
                          </View>
                        </View>
                      </View>
                      {tx.balanceAfter !== null && tx.balanceAfter !== undefined && (
                        <Text style={styles.balanceAfterText}>
                          Saldo após operação: {formatMoney(tx.balanceAfter)} XOF
                        </Text>
                      )}
                    </View>
                  );
                })
              )}
            </>
          )}
        </ScrollView>
      </View>

      {/* MODAL DE RECARGA (AUTOMÁTICA + SMS TXID) */}
      <Modal
        visible={isRechargeModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => toggleRechargeModal(false)}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.modalOverlay}>
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={styles.modalCard}
            >
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Recarregar Carteira</Text>
                <TouchableOpacity onPress={() => toggleRechargeModal(false)}>
                  <Ionicons name="close" size={24} color="#64748B" />
                </TouchableOpacity>
              </View>

              <View style={styles.modalTabRow}>
                <TouchableOpacity
                  style={[styles.modalTab, rechargeTab === 'AUTO' && styles.modalTabActive]}
                  onPress={() => setRechargeTab('AUTO')}
                >
                  <Text style={[styles.modalTabText, rechargeTab === 'AUTO' && styles.modalTabTextActive]}>
                    ⚡ Recarga Automática
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalTab, rechargeTab === 'TXID' && styles.modalTabActive]}
                  onPress={() => setRechargeTab('TXID')}
                >
                  <Text style={[styles.modalTabText, rechargeTab === 'TXID' && styles.modalTabTextActive]}>
                    📲 Código SMS (TxID)
                  </Text>
                </TouchableOpacity>
              </View>

              {rechargeTab === 'AUTO' ? (
                <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                  <Text style={styles.inputLabel}>Escolha a Operadora</Text>
                  <View style={styles.opRow}>
                    <TouchableOpacity
                      style={[
                        styles.opSelectBtn,
                        rechargeProvider === 'ORANGE_MONEY' && { borderColor: '#FF7900', backgroundColor: '#FFF7ED' }
                      ]}
                      onPress={() => selectRechargeOperator('ORANGE_MONEY')}
                    >
                      <Ionicons name="phone-portrait" size={18} color="#FF7900" />
                      <Text style={styles.opSelectText}>Orange Money</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.opSelectBtn,
                        rechargeProvider === 'MTN_MOMO' && { borderColor: '#EAB308', backgroundColor: '#FEFCE8' }
                      ]}
                      onPress={() => selectRechargeOperator('MTN_MOMO')}
                    >
                      <Ionicons name="wallet" size={18} color="#CA8A04" />
                      <Text style={styles.opSelectText}>Telecel / MTN</Text>
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.inputLabel}>Valor da Recarga (XOF)</Text>
                  <View style={styles.chipsRow}>
                    {QUICK_AMOUNTS.map((amt) => (
                      <TouchableOpacity
                        key={amt}
                        style={[styles.chipBtn, Number(rechargeAmount) === amt && styles.chipBtnActive]}
                        onPress={() => setRechargeAmount(String(amt))}
                      >
                        <Text style={[styles.chipText, Number(rechargeAmount) === amt && styles.chipTextActive]}>
                          {formatMoney(amt)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <View style={styles.fieldBox}>
                    <Text style={styles.fieldPrefix}>XOF</Text>
                    <TextInput
                      style={styles.fieldInput}
                      value={rechargeAmount}
                      onChangeText={(v) => setRechargeAmount(v.replace(/\D/g, ''))}
                      keyboardType="number-pad"
                      placeholder="2500"
                      placeholderTextColor="#94A3B8"
                    />
                  </View>

                  <Text style={styles.inputLabel}>
                    Telemóvel {rechargeProvider === 'ORANGE_MONEY' ? 'Orange (95...)' : 'Telecel / MTN (96 ou 97...)'}
                  </Text>
                  <View style={styles.fieldBox}>
                    <Text style={styles.fieldPrefix}>🇬🇼 +245</Text>
                    <TextInput
                      style={styles.fieldInput}
                      value={rechargePhone}
                      onChangeText={(v) => setRechargePhone(v.replace(/\D/g, '').slice(0, 9))}
                      keyboardType="number-pad"
                      maxLength={9}
                      placeholder={rechargeProvider === 'ORANGE_MONEY' ? '955000000' : '966000000'}
                      placeholderTextColor="#94A3B8"
                    />
                  </View>

                  <TouchableOpacity
                    style={[styles.submitPrimaryBtn, submittingRecharge && { opacity: 0.7 }]}
                    onPress={handleAutoRecharge}
                    disabled={submittingRecharge}
                  >
                    {submittingRecharge ? (
                      <ActivityIndicator color="#FFF" />
                    ) : (
                      <>
                        <Ionicons name="flash" size={18} color="#FFF" />
                        <Text style={styles.submitPrimaryText}>
                          Pagar {rechargeAmount ? `${formatMoney(Number(rechargeAmount))} XOF` : ''}
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                </ScrollView>
              ) : (
                <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                  <Text style={styles.smsHelper}>
                    1. Transfira o valor desejado para a conta oficial Nô Bai 245:{'\n'}
                    2. Copie o código da transação (TxID) no SMS de confirmação e cole abaixo.
                  </Text>

                  <View style={styles.copyBox}>
                    <View>
                      <Text style={styles.copyBoxLabel}>Orange Money Oficial</Text>
                      <Text style={styles.copyBoxNum}>+{adminOrangeNumber}</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.copyActionBtn}
                      onPress={() => copyToClipboard(adminOrangeNumber, 'MODAL_ORANGE')}
                    >
                      <Text style={styles.copyActionText}>
                        {copiedProvider === 'MODAL_ORANGE' ? 'Copiado ✓' : 'Copiar'}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <View style={styles.copyBox}>
                    <View>
                      <Text style={styles.copyBoxLabel}>Telecel / MTN MoMo Oficial</Text>
                      <Text style={styles.copyBoxNum}>+{adminMtnNumber}</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.copyActionBtn}
                      onPress={() => copyToClipboard(adminMtnNumber, 'MODAL_MTN')}
                    >
                      <Text style={styles.copyActionText}>
                        {copiedProvider === 'MODAL_MTN' ? 'Copiado ✓' : 'Copiar'}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.inputLabel}>Código da Transação (TxID do SMS)</Text>
                  <View style={styles.fieldBox}>
                    <Ionicons name="key-outline" size={18} color="#64748B" style={{ marginRight: 8 }} />
                    <TextInput
                      style={styles.fieldInput}
                      value={txId}
                      onChangeText={setTxId}
                      placeholder="Ex: PP261113.1420.A12345"
                      placeholderTextColor="#94A3B8"
                      autoCapitalize="characters"
                    />
                  </View>

                  <TouchableOpacity
                    style={[styles.submitPrimaryBtn, { backgroundColor: '#059669' }, claiming && { opacity: 0.7 }]}
                    onPress={handleClaimTxId}
                    disabled={claiming}
                  >
                    {claiming ? (
                      <ActivityIndicator color="#FFF" />
                    ) : (
                      <Text style={styles.submitPrimaryText}>Validar e Creditar Saldo</Text>
                    )}
                  </TouchableOpacity>
                </ScrollView>
              )}
            </KeyboardAvoidingView>
          </View>
        </TouchableWithoutFeedback>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.primaryDark },
  topHeaderContainer: { paddingHorizontal: 20, paddingBottom: 24 },
  headerTopBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backButton: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.12)', justifyContent: 'center', alignItems: 'center',
  },
  refreshButton: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: 'rgba(255,255,255,0.12)', justifyContent: 'center', alignItems: 'center',
  },
  headerTitle: { color: '#FFF', fontSize: 17, fontWeight: '800' },
  heroAmountBox: { alignItems: 'center', marginTop: 16 },
  heroLabel: { color: '#94A3B8', fontSize: 12, fontWeight: '600' },
  heroAmount: { color: '#FFF', fontSize: 32, fontWeight: '900', marginTop: 4 },
  heroCurrency: { color: '#FFCC00', fontSize: 16, fontWeight: '800' },
  heroSubStats: { color: '#CBD5E1', fontSize: 12, marginTop: 4 },
  quickPillRow: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginTop: 16 },
  quickPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.14)', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20,
  },
  quickPillText: { color: '#FFF', fontSize: 13, fontWeight: '700' },
  contentSheet: {
    flex: 1, backgroundColor: '#F8FAFC',
    borderTopLeftRadius: 26, borderTopRightRadius: 26, overflow: 'hidden',
  },
  scrollContent: { padding: 20 },
  pendingBanner: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF7ED',
    borderWidth: 1, borderColor: '#F97316', borderRadius: 14, padding: 12, marginBottom: 16,
  },
  pendingTitle: { color: '#0F172A', fontWeight: '800', fontSize: 13 },
  pendingSub: { color: '#475569', fontSize: 11, marginTop: 2 },
  pendingBtn: { backgroundColor: '#EA580C', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  pendingBtnText: { color: '#FFF', fontWeight: '800', fontSize: 12 },
  walletSectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: '#0F172A', marginBottom: 10 },
  liveBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#D1FAE5', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, gap: 5 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#059669' },
  liveText: { color: '#059669', fontSize: 11, fontWeight: '700' },
  creditCard: {
    backgroundColor: '#FFF', borderRadius: 18, padding: 16,
    borderWidth: 1, borderColor: '#E2E8F0', elevation: 2,
  },
  creditTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  creditLabel: { color: '#64748B', fontSize: 12, fontWeight: '600' },
  creditBalance: { fontSize: 24, fontWeight: '900', marginTop: 4 },
  rechargeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#059669', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
  },
  rechargeBtnText: { color: '#FFF', fontWeight: '800', fontSize: 13 },
  warningBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA',
    borderRadius: 10, padding: 10, marginTop: 12,
  },
  warningText: { flex: 1, color: '#DC2626', fontSize: 11, fontWeight: '700' },
  creditDivider: { height: 1, backgroundColor: '#F1F5F9', marginVertical: 12 },
  creditFooter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  creditHint: { flex: 1, color: '#64748B', fontSize: 11, lineHeight: 16 },
  iconGrid: { flexDirection: 'row', gap: 10 },
  gridItem: {
    flex: 1, backgroundColor: '#FFF', borderRadius: 16, padding: 12,
    borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center',
  },
  gridIconBox: { width: 38, height: 38, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  gridLabel: { color: '#64748B', fontSize: 11, fontWeight: '600' },
  gridValue: { color: '#0F172A', fontSize: 13, fontWeight: '900', marginTop: 2 },
  gridSub: { color: '#94A3B8', fontSize: 10, marginTop: 2 },
  dailyClosingCard: {
    backgroundColor: '#FFF', borderRadius: 16, padding: 16, marginTop: 12,
    borderWidth: 1, borderColor: '#E2E8F0',
  },
  closingHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  closingTitle: { color: '#0F172A', fontSize: 13, fontWeight: '800' },
  closingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  closingLabel: { color: '#64748B', fontSize: 12 },
  closingVal: { color: '#0F172A', fontSize: 13, fontWeight: '700' },
  closingDivider: { height: 1, backgroundColor: '#E2E8F0', marginVertical: 8 },
  closingNetLabel: { color: '#0F172A', fontSize: 13, fontWeight: '800' },
  closingNetVal: { color: '#059669', fontSize: 15, fontWeight: '900' },
  adminAccountsCard: {
    backgroundColor: '#FFF', borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: '#E2E8F0',
  },
  adminAccountsHint: { color: '#64748B', fontSize: 12, lineHeight: 17, marginBottom: 12 },
  adminRow: {
    flexDirection: 'row', alignItems: 'center', paddingBottom: 10, marginBottom: 10,
    borderBottomWidth: 1, borderBottomColor: '#F1F5F9',
  },
  opDot: { width: 10, height: 10, borderRadius: 5, marginRight: 10 },
  adminOpName: { color: '#64748B', fontSize: 11, fontWeight: '600' },
  adminOpNum: { color: '#0F172A', fontSize: 14, fontWeight: '800', marginTop: 1 },
  copySmallBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#F1F5F9', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
  },
  copySmallText: { color: '#1E293B', fontSize: 12, fontWeight: '700' },
  validateSmsLinkBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#F1F5F9',
  },
  validateSmsLinkText: { color: '#0284C7', fontSize: 13, fontWeight: '800' },
  historyTabsRow: { flexDirection: 'row', gap: 8, marginTop: 22, marginBottom: 12 },
  historyTabBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 12,
    backgroundColor: '#E2E8F0', alignItems: 'center',
  },
  historyTabBtnActive: { backgroundColor: theme.colors.primaryDark },
  historyTabText: { color: '#475569', fontSize: 12, fontWeight: '700' },
  historyTabTextActive: { color: '#FFF', fontWeight: '800' },
  emptyBox: {
    backgroundColor: '#FFF', borderRadius: 16, padding: 24, alignItems: 'center',
    borderWidth: 1, borderColor: '#E2E8F0',
  },
  emptyTitle: { color: '#0F172A', fontSize: 14, fontWeight: '800', marginTop: 8 },
  emptySub: { color: '#64748B', fontSize: 12, textAlign: 'center', marginTop: 4 },
  historyCard: {
    backgroundColor: '#FFF', borderRadius: 14, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: '#E2E8F0',
  },
  historyTop: { flexDirection: 'row', alignItems: 'center' },
  historyTitle: { color: '#0F172A', fontSize: 13, fontWeight: '800' },
  historyDate: { color: '#64748B', fontSize: 11, marginTop: 2 },
  historyAmount: { fontSize: 13, fontWeight: '900' },
  historyFeeMeta: { color: '#64748B', fontSize: 10, marginTop: 2 },
  historyRoute: { color: '#475569', fontSize: 11, marginTop: 8 },
  txCircle: { width: 38, height: 38, borderRadius: 19, justifyContent: 'center', alignItems: 'center' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8, marginTop: 4 },
  statusBadgeText: { fontSize: 10, fontWeight: '800' },
  balanceAfterText: { color: '#64748B', fontSize: 11, marginTop: 8, paddingTop: 6, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.6)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: '#FFF', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, maxHeight: '88%',
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  modalTitle: { color: '#0F172A', fontSize: 18, fontWeight: '900' },
  modalTabRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  modalTab: { flex: 1, paddingVertical: 10, borderRadius: 12, backgroundColor: '#F1F5F9', alignItems: 'center' },
  modalTabActive: { backgroundColor: theme.colors.primaryDark },
  modalTabText: { color: '#475569', fontSize: 12, fontWeight: '700' },
  modalTabTextActive: { color: '#FFF', fontWeight: '800' },
  inputLabel: { color: '#334155', fontSize: 12, fontWeight: '700', marginBottom: 6, marginTop: 8 },
  opRow: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  opSelectBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 12, borderWidth: 1.5, borderColor: '#E2E8F0', backgroundColor: '#FFF',
  },
  opSelectText: { color: '#0F172A', fontSize: 13, fontWeight: '800' },
  chipsRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  chipBtn: {
    flex: 1, paddingVertical: 8, borderRadius: 10, backgroundColor: '#F8FAFC',
    borderWidth: 1, borderColor: '#E2E8F0', alignItems: 'center',
  },
  chipBtnActive: { borderColor: '#F59E0B', backgroundColor: '#FEF3C7' },
  chipText: { color: '#475569', fontSize: 12, fontWeight: '700' },
  chipTextActive: { color: '#B45309', fontWeight: '900' },
  fieldBox: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8FAFC',
    borderRadius: 12, borderWidth: 1, borderColor: '#CBD5E1', paddingHorizontal: 12, height: 48, marginBottom: 10,
  },
  fieldPrefix: { color: '#0F172A', fontSize: 14, fontWeight: '800', marginRight: 8 },
  fieldInput: { flex: 1, color: '#0F172A', fontSize: 15, fontWeight: '700' },
  submitPrimaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: theme.colors.primaryDark, height: 48, borderRadius: 12, marginTop: 10, marginBottom: 10,
  },
  submitPrimaryText: { color: '#FFF', fontSize: 15, fontWeight: '800' },
  smsHelper: { color: '#475569', fontSize: 12, lineHeight: 18, marginBottom: 12 },
  copyBox: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#F8FAFC', borderRadius: 12, padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: '#E2E8F0',
  },
  copyBoxLabel: { color: '#64748B', fontSize: 11, fontWeight: '600' },
  copyBoxNum: { color: '#0F172A', fontSize: 15, fontWeight: '900', marginTop: 2 },
  copyActionBtn: { backgroundColor: '#E2E8F0', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  copyActionText: { color: '#0F172A', fontSize: 12, fontWeight: '800' },
});
