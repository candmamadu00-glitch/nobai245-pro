import React, { useEffect, useState, useCallback } from 'react';
import { 
  Eye, ShieldAlert, CheckCircle, Search, Download, FileDown, 
  X, Star, Wallet, Calendar, Loader2, Car, Trash2 
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