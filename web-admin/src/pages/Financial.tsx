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
  const [activeTab, setActiveTab] = useState<'overview' | 'manage_balances'>('overview');
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
  const [exportDates, setExportDates] = useState({ start: '', end: '' });

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