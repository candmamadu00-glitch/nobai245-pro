import { useEffect, useState, useCallback, useMemo } from 'react';
import { 
  Eye, ShieldAlert, CheckCircle, Check, Search, Download, 
  FileDown, X, Loader2, RefreshCw, Users, UserCheck, Clock, UserX, Car, AlertTriangle, Edit2, Save, CreditCard, Trash2, Wallet, PlusCircle, Sliders
} from 'lucide-react';
import { api, API_URL } from '../services/api';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import './Drivers.css';

interface Driver {
  id: string;
  fullName: string;
  phone: string;
  vehicleType: string;
  vehicleBrand?: string;
  vehicleColor?: string;
  vehicleSeats?: number | null;
  vehiclePlate: string;
  documentType?: string;
  documentNumber?: string;
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
  walletBalance: number;
  ratingAverage: number;
  createdAt: string;
  profilePicture?: string;
  licenseFrontPicture?: string;
  licenseBackPicture?: string;
  mobileMoneyProvider?: string;
  mobileMoneyNumber?: string;
  financeStatus?: 'OK' | 'PENDING_VERIFICATION';
}

interface WalletTransaction {
  id: string;
  type: string;
  amount: number;
  status: string;
  paymentMethod?: string;
  reference?: string;
  description?: string;
  createdAt: string;
}

interface ApiError {
  response?: {
    data?: {
      error?: string;
      message?: string;
    };
  };
}

const STATUS_MAP: Record<Driver['status'], { label: string; className: string }> = {
  APPROVED: { label: 'Aprovado', className: 'status-approved' },
  PENDING_APPROVAL: { label: 'Pendente', className: 'status-pending' },
  SUSPENDED: { label: 'Suspenso', className: 'status-suspended' },
  REJECTED: { label: 'Rejeitado', className: 'status-rejected' },
};

export function Drivers() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | Driver['status']>('ALL');
  
  const [selectedDriver, setSelectedDriver] = useState<Driver | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Estados para edição de pagamento
  const [isEditingPayment, setIsEditingPayment] = useState(false);
  const [editProvider, setEditProvider] = useState('ORANGE');
  const [editNumber, setEditNumber] = useState('');

  // Estados para gestão da carteira do motorista
  const [walletDriver, setWalletDriver] = useState<Driver | null>(null);
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletSubmitting, setWalletSubmitting] = useState(false);
  const [walletMode, setWalletMode] = useState<'ADD' | 'SET'>('ADD');
  const [walletAmount, setWalletAmount] = useState('');
  const [walletReason, setWalletReason] = useState('');
  const [walletTransactions, setWalletTransactions] = useState<WalletTransaction[]>([]);

  const formatXof = (value?: number) => {
    const num = Math.round(Number(value || 0));
    return `${num.toLocaleString('pt-BR')} XOF`;
  };

  // 🛡️ TRATAMENTO BLINDADO DE IMAGENS
  const formatImageUrl = (path?: string) => {
    if (!path) return undefined;

    const serverBase = API_URL.replace(/\/api\/?$/, '');

    if (path.includes('/uploads/')) {
      const filename = path.split('/uploads/')[1];
      return `${serverBase}/uploads/${filename}`;
    }

    if (path.startsWith('http://') || path.startsWith('https://')) {
      return path;
    }

    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${serverBase}${cleanPath}`;
  };

  const fetchDrivers = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.get<Driver[]>('/admin/drivers');
      setDrivers(response.data || []);
    } catch (error) {
      console.error('[DRIVERS] Erro ao buscar motoristas:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDrivers();
  }, [fetchDrivers]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isWalletModalOpen) handleCloseWalletModal();
        else if (isModalOpen) handleCloseModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen, isWalletModalOpen]);

  const metrics = useMemo(() => {
    return {
      total: drivers.length,
      approved: drivers.filter(d => d.status === 'APPROVED').length,
      pending: drivers.filter(d => d.status === 'PENDING_APPROVAL').length,
      suspended: drivers.filter(d => d.status === 'SUSPENDED').length,
    };
  }, [drivers]);

  const handleApprove = async (driverId: string) => {
    if (!window.confirm('Tem certeza que deseja aprovar este motorista?')) return;
    try {
      setActionLoading(driverId);
      await api.patch(`/admin/approve-driver/${driverId}`);
      await fetchDrivers();
    } catch (error) {
      console.error('[DRIVERS] Erro ao aprovar motorista:', error);
      alert('Erro ao aprovar motorista. Tente novamente.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggleStatus = async (driverId: string, currentStatus: Driver['status']) => {
    const newStatus = currentStatus === 'APPROVED' ? 'SUSPENDED' : 'APPROVED';
    const actionText = currentStatus === 'APPROVED' ? 'SUSPENDER' : 'REATIVAR';

    if (!window.confirm(`Tem certeza que deseja ${actionText} este motorista?`)) return;

    try {
      setActionLoading(driverId);
      await api.patch(`/admin/drivers/${driverId}/status`, { status: newStatus });
      await fetchDrivers();
    } catch (error) {
      console.error('[DRIVERS] Erro ao alterar status:', error);
      alert('Erro ao alterar o status do motorista.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteDriver = async (driverId: string, name: string) => {
    if (!window.confirm(`Tem certeza que deseja EXCLUIR DEFINITIVAMENTE o motorista "${name}"?`)) return;

    try {
      setActionLoading(driverId);
      await api.delete(`/admin/drivers/${driverId}`);
      alert('Motorista excluído com sucesso!');
      await fetchDrivers();
    } catch (err: unknown) {
      const apiError = err as ApiError;
      const errorMessage = apiError.response?.data?.error || apiError.response?.data?.message || 'Erro ao excluir motorista.';
      console.error('[DRIVERS] Erro ao excluir motorista:', err);
      alert(errorMessage);
    } finally {
      setActionLoading(null);
    }
  };

  const getDocComplianceBadge = (driver: any) => {
    const now = Date.now();
    const dates = [driver.licenseExpiresAt, driver.insuranceExpiresAt]
      .filter(Boolean)
      .map((d: string) => new Date(d).getTime());

    if (dates.length === 0) {
      return (
        <span style={{ fontSize: '0.72rem', color: '#64748B', backgroundColor: '#F1F5F9', padding: '2px 7px', borderRadius: '6px' }}>
          Validade não informada
        </span>
      );
    }

    const minExp = Math.min(...dates);
    const daysLeft = Math.ceil((minExp - now) / (1000 * 60 * 60 * 24));

    if (daysLeft < 0) {
      return (
        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#B91C1C', backgroundColor: '#FEE2E2', padding: '2px 7px', borderRadius: '6px' }}>
          ⚠️ Doc. Vencido ({Math.abs(daysLeft)}d)
        </span>
      );
    }
    if (daysLeft <= 30) {
      return (
        <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#B45309', backgroundColor: '#FEF3C7', padding: '2px 7px', borderRadius: '6px' }}>
          ⏳ Vence em {daysLeft}d
        </span>
      );
    }
    return (
      <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#047857', backgroundColor: '#ECFDF5', padding: '2px 7px', borderRadius: '6px' }}>
        ✅ Docs em Dia
      </span>
    );
  };

  const handleUnlockDriverApp = async (driverId: string, fullName: string) => {
    if (!window.confirm(`Destravar o aplicativo de ${fullName}?\nIsso limpa qualquer corrida presa na tela do motorista.`)) return;
    try {
      const res = await api.patch(`/admin/users-unlock/driver/${driverId}`);
      alert(res.data?.message || 'Aplicativo destravado!');
      fetchDrivers();
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Erro ao destravar motorista.');
    }
  };

  const handleOpenDetails = (driver: Driver) => {
    setSelectedDriver(driver);
    setEditProvider(driver.mobileMoneyProvider || 'ORANGE');
    setEditNumber(driver.mobileMoneyNumber || '');
    setIsEditingPayment(false);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedDriver(null);
    setIsEditingPayment(false);
  };

  // ==========================================
  // 👛 FUNÇÕES DA CARTEIRA DO MOTORISTA
  // ==========================================
  const loadDriverWalletDetails = async (driverId: string) => {
    try {
      setWalletLoading(true);
      const res = await api.get(`/admin/drivers/${driverId}/wallet`);
      if (res.data?.driver) {
        const freshBalance = Number(res.data.driver.walletBalance || 0);
        setWalletDriver(prev => prev ? { ...prev, walletBalance: freshBalance } : prev);
        setDrivers(prev => prev.map(d => d.id === driverId ? { ...d, walletBalance: freshBalance } : d));
        setSelectedDriver(prev => prev && prev.id === driverId ? { ...prev, walletBalance: freshBalance } : prev);
      }
      setWalletTransactions(res.data?.transactions || []);
    } catch (err) {
      console.error('[WALLET] Erro ao carregar carteira do motorista:', err);
    } finally {
      setWalletLoading(false);
    }
  };

  const handleOpenWalletModal = async (driver: Driver) => {
    setWalletDriver(driver);
    setWalletMode('ADD');
    setWalletAmount('');
    setWalletReason('');
    setWalletTransactions([]);
    setIsWalletModalOpen(true);
    await loadDriverWalletDetails(driver.id);
  };

  const handleCloseWalletModal = () => {
    setIsWalletModalOpen(false);
    setWalletDriver(null);
    setWalletAmount('');
    setWalletReason('');
    setWalletTransactions([]);
  };

  const walletPreviewBalance = useMemo(() => {
    if (!walletDriver) return 0;
    const current = Math.round(Number(walletDriver.walletBalance || 0));
    const parsed = Math.round(Number(walletAmount));
    if (walletAmount.trim() === '' || isNaN(parsed)) return current;
    return walletMode === 'ADD' ? current + parsed : parsed;
  }, [walletDriver, walletAmount, walletMode]);

  const handleSubmitWalletAdjustment = async () => {
    if (!walletDriver) return;

    const numericAmount = Math.round(Number(walletAmount));
    if (walletAmount.trim() === '' || isNaN(numericAmount)) {
      return alert('Informe um valor numérico válido em XOF.');
    }

    if (walletMode === 'ADD' && numericAmount <= 0) {
      return alert('Para adicionar saldo, informe um valor maior que 0 XOF.');
    }

    const actionDesc = walletMode === 'ADD'
      ? `ADICIONAR ${formatXof(numericAmount)} à carteira de ${walletDriver.fullName} (Novo saldo: ${formatXof(walletPreviewBalance)})`
      : `DEFINIR o saldo exato de ${walletDriver.fullName} para ${formatXof(numericAmount)} (Saldo anterior: ${formatXof(walletDriver.walletBalance)})`;

    if (!window.confirm(`Confirmar alteração financeira?\n\n${actionDesc}`)) return;

    try {
      setWalletSubmitting(true);
      const response = await api.patch(`/admin/drivers/${walletDriver.id}/wallet`, {
        mode: walletMode,
        amount: numericAmount,
        reason: walletReason.trim() || undefined
      });

      const updatedBalance = Number(response.data?.newBalance ?? walletPreviewBalance);
      setWalletDriver(prev => prev ? { ...prev, walletBalance: updatedBalance } : prev);
      setDrivers(prev => prev.map(d => d.id === walletDriver.id ? { ...d, walletBalance: updatedBalance } : d));
      setSelectedDriver(prev => prev && prev.id === walletDriver.id ? { ...prev, walletBalance: updatedBalance } : prev);
      setWalletAmount('');
      setWalletReason('');

      await loadDriverWalletDetails(walletDriver.id);
      alert(`Saldo atualizado com sucesso! Novo saldo: ${formatXof(updatedBalance)}`);
    } catch (err: unknown) {
      const apiError = err as ApiError;
      const msg = apiError.response?.data?.error || apiError.response?.data?.message || 'Erro ao atualizar carteira do motorista.';
      alert(msg);
    } finally {
      setWalletSubmitting(false);
    }
  };

  const validatePaymentNumber = (number: string, provider: string) => {
    const cleanNumber = number.replace(/\D/g, '');
    if (cleanNumber.length !== 9) return 'O número deve ter exatamente 9 dígitos.';
    
    const prefix = cleanNumber.substring(0, 2);
    if (provider.includes('ORANGE') && prefix !== '95') {
      return 'Números da Orange Money devem começar com 95.';
    }
    if (provider.includes('MTN') && !['96', '97'].includes(prefix)) {
      return 'Números da Telecel (antigo MTN) devem começar com 96 ou 97.';
    }
    return null;
  };

  const handleSavePaymentInfo = async () => {
    if (!selectedDriver) return;

    const validationError = validatePaymentNumber(editNumber, editProvider);
    if (validationError) {
      return alert(validationError);
    }

    try {
      setActionLoading('payment_update');
      await api.patch(`/admin/drivers/${selectedDriver.id}/payment-info`, {
        mobileMoneyProvider: editProvider,
        mobileMoneyNumber: editNumber
      });
      
      alert('Dados de pagamento atualizados com sucesso.');
      setIsEditingPayment(false);
      await fetchDrivers();
      
      setSelectedDriver({
        ...selectedDriver,
        mobileMoneyProvider: editProvider,
        mobileMoneyNumber: editNumber,
        financeStatus: 'OK'
      });
    } catch (err: unknown) {
      const apiError = err as ApiError;
      const errorMessage = apiError.response?.data?.message || apiError.response?.data?.error || 'Erro ao atualizar dados de pagamento.';
      alert(errorMessage);
    } finally {
      setActionLoading(null);
    }
  };

  const filteredDrivers = drivers.filter((driver) => {
    const term = searchTerm.toLowerCase();
    const matchesSearch = 
      driver.fullName?.toLowerCase().includes(term) ||
      driver.phone?.toLowerCase().includes(term) ||
      driver.vehiclePlate?.toLowerCase().includes(term) ||
      driver.vehicleType?.toLowerCase().includes(term);

    const matchesStatus = statusFilter === 'ALL' || driver.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const displayedDrivers = filteredDrivers.slice(0, 50);

  const handleExportAllPDF = () => {
    if (filteredDrivers.length === 0) return alert('Nenhum dado para exportar.');
    try {
      setIsExporting(true);
      const doc = new jsPDF();
      doc.setFontSize(16);
      doc.text('Relatório Executivo de Motoristas - BAI 245', 14, 15);

      const tableColumn = ["Nome", "Telefone", "Veículo", "Placa", "Carteira", "Status"];
      const tableRows = filteredDrivers.map(driver => [
        driver.fullName,
        driver.phone,
        driver.vehicleType,
        driver.vehiclePlate,
        formatXof(driver.walletBalance),
        STATUS_MAP[driver.status]?.label || driver.status
      ]);

      autoTable(doc, {
        head: [tableColumn],
        body: tableRows,
        startY: 25,
        theme: 'striped',
        headStyles: { fillColor: [15, 23, 42] }
      });

      doc.save(`relatorio_motoristas_${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (error) {
      console.error('[PDF] Erro ao gerar PDF:', error);
      alert('Erro ao gerar arquivo PDF.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportSinglePDF = (driver: Driver) => {
    try {
      const doc = new jsPDF();
      doc.setFontSize(18);
      doc.text('Ficha Cadastral do Motorista', 14, 20);
      doc.setFontSize(12);
      doc.text(`Nome Completo: ${driver.fullName}`, 14, 35);
      doc.text(`Telefone: ${driver.phone}`, 14, 45);
      doc.text(`Tipo de Veículo: ${driver.vehicleType}`, 14, 55);
      doc.text(`Placa do Veículo: ${driver.vehiclePlate}</div>
                          <div style={{ marginTop: '4px' }}>{getDocComplianceBadge(driver)}`, 14, 65);
      doc.text(`Saldo da Carteira: ${formatXof(driver.walletBalance)}`, 14, 75);
      doc.text(`Status Atual: ${STATUS_MAP[driver.status]?.label || driver.status}`, 14, 85);
      doc.save(`motorista_${driver.fullName.replace(/\s+/g, '_')}.pdf`);
    } catch (error) {
      console.error('[PDF] Erro ao gerar Ficha:', error);
      alert('Erro ao gerar PDF do motorista.');
    }
  };

  return (
    <div className="drivers-page">
      <div className="drivers-header">
        <div>
          <h1 className="drivers-title">Gestão da Frota</h1>
          <p className="drivers-subtitle">Aprovação, carteira digital, monitoramento em tempo real e controle de acesso dos motoristas</p>
        </div>
        <div className="drivers-header-actions">
          <button className="btn-modern secondary" onClick={fetchDrivers} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            <span>Atualizar</span>
          </button>
          <button className="btn-modern primary" disabled={isExporting} onClick={handleExportAllPDF}>
            <Download size={18} /> 
            <span>{isExporting ? 'Exportando...' : 'Exportar Relatório'}</span>
          </button>
        </div>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card text-slate">
          <div className="kpi-icon bg-slate-100 text-slate-800"><Users size={22} /></div>
          <div><span className="kpi-label">Total Cadastrados</span><span className="kpi-value">{metrics.total}</span></div>
        </div>
        <div className="kpi-card text-emerald">
          <div className="kpi-icon bg-emerald-50 text-emerald-600"><UserCheck size={22} /></div>
          <div><span className="kpi-label">Aprovados & Ativos</span><span className="kpi-value">{metrics.approved}</span></div>
        </div>
        <div className="kpi-card text-amber">
          <div className="kpi-icon bg-amber-50 text-amber-600"><Clock size={22} /></div>
          <div><span className="kpi-label">Análise Pendente</span><span className="kpi-value">{metrics.pending}</span></div>
        </div>
        <div className="kpi-card text-rose">
          <div className="kpi-icon bg-rose-50 text-rose-600"><UserX size={22} /></div>
          <div><span className="kpi-label">Suspensos</span><span className="kpi-value">{metrics.suspended}</span></div>
        </div>
      </div>

      <div className="main-panel">
        <div className="controls-row">
          <div className="status-tabs">
            <button className={`tab-btn ${statusFilter === 'ALL' ? 'active' : ''}`} onClick={() => setStatusFilter('ALL')}>Todos</button>
            <button className={`tab-btn ${statusFilter === 'APPROVED' ? 'active' : ''}`} onClick={() => setStatusFilter('APPROVED')}>Aprovados</button>
            <button className={`tab-btn ${statusFilter === 'PENDING_APPROVAL' ? 'active' : ''}`} onClick={() => setStatusFilter('PENDING_APPROVAL')}>Pendentes</button>
            <button className={`tab-btn ${statusFilter === 'SUSPENDED' ? 'active' : ''}`} onClick={() => setStatusFilter('SUSPENDED')}>Suspensos</button>
          </div>
          <div className="search-bar-wrapper">
            <Search size={18} className="search-icon" />
            <input type="text" placeholder="Buscar por nome, placa ou telefone..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
          </div>
        </div>

        <div className="table-responsive">
          {loading ? (
            <div className="loading-container">
              <Loader2 className="animate-spin text-slate-800" size={32} />
              <span>Sincronizando registros da frota...</span>
            </div>
          ) : (
            <table className="modern-table">
              <thead>
                <tr>
                  <th>Motorista</th>
                  <th>Contato</th>
                  <th>Veículo / Identificação</th>
                  <th>Carteira (XOF)</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {displayedDrivers.length === 0 ? (
                  <tr><td colSpan={6} className="empty-state">Nenhum motorista encontrado.</td></tr>
                ) : (
                  displayedDrivers.map((driver) => {
                    const profileImgSrc = formatImageUrl(driver.profilePicture);
                    const isProcessing = actionLoading === driver.id;
                    const statusInfo = STATUS_MAP[driver.status];
                    const balance = Number(driver.walletBalance || 0);

                    return (
                      <tr key={driver.id}>
                        <td>
                          <div className="driver-profile-cell">
                            {profileImgSrc ? (
                              <img src={profileImgSrc} alt="Avatar" className="driver-avatar-img" />
                            ) : (
                              <div className="driver-avatar-fallback">{driver.fullName?.charAt(0) || 'M'}</div>
                            )}
                            <div>
                              <strong className="driver-name" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                {driver.fullName}
                                {driver.financeStatus === 'PENDING_VERIFICATION' && (
                                  <span title="Erro no Cadastro de Pagamento (Mobile Money)">
                                    <AlertTriangle size={16} color="#eab308" />
                                  </span>
                                )}
                              </strong>
                              <span className="driver-subtext">Cadastro: {new Date(driver.createdAt || Date.now()).toLocaleDateString('pt-BR')}</span>
                            </div>
                          </div>
                        </td>
                        <td><span className="phone-badge">{driver.phone}</span></td>
                        <td>
                          <div className="vehicle-info">
                            <span className="vehicle-type"><Car size={14} /> {driver.vehicleType}</span>
                            <span className="vehicle-plate">{driver.vehiclePlate}</span>
                          <div style={{ marginTop: '4px' }}>{getDocComplianceBadge(driver)}</div>
                          </div>
                        </td>
                        <td>
                          <button
                            type="button"
                            onClick={() => handleOpenWalletModal(driver)}
                            title="Clique para gerenciar o saldo da carteira"
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                              padding: '5px 10px',
                              borderRadius: '8px',
                              border: balance < 0 ? '1px solid #fecaca' : balance === 0 ? '1px solid #fde68a' : '1px solid #bbf7d0',
                              backgroundColor: balance < 0 ? '#fef2f2' : balance === 0 ? '#fffbeb' : '#f0fdf4',
                              color: balance < 0 ? '#dc2626' : balance === 0 ? '#b45309' : '#15803d',
                              fontWeight: 700,
                              fontSize: '13px',
                              cursor: 'pointer'
                            }}
                          >
                            <Wallet size={14} />
                            <span>{formatXof(balance)}</span>
                          </button>
                        </td>
                        <td><span className={`status-pill ${statusInfo?.className || ''}`}>{statusInfo?.label || driver.status}</span></td>
                        <td>
                          <div className="actions-cell">
                            <button
                              className="icon-action-btn"
                              title="Gerenciar Carteira"
                              disabled={isProcessing}
                              onClick={() => handleOpenWalletModal(driver)}
                              style={{ backgroundColor: '#ecfdf5', color: '#047857', borderColor: '#a7f3d0' }}
                            >
                              <Wallet size={16} /><span>Carteira</span>
                            </button>
                            <button className="icon-action-btn view" title="Ver Detalhes" disabled={isProcessing} onClick={() => handleOpenDetails(driver)}>
                              <Eye size={16} /><span>Detalhes</span>
                            </button>
                            <button className="icon-action-btn pdf" title="Exportar PDF" disabled={isProcessing} onClick={() => handleExportSinglePDF(driver)}>
                              <FileDown size={16} />
                            </button>
                            {driver.status === 'PENDING_APPROVAL' && (
                              <button className="btn-status approve" disabled={isProcessing} onClick={() => handleApprove(driver.id)}>
                                {isProcessing ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}<span>Aprovar</span>
                              </button>
                            )}
                            {driver.status === 'APPROVED' && (
                              <button className="btn-status suspend" disabled={isProcessing} onClick={() => handleToggleStatus(driver.id, driver.status)}>
                                {isProcessing ? <Loader2 size={16} className="animate-spin" /> : <ShieldAlert size={16} />}<span>Suspender</span>
                              </button>
                            )}
                            {driver.status === 'SUSPENDED' && (
                              <button className="btn-status reactivate" disabled={isProcessing} onClick={() => handleToggleStatus(driver.id, driver.status)}>
                                {isProcessing ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}<span>Reativar</span>
                              </button>
                            )}

                            <button 
                              className="btn-status delete" 
                              title="Excluir Motorista" 
                              disabled={isProcessing} 
                              onClick={() => handleDeleteDriver(driver.id, driver.fullName)}
                              style={{ backgroundColor: '#ef4444', color: '#ffffff', borderColor: '#dc2626' }}
                            >
                              {isProcessing ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                              <span>Excluir</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ========================================== */}
      {/* 👛 MODAL DE GESTÃO DA CARTEIRA DO MOTORISTA */}
      {/* ========================================== */}
      {isWalletModalOpen && walletDriver && (
        <div className="modal-overlay-backdrop" onClick={handleCloseWalletModal}>
          <div className="modern-modal" style={{ maxWidth: '640px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-bar">
              <div>
                <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Wallet size={20} color="#16a34a" /> Carteira Digital — {walletDriver.fullName}
                </h2>
                <p>Telefone: {walletDriver.phone} • Veículo: {walletDriver.vehiclePlate}</p>
              </div>
              <button className="close-btn" onClick={handleCloseWalletModal}><X size={20} /></button>
            </div>

            <div className="modal-content-body">
              {/* Card de Saldo Atual */}
              <div style={{
                padding: '16px 20px',
                borderRadius: '12px',
                background: Number(walletDriver.walletBalance || 0) <= 0
                  ? 'linear-gradient(135deg, #fef2f2 0%, #fee2e2 100%)'
                  : 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
                color: Number(walletDriver.walletBalance || 0) <= 0 ? '#991b1b' : '#ffffff',
                border: Number(walletDriver.walletBalance || 0) <= 0 ? '1px solid #fca5a5' : 'none',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '12px'
              }}>
                <div>
                  <span style={{ fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.85 }}>
                    Saldo Atual na Carteira
                  </span>
                  <div style={{ fontSize: '28px', fontWeight: 800, marginTop: '4px' }}>
                    {formatXof(walletDriver.walletBalance)}
                  </div>
                </div>
                {Number(walletDriver.walletBalance || 0) <= 0 && (
                  <div style={{
                    backgroundColor: '#dc2626',
                    color: '#fff',
                    padding: '6px 12px',
                    borderRadius: '8px',
                    fontSize: '12px',
                    fontWeight: 600,
                    maxWidth: '250px'
                  }}>
                    Bloqueado para ficar Online (saldo precisa ser maior que 0 XOF)
                  </div>
                )}
              </div>

              {/* Formulário de Atualização */}
              <div style={{ marginTop: '18px', padding: '16px', backgroundColor: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '14px' }}>
                  <button
                    type="button"
                    onClick={() => setWalletMode('ADD')}
                    style={{
                      padding: '10px 12px',
                      borderRadius: '8px',
                      border: walletMode === 'ADD' ? '2px solid #16a34a' : '1px solid #cbd5e1',
                      backgroundColor: walletMode === 'ADD' ? '#f0fdf4' : '#ffffff',
                      color: walletMode === 'ADD' ? '#15803d' : '#475569',
                      fontWeight: 700,
                      fontSize: '13px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px'
                    }}
                  >
                    <PlusCircle size={16} /> Adicionar Valor (Recarga)
                  </button>
                  <button
                    type="button"
                    onClick={() => setWalletMode('SET')}
                    style={{
                      padding: '10px 12px',
                      borderRadius: '8px',
                      border: walletMode === 'SET' ? '2px solid #0f172a' : '1px solid #cbd5e1',
                      backgroundColor: walletMode === 'SET' ? '#f1f5f9' : '#ffffff',
                      color: walletMode === 'SET' ? '#0f172a' : '#475569',
                      fontWeight: 700,
                      fontSize: '13px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px'
                    }}
                  >
                    <Sliders size={16} /> Definir Saldo Exato
                  </button>
                </div>

                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginBottom: '6px' }}>
                  {walletMode === 'ADD' ? 'Valor a Adicionar (XOF)' : 'Novo Saldo Exato (XOF)'}
                </label>
                <input
                  type="number"
                  value={walletAmount}
                  onChange={(e) => setWalletAmount(e.target.value)}
                  placeholder={walletMode === 'ADD' ? 'Ex: 2000' : 'Ex: 5000'}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '16px',
                    fontWeight: 700,
                    boxSizing: 'border-box'
                  }}
                />

                {/* Atalhos rápidos */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '8px' }}>
                  {[500, 1000, 2000, 5000, 10000].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        if (walletMode === 'ADD') {
                          const cur = Math.round(Number(walletAmount || 0));
                          setWalletAmount(String(cur + preset));
                        } else {
                          setWalletAmount(String(preset));
                        }
                      }}
                      style={{
                        padding: '4px 10px',
                        borderRadius: '6px',
                        border: '1px solid #cbd5e1',
                        backgroundColor: '#ffffff',
                        fontSize: '12px',
                        fontWeight: 600,
                        color: '#334155',
                        cursor: 'pointer'
                      }}
                    >
                      {walletMode === 'ADD' ? `+${preset.toLocaleString('pt-BR')}` : `${preset.toLocaleString('pt-BR')} XOF`}
                    </button>
                  ))}
                </div>

                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, color: '#475569', marginTop: '12px', marginBottom: '6px' }}>
                  Motivo / Comprovante (opcional)
                </label>
                <input
                  type="text"
                  value={walletReason}
                  onChange={(e) => setWalletReason(e.target.value)}
                  placeholder="Ex: Recarga Orange Money não creditada automaticamente"
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '14px',
                    boxSizing: 'border-box'
                  }}
                />

                {/* Pré-visualização do Resultado */}
                <div style={{
                  marginTop: '12px',
                  padding: '10px 12px',
                  borderRadius: '8px',
                  backgroundColor: '#ffffff',
                  border: '1px dashed #94a3b8',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '13px'
                }}>
                  <span style={{ color: '#64748b' }}>Saldo após confirmação:</span>
                  <strong style={{
                    fontSize: '15px',
                    color: walletPreviewBalance > 0 ? '#15803d' : '#dc2626'
                  }}>
                    {formatXof(walletPreviewBalance)}
                  </strong>
                </div>

                <button
                  type="button"
                  onClick={handleSubmitWalletAdjustment}
                  disabled={walletSubmitting || walletAmount.trim() === ''}
                  style={{
                    marginTop: '14px',
                    width: '100%',
                    padding: '12px',
                    borderRadius: '8px',
                    border: 'none',
                    backgroundColor: walletSubmitting || walletAmount.trim() === '' ? '#94a3b8' : '#16a34a',
                    color: '#ffffff',
                    fontWeight: 700,
                    fontSize: '14px',
                    cursor: walletSubmitting || walletAmount.trim() === '' ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px'
                  }}
                >
                  {walletSubmitting ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                  <span>{walletSubmitting ? 'Atualizando Carteira...' : 'Confirmar Atualização de Saldo'}</span>
                </button>
              </div>

              {/* Extrato Recente da Carteira */}
              <div style={{ marginTop: '18px' }}>
                <h3 style={{ fontSize: '14px', fontWeight: 700, color: '#1e293b', marginBottom: '8px' }}>
                  Últimas Movimentações da Carteira
                </h3>
                {walletLoading ? (
                  <div style={{ padding: '16px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
                    Carregando histórico financeiro...
                  </div>
                ) : walletTransactions.length === 0 ? (
                  <div style={{ padding: '14px', textAlign: 'center', color: '#94a3b8', fontSize: '13px', backgroundColor: '#f8fafc', borderRadius: '8px' }}>
                    Nenhuma movimentação registrada ainda.
                  </div>
                ) : (
                  <div style={{ maxHeight: '190px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                    {walletTransactions.map((tx) => (
                      <div key={tx.id} style={{
                        padding: '10px 12px',
                        borderBottom: '1px solid #f1f5f9',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '10px',
                        fontSize: '12px'
                      }}>
                        <div>
                          <strong style={{ color: '#0f172a', display: 'block' }}>
                            {tx.description || tx.type}
                          </strong>
                          <span style={{ color: '#64748b' }}>
                            {new Date(tx.createdAt).toLocaleString('pt-BR')} {tx.reference ? `• ${tx.reference}` : ''}
                          </span>
                        </div>
                        <span style={{
                          fontWeight: 700,
                          whiteSpace: 'nowrap',
                          color: ['COMMISSION_FEE', 'WITHDRAWAL', 'PAYOUT'].includes(tx.type) ? '#dc2626' : '#15803d'
                        }}>
                          {['COMMISSION_FEE', 'WITHDRAWAL', 'PAYOUT'].includes(tx.type) ? '-' : '+'}{formatXof(tx.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="modal-footer-bar">
              <button className="btn-modern secondary" onClick={handleCloseWalletModal}>Fechar</button>
            </div>
          </div>
        </div>
      )}

      {/* ========================================== */}
      {/* 📋 MODAL DE DETALHES DO MOTORISTA */}
      {/* ========================================== */}
      {isModalOpen && selectedDriver && (
        <div className="modal-overlay-backdrop" onClick={handleCloseModal}>
          <div className="modern-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-bar">
              <div>
                <h2>Documentação de {selectedDriver.fullName}</h2>
                <p>Verificação de habilitação, carteira e dados do veículo</p>
              </div>
              <button className="close-btn" onClick={handleCloseModal}><X size={20} /></button>
            </div>
            
            <div className="modal-content-body">
              <div className="details-summary-card" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px' }}>
                <div>
                  <span className="summary-label">Veículo</span>
                  <strong className="summary-value">{selectedDriver.vehicleType} {selectedDriver.vehicleBrand ? `- ${selectedDriver.vehicleBrand}` : ''} ({selectedDriver.vehiclePlate})</strong>
                  {selectedDriver.vehicleColor && <small style={{ display: 'block', color: '#64748b' }}>Cor: {selectedDriver.vehicleColor}</small>}
                </div>
                <div>
                  <span className="summary-label">Documento</span>
                  <strong className="summary-value">{selectedDriver.documentType || 'BI'}: {selectedDriver.documentNumber || 'Não informado'}</strong>
                </div>
                <div>
                  <span className="summary-label">Telefone de Contato</span>
                  <strong className="summary-value">{selectedDriver.phone}</strong>
                </div>
                <div>
                  <span className="summary-label">Carteira Digital</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
                    <strong className="summary-value" style={{ color: Number(selectedDriver.walletBalance || 0) <= 0 ? '#dc2626' : '#15803d' }}>
                      {formatXof(selectedDriver.walletBalance)}
                    </strong>
                    <button
                      type="button"
                      onClick={() => handleOpenWalletModal(selectedDriver)}
                      style={{
                        padding: '3px 8px',
                        borderRadius: '6px',
                        border: '1px solid #16a34a',
                        backgroundColor: '#f0fdf4',
                        color: '#15803d',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      Ajustar
                    </button>
                  </div>
                </div>
                <div>
                  <span className="summary-label">Status da Conta</span>
                  <span className={`status-pill ${STATUS_MAP[selectedDriver.status]?.className || ''}`}>
                    {STATUS_MAP[selectedDriver.status]?.label}
                  </span>
                </div>
              </div>

              <div style={{ marginTop: '20px', padding: '16px', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0, fontSize: '16px', color: '#1e293b' }}>
                    <CreditCard size={18} color="#64748b"/> Dados de Repasse (Mobile Money)
                    {selectedDriver.financeStatus === 'PENDING_VERIFICATION' && (
                      <span style={{ fontSize: '12px', color: '#b45309', backgroundColor: '#fef3c7', padding: '2px 8px', borderRadius: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <AlertTriangle size={12}/> Falha Recente
                      </span>
                    )}
                  </h3>
                  {!isEditingPayment && (
                    <button onClick={() => setIsEditingPayment(true)} style={{ background: 'none', border: 'none', color: '#0f172a', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', fontWeight: '500' }}>
                      <Edit2 size={14} /> Editar
                    </button>
                  )}
                </div>

                {isEditingPayment ? (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>Operadora</label>
                      <select 
                        value={editProvider} 
                        onChange={(e) => setEditProvider(e.target.value)}
                        style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                      >
                        <option value="ORANGE">Orange Money</option>
                        <option value="MTN">Telecel (antigo MTN)</option>
                      </select>
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '12px', color: '#64748b', marginBottom: '4px' }}>Número (9 dígitos)</label>
                      <input 
                        type="text" 
                        maxLength={9}
                        value={editNumber} 
                        onChange={(e) => setEditNumber(e.target.value.replace(/\D/g, ''))}
                        style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                        placeholder="Ex: 95XXXXXXX"
                      />
                    </div>
                    <div style={{ gridColumn: '1 / -1', display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '8px' }}>
                      <button onClick={() => setIsEditingPayment(false)} style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #cbd5e1', background: 'white', cursor: 'pointer' }}>
                        Cancelar
                      </button>
                      <button onClick={handleSavePaymentInfo} disabled={actionLoading === 'payment_update'} style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', background: '#0f172a', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {actionLoading === 'payment_update' ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Salvar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: '24px' }}>
                    <div>
                      <span style={{ display: 'block', fontSize: '12px', color: '#64748b' }}>Operadora</span>
                      <strong style={{ color: '#0f172a' }}>{selectedDriver.mobileMoneyProvider || 'Não configurado'}</strong>
                    </div>
                    <div>
                      <span style={{ display: 'block', fontSize: '12px', color: '#64748b' }}>Número</span>
                      <strong style={{ color: '#0f172a' }}>{selectedDriver.mobileMoneyNumber || 'Não configurado'}</strong>
                    </div>
                  </div>
                )}
              </div>
              
              <div className="documents-grid-view" style={{ marginTop: '20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px' }}>
                <div className="document-preview-card">
                  <h3>Foto do Perfil / Selfie</h3>
                  {selectedDriver.profilePicture ? (
                    <img src={formatImageUrl(selectedDriver.profilePicture)} alt="Foto do Motorista" style={{ width: '100%', height: '180px', objectFit: 'cover', borderRadius: '8px' }} />
                  ) : (
                    <div className="no-document-placeholder">Foto não enviada</div>
                  )}
                </div>
                <div className="document-preview-card">
                  <h3>Documento / CNH (Frente)</h3>
                  {selectedDriver.licenseFrontPicture ? (
                    <img src={formatImageUrl(selectedDriver.licenseFrontPicture)} alt="Frente do Documento" style={{ width: '100%', height: '180px', objectFit: 'cover', borderRadius: '8px' }} />
                  ) : (
                    <div className="no-document-placeholder">Documento não enviado</div>
                  )}
                </div>
                <div className="document-preview-card">
                  <h3>Documento / CNH (Verso)</h3>
                  {selectedDriver.licenseBackPicture ? (
                    <img src={formatImageUrl(selectedDriver.licenseBackPicture)} alt="Verso do Documento" style={{ width: '100%', height: '180px', objectFit: 'cover', borderRadius: '8px' }} />
                  ) : (
                    <div className="no-document-placeholder">Documento não enviado</div>
                  )}
                </div>
              </div>
            </div>

            <div className="modal-footer-bar">
              <button className="btn-modern secondary" onClick={handleCloseModal}>Fechar Janela</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
