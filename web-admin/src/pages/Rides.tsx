import React, { useEffect, useState, useCallback } from 'react';
import { 
  Search, 
  MapPin, 
  Navigation, 
  Star, 
  Loader2, 
  AlertCircle, 
  Eye, 
  RefreshCw,
  TrendingUp,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronLeft,
  ChevronRight,
  X,
  Map as MapIcon,
  User,
  Car,
  PlayCircle
} from 'lucide-react';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { api } from '../services/api';
import { useAdminSocket } from '../hooks/useAdminSocket';
import { AdminMonitorDrawer } from '../components/AdminMonitorDrawer';
import { RideReplayModal } from '../components/RideReplayModal';
import './Rides.css';

// Fix para ícones padrões do Leaflet em bundles do Vite
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// 📍 Ícones personalizados para Origem e Destino no Mapa
const originIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const destIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

export interface Ride {
  id: string;
  passengerName: string;
  driverName: string;
  vehiclePlate: string;
  passengerPhone?: string;
  driverPhone?: string;
  originAddress: string;
  destinationAddress: string;
  originLat: number | null;
  originLng: number | null;
  destLat: number | null;
  destLng: number | null;
  amount: number;
  status: 'COMPLETED' | 'CANCELLED' | 'IN_PROGRESS' | 'SEARCHING' | 'ACCEPTED';
  createdAt: string;
  rating?: number | null;
}

interface KPIState {
  total: number;
  completed: number;
  cancelled: number;
  revenue: number;
}

interface ApiError {
  response?: {
    data?: {
      error?: string;
      message?: string;
    };
  };
}

// 🔄 Normalizador flexível para compatibilidade com o banco de dados
const normalizeRideData = (raw: Record<string, any>): Ride => {
  const originLatVal = raw.originLat ?? raw.pickupLat ?? raw.startLat ?? raw.originLatitude ?? raw.fromLat;
  const originLngVal = raw.originLng ?? raw.pickupLng ?? raw.startLng ?? raw.originLongitude ?? raw.fromLng;
  const destLatVal = raw.destLat ?? raw.dropoffLat ?? raw.endLat ?? raw.destinationLat ?? raw.toLat;
  const destLngVal = raw.destLng ?? raw.dropoffLng ?? raw.endLng ?? raw.destinationLng ?? raw.toLng;

  return {
    id: String(raw.id || raw._id || Math.random()),
    passengerName: String(raw.passengerName || raw.passenger?.fullName || raw.passenger?.name || 'Passageiro'),
    driverName: String(raw.driverName || raw.driver?.fullName || raw.driver?.name || 'Não atribuído'),
    vehiclePlate: String(raw.vehiclePlate || raw.driver?.vehiclePlate || raw.driver?.plate || ''),
    passengerPhone: raw.passengerPhone || raw.passenger?.phone,
    driverPhone: raw.driverPhone || raw.driver?.phone,
    originAddress: String(raw.originAddress || raw.pickupAddress || raw.startAddress || 'Origem não informada'),
    destinationAddress: String(raw.destinationAddress || raw.dropoffAddress || raw.endAddress || 'Destino não informado'),
    originLat: originLatVal != null ? Number(originLatVal) : null,
    originLng: originLngVal != null ? Number(originLngVal) : null,
    destLat: destLatVal != null ? Number(destLatVal) : null,
    destLng: destLngVal != null ? Number(destLngVal) : null,
    amount: Number(raw.amount ?? raw.price ?? raw.priceXof ?? raw.totalPrice ?? 0),
    status: raw.status || 'SEARCHING',
    createdAt: raw.createdAt || raw.created_at || new Date().toISOString(),
    rating: raw.rating ?? raw.driverRating ?? null,
  };
};

export function Rides() {
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedReplayRideId, setSelectedReplayRideId] = useState<string | null>(null);
  const [kpis, setKpis] = useState<KPIState>({ total: 0, completed: 0, cancelled: 0, revenue: 0 });

  const [selectedRideId, setSelectedRideId] = useState<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [routeModalRide, setRouteModalRide] = useState<Ride | null>(null);

  // 🔧 CORREÇÃO: Resgate do token e injeção correta no hook de socket
  const adminToken = localStorage.getItem('@bai245:admin_token') || '';
  const { liveChats, liveCalls, sharedTrips } = useAdminSocket('admin_operator', adminToken);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 450);
    return () => clearTimeout(handler);
  }, [searchTerm]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, statusFilter]);

  const fetchRides = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await api.get('/admin/rides', {
        params: {
          page,
          limit: 15,
          search: debouncedSearch,
          status: statusFilter
        }
      });

      const responseData = response.data;
      let rawList: any[] = [];

      if (Array.isArray(responseData)) {
        rawList = responseData;
        setTotalPages(1);
      } else {
        rawList = responseData.data || responseData.rides || [];
        setTotalPages(responseData.meta?.totalPages || responseData.totalPages || 1);
        if (responseData.kpis) {
          setKpis(responseData.kpis);
        }
      }

      const normalized = rawList.map(normalizeRideData);
      setRides(normalized);

      if (!responseData.kpis) {
        const completed = normalized.filter(r => r.status === 'COMPLETED').length;
        const cancelled = normalized.filter(r => r.status === 'CANCELLED').length;
        const revenue = normalized.reduce((acc, r) => acc + (r.status === 'COMPLETED' ? r.amount : 0), 0);
        setKpis({
          total: normalized.length,
          completed,
          cancelled,
          revenue
        });
      }

    } catch (err: unknown) {
      console.error('❌ [RIDES] Erro ao carregar corridas:', err);
      setError('Não foi possível carregar o histórico. Verifique se o servidor backend está online.');
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, statusFilter]);

  useEffect(() => {
    fetchRides();
  }, [fetchRides]);

  const formatDate = (dateString: string) => {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return isNaN(date.getTime()) ? 'N/A' : date.toLocaleDateString('pt-BR');
  };

  const formatTime = (dateString: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return isNaN(date.getTime())
      ? ''
      : date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  };

  const formatCurrency = (val: number = 0) => {
    return new Intl.NumberFormat('fr-GW', {
      style: 'currency',
      currency: 'XOF',
      maximumFractionDigits: 0,
    }).format(val).replace('XOF', 'FCFA');
  };

  const getStatusBadge = (status: Ride['status']) => {
    switch (status) {
      case 'COMPLETED':
        return <span className="status-badge success"><CheckCircle2 size={12} /> Concluída</span>;
      case 'CANCELLED':
        return <span className="status-badge danger"><XCircle size={12} /> Cancelada</span>;
      case 'IN_PROGRESS':
        return <span className="status-badge info"><Clock size={12} /> Em Andamento</span>;
      case 'ACCEPTED':
        return <span className="status-badge info"><Car size={12} /> A Caminho</span>;
      case 'SEARCHING':
      default:
        return <span className="status-badge warning"><Loader2 size={12} className="animate-spin" /> Buscando</span>;
    }
  };

  return (
    <div className="rides-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Gestão & Auditoria de Corridas</h1>
          <p className="page-subtitle">Acompanhamento operacional, métricas financeiras e reprodução de trajetos</p>
        </div>
        <button className="btn-refresh" onClick={fetchRides} disabled={loading} title="Recarregar Dados">
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          <span>{loading ? 'Atualizando...' : 'Atualizar'}</span>
        </button>
      </div>

      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-header">
            <span className="kpi-label">Total Exibido</span>
            <Clock size={18} className="kpi-icon text-gray" />
          </div>
          <span className="kpi-value">{kpis.total || rides.length}</span>
        </div>

        <div className="kpi-card success">
          <div className="kpi-header">
            <span className="kpi-label">Concluídas</span>
            <CheckCircle2 size={18} className="kpi-icon text-success" />
          </div>
          <span className="kpi-value">{kpis.completed}</span>
        </div>

        <div className="kpi-card danger">
          <div className="kpi-header">
            <span className="kpi-label">Canceladas</span>
            <XCircle size={18} className="kpi-icon text-danger" />
          </div>
          <span className="kpi-value">{kpis.cancelled}</span>
        </div>

        <div className="kpi-card primary">
          <div className="kpi-header">
            <span className="kpi-label">Volume de Vendas</span>
            <TrendingUp size={18} className="kpi-icon text-primary" />
          </div>
          <span className="kpi-value">{formatCurrency(kpis.revenue)}</span>
        </div>
      </div>

      <div className="table-controls">
        <div className="search-bar">
          <Search size={18} color="#9CA3AF" />
          <input
            type="text"
            placeholder="Buscar por passageiro, motorista, placa ou ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button className="btn-clear-search" onClick={() => setSearchTerm('')}>
              <X size={14} />
            </button>
          )}
        </div>

        <div className="filter-tabs">
          {[
            { id: 'ALL', label: 'Todas' },
            { id: 'COMPLETED', label: 'Concluídas' },
            { id: 'IN_PROGRESS', label: 'Em Andamento' },
            { id: 'CANCELLED', label: 'Canceladas' },
            { id: 'SEARCHING', label: 'Buscando' },
          ].map((tab) => (
            <button
              key={tab.id}
              className={statusFilter === tab.id ? 'active' : ''}
              onClick={() => setStatusFilter(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="table-container">
        {loading && rides.length === 0 ? (
          <div className="loading-state">
            <Loader2 className="animate-spin" size={28} />
            <span>Buscando histórico de corridas...</span>
          </div>
        ) : error ? (
          <div className="empty-state error-text">
            <AlertCircle size={32} />
            <p>{error}</p>
            <button className="btn-retry" onClick={fetchRides}>Tentar Novamente</button>
          </div>
        ) : (
          <>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Data / Hora</th>
                  <th>Passageiro</th>
                  <th>Motorista</th>
                  <th>Trajeto</th>
                  <th>Valor</th>
                  <th>Status</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {rides.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="empty-state">
                      Nenhuma corrida encontrada no histórico.
                    </td>
                  </tr>
                ) : (
                  rides.map((ride) => {
                    const hasLiveActivity =
                      liveChats.some((c) => c.rideId === ride.id) ||
                      liveCalls.some((c) => c.rideId === ride.id);

                    return (
                      <tr key={ride.id} className={selectedRideId === ride.id ? 'row-selected' : ''}>
                        <td>
                          <div className="date-time">
                            <strong>{formatDate(ride.createdAt)}</strong>
                            <span className="time">{formatTime(ride.createdAt)}</span>
                          </div>
                        </td>
                        <td>
                          <div className="user-info-cell">
                            <User size={14} className="text-gray" />
                            <strong>{ride.passengerName}</strong>
                          </div>
                          {ride.rating != null && (
                            <div className="rating-badge">
                              <Star size={11} fill="#F59E0B" color="#F59E0B" />
                              <span>{ride.rating.toFixed(1)}</span>
                            </div>
                          )}
                        </td>
                        <td>
                          <div className="user-info-cell">
                            <Car size={14} className="text-gray" />
                            <strong>{ride.driverName}</strong>
                          </div>
                          {ride.vehiclePlate && (
                            <span className="text-smallplate">{ride.vehiclePlate}</span>
                          )}
                        </td>
                        <td>
                          <div 
                            className="route-cell clickable" 
                            title="Clique para ver no Mapa"
                            onClick={() => setRouteModalRide(ride)}
                          >
                            <div className="route-point">
                              <MapPin size={14} color="#10B981" />
                              <span className="truncate-text">{ride.originAddress}</span>
                            </div>
                            <div className="route-point">
                              <Navigation size={14} color="#EF4444" />
                              <span className="truncate-text">{ride.destinationAddress}</span>
                            </div>
                          </div>
                        </td>
                        <td className="amount-cell">{formatCurrency(ride.amount)}</td>
                        <td>{getStatusBadge(ride.status)}</td>
                        <td>
                          <div className="actions-group">
                            <button
                              className="btn-action-icon"
                              title="Reproduzir Replay Animado (GPS)"
                              onClick={() => setSelectedReplayRideId(ride.id)}
                            >
                              <PlayCircle size={16} color="#2563EB" />
                            </button>

                            <button
                              className="btn-action-icon"
                              title="Ver Mapa Estático"
                              onClick={() => setRouteModalRide(ride)}
                            >
                              <MapIcon size={16} />
                            </button>

                            <button
                              className={`btn-audit ${hasLiveActivity ? 'active-event' : ''}`}
                              onClick={() => {
                                setSelectedRideId(ride.id);
                                setIsDrawerOpen(true);
                              }}
                            >
                              <Eye size={14} />
                              <span>Auditar</span>
                              {hasLiveActivity && <span className="activity-dot" />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>

            {totalPages > 1 && (
              <div className="pagination-footer">
                <span className="page-info">
                  Página <strong>{page}</strong> de <strong>{totalPages}</strong>
                </span>
                <div className="pagination-controls">
                  <button 
                    disabled={page === 1 || loading} 
                    onClick={() => setPage(p => p - 1)}
                    className="btn-page"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button 
                    disabled={page === totalPages || loading} 
                    onClick={() => setPage(p => p + 1)}
                    className="btn-page"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {selectedReplayRideId && (
        <RideReplayModal
          rideId={selectedReplayRideId}
          onClose={() => setSelectedReplayRideId(null)}
        />
      )}

      {routeModalRide && (
        <div className="modal-overlay" onClick={() => setRouteModalRide(null)}>
          <div className="modal-content-map" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>Reprodução do Trajeto</h2>
                <p className="modal-subtitle">ID da Corrida: {routeModalRide.id}</p>
              </div>
              <button className="btn-close-modal" onClick={() => setRouteModalRide(null)}>
                <X size={20} />
              </button>
            </div>

            <div className="modal-ride-info">
              <div className="info-item">
                <User size={16} color="#3B82F6" />
                <span><strong>Passageiro:</strong> {routeModalRide.passengerName}</span>
              </div>
              <div className="info-item">
                <Car size={16} color="#10B981" />
                <span><strong>Motorista:</strong> {routeModalRide.driverName}</span>
              </div>
              <div className="info-item">
                <TrendingUp size={16} color="#8B5CF6" />
                <span><strong>Valor:</strong> {formatCurrency(routeModalRide.amount)}</span>
              </div>
            </div>

            <div className="map-view-wrapper">
              {routeModalRide.originLat && routeModalRide.originLng ? (
                <MapContainer 
                  center={[routeModalRide.originLat, routeModalRide.originLng]} 
                  zoom={13} 
                  style={{ height: '100%', width: '100%', borderRadius: '8px' }}
                >
                  <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  
                  <Marker position={[routeModalRide.originLat, routeModalRide.originLng]} icon={originIcon}>
                    <Popup>
                      <strong>Origem:</strong><br />
                      {routeModalRide.originAddress}
                    </Popup>
                  </Marker>

                  {routeModalRide.destLat && routeModalRide.destLng && (
                    <>
                      <Marker position={[routeModalRide.destLat, routeModalRide.destLng]} icon={destIcon}>
                        <Popup>
                          <strong>Destino:</strong><br />
                          {routeModalRide.destinationAddress}
                        </Popup>
                      </Marker>

                      <Polyline 
                        positions={[
                          [routeModalRide.originLat, routeModalRide.originLng],
                          [routeModalRide.destLat, routeModalRide.destLng]
                        ]} 
                        color="#2563EB" 
                        weight={4}
                        dashArray="8, 8"
                      />
                    </>
                  )}
                </MapContainer>
              ) : (
                <div className="map-fallback">
                  <AlertCircle size={32} color="#F59E0B" />
                  <p>Coordenadas geográficas indisponíveis para plotagem automática nesta corrida.</p>
                  <div className="addresses-fallback">
                    <p>📍 <strong>Origem:</strong> {routeModalRide.originAddress}</p>
                    <p>🏁 <strong>Destino:</strong> {routeModalRide.destinationAddress}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <AdminMonitorDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        selectedRideId={selectedRideId}
        chats={liveChats}
        calls={liveCalls}
        sharedTrips={sharedTrips}
      />
    </div>
  );
}