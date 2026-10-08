import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Modal,
  Alert,
  Platform,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../services/api';

interface RideHistoryItem {
  id: string;
  createdAt: string;
  originAddress: string;
  destinationAddress: string;
  priceXof: number;
  status: 'COMPLETED' | 'CANCELLED';
  passenger: {
    fullName: string;
    profilePicture?: string;
  };
}

interface FinanceData {
  totalEarned: number;
  mobileMoneyAccount: string;
  totalRides: number;
  history: RideHistoryItem[];
}

function formatCurrency(amount: number | string | undefined | null): string {
  const num = Math.round(Number(amount) || 0);
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function formatDate(dateString: string): string {
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return dateString;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${day}/${month} às ${hours}:${minutes}`;
  } catch {
    return dateString;
  }
}

export function Earnings({ navigation }: any) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [finance, setFinance] = useState<FinanceData | null>(null);

  const [isModalVisible, setIsModalVisible] = useState(false);
  const [paymentProvider, setPaymentProvider] = useState<'ORANGE' | 'MTN'>('ORANGE');
  const [accountNumber, setAccountNumber] = useState('');
  const [updatingAccount, setUpdatingAccount] = useState(false);

  const fetchFinanceData = async () => {
    try {
      const response = await api.get('/drivers/finance');
      setFinance(response.data);
    } catch (error: any) {
      Alert.alert('Erro', error.response?.data?.error || 'Não foi possível carregar o extrato financeiro.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchFinanceData();
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchFinanceData();
  }, []);

  const handleUpdatePaymentInfo = async () => {
    const cleanNumber = accountNumber.trim().replace(/\D/g, '');
    if (!cleanNumber || cleanNumber.length !== 9) {
      Alert.alert('Atenção', 'Informe um número de telefone válido com 9 dígitos.');
      return;
    }

    setUpdatingAccount(true);
    try {
      // 🛡️ BLINDAGEM: Payload duplo para garantir compatibilidade com qualquer versão do backend
      await api.put('/drivers/payment-info', {
        mobileMoneyNumber: cleanNumber,
        mobileMoneyProvider: paymentProvider,
        paymentAccountNumber: cleanNumber,
        paymentProvider: paymentProvider === 'ORANGE' ? 'ORANGE_MONEY' : 'MTN_MOMO',
      });
      Alert.alert('Sucesso', 'Conta de recebimento atualizada com sucesso!');
      setIsModalVisible(false);
      setAccountNumber('');
      fetchFinanceData();
    } catch (error: any) {
      Alert.alert('Erro', error.response?.data?.error || error.response?.data?.message || 'Falha ao atualizar dados de pagamento.');
    } finally {
      setUpdatingAccount(false);
    }
  };

  const totalNet = finance?.totalEarned || 0;
  const totalGross = Math.round(totalNet / 0.8);
  const platformFee = Math.round(totalGross - totalNet);

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#059669" />
        <Text style={styles.loadingText}>Carregando dados financeiros...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" translucent />
      
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={24} color="#1F2937" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Ganhos e Carteira</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#059669']} />}
      >
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Total Recebido (Líquido)</Text>
          <Text style={styles.balanceValue}>{formatCurrency(totalNet)} XOF</Text>

          <View style={styles.divider} />

          <View style={styles.metricsRow}>
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Total Bruto</Text>
              <Text style={styles.metricValue}>{formatCurrency(totalGross)} XOF</Text>
            </View>
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Taxa Nobai (20%)</Text>
              <Text style={[styles.metricValue, { color: '#F87171' }]}>
                -{formatCurrency(platformFee)} XOF
              </Text>
            </View>
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Viagens</Text>
              <Text style={styles.metricValue}>{finance?.totalRides || 0}</Text>
            </View>
          </View>
        </View>

        <View style={styles.accountCard}>
          <View style={styles.accountHeader}>
            <View style={styles.accountTitleRow}>
              <Ionicons name="wallet-outline" size={22} color="#059669" />
              <Text style={styles.accountTitle}>Conta de Repasse Automático</Text>
            </View>
            <TouchableOpacity onPress={() => setIsModalVisible(true)}>
              <Text style={styles.editButtonText}>Alterar</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.accountSubtext}>
            Seus ganhos são transferidos automaticamente após cada corrida concluída.
          </Text>

          <View style={styles.accountBadge}>
            <Ionicons name="checkmark-circle" size={18} color="#059669" />
            <Text style={styles.accountBadgeText}>
              {finance?.mobileMoneyAccount ? `+245 ${finance.mobileMoneyAccount}` : 'Telefone de Cadastro'}
            </Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Histórico de Corridas e Repasses</Text>

        {!finance?.history || finance.history.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="receipt-outline" size={48} color="#9CA3AF" />
            <Text style={styles.emptyText}>Nenhuma corrida registrada até o momento.</Text>
          </View>
        ) : (
          finance.history.map((item) => {
            const itemGross = item.priceXof || 0;
            const itemNet = Math.round(itemGross * 0.8);

            return (
              <View key={item.id} style={styles.rideCard}>
                <View style={styles.rideHeader}>
                  <Text style={styles.rideDate}>{formatDate(item.createdAt)}</Text>
                  <View
                    style={[
                      styles.statusTag,
                      item.status === 'COMPLETED' ? styles.statusCompleted : styles.statusCancelled,
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusTagText,
                        item.status === 'COMPLETED' ? styles.statusCompletedText : styles.statusCancelledText,
                      ]}
                    >
                      {item.status === 'COMPLETED' ? 'Concluída' : 'Cancelada'}
                    </Text>
                  </View>
                </View>

                <View style={styles.routeContainer}>
                  <Text style={styles.routeText} numberOfLines={1}>
                    📍 {item.originAddress}
                  </Text>
                  <Text style={styles.routeText} numberOfLines={1}>
                    🏁 {item.destinationAddress}
                  </Text>
                </View>

                <View style={styles.rideFooter}>
                  <Text style={styles.passengerName}>Passageiro: {item.passenger?.fullName || 'Cliente'}</Text>
                  <View style={styles.payoutBadge}>
                    <Text style={styles.payoutGross}>{formatCurrency(itemGross)} XOF</Text>
                    <Text style={styles.payoutNet}>+ {formatCurrency(itemNet)} XOF Líq.</Text>
                  </View>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      <Modal visible={isModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Configurar Repasse</Text>
              <TouchableOpacity onPress={() => setIsModalVisible(false)}>
                <Ionicons name="close" size={24} color="#6B7280" />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSubtext}>
              Selecione a operadora e o número local (9 dígitos) que receberá o dinheiro:
            </Text>

            <View style={styles.providerSelector}>
              <TouchableOpacity
                style={[
                  styles.providerOption,
                  paymentProvider === 'ORANGE' && styles.providerOptionActive,
                ]}
                onPress={() => setPaymentProvider('ORANGE')}
              >
                <Text
                  style={[
                    styles.providerOptionText,
                    paymentProvider === 'ORANGE' && styles.providerOptionTextActive,
                  ]}
                >
                  Orange Money
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.providerOption,
                  paymentProvider === 'MTN' && styles.providerOptionActive,
                ]}
                onPress={() => setPaymentProvider('MTN')}
              >
                <Text
                  style={[
                    styles.providerOptionText,
                    paymentProvider === 'MTN' && styles.providerOptionTextActive,
                  ]}
                >
                  MTN MoMo
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.inputLabel}>Número de Telefone da Carteira</Text>
            <TextInput
              style={styles.input}
              placeholder="Ex: 955001122"
              keyboardType="phone-pad"
              value={accountNumber}
              onChangeText={setAccountNumber}
              maxLength={9}
            />

            <TouchableOpacity
              style={styles.saveButton}
              onPress={handleUpdatePaymentInfo}
              disabled={updatingAccount}
            >
              {updatingAccount ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.saveButtonText}>Salvar Conta de Recebimento</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F9FAFB' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F9FAFB' },
  loadingText: { marginTop: 12, color: '#4B5563', fontSize: 14 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justify: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 10 : 50,
    paddingBottom: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
  },
  backButton: { padding: 4 },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#1F2937' },
  balanceCard: {
    margin: 16,
    padding: 20,
    backgroundColor: '#059669',
    borderRadius: 16,
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
  },
  balanceLabel: { color: '#D1FAE5', fontSize: 14, fontWeight: '500' },
  balanceValue: { color: '#FFFFFF', fontSize: 28, fontWeight: 'bold', marginTop: 4 },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.2)', marginVertical: 16 },
  metricsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  metricItem: { alignItems: 'center' },
  metricLabel: { color: '#D1FAE5', fontSize: 11 },
  metricValue: { color: '#FFFFFF', fontSize: 14, fontWeight: 'bold', marginTop: 2 },
  accountCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  accountHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  accountTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  accountTitle: { fontSize: 15, fontWeight: 'bold', color: '#1F2937' },
  editButtonText: { color: '#059669', fontWeight: 'bold', fontSize: 14 },
  accountSubtext: { fontSize: 12, color: '#6B7280', marginTop: 6, marginBottom: 12 },
  accountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    padding: 10,
    borderRadius: 8,
    gap: 8,
  },
  accountBadgeText: { color: '#047857', fontWeight: '600', fontSize: 14 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: '#1F2937', marginHorizontal: 16, marginBottom: 12 },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyText: { color: '#9CA3AF', marginTop: 8, fontSize: 14 },
  rideCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  rideHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  rideDate: { fontSize: 12, color: '#6B7280' },
  statusTag: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12 },
  statusCompleted: { backgroundColor: '#D1FAE5' },
  statusCancelled: { backgroundColor: '#FEE2E2' },
  statusTagText: { fontSize: 11, fontWeight: 'bold' },
  statusCompletedText: { color: '#047857' },
  statusCancelledText: { color: '#DC2626' },
  routeContainer: { marginVertical: 6, gap: 2 },
  routeText: { fontSize: 13, color: '#374151' },
  rideFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  passengerName: { fontSize: 12, color: '#4B5563' },
  payoutBadge: { alignItems: 'flex-end' },
  payoutGross: { fontSize: 11, color: '#9CA3AF', textDecorationLine: 'line-through' },
  payoutNet: { fontSize: 14, fontWeight: 'bold', color: '#059669' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalContainer: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#1F2937' },
  modalSubtext: { fontSize: 13, color: '#6B7280', marginBottom: 16 },
  providerSelector: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  providerOption: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D1D5DB',
  },
  providerOptionActive: { borderColor: '#059669', backgroundColor: '#ECFDF5' },
  providerOptionText: { color: '#4B5563', fontWeight: 'bold' },
  providerOptionTextActive: { color: '#059669' },
  inputLabel: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    marginBottom: 20,
  },
  saveButton: { backgroundColor: '#059669', paddingVertical: 14, borderRadius: 8, alignItems: 'center' },
  saveButtonText: { color: '#FFFFFF', fontWeight: 'bold', fontSize: 15 },
});