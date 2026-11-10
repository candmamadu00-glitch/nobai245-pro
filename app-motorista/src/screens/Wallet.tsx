import React, { useState, useEffect, useRef } from 'react';
import { 
  View, Text, StyleSheet, TouchableOpacity, 
  ScrollView, Platform, StatusBar, ActivityIndicator, RefreshControl, Modal, TextInput, Alert, Clipboard,
  KeyboardAvoidingView, TouchableWithoutFeedback, Keyboard 
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { api } from '../services/api';
import { socket } from '../services/socket';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme/theme';

export function Wallet() {
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const isMountedRef = useRef(true);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [financeData, setFinanceData] = useState<any>(null);
  const [isRechargeModalVisible, setIsRechargeModalVisible] = useState(false);

  // Estado para resgate de transação realizada por outro número
  const [txId, setTxId] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [copiedProvider, setCopiedProvider] = useState<string | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    console.log('💳 [WALLET_DEBUG] Componente Wallet montado.');
    fetchWalletData();

    // 📡 Escuta Socket em tempo real emitida pelo webhookRoutes.ts (/sms-gateway)
    if (socket) {
      console.log('📡 [SOCKET_DEBUG] Registrando ouvinte em tempo real: "wallet:updated"');
      const handleWalletUpdated = (data: any) => {
        console.log('⚡ [SOCKET_DEBUG] Evento "wallet:updated" recebido:', data);
        if (isMountedRef.current) {
          fetchWalletData();
        }
      };

      socket.on('wallet:updated', handleWalletUpdated);
      return () => {
        isMountedRef.current = false;
        console.log('📡 [SOCKET_DEBUG] Removendo ouvinte: "wallet:updated"');
        socket.off('wallet:updated', handleWalletUpdated);
      };
    }

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  async function fetchWalletData() {
    try {
      console.log('💳 [WALLET_DEBUG] Buscando dados financeiros via GET /drivers/finance...');
      const res = await api.get('/drivers/finance');
      if (isMountedRef.current) {
        console.log('✅ [WALLET_DEBUG] Resumo financeiro recarregado:', res.data);
        setFinanceData(res.data);
      }
    } catch (error: any) {
      console.error('❌ [WALLET_DEBUG] Erro ao carregar dados da carteira:', error?.response?.data || error?.message || error);
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }

  function handleRefresh() {
    console.log('🔄 [WALLET_DEBUG] Atualização manual acionada pelo usuário.');
    setRefreshing(true);
    fetchWalletData();
  }

  function formatMoney(value?: number | string) {
    if (value === null || value === undefined) return '0';
    const num = Number(value);
    if (isNaN(num)) return '0';
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }

  const toggleRechargeModal = (visible: boolean) => {
    console.log(`📲 [RECHARGE_DEBUG] Modal de recarga alterado para: ${visible}`);
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
      console.error('❌ [CLAIM_TXID_ERROR]:', error?.response?.data || error?.message);
      Alert.alert(
        'Falha no Resgate',
        error?.response?.data?.error || 'Código de transação não localizado ou já utilizado. Verifique os dígitos no SMS.'
      );
    } finally {
      if (isMountedRef.current) setClaiming(false);
    }
  }

  const dynamicTopPadding = Math.max((insets?.top || 0) + 6, Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 6 : 14);
  const dynamicBottomPadding = Math.max((insets?.bottom || 0) + 16, Platform.OS === 'android' ? 28 : 16);

  // 🟢 CORREÇÃO: Ignora números fictícios zerados vindo do backend e força o fallback correto
  const adminOrangeNumber = 
    financeData?.adminOrangeNumber && 
    financeData.adminOrangeNumber.trim() !== '' && 
    !financeData.adminOrangeNumber.includes('000000')
      ? financeData.adminOrangeNumber 
      : '245957341832';

  const adminMtnNumber = 
    financeData?.adminMtnNumber && 
    financeData.adminMtnNumber.trim() !== '' && 
    !financeData.adminMtnNumber.includes('000000')
      ? financeData.adminMtnNumber 
      : (financeData?.mtnNumber || financeData?.mtn || '245966626730');

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={theme.colors.primaryDark} translucent />
      
      {/* HEADER HERO BANCO DIGITAL */}
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

      {/* FOLHA BRANCA SOBREPOSTA */}
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
              {/* RESUMO DE OPERAÇÕES */}
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

                {/* BOTÃO QUE ABRE O MODAL DE RECARGA */}
                <TouchableOpacity 
                  style={styles.rechargeButton}
                  onPress={() => toggleRechargeModal(true)}
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

      {/* 📲 MODAL COM KEYBOARD AVOIDING VIEW */}
      <Modal
        visible={isRechargeModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => toggleRechargeModal(false)}
      >
        <KeyboardAvoidingView 
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.modalBackdropTouch} />
          </TouchableWithoutFeedback>

          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Recarga de Saldo Instantânea</Text>
              <TouchableOpacity onPress={() => toggleRechargeModal(false)}>
                <Ionicons name="close-circle" size={26} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            <ScrollView 
              showsVerticalScrollIndicator={false} 
              style={styles.modalScrollView}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.modalDescription}>
                Envie o valor da recarga via USSD para um dos números oficiais da plataforma abaixo:
              </Text>

              {/* NÚMERO ORANGE MONEY */}
              <View style={[styles.numberCard, { borderColor: '#FF7900' }]}>
                <View style={{ flex: 1 }}>
                  <View style={[styles.providerBadge, { backgroundColor: '#FF7900' }]}>
                    <Text style={styles.providerBadgeText}>Orange Money</Text>
                  </View>
                  <Text style={styles.numberText}>{adminOrangeNumber}</Text>
                </View>

                <TouchableOpacity 
                  style={[styles.copyBtn, copiedProvider === 'ORANGE' && styles.copyBtnSuccess]} 
                  onPress={() => copyToClipboard(adminOrangeNumber, 'ORANGE')}
                >
                  <Ionicons name={copiedProvider === 'ORANGE' ? "checkmark-done" : "copy-outline"} size={16} color="#FFF" />
                  <Text style={styles.copyBtnText}>{copiedProvider === 'ORANGE' ? "Copiado" : "Copiar"}</Text>
                </TouchableOpacity>
              </View>

              {/* NÚMERO MTN MOMO */}
              <View style={[styles.numberCard, { borderColor: '#EAB308' }]}>
                <View style={{ flex: 1 }}>
                  <View style={[styles.providerBadge, { backgroundColor: '#EAB308' }]}>
                    <Text style={[styles.providerBadgeText, { color: '#0F172A' }]}>MTN MoMo</Text>
                  </View>
                  <Text style={styles.numberText}>{adminMtnNumber}</Text>
                </View>

                <TouchableOpacity 
                  style={[styles.copyBtn, copiedProvider === 'MTN' && styles.copyBtnSuccess]} 
                  onPress={() => copyToClipboard(adminMtnNumber, 'MTN')}
                >
                  <Ionicons name={copiedProvider === 'MTN' ? "checkmark-done" : "copy-outline"} size={16} color="#FFF" />
                  <Text style={styles.copyBtnText}>{copiedProvider === 'MTN' ? "Copiado" : "Copiar"}</Text>
                </TouchableOpacity>
              </View>

              {/* SEÇÃO PARA ENVIOS DE OUTRO NÚMERO / RESGATE POR TXID */}
              <View style={styles.claimSection}>
                <Text style={styles.claimSectionTitle}>
                  💡 Transferiu de outro número (parente/amigo)?
                </Text>
                <Text style={styles.claimSectionSub}>
                  Cole o código da transação (ID / Ref) recebido na mensagem SMS para validar seu saldo agora:
                </Text>

                <View style={styles.claimInputRow}>
                  <TextInput
                    style={styles.claimInput}
                    placeholder="Ex: 12984920492"
                    placeholderTextColor="#94A3B8"
                    value={txId}
                    onChangeText={setTxId}
                    keyboardType="number-pad"
                  />
                  <TouchableOpacity 
                    style={[styles.claimBtn, claiming && { opacity: 0.7 }]} 
                    onPress={handleClaimTxId}
                    disabled={claiming}
                  >
                    {claiming ? (
                      <ActivityIndicator size="small" color="#FFF" />
                    ) : (
                      <Text style={styles.claimBtnText}>Validar</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>

            <TouchableOpacity 
              style={styles.modalCloseButton} 
              onPress={() => toggleRechargeModal(false)}
            >
              <Text style={styles.modalCloseButtonText}>Fechar</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
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

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalBackdropTouch: {
    flex: 1,
  },
  modalContent: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: theme.colors.textPrimary,
  },
  modalDescription: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    lineHeight: 18,
    marginBottom: 14,
  },
  modalScrollView: {
    flexGrow: 0,
  },
  numberCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    backgroundColor: '#F8FAFC',
    marginBottom: 10,
  },
  providerBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginBottom: 4,
  },
  providerBadgeText: {
    color: '#FFF',
    fontWeight: '800',
    fontSize: 11,
  },
  numberText: {
    fontSize: 18,
    fontWeight: '900',
    color: theme.colors.textPrimary,
    letterSpacing: 1,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.primaryDark,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    gap: 4,
  },
  copyBtnSuccess: {
    backgroundColor: theme.colors.emeraldGreen,
  },
  copyBtnText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 12,
  },
  claimSection: {
    backgroundColor: '#F0F9FF',
    borderRadius: 14,
    padding: 14,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#BAE6FD',
    marginBottom: 10,
  },
  claimSectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0369A1',
    marginBottom: 4,
  },
  claimSectionSub: {
    fontSize: 12,
    color: '#0284C7',
    lineHeight: 16,
    marginBottom: 10,
  },
  claimInputRow: {
    flexDirection: 'row',
    gap: 8,
  },
  claimInput: {
    flex: 1,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#7DD3FC',
    borderRadius: 10,
    paddingHorizontal: 12,
    fontSize: 14,
    fontWeight: '700',
    color: theme.colors.textPrimary,
    height: 44,
  },
  claimBtn: {
    backgroundColor: '#0284C7',
    paddingHorizontal: 16,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  claimBtnText: {
    color: '#FFF',
    fontWeight: '800',
    fontSize: 13,
  },
  modalCloseButton: {
    backgroundColor: theme.colors.primaryDark,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  modalCloseButtonText: {
    color: '#FFF',
    fontWeight: '800',
    fontSize: 15,
  },
});