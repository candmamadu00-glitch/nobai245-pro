import { emergencySiren } from '../utils/emergencySiren';
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { api, BASE_SERVER_URL } from '../services/api';
import { useAuth } from '../contexts/AuthContext';
import { useAdminSocket } from '../hooks/useAdminSocket';
import type { SosAlertPayload } from '../hooks/useAdminSocket';
import './SOSMonitor.css';

export function SOSMonitor() {
  const { admin, token } = useAuth();
  const [sosList, setSosList] = useState<SosAlertPayload[]>([]);
  const [selectedSos, setSelectedSos] = useState<SosAlertPayload | null>(null);
  const [filter, setFilter] = useState<'ACTIVE' | 'RESOLVED' | 'FALSE_ALARM'>('ACTIVE');
  const [loading, setLoading] = useState(true);
  const [soundMuted, setSoundMuted] = useState(false);

  const lastAlertIdRef = useRef<string | null>(null);
  const { incomingSosAlert } = useAdminSocket(admin?.id, token || undefined);

  // Sirene sintetizada via Web Audio API (funciona offline/sem depender de MP3 externo)
  const playEmergencySiren = useCallback(() => {
    if (soundMuted) return;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      const now = ctx.currentTime;
      osc.frequency.setValueAtTime(680, now);
      osc.frequency.linearRampToValueAtTime(980, now + 0.25);
      osc.frequency.linearRampToValueAtTime(680, now + 0.5);
      osc.frequency.linearRampToValueAtTime(980, now + 0.75);

      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.85);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.85);
      osc.onended = () => ctx.close().catch(() => {});
    } catch {
      // Ignora bloqueio de autoplay antes da primeira interação do usuário
    }
  }, [soundMuted]);

  const fetchSosAlerts = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.get(`/admin/sos?status=${filter}`);
      const items = Array.isArray(response.data) ? response.data : [];
      setSosList(items);
      if (items.length > 0) {
        setSelectedSos(items[0]);
      } else {
        setSelectedSos(null);
      }
    } catch (err) {
      console.error('Erro ao buscar alertas SOS:', err);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchSosAlerts();
  }, [fetchSosAlerts]);

  useEffect(() => {
    if (!incomingSosAlert || incomingSosAlert.id === lastAlertIdRef.current) return;
    lastAlertIdRef.current = incomingSosAlert.id;

    if (filter === 'ACTIVE') {
      setSosList((prev) =>
        prev.some((item) => item.id === incomingSosAlert.id) ? prev : [incomingSosAlert, ...prev]
      );
    }
    setSelectedSos(incomingSosAlert);
    playEmergencySiren();
  }, [incomingSosAlert, filter, playEmergencySiren]);

  const generateAgencyLink = async (agencyType: 'POLICE' | 'HOSPITAL') => {
    const label = agencyType === 'POLICE' ? 'Policia POP (112)' : 'Hospital Central';
    try {
      const res = await api.post('/admin/emergency-access/generate', {
        agencyName: label,
        agencyType,
        expiresInHours: 168,
      });
      const url = res.data?.accessUrl;
      if (url) {
        await navigator.clipboard?.writeText(url).catch(() => {});
        window.prompt(`Link exclusivo de Radar em Tempo Real gerado para ${label} (valido por 7 dias):`, url);
      }
    } catch {
      alert('Erro ao gerar link exclusivo de emergencia.');
    }
  };

  const handleUpdateStatus = async (id: string, status: 'RESOLVED' | 'FALSE_ALARM') => {
    const label = status === 'RESOLVED' ? 'RESOLVIDO' : 'FALSO ALARME';
    if (!window.confirm(`Confirmar encerramento deste chamado SOS como ${label}?`)) return;

    try {
      await api.patch(`/admin/sos/${id}/status`, { status });
      fetchSosAlerts();
    } catch {
      alert('Erro ao atualizar status do incidente.');
    }
  };

  const getAudioSource = (url: string) => {
    if (url.startsWith('http://') || url.startsWith('https://')) return url;
    return `${BASE_SERVER_URL}${url.startsWith('/') ? '' : '/'}${url}`;
  };

  return (
    <div className="sos-container">
      <header className="sos-header">
        <div>
          <h1>🚨 Sala de Controle de Emergências (SOS)</h1>
          <p>Monitoramento e resposta rápida para incidentes de segurança na Guiné-Bissau</p>
        </div>

        <div className="sos-filters" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => setSoundMuted((prev) => !prev)}
            style={{
              backgroundColor: soundMuted ? '#fef2f2' : '#ecfdf5',
              color: soundMuted ? '#dc2626' : '#059669',
              border: `1px solid ${soundMuted ? '#fecaca' : '#a7f3d0'}`,
              fontWeight: 700
            }}
            title="Ativar ou silenciar sirene sonora de novos alertas SOS"
          >
            {soundMuted ? '🔇 Sirene Silenciada' : '🔊 Sirene Ativa'}
          </button>
          <button type="button" onClick={() => generateAgencyLink('POLICE')} style={{ backgroundColor: '#1E3A8A', color: '#FFF', fontWeight: 700 }}>🚓 Link Polícia</button>
          <button type="button" onClick={() => generateAgencyLink('HOSPITAL')} style={{ backgroundColor: '#065F46', color: '#FFF', fontWeight: 700 }}>🏥 Link Hospital</button>
          <button
            type="button"
            onClick={() => { emergencySiren.playPulse(); playEmergencySiren(); }}
            title="Testar alerta sonoro na sala de controle"
          >
            🔔 Testar Som
          </button>
          <button
            type="button"
            className={filter === 'ACTIVE' ? 'active danger' : ''}
            onClick={() => setFilter('ACTIVE')}
          >
            Ativos
          </button>
          <button
            type="button"
            className={filter === 'RESOLVED' ? 'active' : ''}
            onClick={() => setFilter('RESOLVED')}
          >
            Resolvidos
          </button>
          <button
            type="button"
            className={filter === 'FALSE_ALARM' ? 'active' : ''}
            onClick={() => setFilter('FALSE_ALARM')}
          >
            Falsos Alarmes
          </button>
        </div>
      </header>

      <div className="sos-content">
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

              {selectedSos.audioUrl && (
                <div className="audio-player-box">
                  <label>🔊 Gravação de Segurança do Ambiente:</label>
                  <audio controls src={getAudioSource(selectedSos.audioUrl)} style={{ width: '100%', marginTop: '8px' }} />
                </div>
              )}

              <div className="map-preview">
                <iframe
                  title="GPS Location"
                  width="100%"
                  height="250"
                  frameBorder="0"
                  src={`https://maps.google.com/maps?q=${selectedSos.lat},${selectedSos.lng}&z=15&output=embed`}
                />
              </div>

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
                      type="button"
                      className="btn btn-resolve"
                      onClick={() => handleUpdateStatus(selectedSos.id, 'RESOLVED')}
                    >
                      ✅ Resolver Incidente
                    </button>
                    <button
                      type="button"
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
