import React, { useEffect, useState, useCallback } from 'react';
import { Eye, Check, X, Search, Loader2 } from 'lucide-react';
import { api, API_URL } from '../services/api';
import './Drivers.css';

interface DriverChangeRequestItem {
  id: string;
  driverId: string;
  newFullName?: string | null;
  newVehiclePlate?: string | null;
  newVehicleBrand?: string | null;
  newVehicleColor?: string | null;
  newDocumentNumber?: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: string;
  driver?: {
    fullName: string;
    phone: string;
    vehiclePlate: string;
    vehicleBrand?: string | null;
    vehicleColor?: string | null;
    documentNumber?: string | null;
  };
}

interface DriverRequest {
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
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED';
  createdAt: string;
  profilePicture?: string;
  licenseFrontPicture?: string;
  licenseBackPicture?: string;
}

export function DriverRequests() {
  const [activeTab, setActiveTab] = useState<'new' | 'updates'>('new');
  const [requests, setRequests] = useState<DriverRequest[]>([]);
  const [changeRequests, setChangeRequests] = useState<DriverChangeRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDriver, setSelectedDriver] = useState<DriverRequest | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // 🛡️ TRATAMENTO BLINDADO DE IMAGENS
  const formatImageUrl = (path?: string) => {
    if (!path) return undefined;

    // Remove o sufixo /api para apontar diretamente para o endpoint de arquivos estáticos (/uploads)
    const serverBase = API_URL.replace(/\/api\/?$/, '');

    // Se contiver /uploads/, isola o nome do arquivo ignorando domínios/IPs locais gravados no banco
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

  const fetchRequests = useCallback(async () => {
    try {
      setLoading(true);
      const [newDriversRes, changeReqRes] = await Promise.all([
        api.get<DriverRequest[]>('/admin/drivers', {
          params: { status: 'PENDING_APPROVAL' }
        }),
        api.get<DriverChangeRequestItem[]>('/admin/driver-requests').catch(() => ({ data: [] as DriverChangeRequestItem[] })),
      ]);
      setRequests(Array.isArray(newDriversRes.data) ? newDriversRes.data : []);
      const pendingChanges = Array.isArray(changeReqRes.data) ? changeReqRes.data : [];
      setChangeRequests(pendingChanges);
      if ((newDriversRes.data?.length || 0) === 0 && pendingChanges.length > 0) {
        setActiveTab('updates');
      }
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

  const handleReviewChangeRequest = async (requestId: string, action: 'APPROVE' | 'REJECT') => {
    const confirmMsg = action === 'APPROVE'
      ? 'Confirmar aprovação e aplicar os novos dados no cadastro deste motorista?'
      : 'Tem certeza que deseja REJEITAR esta solicitação de alteração?';
    if (!window.confirm(confirmMsg)) return;

    try {
      setActionLoading(requestId);
      await api.put(`/admin/driver-requests/${requestId}/review`, { action });
      await fetchRequests();
    } catch (error: any) {
      console.error('Erro ao revisar alteração de motorista:', error);
      alert(error?.response?.data?.error || 'Erro ao processar solicitação de alteração.');
    } finally {
      setActionLoading(null);
    }
  };

  const filteredChangeRequests = changeRequests.filter((item) => {
    const term = searchTerm.toLowerCase();
    return (
      (item.driver?.fullName || '').toLowerCase().includes(term) ||
      (item.driver?.phone || '').toLowerCase().includes(term) ||
      (item.driver?.vehiclePlate || '').toLowerCase().includes(term) ||
      (item.newFullName || '').toLowerCase().includes(term) ||
      (item.newVehiclePlate || '').toLowerCase().includes(term)
    );
  });

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
            Análise de novos cadastros e pedidos de alteração de dados / veículo
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => setActiveTab('new')}
          style={{
            padding: '10px 16px',
            borderRadius: 10,
            border: activeTab === 'new' ? '2px solid #EAB308' : '1px solid #E5E7EB',
            backgroundColor: activeTab === 'new' ? '#FEF9C3' : '#FFFFFF',
            color: '#111827',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span>Novos Cadastros</span>
          <span style={{ backgroundColor: '#111827', color: '#FFFFFF', borderRadius: 999, padding: '2px 8px', fontSize: 12 }}>
            {requests.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('updates')}
          style={{
            padding: '10px 16px',
            borderRadius: 10,
            border: activeTab === 'updates' ? '2px solid #EAB308' : '1px solid #E5E7EB',
            backgroundColor: activeTab === 'updates' ? '#FEF9C3' : '#FFFFFF',
            color: '#111827',
            fontWeight: 700,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span>Alterações de Dados / Veículo</span>
          <span style={{ backgroundColor: changeRequests.length > 0 ? '#D97706' : '#6B7280', color: '#FFFFFF', borderRadius: 999, padding: '2px 8px', fontSize: 12 }}>
            {changeRequests.length}
          </span>
        </button>
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
          {activeTab === 'new'
            ? `${filteredRequests.length} novo(s) cadastro(s) pendente(s)`
            : `${filteredChangeRequests.length} alteração(ões) de dados pendente(s)`}
        </div>
      </div>

      {activeTab === 'updates' ? (
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Motorista</th>
                <th>Alterações Solicitadas (Atual → Novo)</th>
                <th>Data do Pedido</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filteredChangeRequests.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: '32px', color: '#6B7280' }}>
                    Nenhuma solicitação de alteração de dados pendente no momento.
                  </td>
                </tr>
              ) : (
                filteredChangeRequests.map((item) => {
                  const isProcessing = actionLoading === item.id;
                  const currentDriver = item.driver;
                  const diffs: Array<{ label: string; oldVal: string; newVal: string }> = [];

                  if (item.newFullName && item.newFullName !== (currentDriver?.fullName || '')) {
                    diffs.push({ label: 'Nome', oldVal: currentDriver?.fullName || '—', newVal: item.newFullName });
                  }
                  if (item.newVehiclePlate && item.newVehiclePlate !== (currentDriver?.vehiclePlate || '')) {
                    diffs.push({ label: 'Placa', oldVal: currentDriver?.vehiclePlate || '—', newVal: item.newVehiclePlate });
                  }
                  if (item.newVehicleBrand && item.newVehicleBrand !== (currentDriver?.vehicleBrand || '')) {
                    diffs.push({ label: 'Marca/Modelo', oldVal: currentDriver?.vehicleBrand || '—', newVal: item.newVehicleBrand });
                  }
                  if (item.newVehicleColor && item.newVehicleColor !== (currentDriver?.vehicleColor || '')) {
                    diffs.push({ label: 'Cor', oldVal: currentDriver?.vehicleColor || '—', newVal: item.newVehicleColor });
                  }
                  if (item.newDocumentNumber && item.newDocumentNumber !== (currentDriver?.documentNumber || '')) {
                    diffs.push({ label: 'Nº Documento', oldVal: currentDriver?.documentNumber || '—', newVal: item.newDocumentNumber });
                  }

                  return (
                    <tr key={item.id}>
                      <td>
                        <strong>{currentDriver?.fullName || 'Motorista'}</strong>
                        <div style={{ fontSize: 12, color: '#6B7280' }}>{currentDriver?.phone || ''}</div>
                        <div style={{ fontSize: 12, color: '#6B7280' }}>Placa atual: {currentDriver?.vehiclePlate || '—'}</div>
                      </td>
                      <td>
                        {diffs.length === 0 ? (
                          <span style={{ color: '#6B7280' }}>Sem campos divergentes</span>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {diffs.map((d) => (
                              <div key={d.label} style={{ fontSize: 13 }}>
                                <strong>{d.label}:</strong>{' '}
                                <span style={{ color: '#6B7280', textDecoration: 'line-through' }}>{d.oldVal}</span>{' '}
                                → <span style={{ color: '#059669', fontWeight: 700 }}>{d.newVal}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td>{new Date(item.createdAt).toLocaleString('pt-BR')}</td>
                      <td>
                        <button
                          className="action-btn"
                          disabled={isProcessing}
                          style={{ backgroundColor: '#059669', color: 'white' }}
                          onClick={() => handleReviewChangeRequest(item.id, 'APPROVE')}
                        >
                          <Check size={16} /> Aprovar Alteração
                        </button>
                        <button
                          className="action-btn"
                          disabled={isProcessing}
                          style={{ backgroundColor: '#DC2626', color: 'white', marginLeft: 8 }}
                          onClick={() => handleReviewChangeRequest(item.id, 'REJECT')}
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
      ) : (
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
                      <div><strong>{driver.vehicleType}</strong> ({driver.vehicleBrand || 'N/A'})</div>
                      <small style={{ color: '#6B7280' }}>Placa: {driver.vehiclePlate}</small>
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
      )}

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
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px', backgroundColor: '#F3F4F6', padding: '12px', borderRadius: '8px' }}>
                <p><strong>Telefone:</strong> {selectedDriver.phone}</p>
                <p><strong>Tipo de Documento:</strong> {selectedDriver.documentType || 'BI'}</p>
                <p><strong>Nº do Documento:</strong> {selectedDriver.documentNumber || 'Não informado'}</p>
                <p><strong>Veículo:</strong> {selectedDriver.vehicleType} - {selectedDriver.vehicleBrand || ''} ({selectedDriver.vehicleColor || 'Sem cor'})</p>
                <p><strong>Placa:</strong> {selectedDriver.vehiclePlate}</p>
                {selectedDriver.vehicleSeats ? <p><strong>Lotação:</strong> {selectedDriver.vehicleSeats} Lugares</p> : null}
              </div>

              <div className="documents-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
                <div className="document-card">
                  <h3>Foto de Perfil / Selfie</h3>
                  {selectedDriver.profilePicture ? (
                    <img src={formatImageUrl(selectedDriver.profilePicture)} alt="Foto do Motorista" style={{ width: '100%', height: '180px', objectFit: 'cover', borderRadius: '8px' }} />
                  ) : (
                    <div className="no-image">Imagem não enviada</div>
                  )}
                </div>

                <div className="document-card">
                  <h3>Carta de Condução (Frente)</h3>
                  {selectedDriver.licenseFrontPicture ? (
                    <img src={formatImageUrl(selectedDriver.licenseFrontPicture)} alt="Frente Documento" style={{ width: '100%', height: '180px', objectFit: 'cover', borderRadius: '8px' }} />
                  ) : (
                    <div className="no-image">Imagem não enviada</div>
                  )}
                </div>

                <div className="document-card">
                  <h3>Carta de Condução (Verso)</h3>
                  {selectedDriver.licenseBackPicture ? (
                    <img src={formatImageUrl(selectedDriver.licenseBackPicture)} alt="Verso Documento" style={{ width: '100%', height: '180px', objectFit: 'cover', borderRadius: '8px' }} />
                  ) : (
                    <div className="no-image">Imagem não enviada</div>
                  )}
                </div>
              </div>
            </div>

            <div className="modal-footer" style={{ gap: 12, marginTop: '16px' }}>
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