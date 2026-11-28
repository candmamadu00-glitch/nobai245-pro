import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
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
  KeyboardAvoidingView,
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

const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export function Earnings({ navigation }: any) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [finance, setFinance] = useState<FinanceData | null>(null);
  const [scaleStatus, setScaleStatus] = useState<{
    wallet?: { balanceXof: number; minAllowedXof: number; isBlockedByDebt: boolean };
    compliance?: { autoBlockExpiredDocs: boolean; alerts: Array<{ type: string; status: string; date: string }> };
    fleetPartner?: { ownerName: string; ownerSharePercent: number } | null;
    missions?: Array<{
      id: string;
      title: string;
      description?: string;
      targetRides: number;
      completedRides: number;
      progressPercent: number;
      isCompleted: boolean;
      rewardXof: number;
    }>;
  } | null>(null);

  const [isModalVisible, setIsModalVisible] = useState(false);
  const [paymentProvider, setPaymentProvider] = useState<'ORANGE' | 'MTN'>('ORANGE');
  const [accountNumber, setAccountNumber] = useState('');
  const [updatingAccount, setUpdatingAccount] = useState(false);

  const fetchFinanceData = async () => {
    try {
      const [response, scaleRes] = await Promise.all([
        api.get('/drivers/finance'),
        api.get('/drivers/scale-status').catch(() => null),
      ]);
      setFinance(response.data);
      if (scaleRes?.data?.success) {
        setScaleStatus(scaleRes.data);
      }
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

  const weeklyChart = useMemo(() => {
    const now = new Date();
    const days: Array<{ key: string; label: string; netXof: number; ridesCount: number; isToday: boolean }> = [];

    for (let i = 6; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      days.push({
        key,
        label: WEEKDAY_LABELS[d.getDay()],
        netXof: 0,
        ridesCount: 0,
        isToday: i === 0,
      });
    }

    const dayMap = new Map(days.map((item) => [item.key, item]));
    const list = finance?.history || [];
    for (const ride of list) {
      if (ride.status !== 'COMPLETED' || !ride.createdAt) continue;
      const rd = new Date(ride.createdAt);
      if (isNaN(rd.getTime())) continue;
      const key = `${rd.getFullYear()}-${String(rd.getMonth() + 1).padStart(2, '0')}-${String(rd.getDate()).padStart(2, '0')}`;
      const bucket = dayMap.get(key);
      if (bucket) {
        bucket.netXof += Math.round((Number(ride.priceXof) || 0) * 0.8);
        bucket.ridesCount += 1;
      }
    }

    const maxVal = Math.max(1000, ...days.map((d) => d.netXof));
    const weekTotal = days.reduce((acc, d) => acc + d.netXof, 0);
    return { days, maxVal, weekTotal };
  }, [finance?.history]);

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
          <Ionicons name="arrow-back" size={22} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('earnings_title', 'Ganhos e Carteira')}</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 28 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#059669']} />}
      >
        <View style={styles.balanceCard}>
          <View style={styles.balanceTopRow}>
            <Text style={styles.balanceLabel}>Total Recebido (Líquido)</Text>
            <View style={styles.liveTag}>
              <Ionicons name="shield-checkmark" size={12} color="#ECFDF5" />
              <Text style={styles.liveTagText}>Nô Bai Pay</Text>
            </View>
          </View>
          <Text style={styles.balanceValue}>{formatCurrency(totalNet)} XOF</Text>

          <View style={styles.divider} />

          <View style={styles.metricsRow}>
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Total Bruto</Text>
              <Text style={styles.metricValue}>{formatCurrency(totalGross)} XOF</Text>
            </View>
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Taxa Nobai (20%)</Text>
              <Text style={[styles.metricValue, { color: '#FDE68A' }]}>
                -{formatCurrency(platformFee)} XOF
              </Text>
            </View>
            <View style={styles.metricItem}>
              <Text style={styles.metricLabel}>Viagens</Text>
              <Text style={styles.metricValue}>{finance?.totalRides || 0}</Text>
            </View>
          </View>
        </View>

        {/* 📊 DESEMPENHO DOS ÚLTIMOS 7 DIAS */}
        <View style={styles.chartCard}>
          <View style={styles.chartHeader}>
            <View>
              <Text style={styles.chartTitle}>Desempenho Semanal</Text>
              <Text style={styles.chartSub}>Últimos 7 dias (ganho líquido)</Text>
            </View>
            <View style={styles.chartTotalPill}>
              <Text style={styles.chartTotalText}>{formatCurrency(weeklyChart.weekTotal)} XOF</Text>
            </View>
          </View>

          <View style={styles.barsRow}>
            {weeklyChart.days.map((day) => {
              const barHeight = day.netXof > 0
                ? Math.max(14, Math.round((day.netXof / weeklyChart.maxVal) * 86))
                : 8;
              return (
                <View key={day.key} style={styles.barColumn}>
                  <Text style={styles.barValueLabel} numberOfLines={1}>
                    {day.netXof > 0 ? `${Math.round(day.netXof / 1000)}k` : ''}
                  </Text>
                  <View style={styles.barTrack}>
                    <View
                      style={[
                        styles.barFill,
                        {
                          height: barHeight,
                          backgroundColor: day.isToday
                            ? '#EAB308'
                            : day.netXof > 0
                            ? '#059669'
                            : '#E2E8F0',
                        },
                      ]}
                    />
                  </View>
                  <Text style={[styles.barDayLabel, day.isToday && styles.barDayLabelToday]}>
                    {day.isToday ? 'Hoje' : day.label}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* ALERTAS DE CONFORMIDADE DOCUMENTAL E LIMITE DE CARTEIRA */}
        {scaleStatus?.wallet?.isBlockedByDebt && (
          <View style={{ marginHorizontal: 16, marginBottom: 12, padding: 14, backgroundColor: '#FEF2F2', borderRadius: 16, borderWidth: 1, borderColor: '#FCA5A5', flexDirection: 'row', alignItems: 'center' }}>
            <Ionicons name="alert-circle" size={24} color="#DC2626" />
            <View style={{ marginLeft: 10, flex: 1 }}>
              <Text style={{ color: '#991B1B', fontWeight: 'bold', fontSize: 13 }}>Saldo Abaixo do Mínimo Operacional</Text>
              <Text style={{ color: '#B91C1C', fontSize: 12, marginTop: 2 }}>
                Recarregue sua carteira (mínimo {formatCurrency(scaleStatus.wallet.minAllowedXof)} XOF) para continuar recebendo chamadas.
              </Text>
            </View>
          </View>
        )}

        {scaleStatus?.compliance?.alerts && scaleStatus.compliance.alerts.length > 0 && (
          <View style={{ marginHorizontal: 16, marginBottom: 12, padding: 14, backgroundColor: '#FFFBEB', borderRadius: 16, borderWidth: 1, borderColor: '#FCD34D' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
              <Ionicons name="document-text" size={20} color="#D97706" />
              <Text style={{ color: '#92400E', fontWeight: 'bold', fontSize: 13, marginLeft: 8 }}>Aviso de Documentação</Text>
            </View>
            {scaleStatus.compliance.alerts.map((al, idx) => (
              <Text key={idx} style={{ color: '#B45309', fontSize: 12, marginTop: 2 }}>
- {al.type}: {al.status === 'EXPIRED' ? 'VENCIDO' : 'Vence em breve'} ({formatDate(al.date).split(' ')[0]})
              </Text>
            ))}
          </View>
        )}

        {/* VÍNCULO COM FROTISTA */}
        {scaleStatus?.fleetPartner && (
          <View style={{ marginHorizontal: 16, marginBottom: 12, padding: 14, backgroundColor: '#EFF6FF', borderRadius: 16, borderWidth: 1, borderColor: '#BFDBFE', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Ionicons name="car-sport" size={22} color="#2563EB" />
              <View style={{ marginLeft: 10 }}>
                <Text style={{ color: '#1E40AF', fontWeight: 'bold', fontSize: 13 }}>Veículo de Frota Parceira</Text>
                <Text style={{ color: '#3B82F6', fontSize: 12 }}>Proprietário: {scaleStatus.fleetPartner.ownerName}</Text>
              </View>
            </View>
            <Text style={{ color: '#1D4ED8', fontWeight: 'bold', fontSize: 12 }}>
              Repasse {scaleStatus.fleetPartner.ownerSharePercent}%
            </Text>
          </View>
        )}

        {/* MISSÕES E METAS ATIVAS */}
        {scaleStatus?.missions && scaleStatus.missions.length > 0 && (
          <View style={{ marginHorizontal: 16, marginBottom: 16, padding: 16, backgroundColor: '#FFFFFF', borderRadius: 20, borderWidth: 1, borderColor: '#E2E8F0' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="trophy" size={20} color="#D97706" />
                <Text style={{ fontSize: 15, fontWeight: '800', color: '#0F172A', marginLeft: 8 }}>Missões & Bônus da Frota</Text>
              </View>
              <Text style={{ fontSize: 11, color: '#059669', fontWeight: '800' }}>ATIVO</Text>
            </View>

            {scaleStatus.missions.map((m) => (
              <View key={m.id} style={{ backgroundColor: '#F8FAFC', padding: 12, borderRadius: 14, marginBottom: 10, borderWidth: 1, borderColor: m.isCompleted ? '#10B981' : '#E2E8F0' }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text style={{ fontSize: 14, fontWeight: 'bold', color: '#0F172A', flex: 1 }}>{m.title}</Text>
                  <View style={{ backgroundColor: '#D1FAE5', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
                    <Text style={{ color: '#047857', fontWeight: 'bold', fontSize: 12 }}>+{formatCurrency(m.rewardXof)} XOF</Text>
                  </View>
                </View>
                {m.description ? <Text style={{ fontSize: 12, color: '#64748B', marginTop: 3 }}>{m.description}</Text> : null}
                <View style={{ height: 8, backgroundColor: '#E2E8F0', borderRadius: 4, overflow: 'hidden', marginTop: 10 }}>
                  <View style={{ height: '100%', width: `${m.progressPercent}%`, backgroundColor: m.isCompleted ? '#059669' : '#EAB308', borderRadius: 4 }} />
                </View>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                  <Text style={{ fontSize: 11, color: '#475569', fontWeight: '600' }}>
                    Progresso: {m.completedRides} / {m.targetRides} viagens
                  </Text>
                  <Text style={{ fontSize: 11, color: m.isCompleted ? '#059669' : '#D97706', fontWeight: 'bold' }}>
                    {m.isCompleted ? 'Meta Concluída!' : `${m.progressPercent}%`}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={styles.accountCard}>
          <View style={styles.accountHeader}>
            <View style={styles.accountTitleRow}>
              <Ionicons name="wallet-outline" size={22} color="#059669" />
              <Text style={styles.accountTitle}>Conta de Repasse Automático</Text>
            </View>
            <TouchableOpacity onPress={() => setIsModalVisible(true)} style={styles.editPillBtn}>
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
            <Ionicons name="receipt-outline" size={48} color="#94A3B8" />
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
                  <View style={styles.routeLineRow}>
                    <View style={styles.dotGreen} />
                    <Text style={styles.routeText} numberOfLines={1}>
                      {item.originAddress}
                    </Text>
                  </View>
                  <View style={styles.routeLineRow}>
                    <View style={styles.dotDark} />
                    <Text style={styles.routeText} numberOfLines={1}>
                      {item.destinationAddress}
                    </Text>
                  </View>
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

      <Modal visible={isModalVisible} transparent animationType="slide" onRequestClose={() => setIsModalVisible(false)}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Configurar Repasse</Text>
              <TouchableOpacity
                onPress={() => setIsModalVisible(false)}
                style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: '#F1F5F9', justifyContent: 'center', alignItems: 'center' }}
              >
                <Ionicons name="close" size={20} color="#475569" />
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
                  Telecel (antigo MTN)
                </Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.inputLabel}>Número de Telefone da Carteira</Text>
            <TextInput
              style={styles.input}
              placeholder="Ex: 955001122"
              placeholderTextColor="#94A3B8"
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
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F8FAFC' },
  loadingText: { marginTop: 12, color: '#475569', fontSize: 14, fontWeight: '600' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) + 10 : 50,
    paddingBottom: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  backButton: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#F1F5F9', justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#0F172A' },
  balanceCard: {
    margin: 16,
    padding: 20,
    backgroundColor: '#059669',
    borderRadius: 24,
    elevation: 4,
    shadowColor: '#059669',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 12,
  },
  balanceTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  balanceLabel: { color: '#D1FAE5', fontSize: 13.5, fontWeight: '600' },
  liveTag: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.16)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  liveTagText: { color: '#ECFDF5', fontSize: 11, fontWeight: '800' },
  balanceValue: { color: '#FFFFFF', fontSize: 30, fontWeight: '900', marginTop: 6 },
  divider: { height: 1, backgroundColor: 'rgba(255,255,255,0.22)', marginVertical: 16 },
  metricsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  metricItem: { alignItems: 'center' },
  metricLabel: { color: '#D1FAE5', fontSize: 11, fontWeight: '600' },
  metricValue: { color: '#FFFFFF', fontSize: 14, fontWeight: '800', marginTop: 3 },
  chartCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    padding: 18,
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
  },
  chartHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  chartTitle: { fontSize: 15, fontWeight: '800', color: '#0F172A' },
  chartSub: { fontSize: 12, color: '#64748B', marginTop: 2 },
  chartTotalPill: { backgroundColor: '#ECFDF5', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12 },
  chartTotalText: { fontSize: 12.5, fontWeight: '800', color: '#059669' },
  barsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', height: 124, paddingTop: 12 },
  barColumn: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  barValueLabel: { fontSize: 10, fontWeight: '800', color: '#475569', marginBottom: 4, height: 14 },
  barTrack: { width: 22, height: 86, justifyContent: 'flex-end', alignItems: 'center', backgroundColor: '#F8FAFC', borderRadius: 8 },
  barFill: { width: 22, borderRadius: 8 },
  barDayLabel: { fontSize: 11, fontWeight: '700', color: '#64748B', marginTop: 6 },
  barDayLabelToday: { color: '#0F172A', fontWeight: '900' },
  accountCard: {
    marginHorizontal: 16,
    marginBottom: 18,
    padding: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  accountHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  accountTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  accountTitle: { fontSize: 15, fontWeight: '800', color: '#0F172A' },
  editPillBtn: { backgroundColor: '#ECFDF5', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  editButtonText: { color: '#059669', fontWeight: '800', fontSize: 12.5 },
  accountSubtext: { fontSize: 12.5, color: '#64748B', marginTop: 6, marginBottom: 12, lineHeight: 18 },
  accountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ECFDF5',
    padding: 11,
    borderRadius: 12,
    gap: 8,
  },
  accountBadgeText: { color: '#047857', fontWeight: '700', fontSize: 14 },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: '#0F172A', marginHorizontal: 16, marginBottom: 12 },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', padding: 32 },
  emptyText: { color: '#94A3B8', marginTop: 8, fontSize: 14, fontWeight: '600' },
  rideCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  rideHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  rideDate: { fontSize: 12, color: '#64748B', fontWeight: '600' },
  statusTag: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 10 },
  statusCompleted: { backgroundColor: '#ECFDF5' },
  statusCancelled: { backgroundColor: '#FEF2F2' },
  statusTagText: { fontSize: 11, fontWeight: '800' },
  statusCompletedText: { color: '#059669' },
  statusCancelledText: { color: '#DC2626' },
  routeContainer: { marginVertical: 4, gap: 6 },
  routeLineRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dotGreen: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#10B981' },
  dotDark: { width: 8, height: 8, borderRadius: 2, backgroundColor: '#0F172A' },
  routeText: { fontSize: 13.5, color: '#334155', fontWeight: '600', flex: 1 },
  rideFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  passengerName: { fontSize: 12.5, color: '#64748B', fontWeight: '600' },
  payoutBadge: { alignItems: 'flex-end' },
  payoutGross: { fontSize: 11, color: '#94A3B8', textDecorationLine: 'line-through' },
  payoutNet: { fontSize: 14.5, fontWeight: '900', color: '#059669' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.6)', justifyContent: 'flex-end' },
  modalContainer: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, paddingBottom: 28 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#0F172A' },
  modalSubtext: { fontSize: 13, color: '#64748B', marginBottom: 16, lineHeight: 18 },
  providerSelector: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  providerOption: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  providerOptionActive: { borderColor: '#059669', backgroundColor: '#ECFDF5' },
  providerOptionText: { color: '#475569', fontWeight: '700' },
  providerOptionTextActive: { color: '#059669', fontWeight: '800' },
  inputLabel: { fontSize: 13, fontWeight: '700', color: '#334155', marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#0F172A',
    marginBottom: 20,
    backgroundColor: '#F8FAFC',
  },
  saveButton: { backgroundColor: '#059669', paddingVertical: 15, borderRadius: 16, alignItems: 'center' },
  saveButtonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },
});
