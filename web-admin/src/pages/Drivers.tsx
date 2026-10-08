import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { 
  Eye, ShieldAlert, CheckCircle, Check, Search, Download, 
  FileDown, X, Loader2, RefreshCw, Users, UserCheck, Clock, UserX, Car, AlertTriangle, Edit2, Save, CreditCard, Trash2
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
  vehiclePlate: string;
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

  const formatImageUrl = (path?: string) => {
    if (!path) return undefined;
    if (path.startsWith('http')) return path;
    const cleanBase = API_URL.replace(/\/$/, '');
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${cleanBase}${cleanPath}`;
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
      if (e.key === 'Escape' && isModalOpen) {
        handleCloseModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen]);

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

  const validatePaymentNumber = (number: string, provider: string) => {
    const cleanNumber = number.replace(/\D/g, '');
    if (cleanNumber.length !== 9) return 'O número deve ter exatamente 9 dígitos.';
    
    const prefix = cleanNumber.substring(0, 2);
    if (provider.includes('ORANGE') && prefix !== '95') {
      return 'Números da Orange Money devem começar com 95.';
    }
    if (provider.includes('MTN') && !['96', '97'].includes(prefix)) {
      return 'Números da MTN MoMo devem começar com 96 ou 97.';
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

      const tableColumn = ["Nome", "Telefone", "Veículo", "Placa", "Status"];
      const tableRows = filteredDrivers.map(driver => [
        driver.fullName,
        driver.phone,
        driver.vehicleType,
        driver.vehiclePlate,
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
      doc.text(`Placa do Veículo: ${driver.vehiclePlate}`, 14, 65);
      doc.text(`Status Atual: ${STATUS_MAP[driver.status]?.label || driver.status}`, 14, 75);
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
          <p className="drivers-subtitle">Aprovação, monitoramento em tempo real e controle de acesso dos motoristas</p>
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
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {displayedDrivers.length === 0 ? (
                  <tr><td colSpan={5} className="empty-state">Nenhum motorista encontrado.</td></tr>
                ) : (
                  displayedDrivers.map((driver) => {
                    const profileImgSrc = formatImageUrl(driver.profilePicture);
                    const isProcessing = actionLoading === driver.id;
                    const statusInfo = STATUS_MAP[driver.status];

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
                                  <AlertTriangle size={16} color="#eab308" title="Erro no Cadastro de Pagamento (Mobile Money)" />
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
                          </div>
                        </td>
                        <td><span className={`status-pill ${statusInfo?.className || ''}`}>{statusInfo?.label || driver.status}</span></td>
                        <td>
                          <div className="actions-cell">
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

      {isModalOpen && selectedDriver && (
        <div className="modal-overlay-backdrop" onClick={handleCloseModal}>
          <div className="modern-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-bar">
              <div>
                <h2>Documentação de {selectedDriver.fullName}</h2>
                <p>Verificação de habilitação e dados do veículo</p>
              </div>
              <button className="close-btn" onClick={handleCloseModal}><X size={20} /></button>
            </div>
            
            <div className="modal-content-body">
              <div className="details-summary-card">
                <div>
                  <span className="summary-label">Veículo</span>
                  <strong className="summary-value">{selectedDriver.vehicleType} ({selectedDriver.vehiclePlate})</strong>
                </div>
                <div>
                  <span className="summary-label">Telefone de Contato</span>
                  <strong className="summary-value">{selectedDriver.phone}</strong>
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
                        <option value="MTN">MTN MoMo</option>
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
              
              <div className="documents-grid-view" style={{ marginTop: '20px' }}>
                <div className="document-preview-card">
                  <h3>Documento / CNH (Frente)</h3>
                  {selectedDriver.licenseFrontPicture ? (
                    <img src={formatImageUrl(selectedDriver.licenseFrontPicture)} alt="Frente do Documento" />
                  ) : (
                    <div className="no-document-placeholder">Documento não enviado</div>
                  )}
                </div>
                <div className="document-preview-card">
                  <h3>Documento / CNH (Verso)</h3>
                  {selectedDriver.licenseBackPicture ? (
                    <img src={formatImageUrl(selectedDriver.licenseBackPicture)} alt="Verso do Documento" />
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