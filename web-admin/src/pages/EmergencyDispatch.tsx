import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import Map, { Marker, Popup, NavigationControl } from 'react-map-gl/mapbox';
import type { MapRef } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import axios from 'axios';
import { io, Socket } from 'socket.io-client';
import { TopDownVehicle3D } from '../components/TopDownVehicle3D';
import { emergencySiren } from '../utils/emergencySiren';

const rawUrl = import.meta.env?.VITE_API_URL || 'https://api.nobai245.com';
const API_BASE_URL = rawUrl.replace(/\/$/, '').endsWith('/api')
  ? rawUrl.replace(/\/$/, '')
  : `${rawUrl.replace(/\/$/, '')}/api`;
const SOCKET_BASE_URL = rawUrl.replace(/\/api\/?$/, '').replace(/\/$/, '');
const MAPBOX_TOKEN =
  import.meta.env.VITE_MAPBOX_TOKEN ||
  'pk.eyJ1IjoibWFtYWR1Y2FuZGUiLCJhIjoiY211ZGpkMnVtMDMzdDJ4c2U0NHd3dHBtZiJ9.mT0BfmoFsPTgWFzNnblCZg';

const STORAGE_AGENCY_TOKEN = '@bai245:emergency_agency_token';

function decodeAgencyPayload(token: string) {
  try {
    const part = token.split('.')[1];
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=')));
  } catch {
    return null;
  }
}

export function EmergencyDispatch() {
  const [searchParams] = useSearchParams();
  const mapRef = useRef<MapRef>(null);

  const [agencyToken, setAgencyToken] = useState<string>(() => {
    const fromQuery = searchParams.get('token');
    if (fromQuery) {
      localStorage.setItem(STORAGE_AGENCY_TOKEN, fromQuery);
      return fromQuery;
    }
    return localStorage.getItem(STORAGE_AGENCY_TOKEN) || localStorage.getItem('@bai245:admin_token') || '';
  });

  const [tokenInput, setTokenInput] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [drivers, setDrivers] = useState<Record<string, any>>({});
  const [sosAlerts, setSosAlerts] = useState<any[]>([]);
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [sirenMuted, setSirenMuted] = useState<boolean>(() => emergencySiren.isMuted());
  const [connected, setConnected] = useState(false);

  const agencyInfo = agencyToken ? decodeAgencyPayload(agencyToken) : null;

  const fetchRadarData = useCallback(async () => {
    if (!agencyToken) return;
    try {
      const headers = { Authorization: `Bearer ${agencyToken}` };
      const [drvRes, sosRes] = await Promise.all([
        axios.get(`${API_BASE_URL}/admin/drivers/online`, { headers }),
        axios.get(`${API_BASE_URL}/admin/sos?status=ACTIVE`, { headers }),
      ]);

      setAuthError(null);
      const activeSos = Array.isArray(sosRes.data) ? sosRes.data : [];
      setSosAlerts(activeSos);

      if (activeSos.length > 0 && !emergencySiren.isMuted()) {
        emergencySiren.startContinuous();
      } else if (activeSos.length === 0) {
        emergencySiren.stopContinuous();
      }

      const sosMap: Record<string, any> = {};
      activeSos.forEach((s: any) => {
        const dId = s.driverId || s.ride?.driverId || s.driver?.id;
        if (dId) sosMap[dId] = s;
      });

      if (Array.isArray(drvRes.data)) {
        setDrivers((prev) => {
          const next: Record<string, any> = {};
          drvRes.data.forEach((d: any) => {
            next[d.driverId] = {
              ...prev[d.driverId],
              ...d,
              activeSos: sosMap[d.driverId] || null,
            };
          });
          return next;
        });
      }
    } catch (err: any) {
      if (err?.response?.status === 401 || err?.response?.status === 403) {
        setAuthError('Credencial de emergência inválida ou expirada. Solicite um novo link à Central Nô Bai 245.');
      }
    }
  }, [agencyToken]);

  useEffect(() => {
    if (!agencyToken) return;
    fetchRadarData();
    const timer = setInterval(fetchRadarData, 10000);
    return () => {
      clearInterval(timer);
      emergencySiren.stopContinuous();
    };
  }, [agencyToken, fetchRadarData]);

  useEffect(() => {
    if (!agencyToken) return;
    const socket: Socket = io(SOCKET_BASE_URL, {
      transports: ['websocket', 'polling'],
      auth: { token: agencyToken },
    });

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('admin:join_dashboard');
    });

    socket.on('disconnect', () => setConnected(false));

    socket.on('admin:map_update', (data: any) => {
      if (!data?.driverId) return;
      setDrivers((prev) => ({
        ...prev,
        [data.driverId]: {
          ...prev[data.driverId],
          ...data,
          latitude: Number(data.latitude),
          longitude: Number(data.longitude),
        },
      }));
    });

    socket.on('admin:sos_alert', (sos: any) => {
      emergencySiren.startContinuous();
      setSosAlerts((prev) => (prev.some((x) => x.id === (sos.id || sos.sosId)) ? prev : [sos, ...prev]));
      const dId = sos?.driverId || sos?.ride?.driverId || sos?.driver?.id;
      const lat = Number(sos?.lat ?? sos?.latitude ?? 11.8632);
      const lng = Number(sos?.lng ?? sos?.longitude ?? -15.5977);
      if (dId) {
        setDrivers((prev) => ({
          ...prev,
          [dId]: {
            ...prev[dId],
            driverId: dId,
            fullName: prev[dId]?.fullName || sos?.driverName || sos?.driver?.fullName || 'Veículo SOS',
            vehiclePlate: prev[dId]?.vehiclePlate || sos?.vehiclePlate || sos?.driver?.vehiclePlate || 'SOS',
            vehicleBrand: prev[dId]?.vehicleBrand || sos?.vehicleModel || sos?.driver?.vehicleBrand || '',
            phone: prev[dId]?.phone || sos?.phone || '',
            latitude: lat,
            longitude: lng,
            activeSos: sos,
          },
        }));
        setSelectedDriverId(dId);
      }
      if (mapRef.current && lat && lng) {
        mapRef.current.flyTo({ center: [lng, lat], zoom: 16.5, duration: 1000 });
      }
    });

    socket.on('admin:sos_resolved', () => {
      fetchRadarData();
    });

    return () => {
      socket.disconnect();
    };
  }, [agencyToken, fetchRadarData]);

  const handleAcknowledgeSos = async (sosId: string) => {
    if (!window.confirm('Confirmar que a viatura/ambulância atendeu e encerrou esta ocorrência SOS?')) return;
    try {
      await axios.patch(
        `${API_BASE_URL}/admin/sos/${sosId}/status`,
        { status: 'RESOLVED' },
        { headers: { Authorization: `Bearer ${agencyToken}` } }
      );
      emergencySiren.stopContinuous();
      fetchRadarData();
    } catch {
      alert('Não foi possível encerrar o chamado.');
    }
  };

  if (!agencyToken || authError) {
    return (
      <div style={{ minHeight: '100vh', background: '#090D16', color: '#F8FAFC', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div style={{ maxWidth: 440, width: '100%', background: '#111827', border: '1px solid #1F2937', borderRadius: 18, padding: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 28 }}>🚓🏥</span>
            <div>
              <h1 style={{ margin: 0, fontSize: 19, fontWeight: 900, color: '#EAB308' }}>NÔ BAI 245 • CENTRAL DE EMERGÊNCIA</h1>
              <p style={{ margin: 0, fontSize: 12, color: '#94A3B8' }}>Acesso Restrito: Polícia POP (112) & Hospitais</p>
            </div>
          </div>

          {authError && (
            <div style={{ background: 'rgba(220,38,38,0.18)', border: '1px solid #EF4444', color: '#FCA5A5', padding: 10, borderRadius: 10, fontSize: 12, marginBottom: 14 }}>
              {authError}
            </div>
          )}

          <p style={{ fontSize: 13, color: '#CBD5E1', lineHeight: 1.5 }}>
            Cole o token de despacho fornecido pela Central Operacional Nô Bai 245 ou abra diretamente o link autorizado recebido.
          </p>

          <input
            type="password"
            placeholder="Cole o token de acesso de emergência..."
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            style={{ width: '100%', padding: '12px', borderRadius: 10, border: '1px solid #374151', background: '#0F172A', color: '#FFF', marginTop: 10, marginBottom: 12, boxSizing: 'border-box' }}
          />
          <button
            type="button"
            onClick={() => {
              if (!tokenInput.trim()) return;
              localStorage.setItem(STORAGE_AGENCY_TOKEN, tokenInput.trim());
              setAgencyToken(tokenInput.trim());
            }}
            style={{ width: '100%', padding: '12px', borderRadius: 10, border: 'none', background: '#DC2626', color: '#FFF', fontWeight: 800, cursor: 'pointer' }}
          >
            Entrar no Radar de Emergência
          </button>
        </div>
      </div>
    );
  }

  const driverList = Object.values(drivers);
  const selectedDriver = selectedDriverId ? drivers[selectedDriverId] : null;

  return (
    <div style={{ height: '100vh', width: '100vw', display: 'flex', flexDirection: 'column', background: '#090D16', color: '#F8FAFC', fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Cabeçalho Institucional Polícia & Hospitais */}
      <header style={{ background: '#0F172A', borderBottom: '1px solid #1E293B', padding: '10px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>{agencyInfo?.agencyType === 'HOSPITAL' ? '🏥' : '🚓'}</span>
          <div>
            <strong style={{ fontSize: 15, color: '#F8FAFC', display: 'block' }}>
              CENTRAL DE DESPACHO • {agencyInfo?.agencyName || 'POLÍCIA & HOSPITAIS'}
            </strong>
            <span style={{ fontSize: 11, color: connected ? '#34D399' : '#F87171' }}>
              ● {connected ? 'Radar ao Vivo Conectado' : 'Reconectando'} • {driverList.length} veículos monitorados
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => {
              const next = !sirenMuted;
              setSirenMuted(next);
              emergencySiren.setMuted(next);
              if (!next && sosAlerts.length > 0) emergencySiren.startContinuous();
            }}
            style={{ background: sirenMuted ? '#374151' : '#DC2626', color: '#FFF', border: 'none', borderRadius: 8, padding: '8px 12px', fontSize: 12, fontWeight: 800, cursor: 'pointer' }}
          >
            {sirenMuted ? '🔇 Sirene Silenciada' : '🔊 Sirene Ativa'}
          </button>
          <button
            type="button"
            onClick={() => emergencySiren.playPulse()}
            style={{ background: '#1E293B', color: '#F8FAFC', border: '1px solid #334155', borderRadius: 8, padding: '8px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
          >
            🔔 Testar Alarme
          </button>
        </div>
      </header>

      {sosAlerts.length > 0 && (
        <div style={{ background: '#DC2626', color: '#FFFFFF', padding: '10px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 800, fontSize: 13 }}>
          <span>🚨 ALERTA DE EMERGÊNCIA PRIORITÁRIO ATIVO ({sosAlerts.length}) — VEÍCULO DESTACADO EM VERMELHO NO RADAR</span>
          {sosAlerts[0]?.driverId && (
            <button
              type="button"
              onClick={() => {
                const d = drivers[sosAlerts[0].driverId];
                if (d && mapRef.current) {
                  setSelectedDriverId(d.driverId);
                  mapRef.current.flyTo({ center: [d.longitude, d.latitude], zoom: 16.5, duration: 900 });
                }
              }}
              style={{ background: '#FFF', color: '#B91C1C', border: 'none', borderRadius: 6, padding: '5px 10px', fontWeight: 900, cursor: 'pointer' }}
            >
              Focar Ocorrência
            </button>
          )}
        </div>
      )}

      <style>{`@media (max-width: 768px) { .em-body { flex-direction: column-reverse !important; } .em-aside { width: 100% !important; height: 44% !important; border-right: none !important; border-top: 1px solid #1E293B !important; } .em-map { height: 56% !important; } }`}</style>
      <div className="em-body" style={{ flex: 1, display: 'flex', position: 'relative', overflow: 'hidden' }}>
        {/* Lista lateral de Emergências & Veículos */}
        <aside className="em-aside" style={{ width: 320, background: '#0F172A', borderRight: '1px solid #1E293B', padding: 14, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#94A3B8', textTransform: 'uppercase' }}>
            Chamados SOS Prioritários ({sosAlerts.length})
          </div>

          {sosAlerts.length === 0 ? (
            <div style={{ background: '#1E293B', padding: 12, borderRadius: 10, fontSize: 12, color: '#94A3B8' }}>
              Nenhuma emergência SOS ativa no momento. Todos os veículos seguem monitorados.
            </div>
          ) : (
            sosAlerts.map((sos) => (
              <div
                key={sos.id}
                onClick={() => {
                  const lat = Number(sos.lat ?? sos.latitude);
                  const lng = Number(sos.lng ?? sos.longitude);
                  if (sos.driverId) setSelectedDriverId(sos.driverId);
                  if (mapRef.current && lat && lng) {
                    mapRef.current.flyTo({ center: [lng, lat], zoom: 16.5, duration: 900 });
                  }
                }}
                style={{ background: 'rgba(220,38,38,0.2)', border: '2px solid #EF4444', borderRadius: 12, padding: 12, cursor: 'pointer' }}
              >
                <div style={{ fontSize: 11, fontWeight: 900, color: '#FCA5A5' }}>
                  🚨 {sos.userType === 'PASSENGER' ? 'PASSAGEIRO EM PERIGO' : 'MOTORISTA EM PERIGO'}
                </div>
                <div style={{ fontSize: 14, fontWeight: 800, marginTop: 3 }}>
                  {sos.passenger?.fullName || sos.driver?.fullName || 'Solicitante SOS'}
                </div>
                <div style={{ fontSize: 12, color: '#E2E8F0', marginTop: 2 }}>
                  Matrícula: <strong>{sos.driver?.vehiclePlate || 'N/A'}</strong> • Tel: {sos.passenger?.phone || sos.driver?.phone || 'N/A'}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                  <a
                    href={`tel:${sos.passenger?.phone || sos.driver?.phone || ''}`}
                    onClick={(e) => e.stopPropagation()}
                    style={{ flex: 1, textAlign: 'center', background: '#2563EB', color: '#FFF', padding: '6px', borderRadius: 6, fontSize: 11, fontWeight: 800, textDecoration: 'none' }}
                  >
                    📞 Ligar
                  </a>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleAcknowledgeSos(sos.id);
                    }}
                    style={{ flex: 1, background: '#16A34A', color: '#FFF', border: 'none', padding: '6px', borderRadius: 6, fontSize: 11, fontWeight: 800, cursor: 'pointer' }}
                  >
                    ✅ Atendido
                  </button>
                </div>
              </div>
            ))
          )}

          <div style={{ fontSize: 11, fontWeight: 800, color: '#94A3B8', textTransform: 'uppercase', marginTop: 8 }}>
            Frota Monitorada ao Vivo ({driverList.length})
          </div>

          {driverList.map((d: any) => (
            <div
              key={d.driverId}
              onClick={() => {
                setSelectedDriverId(d.driverId);
                if (mapRef.current) mapRef.current.flyTo({ center: [d.longitude, d.latitude], zoom: 16 });
              }}
              style={{
                background: d.activeSos ? 'rgba(220,38,38,0.22)' : '#1E293B',
                border: `1.5px solid ${d.activeSos ? '#EF4444' : '#334155'}`,
                borderRadius: 10,
                padding: '9px 11px',
                cursor: 'pointer',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 800 }}>
                {d.activeSos ? '🚨 ' : ''}
                {d.vehiclePlate || 'Sem placa'} — {d.fullName}
              </div>
              <div style={{ fontSize: 11, color: '#94A3B8' }}>
                {d.vehicleBrand || 'Veículo'} • {d.activeSos ? 'EMERGÊNCIA PRIORITÁRIA' : d.status === 'ON_RIDE' ? 'Em Corrida' : 'Disponível'}
              </div>
            </div>
          ))}
        </aside>

        {/* Mapa de Radar em Tempo Real */}
        <div className="em-map" style={{ flex: 1, position: 'relative' }}>
          <Map
            ref={mapRef}
            initialViewState={{ latitude: 11.8632, longitude: -15.5977, zoom: 13 }}
            mapStyle="mapbox://styles/mapbox/streets-v12"
            mapboxAccessToken={MAPBOX_TOKEN}
            style={{ width: '100%', height: '100%' }}
          >
            <NavigationControl position="bottom-right" />

            {driverList.map((d: any) => {
              const isEmergency = Boolean(d.activeSos);
              return (
                <Marker
                  key={d.driverId}
                  latitude={Number(d.latitude)}
                  longitude={Number(d.longitude)}
                  anchor="center"
                  onClick={(e) => {
                    e.originalEvent.stopPropagation();
                    setSelectedDriverId(d.driverId);
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer' }}>
                    <div
                      style={{
                        backgroundColor: isEmergency ? '#DC2626' : 'rgba(15,23,42,0.88)',
                        color: '#FFF',
                        border: `1px solid ${isEmergency ? '#FECACA' : 'rgba(255,255,255,0.25)'}`,
                        borderRadius: 7,
                        padding: '2px 7px',
                        fontSize: 10,
                        fontWeight: 900,
                        marginBottom: 2,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {isEmergency ? `🚨 SOS • ${d.vehiclePlate || ''}` : d.vehiclePlate || d.fullName}
                    </div>
                    <div style={{ transform: `rotate(${Math.round(d.heading || 0)}deg)`, transition: 'transform 0.5s linear' }}>
                      <TopDownVehicle3D
                        vehicleType={d.vehicleType}
                        vehicleColor={d.vehicleColor}
                        isRiding={d.status === 'ON_RIDE'}
                        isEmergency={isEmergency}
                        size={isEmergency ? 64 : 52}
                      />
                    </div>
                  </div>
                </Marker>
              );
            })}

            {selectedDriver && (
              <Popup
                latitude={Number(selectedDriver.latitude)}
                longitude={Number(selectedDriver.longitude)}
                onClose={() => setSelectedDriverId(null)}
                closeOnClick={false}
                anchor="bottom"
                offset={34}
              >
                <div style={{ color: '#0F172A', minWidth: 210, padding: 4 }}>
                  {selectedDriver.activeSos && (
                    <div style={{ background: '#DC2626', color: '#FFF', padding: '5px 8px', borderRadius: 6, fontSize: 11, fontWeight: 900, marginBottom: 6 }}>
                      🚨 EMERGÊNCIA PRIORITÁRIA
                    </div>
                  )}
                  <strong style={{ fontSize: 13 }}>{selectedDriver.fullName}</strong>
                  <div style={{ fontSize: 12, marginTop: 4 }}>
                    <div><strong>Matrícula:</strong> {selectedDriver.vehiclePlate || 'N/A'}</div>
                    <div><strong>Veículo:</strong> {selectedDriver.vehicleBrand || 'N/A'}</div>
                    <div><strong>Telefone:</strong> {selectedDriver.phone || 'N/A'}</div>
                  </div>
                </div>
              </Popup>
            )}
          </Map>
        </div>
      </div>
    </div>
  );
}
