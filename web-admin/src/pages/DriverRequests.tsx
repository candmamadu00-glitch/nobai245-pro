import React, { useEffect, useState, useCallback } from 'react';
import { Eye, Check, X, Search, Loader2 } from 'lucide-react';
import { api, API_URL } from '../services/api';
import './Drivers.css';

interface DriverRequest {
  id: string;
  fullName: string;
  phone: string;
  vehicleType: string;
  vehiclePlate: string;
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
  createdAt: string;
  profilePicture?: string;
  licenseFrontPicture?: string;
  licenseBackPicture?: string;
}

export function DriverRequests() {
  const [requests, setRequests] = useState<DriverRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDriver, setSelectedDriver] = useState<DriverRequest | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const formatImageUrl = (path?: string) => {
    if (!path) return undefined;
    if (path.startsWith('http')) return path;
    return `${API_URL}${path.startsWith('/') ? '' : '/'}${path}`;
  };

  const fetchRequests = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.get<DriverRequest[]>('/admin/drivers', {
        params: { status: 'PENDING_APPROVAL' }
      });
      setRequests(response.data);
    } catch (error) {
      console.error('Erro ao buscar solicitações de motoristas:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isModalOpen) {
        setIsModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen]);

  const handleApprove = async (driverId: string) => {
    if (!window.confirm('Confirmar aprovação do cadastro deste motorista?')) return;
    
    try {
      setActionLoading(driverId);
      await api.patch(`/admin/drivers/${driverId}/status`, { status: 'APPROVED' });
      setIsModalOpen(false);
      await fetchRequests();
    } catch (error) {
      console.error('Erro ao aprovar motorista:', error);
      alert('Erro ao processar aprovação do motorista.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (driverId: string) => {
    if (!window.confirm('Tem certeza que deseja REJEITAR o cadastro deste motorista?')) return;
    
    try {
      setActionLoading(driverId);
      await api.patch(`/admin/drivers/${driverId}/status`, { status: 'REJECTED' });
      setIsModalOpen(false);
      await fetchRequests();
    } catch (error) {
      console.error('Erro ao rejeitar motorista:', error);
      alert('Erro ao rejeitar motorista.');
    } finally {
      setActionLoading(null);
    }
  };

  const filteredRequests = requests.filter((driver) => {
    const term = searchTerm.toLowerCase();
    return (
      driver.fullName.toLowerCase().includes(term) ||
      driver.phone.toLowerCase().includes(term) ||
      driver.vehiclePlate.toLowerCase().includes(term)
    );
  });

  if (loading) {
    return (
      <div style={{ padding: 32, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Loader2 className="animate-spin" size={20} />
        <span>Carregando solicitações pendentes...</span>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Solicitações de Motoristas</h1>
          <p style={{ color: '#6B7280', margin: '4px 0 0 0' }}>
            Análise e validação de novos cadastros
          </p>
        </div>
      </div>

      <div className="controls-bar">
        <div className="search-box">
          <Search size={18} className="search-icon" />
          <input
            type="text"
            placeholder="Buscar por nome, telefone ou placa..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="results-info">
          {filteredRequests.length} solicitação(ões) pendente(s)
        </div>
      </div>

      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Motorista</th>
              <th>Contato</th>
              <th>Veículo / Placa</th>
              <th>Data Cadastro</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {filteredRequests.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ textAlign: 'center', padding: '32px', color: '#6B7280' }}>
                  Nenhuma solicitação pendente no momento.
                </td>
              </tr>
            ) : (
              filteredRequests.map((driver) => {
                const profileImgSrc = formatImageUrl(driver.profilePicture);
                const isProcessing = actionLoading === driver.id;

                return (
                  <tr key={driver.id}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        {profileImgSrc ? (
                          <img
                            src={profileImgSrc}
                            alt={driver.fullName}
                            style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover' }}
                          />
                        ) : (
                          <div style={{ width: '40px', height: '40px', borderRadius: '50%', backgroundColor: '#FEF3C7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <span style={{ color: '#D97706', fontWeight: 'bold' }}>{driver.fullName.charAt(0)}</span>
                          </div>
                        )}
                        <strong>{driver.fullName}</strong>
                      </div>
                    </td>
                    <td>{driver.phone}</td>
                    <td>
                      <div><strong>{driver.vehicleType}</strong></div>
                      <small style={{ color: '#6B7280' }}>{driver.vehiclePlate}</small>
                    </td>
                    <td>{new Date(driver.createdAt).toLocaleDateString('pt-BR')}</td>
                    <td>
                      <button
                        className="action-btn btn-view"
                        disabled={isProcessing}
                        onClick={() => { setSelectedDriver(driver); setIsModalOpen(true); }}
                      >
                        <Eye size={16} /> Analisar Documentos
                      </button>
                      <button
                        className="action-btn"
                        disabled={isProcessing}
                        style={{ backgroundColor: '#059669', color: 'white', marginLeft: 8 }}
                        onClick={() => handleApprove(driver.id)}
                      >
                        <Check size={16} /> Aprovar
                      </button>
                      <button
                        className="action-btn"
                        disabled={isProcessing}
                        style={{ backgroundColor: '#DC2626', color: 'white', marginLeft: 8 }}
                        onClick={() => handleReject(driver.id)}
                      >
                        <X size={16} /> Rejeitar
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {isModalOpen && selectedDriver && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Análise de Documentos - {selectedDriver.fullName}</h2>
              <button className="close-modal-btn" onClick={() => setIsModalOpen(false)}>
                <X size={24} />
              </button>
            </div>

            <div className="modal-body">
              <p><strong>Telefone:</strong> {selectedDriver.phone}</p>
              <p><strong>Veículo:</strong> {selectedDriver.vehicleType} | <strong>Placa:</strong> {selectedDriver.vehiclePlate}</p>

              <div className="documents-grid">
                <div className="document-card">
                  <h3>CNH / Documento (Frente)</h3>
                  {selectedDriver.licenseFrontPicture ? (
                    <img src={formatImageUrl(selectedDriver.licenseFrontPicture)} alt="Frente Documento" />
                  ) : (
                    <div className="no-image">Imagem não enviada</div>
                  )}
                </div>

                <div className="document-card">
                  <h3>CNH / Documento (Verso)</h3>
                  {selectedDriver.licenseBackPicture ? (
                    <img src={formatImageUrl(selectedDriver.licenseBackPicture)} alt="Verso Documento" />
                  ) : (
                    <div className="no-image">Imagem não enviada</div>
                  )}
                </div>
              </div>
            </div>

            <div className="modal-footer" style={{ gap: 12 }}>
              <button
                className="action-btn"
                disabled={actionLoading === selectedDriver.id}
                style={{ backgroundColor: '#DC2626', color: 'white' }}
                onClick={() => handleReject(selectedDriver.id)}
              >
                <X size={16} /> Rejeitar Cadastramento
              </button>
              <button
                className="action-btn"
                disabled={actionLoading === selectedDriver.id}
                style={{ backgroundColor: '#059669', color: 'white' }}
                onClick={() => handleApprove(selectedDriver.id)}
              >
                <Check size={16} /> Aprovar Motorista
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}