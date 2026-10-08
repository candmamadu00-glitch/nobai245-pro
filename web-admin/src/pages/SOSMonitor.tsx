import React, { useEffect, useState, useRef } from 'react';
import { api } from '../services/api';
import { useAdminSocket } from '../hooks/useAdminSocket';
import type { SosAlertPayload } from '../hooks/useAdminSocket';
import './SOSMonitor.css';

// URL base da API para carregar o áudio estático do backend
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export function SOSMonitor() {
  const [sosList, setSosList] = useState<SosAlertPayload[]>([]);
  const [selectedSos, setSelectedSos] = useState<SosAlertPayload | null>(null);
  const [filter, setFilter] = useState<'ACTIVE' | 'RESOLVED' | 'FALSE_ALARM'>('ACTIVE');
  const [loading, setLoading] = useState(true);

  // Áudio para o alarme sonoro da sala de controle
  const alarmRef = useRef<HTMLAudioElement | null>(null);

  const { incomingSosAlert } = useAdminSocket('CURRENT_ADMIN_ID');

  const fetchSosAlerts = async () => {
    try {
      setLoading(true);
      const response = await api.get(`/admin/sos?status=${filter}`);
      setSosList(response.data);
      if (response.data.length > 0) {
        setSelectedSos(response.data[0]);
      } else {
        setSelectedSos(null);
      }
    } catch (err) {
      console.error('Erro ao buscar alertas SOS:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSosAlerts();
  }, [filter]);

  // Quando chegar um novo SOS via WebSocket
  useEffect(() => {
    if (incomingSosAlert) {
      if (filter === 'ACTIVE') {
        setSosList((prev) => [incomingSosAlert, ...prev]);
      }
      setSelectedSos(incomingSosAlert);
      
      // Tocar alarme sonoro
      if (alarmRef.current) {
        alarmRef.current.play().catch(() => {});
      }
    }
  }, [incomingSosAlert]);

  const handleUpdateStatus = async (id: string, status: 'RESOLVED' | 'FALSE_ALARM') => {
    try {
      await api.patch(`/admin/sos/${id}/status`, { status });
      fetchSosAlerts();
    } catch (err) {
      alert('Erro ao atualizar status do incidente.');
    }
  };

  // Trata a URL do áudio (se for relativa, adiciona a base da API)
  const getAudioSource = (url: string) => {
    if (url.startsWith('http')) return url;
    return `${API_URL}${url.startsWith('/') ? '' : '/'}${url}`;
  };

  return (
    <div className="sos-container">
      {/* Alarme sonoro em background */}
      <audio ref={alarmRef} src="/alarm.mp3" preload="auto" />

      <header className="sos-header">
        <div>
          <h1>🚨 Sala de Controle de Emergências (SOS)</h1>
          <p>Monitoramento e resposta rápida para incidentes de segurança na Guiné-Bissau</p>
        </div>

        <div className="sos-filters">
          <button 
            className={filter === 'ACTIVE' ? 'active danger' : ''} 
            onClick={() => setFilter('ACTIVE')}
          >
            Ativos
          </button>
          <button 
            className={filter === 'RESOLVED' ? 'active' : ''} 
            onClick={() => setFilter('RESOLVED')}
          >
            Resolvidos
          </button>
          <button 
            className={filter === 'FALSE_ALARM' ? 'active' : ''} 
            onClick={() => setFilter('FALSE_ALARM')}
          >
            Falsos Alarmes
          </button>
        </div>
      </header>

      <div className="sos-content">
        {/* Painel Esquerdo: Lista de Incidentes */}
        <div className="sos-list-panel">
          {loading ? (
            <p className="empty-state">Carregando chamados de emergência...</p>
          ) : sosList.length === 0 ? (
            <p className="empty-state">Nenhum incidente cadastrado neste status.</p>
          ) : (
            sosList.map((sos) => (
              <div
                key={sos.id}
                className={`sos-card ${selectedSos?.id === sos.id ? 'selected' : ''} ${sos.status.toLowerCase()}`}
                onClick={() => setSelectedSos(sos)}
              >
                <div className="sos-card-badge">
                  <span>{sos.userType === 'PASSENGER' ? 'PASSAGEIRO' : 'MOTORISTA'}</span>
                  <span className="sos-time">{new Date(sos.createdAt).toLocaleTimeString()}</span>
                </div>
                <h3>{sos.passenger?.fullName || sos.driver?.fullName || 'Usuário Não Identificado'}</h3>
                <p>📍 {sos.lat?.toFixed(5) || '0.00000'}, {sos.lng?.toFixed(5) || '0.00000'}</p>
              </div>
            ))
          )}
        </div>

        {/* Painel Direito: Detalhes e Ações Imediatas */}
        <div className="sos-detail-panel">
          {selectedSos ? (
            <div className="sos-detail-card">
              <div className="sos-detail-header">
                <h2>Detalhes do Chamado #{selectedSos.id.substring(0, 8)}</h2>
                <span className={`status-pill ${selectedSos.status.toLowerCase()}`}>
                  {selectedSos.status}
                </span>
              </div>

              <div className="sos-grid">
                <div className="info-box">
                  <label>Vítima / Solicitante</label>
                  <p><strong>Nome:</strong> {selectedSos.passenger?.fullName || selectedSos.driver?.fullName || 'N/A'}</p>
                  <p><strong>Telefone:</strong> {selectedSos.passenger?.phone || selectedSos.driver?.phone || 'N/A'}</p>
                  <p><strong>Tipo:</strong> {selectedSos.userType}</p>
                </div>

                {selectedSos.driver && (
                  <div className="info-box">
                    <label>Dados do Veículo</label>
                    <p><strong>Motorista:</strong> {selectedSos.driver.fullName}</p>
                    <p><strong>Matrícula/Placa:</strong> {selectedSos.driver.vehiclePlate}</p>
                  </div>
                )}
              </div>

              {/* Player de Áudio de Segurança */}
              {selectedSos.audioUrl && (
                <div className="audio-player-box">
                  <label>🔊 Gravação de Segurança do Ambiente:</label>
                  <audio controls src={getAudioSource(selectedSos.audioUrl)} style={{ width: '100%', marginTop: '8px' }} />
                </div>
              )}

              {/* Localização GPS no Google Maps Embed */}
              <div className="map-preview">
                <iframe
                  title="GPS Location"
                  width="100%"
                  height="250"
                  frameBorder="0"
                  src={`https://maps.google.com/maps?q=${selectedSos.lat},${selectedSos.lng}&z=15&output=embed`}
                />
              </div>

              {/* Ações de Emergência */}
              <div className="sos-actions">
                <a
                  href={`tel:${selectedSos.passenger?.phone || selectedSos.driver?.phone}`}
                  className="btn btn-call"
                >
                  📞 Ligar para a Vítima
                </a>
                <a
                  href="tel:112"
                  className="btn btn-police"
                >
                  🚓 Acionar Polícia POP (112)
                </a>
                
                {selectedSos.status === 'ACTIVE' && (
                  <>
                    <button
                      className="btn btn-resolve"
                      onClick={() => handleUpdateStatus(selectedSos.id, 'RESOLVED')}
                    >
                      ✅ Resolver Incidente
                    </button>
                    <button
                      className="btn btn-false-alarm"
                      onClick={() => handleUpdateStatus(selectedSos.id, 'FALSE_ALARM')}
                    >
                      ⚠️ Falso Alarme
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="empty-detail">
              <p>Selecione um alerta à esquerda para abrir a sala de controle.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}