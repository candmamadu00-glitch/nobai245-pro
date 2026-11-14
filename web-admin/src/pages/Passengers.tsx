import React, { useEffect, useState, useCallback } from 'react';
import { 
  Eye, ShieldAlert, CheckCircle, Search, Download, FileDown, 
  X, Star, Wallet, Calendar, Loader2, Car, Trash2,
  PlusCircle,
  MinusCircle,
  ArrowUpRight,
  ArrowDownRight
} from 'lucide-react';
import { api } from '../services/api';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import './Passengers.css';

interface Passenger {
  id: string;
  fullName: string;
  phone: string;
  email?: string;
  avatarUrl?: string;
  status: 'ACTIVE' | 'SUSPENDED';
  walletBalance: number;
  ratingAverage: number;
  totalRides?: number;
  createdAt: string;
}

export function Passengers() {
  const [passengers, setPassengers] = useState<Passenger[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const [selectedPassenger, setSelectedPassenger] = useState<Passenger | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // 👛 GESTÃO DE CARTEIRA / REEMBOLSO DO PASSAGEIRO
  const [walletPassenger, setWalletPassenger] = useState<Passenger | null>(null);
  const [walletLoading, setWalletLoading] = useState(false);
  const [walletSubmitting, setWalletSubmitting] = useState(false);
  const [walletTxs, setWalletTxs] = useState<any[]>([]);
  const [walletType, setWalletType] = useState<'CREDIT' | 'DEBIT'>('CREDIT');
  const [walletAmount, setWalletAmount] = useState('');
  const [walletReason, setWalletReason] = useState('');

  const handleUnlockPassengerApp = async (passengerId: string, fullName: string) => {
    if (!window.confirm(`Destravar o aplicativo de ${fullName}?\nIsso limpa qualquer corrida fantasma presa na tela do passageiro.`)) return;
    try {
      const res = await api.patch(`/admin/users-unlock/passenger/${passengerId}`);
      alert(res.data?.message || 'Aplicativo destravado!');
      fetchPassengers();
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Erro ao destravar passageiro.');
    }
  };

  const handleOpenPassengerWallet = async (pax: Passenger) => {
    setWalletPassenger(pax);
    setWalletType('CREDIT');
    setWalletAmount('');
    setWalletReason('');
    setWalletTxs([]);
    setWalletLoading(true);
    try {
      const res = await api.get(`/admin/passengers/${pax.id}/wallet`);
      if (res.data?.passenger) {
        setWalletPassenger({ ...pax, walletBalance: res.data.passenger.walletBalance });
      }
      setWalletTxs(Array.isArray(res.data?.transactions) ? res.data.transactions : []);
    } catch (err) {
      console.error('Erro ao carregar carteira do passageiro:', err);
    } finally {
      setWalletLoading(false);
    }
  };

  const handleSubmitPassengerWallet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!walletPassenger) return;
    const numeric = Number(walletAmount);
    if (!numeric || numeric <= 0) return alert('Informe um valor válido em XOF.');
    if (!walletReason.trim()) return alert('Informe o motivo do reembolso ou ajuste.');

    try {
      setWalletSubmitting(true);
      const res = await api.patch(`/admin/passengers/${walletPassenger.id}/wallet`, {
        amount: numeric,
        type: walletType,
        reason: walletReason.trim()
      });
      alert(res.data?.message || 'Saldo atualizado!');
      setWalletAmount('');
      setWalletReason('');
      await handleOpenPassengerWallet({ ...walletPassenger, walletBalance: res.data.newBalance });
      fetchPassengers();
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Erro ao atualizar carteira do passageiro.');
    } finally {
      setWalletSubmitting(false);
    }
  };


  const fetchPassengers = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.get('/admin/passengers');
      setPassengers(Array.isArray(response.data) ? response.data : []);
    } catch (error) {
      console.error('Erro ao buscar passageiros:', error);
      setPassengers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPassengers();
  }, [fetchPassengers]);

  // Fechar modal com a tecla Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isModalOpen) {
        handleCloseModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen]);

  // 🗑️ FUNÇÃO DE EXCLUSÃO DE PASSAGEIRO
  const handleDeletePassenger = async (passengerId: string, name: string) => {
    if (!window.confirm(`Tem certeza que deseja EXCLUIR DEFINITIVAMENTE o passageiro "${name}"?`)) return;

    try {
      setUpdatingId(passengerId);
      await api.delete(`/admin/passengers/${passengerId}`);
      alert('Passageiro excluído com sucesso!');
      await fetchPassengers();
    } catch (error: any) {
      console.error('Erro ao excluir passageiro:', error);
      alert(error.response?.data?.error || error.response?.data?.message || 'Erro ao excluir passageiro.');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleToggleStatus = async (passengerId: string, currentStatus: string) => {
    const newStatus = currentStatus === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    const actionText = currentStatus === 'ACTIVE' ? 'SUSPENDER' : 'REATIVAR';

    if (!window.confirm(`Tem certeza que deseja ${actionText} este passageiro?`)) return;

    try {
      setUpdatingId(passengerId);
      await api.patch(`/admin/passengers/${passengerId}/status`, { status: newStatus });
      alert(`Passageiro ${newStatus === 'ACTIVE' ? 'reativado' : 'suspenso'} com sucesso!`);
      await fetchPassengers();
    } catch (error) {
      console.error('Erro ao alterar status:', error);
      alert('Erro ao alterar o status do passageiro.');
    } finally {
      setUpdatingId(null);
    }
  };

  const handleOpenDetails = (passenger: Passenger) => {
    setSelectedPassenger(passenger);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedPassenger(null);
  };

  const formatCurrency = (amount: number = 0) => {
    const val = Number(amount) || 0;
    return new Intl.NumberFormat('pt-GW', { style: 'currency', currency: 'XOF' }).format(val);
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    try {
      return new Date(dateString).toLocaleDateString('pt-BR');
    } catch {
      return 'N/A';
    }
  };

  const getRatingFormatted = (rating?: number) => {
    return (Number(rating) || 0).toFixed(1);
  };

  const filteredPassengers = passengers.filter((passenger) => {
    const term = searchTerm.toLowerCase();
    const name = (passenger.fullName || '').toLowerCase();
    const phone = (passenger.phone || '').toLowerCase();
    return name.includes(term) || phone.includes(term);
  });

  const displayedPassengers = filteredPassengers.slice(0, 50);

  const handleExportAllPDF = () => {
    if (filteredPassengers.length === 0) {
      alert('Nenhum dado para exportar.');
      return;
    }

    const doc = new jsPDF();
    doc.text('Relatório Geral de Passageiros', 14, 15);

    const tableColumn = ["Nome", "Telefone", "Saldo", "Avaliação", "Status"];
    const tableRows = filteredPassengers.map((p) => [
      p.fullName || 'Sem nome',
      p.phone || 'Sem telefone',
      formatCurrency(p.walletBalance),
      `${getRatingFormatted(p.ratingAverage)} ★`,
      p.status === 'ACTIVE' ? 'Ativo' : 'Suspenso'
    ]);

    autoTable(doc, {
      head: [tableColumn],
      body: tableRows,
      startY: 20,
    });

    doc.save(`passageiros_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  const handleExportSinglePDF = (passenger: Passenger) => {
    const doc = new jsPDF();
    
    doc.setFontSize(18);
    doc.text('Ficha do Passageiro', 14, 20);
    
    doc.setFontSize(12);
    doc.text(`Nome Completo: ${passenger.fullName || 'N/A'}`, 14, 35);
    doc.text(`Telefone: ${passenger.phone || 'N/A'}`, 14, 45);
    doc.text(`Saldo na Carteira: ${formatCurrency(passenger.walletBalance)}`, 14, 55);
    doc.text(`Avaliação Média: ${getRatingFormatted(passenger.ratingAverage)} Estrelas`, 14, 65);
    doc.text(`Status Atual: ${passenger.status === 'ACTIVE' ? 'Ativo' : 'Suspenso'}`, 14, 75);
    doc.text(`Data de Cadastro: ${formatDate(passenger.createdAt)}`, 14, 85);

    const sanitizedName = (passenger.fullName || 'passageiro').toLowerCase().replace(/[^a-z0-9]/g, '_');
    doc.save(`passageiro_${sanitizedName}.pdf`);
  };

  if (loading) {
    return (
      <div className="page-container flex items-center justify-center py-12 text-gray-500 gap-2">
        <Loader2 className="animate-spin" size={20} />
        <span>Carregando dados dos passageiros...</span>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h1>Gestão de Passageiros</h1>
        <button className="export-btn" onClick={handleExportAllPDF}>
          <Download size={18} /> Baixar PDF Geral
        </button>
      </div>

      <div className="controls-bar">
        <div className="search-box">
          <Search size={18} className="search-icon" />
          <input 
            type="text" 
            placeholder="Buscar por nome ou telefone..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="results-info">
          Exibindo {displayedPassengers.length} de {filteredPassengers.length} passageiro(s)
        </div>
      </div>

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Passageiro</th>
              <th>Telefone</th>
              <th>Saldo</th>
              <th>Status</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {displayedPassengers.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center py-8 text-gray-500">
                  Nenhum passageiro encontrado.
                </td>
              </tr>
            ) : (
              displayedPassengers.map((passenger) => (
                <tr key={passenger.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      <div className="avatar-placeholder overflow-hidden">
                        {passenger.avatarUrl ? (
                          <img src={passenger.avatarUrl} alt={passenger.fullName} className="w-full h-full object-cover" />
                        ) : (
                          <span>{(passenger.fullName || 'P').charAt(0).toUpperCase()}</span>
                        )}
                      </div>
                      <div>
                        <strong>{passenger.fullName || 'Sem Nome'}</strong>
                        <div className="rating-badge">
                          <Star size={12} fill="currentColor" />
                          <span>{getRatingFormatted(passenger.ratingAverage)}</span>
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>{passenger.phone || 'N/A'}</td>
                  <td>
                    <strong className="wallet-balance">{formatCurrency(passenger.walletBalance)}</strong>
                  </td>
                  <td>
                    <span className={`status-badge ${(passenger.status || 'ACTIVE').toLowerCase()}`}>
                      {passenger.status === 'ACTIVE' ? 'Ativo' : 'Suspenso'}
                    </span>
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <button 
                        className="action-btn" 
                        title="Gerenciar Carteira e Reembolso" 
                        onClick={() => handleOpenPassengerWallet(passenger)}
                        style={{ backgroundColor: '#ECFDF5', color: '#047857', borderColor: '#6EE7B7' }}
                      >
                        <Wallet size={16} /> Carteira
                      </button>

                      <button
                        className="action-btn"
                        title="Destravar corrida presa no app do passageiro"
                        onClick={() => handleUnlockPassengerApp(passenger.id, passenger.fullName)}
                        style={{ backgroundColor: '#FEF3C7', color: '#B45309', borderColor: '#FCD34D' }}
                      >
                        Destravar
                      </button>

                      <button 
                        className="action-btn btn-view" 
                        title="Ver Detalhes" 
                        onClick={() => handleOpenDetails(passenger)}
                      >
                        <Eye size={16} /> Detalhes
                      </button>

                      <button 
                        className="action-btn btn-download-single" 
                        title="Baixar PDF" 
                        onClick={() => handleExportSinglePDF(passenger)}
                      >
                        <FileDown size={16} /> PDF
                      </button>
                      
                      {passenger.status === 'ACTIVE' ? (
                        <button 
                          className="action-btn btn-suspend" 
                          disabled={updatingId === passenger.id}
                          onClick={() => handleToggleStatus(passenger.id, passenger.status)}
                        >
                          <ShieldAlert size={16} /> Suspender
                        </button>
                      ) : (
                        <button 
                          className="action-btn btn-reactivate" 
                          disabled={updatingId === passenger.id}
                          onClick={() => handleToggleStatus(passenger.id, passenger.status)}
                        >
                          <CheckCircle size={16} /> Reativar
                        </button>
                      )}

                      {/* 🔴 BOTÃO DE EXCLUIR PASSAGEIRO */}
                      <button 
                        className="action-btn btn-delete" 
                        title="Excluir Passageiro" 
                        disabled={updatingId === passenger.id}
                        onClick={() => handleDeletePassenger(passenger.id, passenger.fullName || 'Passageiro')}
                        style={{ backgroundColor: '#ef4444', color: '#ffffff', borderColor: '#dc2626' }}
                      >
                        {updatingId === passenger.id ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <Trash2 size={16} />
                        )}
                        <span>Excluir</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>


      {/* MODAL DE CARTEIRA E REEMBOLSO DO PASSAGEIRO */}
      {walletPassenger && (
        <div className="modal-overlay" onClick={() => setWalletPassenger(null)}>
          <div className="modal-content-sm" style={{ maxWidth: '580px', width: '95%' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>Carteira do Passageiro</h2>
                <p style={{ fontSize: '0.85rem', color: '#64748B', marginTop: '2px' }}>
                  {walletPassenger.fullName} • {walletPassenger.phone}
                </p>
              </div>
              <button className="close-modal-btn" onClick={() => setWalletPassenger(null)}>
                <X size={22} />
              </button>
            </div>

            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{
                background: 'linear-gradient(135deg, #0F172A 0%, #1E293B 100%)',
                color: '#FFFFFF',
                padding: '16px 20px',
                borderRadius: '12px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}>
                <div>
                  <span style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94A3B8' }}>
                    Saldo Disponível
                  </span>
                  <div style={{ fontSize: '1.6rem', fontWeight: 800, color: '#34D399', marginTop: '2px' }}>
                    {formatCurrency(walletPassenger.walletBalance)}
                  </div>
                </div>
                <Wallet size={30} color="#34D399" />
              </div>

              <form onSubmit={handleSubmitPassengerWallet} style={{
                backgroundColor: '#F8FAFC',
                border: '1px solid #E2E8F0',
                borderRadius: '10px',
                padding: '14px',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px'
              }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => setWalletType('CREDIT')}
                    style={{
                      padding: '8px 12px',
                      borderRadius: '8px',
                      fontWeight: 600,
                      fontSize: '0.85rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      border: walletType === 'CREDIT' ? '2px solid #059669' : '1px solid #CBD5E1',
                      backgroundColor: walletType === 'CREDIT' ? '#ECFDF5' : '#FFFFFF',
                      color: walletType === 'CREDIT' ? '#047857' : '#475569',
                      cursor: 'pointer'
                    }}
                  >
                    <PlusCircle size={15} /> Reembolsar / Creditar
                  </button>
                  <button
                    type="button"
                    onClick={() => setWalletType('DEBIT')}
                    style={{
                      padding: '8px 12px',
                      borderRadius: '8px',
                      fontWeight: 600,
                      fontSize: '0.85rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                      border: walletType === 'DEBIT' ? '2px solid #DC2626' : '1px solid #CBD5E1',
                      backgroundColor: walletType === 'DEBIT' ? '#FEF2F2' : '#FFFFFF',
                      color: walletType === 'DEBIT' ? '#B91C1C' : '#475569',
                      cursor: 'pointer'
                    }}
                  >
                    <MinusCircle size={15} /> Debitar Saldo
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '8px' }}>
                  <input
                    type="number"
                    min="1"
                    required
                    placeholder="Valor (XOF)"
                    value={walletAmount}
                    onChange={(e) => setWalletAmount(e.target.value)}
                    style={{ padding: '8px 10px', borderRadius: '8px', border: '1px solid #CBD5E1', fontWeight: 700 }}
                  />
                  <input
                    type="text"
                    required
                    placeholder="Motivo (ex: Reembolso corrida cancelada #123)"
                    value={walletReason}
                    onChange={(e) => setWalletReason(e.target.value)}
                    style={{ padding: '8px 10px', borderRadius: '8px', border: '1px solid #CBD5E1' }}
                  />
                </div>

                <button
                  type="submit"
                  disabled={walletSubmitting}
                  style={{
                    padding: '9px 14px',
                    borderRadius: '8px',
                    border: 'none',
                    fontWeight: 700,
                    color: '#FFFFFF',
                    backgroundColor: walletType === 'CREDIT' ? '#059669' : '#DC2626',
                    cursor: 'pointer'
                  }}
                >
                  {walletSubmitting ? 'Processando...' : (walletType === 'CREDIT' ? 'Confirmar Crédito / Reembolso' : 'Confirmar Débito')}
                </button>
              </form>

              <div>
                <h4 style={{ fontSize: '0.85rem', fontWeight: 700, color: '#334155', marginBottom: '8px' }}>
                  Últimas Movimentações
                </h4>
                {walletLoading ? (
                  <p style={{ fontSize: '0.85rem', color: '#64748B' }}>Carregando extrato...</p>
                ) : walletTxs.length === 0 ? (
                  <p style={{ fontSize: '0.85rem', color: '#94A3B8' }}>Nenhuma movimentação registrada.</p>
                ) : (
                  <div style={{ maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {walletTxs.map((t: any) => {
                      const isPositive = t.type === 'DEPOSIT' || t.type === 'REFUND';
                      return (
                        <div key={t.id} style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          padding: '8px 10px',
                          backgroundColor: '#FFFFFF',
                          border: '1px solid #E2E8F0',
                          borderRadius: '8px',
                          fontSize: '0.82rem'
                        }}>
                          <div>
                            <div style={{ fontWeight: 600, color: '#1E293B', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              {isPositive ? <ArrowUpRight size={14} color="#059669" /> : <ArrowDownRight size={14} color="#DC2626" />}
                              {t.description || t.type}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: '#64748B' }}>
                              {new Date(t.createdAt).toLocaleString('pt-BR')} • {t.status}
                            </div>
                          </div>
                          <strong style={{ color: isPositive ? '#059669' : '#DC2626', fontFamily: 'monospace' }}>
                            {isPositive ? '+' : '-'}{formatCurrency(t.amount)}
                          </strong>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE DETALHES */}
      {isModalOpen && selectedPassenger && (
        <div className="modal-overlay" onClick={handleCloseModal}>
          <div className="modal-content-sm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Detalhes do Passageiro</h2>
              <button className="close-modal-btn" onClick={handleCloseModal} aria-label="Fechar modal">
                <X size={24} />
              </button>
            </div>
            
            <div className="modal-body">
              <div className="profile-header">
                <div className="avatar-large overflow-hidden">
                  {selectedPassenger.avatarUrl ? (
                    <img src={selectedPassenger.avatarUrl} alt={selectedPassenger.fullName} className="w-full h-full object-cover" />
                  ) : (
                    <span>{(selectedPassenger.fullName || 'P').charAt(0).toUpperCase()}</span>
                  )}
                </div>
                <h3>{selectedPassenger.fullName || 'Sem Nome'}</h3>
                <p>{selectedPassenger.phone || 'Sem Telefone'}</p>
                <div className="mt-2">
                  <span className={`status-badge ${(selectedPassenger.status || 'ACTIVE').toLowerCase()}`}>
                    {selectedPassenger.status === 'ACTIVE' ? 'Usuário Ativo' : 'Usuário Suspenso'}
                  </span>
                </div>
              </div>

              <div className="stats-grid">
                <div className="stat-card">
                  <Wallet size={20} className="text-emerald-600" />
                  <h4>Saldo na Carteira</h4>
                  <p>{formatCurrency(selectedPassenger.walletBalance)}</p>
                </div>
                
                <div className="stat-card">
                  <Star size={20} className="text-amber-500" />
                  <h4>Avaliação Média</h4>
                  <p>{getRatingFormatted(selectedPassenger.ratingAverage)} / 5.0</p>
                </div>
                
                <div className="stat-card">
                  <Car size={20} className="text-indigo-500" />
                  <h4>Total de Corridas</h4>
                  <p>{selectedPassenger.totalRides || 0} corridas</p>
                </div>

                <div className="stat-card">
                  <Calendar size={20} className="text-blue-500" />
                  <h4>Membro Desde</h4>
                  <p>{formatDate(selectedPassenger.createdAt)}</p>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button className="action-btn btn-close-modal" onClick={handleCloseModal}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}