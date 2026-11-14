import React, { useEffect, useState, useCallback } from 'react';
import { 
  Wallet, TrendingUp, ArrowDownRight, ArrowUpRight, 
  Activity, Search, PlusCircle, XCircle, Users, Loader2, 
  FileSpreadsheet, CheckCircle, Clock, RotateCw, Download 
} from 'lucide-react';
import { api } from '../services/api';
import './Financial.css';

type TransactionType = 'RIDE_PAYMENT' | 'COMMISSION_FEE' | 'DRIVER_PAYOUT' | 'MANUAL_RECHARGE';
type TransactionStatus = 'COMPLETED' | 'PENDING' | 'FAILED';

interface Transaction {
  id: string;
  type: TransactionType;
  amount: number;
  status: TransactionStatus;
  paymentMethod: string;
  createdAt: string;
  passenger?: { fullName: string };
  driver?: { fullName: string };
}

interface WalletData {
  balance: number;
  totalCollected: number;
  pendingWithdrawalsAmount: number;
}

interface RechargeForm {
  userId: string;
  userType: 'PASSENGER' | 'DRIVER';
  amount: number;
  reason: string;
}

interface ApiError {
  response?: {
    data?: {
      error?: string;
      message?: string;
    };
  };
}

const INITIAL_RECHARGE_FORM: RechargeForm = { userId: '', userType: 'PASSENGER', amount: 0, reason: '' };

const TRANSACTION_TYPE_MAP: Record<TransactionType, { label: string; icon: React.ReactNode; colorClass: string }> = {
  RIDE_PAYMENT: { label: 'Pgto Corrida', icon: <ArrowUpRight size={14} />, colorClass: 'type-ride' },
  COMMISSION_FEE: { label: 'Taxa Plataforma', icon: <ArrowDownRight size={14} />, colorClass: 'type-commission' },
  DRIVER_PAYOUT: { label: 'Saque Automático', icon: <ArrowUpRight size={14} />, colorClass: 'type-payout' },
  MANUAL_RECHARGE: { label: 'Recarga Manual', icon: <PlusCircle size={14} />, colorClass: 'type-recharge' },
};

const TRANSACTION_STATUS_MAP: Record<TransactionStatus, { label: string; badgeClass: string; icon: React.ReactNode }> = {
  COMPLETED: { label: 'Concluído', badgeClass: 'status-completed', icon: <CheckCircle size={12} /> },
  PENDING: { label: 'Pendente', badgeClass: 'status-pending', icon: <Clock size={12} /> },
  FAILED: { label: 'Falhou', badgeClass: 'status-failed', icon: <XCircle size={12} /> },
};

/**
 * Escapa e sanitiza campos para evitar quebras de leiaute e CSV Formula Injection
 */
const escapeCsvField = (field: string | number | null | undefined): string => {
  if (field == null) return '""';
  let str = String(field).replace(/"/g, '""');
  // Se começar com caracteres de execução de fórmula, neutraliza adicionando aspa simples
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  return `"${str}"`;
};

export function Financial() {
  const [activeTab, setActiveTab] = useState<'overview' | 'driver_closing' | 'manage_balances'>('overview');
  const [wallet, setWallet] = useState<WalletData>({ balance: 0, totalCollected: 0, pendingWithdrawalsAmount: 0 });
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showFailedOnly, setShowFailedOnly] = useState(false);

  const [isRechargeModalOpen, setIsRechargeModalOpen] = useState(false);
  const [rechargeForm, setRechargeForm] = useState<RechargeForm>(INITIAL_RECHARGE_FORM);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const [approvingTxId, setApprovingTxId] = useState<string | null>(null);

  const handleApproveAndCredit = async (tx: Transaction) => {
    const targetName = tx.driver?.fullName || tx.passenger?.fullName || 'usuário';
    if (!window.confirm(`Confirmar pagamento de ${formatCurrency(tx.amount)} e creditar imediatamente na carteira de ${targetName}?`)) {
      return;
    }
    try {
      setApprovingTxId(tx.id);
      const res = await api.post(`/admin/finance/approve-transaction/${tx.id}`);
      alert(res.data?.message || 'Transação confirmada e saldo creditado!');
      fetchFinancialData();
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Erro ao confirmar e creditar transação.');
    } finally {
      setApprovingTxId(null);
    }
  };

  const [exportDates, setExportDates] = useState({ start: '', end: '' });

  // 📊 FECHAMENTO DIÁRIO POR MOTORISTA
  const [closingDate, setClosingDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [closingLoading, setClosingLoading] = useState(false);
  const [closingSearch, setClosingSearch] = useState('');
  const [closingSummary, setClosingSummary] = useState({
    activeDrivers: 0,
    totalRides: 0,
    totalGross: 0,
    totalCommission: 0,
    totalDriverNet: 0,
    totalWalletPayable: 0
  });
  const [closingDrivers, setClosingDrivers] = useState<any[]>([]);
  const [payingDriverId, setPayingDriverId] = useState<string | null>(null);

  const fetchDriverClosing = useCallback(async (dateStr: string) => {
    try {
      setClosingLoading(true);
      const res = await api.get('/admin/finance/driver-closing', { params: { date: dateStr } });
      setClosingSummary(res.data?.summary || {
        activeDrivers: 0,
        totalRides: 0,
        totalGross: 0,
        totalCommission: 0,
        totalDriverNet: 0,
        totalWalletPayable: 0
      });
      setClosingDrivers(Array.isArray(res.data?.drivers) ? res.data.drivers : []);
    } catch (err) {
      console.error('❌ [DRIVER CLOSING] Erro ao carregar fechamento:', err);
    } finally {
      setClosingLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'driver_closing') {
      fetchDriverClosing(closingDate);
    }
  }, [activeTab, closingDate, fetchDriverClosing]);

  const handleDriverPayout = async (drv: any) => {
    const defaultAmount = Math.max(0, Math.round(Number(drv.walletBalance || 0)));
    if (defaultAmount <= 0) {
      alert('Este motorista não possui saldo positivo na carteira para repasse.');
      return;
    }

    const inputAmount = window.prompt(
      `Registrar repasse para ${drv.fullName} (${drv.payoutAccount})\nSaldo disponível na carteira: ${formatCurrency(defaultAmount)}\n\nInforme o valor a repassar (XOF):`,
      String(defaultAmount)
    );
    if (inputAmount === null) return;

    const numeric = Number(inputAmount);
    if (!numeric || numeric <= 0) {
      alert('Valor inválido.');
      return;
    }

    const refNote = window.prompt(
      'Comprovante / Referência da transferência Orange Money ou MTN (opcional):',
      ''
    );
    if (refNote === null) return;

    try {
      setPayingDriverId(drv.driverId);
      const res = await api.post('/admin/finance/driver-closing/payout', {
        driverId: drv.driverId,
        amount: numeric,
        date: closingDate,
        referenceNote: refNote
      });
      alert(res.data?.message || 'Repasse registrado com sucesso!');
      fetchDriverClosing(closingDate);
      fetchFinancialData();
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Falha ao registrar repasse ao motorista.');
    } finally {
      setPayingDriverId(null);
    }
  };

  const handleExportClosingCSV = () => {
    if (closingDrivers.length === 0) {
      alert('Nenhum motorista com corridas concluídas nesta data.');
      return;
    }
    const headers = [
      'Data',
      'Motorista',
      'Telefone',
      'Placa',
      'Conta_Repasse',
      'Corridas_Concluidas',
      'Corridas_Digitais',
      'Corridas_Dinheiro',
      'Faturamento_Bruto_XOF',
      'Comissao_Retida_XOF',
      'Liquido_Motorista_Dia_XOF',
      'Saldo_Carteira_Atual_XOF'
    ];
    const rows = closingDrivers.map((d) => [
      escapeCsvField(closingDate),
      escapeCsvField(d.fullName),
      escapeCsvField(d.phone),
      escapeCsvField(d.vehiclePlate),
      escapeCsvField(d.payoutAccount),
      escapeCsvField(d.ridesCount),
      escapeCsvField(d.digitalRidesCount),
      escapeCsvField(d.cashRidesCount),
      escapeCsvField(d.grossRevenue),
      escapeCsvField(d.commissionRetained),
      escapeCsvField(d.netDriverEarnings),
      escapeCsvField(d.walletBalance)
    ].join(','));

    const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', `fechamento_motoristas_${closingDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };


  const fetchFinancialData = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.get('/admin/finance/dashboard');
      const data = response.data || {};
      setWallet(data.wallet || { balance: 0, totalCollected: 0, pendingWithdrawalsAmount: 0 });
      setTransactions(Array.isArray(data.transactions) ? data.transactions : []);
    } catch (err: unknown) {
      console.error('❌ [FINANCIAL] Erro ao buscar dados financeiros:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFinancialData();
  }, [fetchFinancialData]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsRechargeModalOpen(false);
        setIsExportModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleManualRecharge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rechargeForm.userId.trim() || rechargeForm.amount <= 0 || !rechargeForm.reason.trim()) {
      alert('Por favor, preencha todos os campos corretamente.');
      return;
    }
    if (!window.confirm(`Confirma a adição de ${formatCurrency(rechargeForm.amount)}?`)) return;

    try {
      setIsSubmitting(true);
      await api.post('/admin/finance/recharge', {
        ...rechargeForm,
        userId: rechargeForm.userId.trim(),
        reason: rechargeForm.reason.trim()
      });
      alert('Recarga manual processada com sucesso!');
      setIsRechargeModalOpen(false);
      setRechargeForm(INITIAL_RECHARGE_FORM);
      await fetchFinancialData();
    } catch (err: unknown) {
      const apiError = err as ApiError;
      const message = apiError.response?.data?.message || apiError.response?.data?.error || 'Falha ao processar a recarga manual.';
      alert(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRetryTransaction = async (transactionId: string) => {
    if (!window.confirm('Deseja tentar processar esta transação falha novamente?')) return;
    try {
      await api.post(`/admin/finance/retry-transaction/${transactionId}`);
      alert('Transação reenviada para processamento!');
      fetchFinancialData();
    } catch (err: unknown) {
      const apiError = err as ApiError;
      const message = apiError.response?.data?.message || apiError.response?.data?.error || 'Erro ao tentar reenviar a transação.';
      alert(message);
    }
  };

  const handleExportCSV = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!exportDates.start || !exportDates.end) return alert("Selecione o período completo.");

    try {
      setIsExporting(true);
      const response = await api.get('/admin/finance/export', {
        params: { startDate: exportDates.start, endDate: exportDates.end }
      });

      const rawExportList = Array.isArray(response.data) ? response.data : (response.data?.data || []);

      if (rawExportList.length === 0) return alert('Nenhuma transação localizada neste período.');

      const headers = ['Data', 'Tipo', 'Envolvido', 'Metodo', 'Valor_XOF', 'Status', 'ID_Transacao'];
      const csvRows = rawExportList.map((tx: any) => {
        const date = new Date(tx.createdAt).toLocaleString('pt-BR');
        const type = TRANSACTION_TYPE_MAP[tx.type as TransactionType]?.label || tx.type;
        const involved = tx.passenger?.fullName || tx.driver?.fullName || 'Sistema';
        const status = TRANSACTION_STATUS_MAP[tx.status as TransactionStatus]?.label || tx.status;
        
        return [
          escapeCsvField(date),
          escapeCsvField(type),
          escapeCsvField(involved),
          escapeCsvField(tx.paymentMethod || 'Wallet'),
          escapeCsvField(tx.amount),
          escapeCsvField(status),
          escapeCsvField(tx.id)
        ].join(',');
      });

      const csvContent = '\uFEFF' + [headers.join(','), ...csvRows].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `Extrato_BAI245_${exportDates.start}_${exportDates.end}.csv`;
      link.click();
      setIsExportModalOpen(false);
    } catch (err: unknown) {
      const apiError = err as ApiError;
      const message = apiError.response?.data?.message || apiError.response?.data?.error || 'Erro ao gerar relatório.';
      alert(message);
    } finally {
      setIsExporting(false);
    }
  };

  const formatCurrency = (value: number = 0) => {
    return new Intl.NumberFormat('fr-GW', { 
      style: 'currency', 
      currency: 'XOF', 
      maximumFractionDigits: 0 
    }).format(value).replace('XOF', 'FCFA');
  };

  const filteredTransactions = transactions.filter(tx => {
    const term = searchTerm.toLowerCase();
    const involved = (tx.passenger?.fullName || tx.driver?.fullName || 'sistema').toLowerCase();
    const typeLabel = TRANSACTION_TYPE_MAP[tx.type]?.label.toLowerCase() || tx.type.toLowerCase();
    const matchesSearch = involved.includes(term) || typeLabel.includes(term);
    const matchesStatus = showFailedOnly ? tx.status === 'FAILED' : true;
    
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="fin-container">
      {/* Cabeçalho Principal */}
      <div className="fin-header-card">
        <div>
          <h1 className="fin-title">
            <Wallet className="fin-title-icon" size={28} />
            Tesouraria Operacional
          </h1>
          <p className="fin-subtitle">
            Gestão simplificada de saldos, liquidações automáticas e fluxo de caixa.
          </p>
        </div>

        <button onClick={() => setIsExportModalOpen(true)} className="btn-dark">
          <FileSpreadsheet size={18} /> Exportar Fechamento
        </button>
      </div>

      {/* Navegação por Abas */}
      <div className="fin-tabs">
        <button 
          className={`fin-tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          Visão Geral
        </button>
        <button 
          className={`fin-tab-btn ${activeTab === 'driver_closing' ? 'active' : ''}`}
          onClick={() => setActiveTab('driver_closing')}
        >
          Fechamento por Motorista
        </button>
        <button 
          className={`fin-tab-btn ${activeTab === 'manage_balances' ? 'active' : ''}`}
          onClick={() => setActiveTab('manage_balances')}
        >
          Controle de Saldos
        </button>
      </div>

      {/* Conteúdo: Visão Geral */}
      {activeTab === 'overview' && (
        <div className="fin-content-space">
          {/* Cards de Resumo */}
          <div className="fin-metrics-grid">
            <div className="fin-metric-card dark">
              <span className="metric-title">Caixa (Lucro Líquido Plataforma)</span>
              <div className="metric-amount highlight">
                {loading ? <div className="skeleton h-8 w-36"></div> : formatCurrency(wallet.balance)}
              </div>
              <Wallet className="metric-bg-icon" size={48} />
            </div>

            <div className="fin-metric-card light">
              <div className="metric-top-row">
                <span className="metric-title">Volume Total Transacionado</span>
                <div className="icon-box-indigo">
                  <TrendingUp size={18} />
                </div>
              </div>
              <div className="metric-amount">
                {loading ? <div className="skeleton h-7 w-32"></div> : formatCurrency(wallet.totalCollected)}
              </div>
            </div>
          </div>

          {/* Histórico de Transações */}
          <div className="fin-table-card">
            <div className="fin-toolbar">
              <div className="toolbar-title">
                <Activity size={18} />
                <h2>Histórico de Liquidações</h2>
              </div>
              
              <div className="toolbar-actions">
                <button 
                  onClick={() => setShowFailedOnly(!showFailedOnly)}
                  className={`btn-toggle-fail ${showFailedOnly ? 'active' : ''}`}
                >
                  Apenas Falhas
                </button>
                <div className="search-input-wrapper">
                  <Search className="search-icon" size={16} />
                  <input 
                    type="text" 
                    placeholder="Pesquisar..." 
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="fin-table-wrapper">
              <table className="fin-table">
                <thead>
                  <tr>
                    <th>Data/Hora</th>
                    <th>Natureza</th>
                    <th>Agente</th>
                    <th className="text-right">Valor</th>
                    <th className="text-center">Status / Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    [...Array(4)].map((_, i) => (
                      <tr key={i} className="skeleton-row">
                        <td><div className="skeleton h-4 w-24"></div></td>
                        <td><div className="skeleton h-5 w-28"></div></td>
                        <td><div className="skeleton h-4 w-32"></div></td>
                        <td><div className="skeleton h-4 w-16 float-right"></div></td>
                        <td><div className="skeleton h-5 w-20 center-auto"></div></td>
                      </tr>
                    ))
                  ) : filteredTransactions.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="empty-table-cell">
                        Nenhum registro localizado.
                      </td>
                    </tr>
                  ) : (
                    filteredTransactions.map((tx) => {
                      const typeConfig = TRANSACTION_TYPE_MAP[tx.type];
                      const statusConfig = TRANSACTION_STATUS_MAP[tx.status];

                      return (
                        <tr key={tx.id}>
                          <td className="date-cell">
                            {new Date(tx.createdAt).toLocaleString('pt-BR')}
                          </td>
                          <td>
                            <span className={`type-tag ${typeConfig?.colorClass || ''}`}>
                              {typeConfig?.icon} {typeConfig?.label || tx.type}
                            </span>
                          </td>
                          <td>
                            <div className="agent-title">
                              {tx.passenger?.fullName || tx.driver?.fullName || 'Conta Master'}
                            </div>
                            <div className="agent-sub">{tx.paymentMethod || 'Wallet'}</div>
                          </td>
                          <td className="amount-cell text-right font-mono">
                            {tx.type === 'COMMISSION_FEE' || tx.type === 'MANUAL_RECHARGE' ? (
                              <span className="text-positive">+{formatCurrency(tx.amount)}</span>
                            ) : tx.type === 'DRIVER_PAYOUT' ? (
                              <span className="text-negative">-{formatCurrency(tx.amount)}</span>
                            ) : (
                              <span>{formatCurrency(tx.amount)}</span>
                            )}
                          </td>
                          <td className="text-center">
                            <div className="status-cell-wrapper">
                              <span className={`status-badge ${statusConfig?.badgeClass || ''}`}>
                                {statusConfig?.icon} {statusConfig?.label || tx.status}
                              </span>
                              {(tx.status === 'PENDING' || tx.status === 'FAILED') && (tx.driver || tx.passenger) && (
                                <button
                                  onClick={() => handleApproveAndCredit(tx)}
                                  disabled={approvingTxId === tx.id}
                                  className="btn-retry"
                                  style={{ backgroundColor: '#ECFDF5', color: '#047857', border: '1px solid #6EE7B7', marginLeft: '6px' }}
                                  title="Confirmar pagamento recebido e creditar carteira agora"
                                >
                                  <CheckCircle size={11} /> {approvingTxId === tx.id ? 'Creditando...' : 'Confirmar & Creditar'}
                                </button>
                              )}
                              {tx.status === 'FAILED' && (
                                <button 
                                  onClick={() => handleRetryTransaction(tx.id)} 
                                  className="btn-retry"
                                >
                                  <RotateCw size={10} /> Tentar Novamente
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Conteúdo: Fechamento Diário por Motorista */}
      {activeTab === 'driver_closing' && (
        <div className="fin-content-space">
          {/* Barra de Filtro por Data e Exportação */}
          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px',
            backgroundColor: '#FFFFFF',
            padding: '14px 18px',
            borderRadius: '12px',
            border: '1px solid #E2E8F0'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <label style={{ fontWeight: 700, fontSize: '0.88rem', color: '#1E293B' }}>
                Data do Fechamento:
              </label>
              <input
                type="date"
                className="fin-input"
                style={{ width: 'auto', padding: '7px 12px' }}
                value={closingDate}
                onChange={(e) => setClosingDate(e.target.value)}
              />
              <button
                type="button"
                onClick={() => fetchDriverClosing(closingDate)}
                className="btn-retry"
                style={{ padding: '8px 12px', fontSize: '0.82rem' }}
              >
                <RotateCw size={13} /> Atualizar
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <div style={{ position: 'relative' }}>
                <Search size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
                <input
                  type="text"
                  placeholder="Filtrar motorista ou placa..."
                  className="fin-input"
                  style={{ paddingLeft: '32px', width: '230px' }}
                  value={closingSearch}
                  onChange={(e) => setClosingSearch(e.target.value)}
                />
              </div>
              <button
                type="button"
                onClick={handleExportClosingCSV}
                className="btn-dark"
                style={{ padding: '8px 14px', fontSize: '0.84rem' }}
              >
                <Download size={15} /> Exportar CSV do Dia
              </button>
            </div>
          </div>

          {/* KPIs Consolidados do Dia */}
          <div className="fin-metrics-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))' }}>
            <div className="fin-metric-card light">
              <div className="metric-top-row">
                <span className="metric-title">Corridas Concluídas ({closingDate})</span>
                <div className="icon-box-indigo"><Car size={18} /></div>
              </div>
              <div className="metric-amount">
                {closingLoading ? '...' : `${closingSummary.totalRides} corridas`}
              </div>
              <span style={{ fontSize: '0.78rem', color: '#64748B', marginTop: '4px' }}>
                {closingSummary.activeDrivers} motorista(s) ativo(s) no dia
              </span>
            </div>

            <div className="fin-metric-card light">
              <div className="metric-top-row">
                <span className="metric-title">Faturamento Bruto (Dia)</span>
                <div className="icon-box-indigo"><TrendingUp size={18} /></div>
              </div>
              <div className="metric-amount">
                {closingLoading ? '...' : formatCurrency(closingSummary.totalGross)}
              </div>
              <span style={{ fontSize: '0.78rem', color: '#64748B', marginTop: '4px' }}>
                Soma total das corridas concluídas
              </span>
            </div>

            <div className="fin-metric-card dark">
              <span className="metric-title">Comissão Retida (Plataforma)</span>
              <div className="metric-amount highlight">
                {closingLoading ? '...' : formatCurrency(closingSummary.totalCommission)}
              </div>
              <span style={{ fontSize: '0.78rem', color: '#94A3B8', marginTop: '4px' }}>
                Receita líquida Nô Bai 245 no dia
              </span>
            </div>

            <div className="fin-metric-card light">
              <div className="metric-top-row">
                <span className="metric-title">Ganho Líquido Motoristas (Dia)</span>
                <div className="icon-box-indigo"><Wallet size={18} /></div>
              </div>
              <div className="metric-amount" style={{ color: '#059669' }}>
                {closingLoading ? '...' : formatCurrency(closingSummary.totalDriverNet)}
              </div>
              <span style={{ fontSize: '0.78rem', color: '#64748B', marginTop: '4px' }}>
                Saldo em carteiras: {formatCurrency(closingSummary.totalWalletPayable)}
              </span>
            </div>
          </div>

          {/* Tabela Detalhada por Motorista */}
          <div className="fin-table-card">
            <div className="fin-table-header">
              <h3>Consolidado Individual por Motorista — {closingDate}</h3>
            </div>
            <div className="table-responsive">
              <table className="fin-table">
                <thead>
                  <tr>
                    <th>Motorista / Conta Repasse</th>
                    <th className="text-center">Corridas</th>
                    <th className="text-right">Bruto (Dia)</th>
                    <th className="text-right">Comissão Retida</th>
                    <th className="text-right">Líquido (Dia)</th>
                    <th className="text-right">Saldo Carteira (A Repassar)</th>
                    <th className="text-center">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {closingLoading ? (
                    <tr>
                      <td colSpan={7} className="empty-table-cell">
                        <Loader2 className="spin" size={18} style={{ display: 'inline', marginRight: '6px' }} />
                        Calculando fechamento diário...
                      </td>
                    </tr>
                  ) : closingDrivers.filter((d) => {
                    const q = closingSearch.toLowerCase().trim();
                    if (!q) return true;
                    return (
                      String(d.fullName || '').toLowerCase().includes(q) ||
                      String(d.phone || '').toLowerCase().includes(q) ||
                      String(d.vehiclePlate || '').toLowerCase().includes(q)
                    );
                  }).length === 0 ? (
                    <tr>
                      <td colSpan={7} className="empty-table-cell">
                        Nenhuma corrida concluída registrada para esta data.
                      </td>
                    </tr>
                  ) : (
                    closingDrivers
                      .filter((d) => {
                        const q = closingSearch.toLowerCase().trim();
                        if (!q) return true;
                        return (
                          String(d.fullName || '').toLowerCase().includes(q) ||
                          String(d.phone || '').toLowerCase().includes(q) ||
                          String(d.vehiclePlate || '').toLowerCase().includes(q)
                        );
                      })
                      .map((drv) => (
                        <tr key={drv.driverId}>
                          <td>
                            <div className="agent-title">{drv.fullName}</div>
                            <div className="agent-sub">
                              {drv.vehiclePlate || 'Sem placa'} • {drv.payoutAccount}
                            </div>
                          </td>
                          <td className="text-center">
                            <span className="status-badge status-completed" style={{ fontWeight: 700 }}>
                              {drv.ridesCount} concluída(s)
                            </span>
                            <div style={{ fontSize: '0.72rem', color: '#64748B', marginTop: '3px' }}>
                              {drv.digitalRidesCount} digital • {drv.cashRidesCount} dinheiro
                            </div>
                          </td>
                          <td className="amount-cell text-right font-mono">
                            {formatCurrency(drv.grossRevenue)}
                            <div style={{ fontSize: '0.72rem', color: '#64748B' }}>
                              Dig: {formatCurrency(drv.digitalRevenue)}
                            </div>
                          </td>
                          <td className="amount-cell text-right font-mono">
                            <span className="text-negative">-{formatCurrency(drv.commissionRetained)}</span>
                          </td>
                          <td className="amount-cell text-right font-mono">
                            <span className="text-positive" style={{ fontWeight: 700 }}>
                              {formatCurrency(drv.netDriverEarnings)}
                            </span>
                          </td>
                          <td className="amount-cell text-right font-mono">
                            <strong style={{ color: drv.walletBalance > 0 ? '#047857' : '#64748B' }}>
                              {formatCurrency(drv.walletBalance)}
                            </strong>
                          </td>
                          <td className="text-center">
                            {drv.walletBalance > 0 ? (
                              <button
                                type="button"
                                disabled={payingDriverId === drv.driverId}
                                onClick={() => handleDriverPayout(drv)}
                                className="btn-retry"
                                style={{
                                  backgroundColor: '#ECFDF5',
                                  color: '#047857',
                                  border: '1px solid #6EE7B7',
                                  padding: '6px 10px',
                                  fontWeight: 600
                                }}
                                title="Registrar transferência Orange Money / MTN e abater saldo da carteira"
                              >
                                <Send size={11} /> {payingDriverId === drv.driverId ? 'Processando...' : 'Registrar Repasse'}
                              </button>
                            ) : (
                              <span style={{ fontSize: '0.75rem', color: '#94A3B8' }}>Quitado</span>
                            )}
                          </td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Conteúdo: Controle de Saldos */}
      {activeTab === 'manage_balances' && (
        <div className="fin-recharge-card">
          <div className="icon-circle-indigo">
            <Users size={32} />
          </div>
          <h2>Injeção Manual de Capital</h2>
          <p>
            Módulo restrito para correção de saldos e distribuição de bônus operacionais para motoristas e passageiros credenciados.
          </p>
          <button onClick={() => setIsRechargeModalOpen(true)} className="btn-indigo">
            <PlusCircle size={18} /> Autorizar Nova Recarga
          </button>
        </div>
      )}

      {/* Modal: Exportação */}
      {isExportModalOpen && (
        <div className="fin-modal-overlay" onClick={() => setIsExportModalOpen(false)}>
          <div className="fin-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="fin-modal-header">
              <div className="modal-title-group">
                <FileSpreadsheet className="text-green" size={20} />
                <span>Parâmetros de Exportação</span>
              </div>
              <button onClick={() => setIsExportModalOpen(false)} className="btn-close">
                <XCircle size={20} />
              </button>
            </div>
            
            <form onSubmit={handleExportCSV} className="fin-modal-body">
              <p className="modal-desc">Defina o período para extrair o relatório contábil em formato CSV.</p>
              
              <div className="grid-2-col">
                <div>
                  <label className="fin-label">Data Inicial</label>
                  <input 
                    type="date" 
                    required 
                    className="fin-input"
                    value={exportDates.start} 
                    onChange={(e) => setExportDates({...exportDates, start: e.target.value})} 
                  />
                </div>
                <div>
                  <label className="fin-label">Data Final</label>
                  <input 
                    type="date" 
                    required 
                    className="fin-input"
                    value={exportDates.end} 
                    onChange={(e) => setExportDates({...exportDates, end: e.target.value})} 
                  />
                </div>
              </div>

              <button type="submit" disabled={isExporting} className="btn-modal-submit dark">
                {isExporting ? <><Loader2 className="spin" size={16} /> Extraindo...</> : <><Download size={16} /> Baixar Relatório</>}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Recarga Manual */}
      {isRechargeModalOpen && (
        <div className="fin-modal-overlay" onClick={() => setIsRechargeModalOpen(false)}>
          <div className="fin-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="fin-modal-header indigo">
              <div className="modal-title-group">
                <PlusCircle className="text-indigo" size={20} />
                <span>Emissão de Capital</span>
              </div>
              <button onClick={() => setIsRechargeModalOpen(false)} className="btn-close">
                <XCircle size={20} />
              </button>
            </div>
            
            <form onSubmit={handleManualRecharge} className="fin-modal-body">
              <div>
                <label className="fin-label">Classe de Usuário</label>
                <select 
                  className="fin-input" 
                  value={rechargeForm.userType} 
                  onChange={(e) => setRechargeForm({...rechargeForm, userType: e.target.value as 'PASSENGER' | 'DRIVER'})}
                >
                  <option value="PASSENGER">Passageiro (Cliente)</option>
                  <option value="DRIVER">Motorista (Parceiro)</option>
                </select>
              </div>

              <div>
                <label className="fin-label">ID do Usuário</label>
                <input 
                  type="text" 
                  required 
                  placeholder="Insira o ID do usuário" 
                  className="fin-input" 
                  value={rechargeForm.userId} 
                  onChange={(e) => setRechargeForm({...rechargeForm, userId: e.target.value})} 
                />
              </div>

              <div>
                <label className="fin-label">Montante (XOF)</label>
                <input 
                  type="number" 
                  required 
                  min="1" 
                  placeholder="Ex: 5000" 
                  className="fin-input font-bold font-mono" 
                  value={rechargeForm.amount || ''} 
                  onChange={(e) => setRechargeForm({...rechargeForm, amount: Number(e.target.value)})} 
                />
              </div>

              <div>
                <label className="fin-label">Justificativa da Emissão</label>
                <input 
                  type="text" 
                  required 
                  placeholder="Motivo da recarga..." 
                  className="fin-input" 
                  value={rechargeForm.reason} 
                  onChange={(e) => setRechargeForm({...rechargeForm, reason: e.target.value})} 
                />
              </div>

              <button type="submit" disabled={isSubmitting} className="btn-modal-submit indigo">
                {isSubmitting ? <><Loader2 className="spin" size={16} /> Processando...</> : 'Autorizar Crédito'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}