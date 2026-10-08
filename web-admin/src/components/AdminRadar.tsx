import React, { useEffect, useState, useMemo, useRef } from 'react';
import Map, { Marker, Popup, NavigationControl } from 'react-map-gl/mapbox';
import type { MapRef } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import { io, Socket } from 'socket.io-client';
import { api } from '../services/api';

const VITE_API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3333').replace(/\/$/, '');
const BACKEND_BASE_URL = VITE_API_URL.replace(/\/api\/?$/, '');
const MAPBOX_TOKEN = 
  import.meta.env.VITE_MAPBOX_TOKEN || 
  'pk.eyJ1IjoibWFtYWR1Y2FuZGUiLCJhIjoiY211ZGpkMnVtMDMzdDJ4c2U0NHd3dHBtZiJ9.mT0BfmoFsPTgWFzNnblCZg';

const DEFAULT_CENTER = { latitude: 11.8632, longitude: -15.5977, zoom: 13 };

export interface DriverLocation {
  driverId: string;
  fullName?: string;
  phone?: string;
  vehiclePlate?: string;
  vehicleBrand?: string;
  latitude: number;
  longitude: number;
  heading?: number;
  status: 'AVAILABLE' | 'ON_RIDE';
  lastUpdate: Date;
}

export function AdminRadar() {
  const mapRef = useRef<MapRef>(null);
  const [drivers, setDrivers] = useState<Record<string, DriverLocation>>({});
  const [selectedDriver, setSelectedDriver] = useState<DriverLocation | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [filter, setFilter] = useState<'ALL' | 'AVAILABLE' | 'ON_RIDE'>('ALL');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    let isMounted = true;

    async function fetchOnlineDrivers() {
      try {
        const response = await api.get<DriverLocation[]>('/admin/drivers/online');
        if (isMounted && Array.isArray(response.data)) {
          const driversMap: Record<string, DriverLocation> = {};
          response.data.forEach((driver) => {
            driversMap[driver.driverId] = {
              ...driver,
              lastUpdate: new Date(driver.lastUpdate || Date.now())
            };
          });
          setDrivers(driversMap);
        }
      } catch (error) {
        console.warn('[RADAR] Endpoint /admin/drivers/online indisponível. Aguardando eventos via WebSocket.');
      }
    }

    fetchOnlineDrivers();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    const token = localStorage.getItem('@bai245:admin_token');
    const socket: Socket = io(BACKEND_BASE_URL, {
      transports: ['websocket'],
      auth: { token },
      reconnection: true,
      reconnectionAttempts: Infinity,
    });

    socket.on('connect', () => {
      setIsConnected(true);
      socket.emit('admin:join_dashboard');
    });

    socket.on('disconnect', () => setIsConnected(false));

    socket.on('admin:map_update', (data: any) => {
      if (!data?.driverId) return;
      setDrivers((prev) => ({
        ...prev,
        [data.driverId]: {
          ...prev[data.driverId],
          ...data,
          lastUpdate: new Date()
        }
      }));
    });

    socket.on('admin:ride_update', (data: any) => {
      if (!data?.driverId) return;
      setDrivers((prev) => {
        if (!prev[data.driverId]) return prev;
        const isRiding = ['ACCEPTED', 'IN_PROGRESS', 'ARRIVED'].includes(data.status);
        return {
          ...prev,
          [data.driverId]: {
            ...prev[data.driverId],
            status: isRiding ? 'ON_RIDE' : 'AVAILABLE',
            lastUpdate: new Date()
          }
        };
      });
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    const cleanupInterval = setInterval(() => {
      const now = Date.now();
      setDrivers((prev) => {
        const updated = { ...prev };
        let hasChanges = false;
        Object.keys(updated).forEach((id) => {
          if (now - new Date(updated[id].lastUpdate).getTime() > 120000) {
            delete updated[id];
            hasChanges = true;
          }
        });
        return hasChanges ? updated : prev;
      });
    }, 30000);

    return () => clearInterval(cleanupInterval);
  }, []);

  const driverList = Object.values(drivers);
  const totalOnline = driverList.length;
  const onRideCount = driverList.filter((d) => d.status === 'ON_RIDE').length;
  const availableCount = totalOnline - onRideCount;

  const filteredDrivers = useMemo(() => {
    return driverList.filter((d) => {
      const matchesFilter = 
        filter === 'ALL' ? true : 
        filter === 'AVAILABLE' ? d.status === 'AVAILABLE' : 
        d.status === 'ON_RIDE';

      const searchLower = searchTerm.toLowerCase();
      const matchesSearch = 
        !searchTerm ||
        (d.fullName && d.fullName.toLowerCase().includes(searchLower)) ||
        (d.vehiclePlate && d.vehiclePlate.toLowerCase().includes(searchLower)) ||
        (d.phone && d.phone.includes(searchTerm));

      return matchesFilter && matchesSearch;
    });
  }, [driverList, filter, searchTerm]);

  const handleSelectDriver = (driver: DriverLocation) => {
    setSelectedDriver(driver);
    if (mapRef.current) {
      mapRef.current.flyTo({
        center: [driver.longitude, driver.latitude],
        zoom: 16,
        duration: 1500
      });
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.mapContainer}>
        <Map
          ref={mapRef}
          initialViewState={DEFAULT_CENTER}
          mapStyle="mapbox://styles/mapbox/streets-v12"
          mapboxAccessToken={MAPBOX_TOKEN}
          style={{ width: '100%', height: '100%' }}
        >
          <NavigationControl position="bottom-right" />

          {filteredDrivers.map((driver) => {
            const isRiding = driver.status === 'ON_RIDE';
            const color = isRiding ? '#3B82F6' : '#10B981';

            return (
              <Marker
                key={driver.driverId}
                latitude={driver.latitude}
                longitude={driver.longitude}
                anchor="center"
                onClick={(e) => {
                  e.originalEvent.stopPropagation();
                  handleSelectDriver(driver);
                }}
              >
                <div
                  title={driver.fullName || 'Motorista'}
                  style={{
                    transform: `rotate(${driver.heading || 0}deg)`,
                    transition: 'all 0.8s linear',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 38,
                    height: 38,
                    borderRadius: '50%',
                    backgroundColor: '#FFFFFF',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
                    border: `3px solid ${color}`
                  }}
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill={color}>
                    <path d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.85 7h10.29l1.04 3H5.81l1.04-3zM19 17H5v-4h14v4z"/>
                    <circle cx="7.5" cy="15.5" r="1.5" />
                    <circle cx="16.5" cy="15.5" r="1.5" />
                  </svg>
                </div>
              </Marker>
            );
          })}

          {selectedDriver && (
            <Popup
              latitude={selectedDriver.latitude}
              longitude={selectedDriver.longitude}
              onClose={() => setSelectedDriver(null)}
              closeOnClick={false}
              anchor="bottom"
              offset={24}
            >
              <div style={styles.popupCard}>
                <div style={styles.popupHeader}>
                  <span style={styles.driverName}>{selectedDriver.fullName || 'Motorista sem nome'}</span>
                  <span style={{
                    ...styles.statusBadgePopup,
                    backgroundColor: selectedDriver.status === 'ON_RIDE' ? '#DBEAFE' : '#D1FAE5',
                    color: selectedDriver.status === 'ON_RIDE' ? '#1E40AF' : '#065F46'
                  }}>
                    {selectedDriver.status === 'ON_RIDE' ? 'Em Corrida' : 'Livre'}
                  </span>
                </div>

                <div style={styles.popupBody}>
                  <p><strong>Telefone:</strong> {selectedDriver.phone || 'N/A'}</p>
                  <p><strong>Veículo:</strong> {selectedDriver.vehicleBrand || 'N/A'} - <span style={styles.plateTag}>{selectedDriver.vehiclePlate || 'N/A'}</span></p>
                  <p style={styles.timeText}>Atualizado às: {new Date(selectedDriver.lastUpdate).toLocaleTimeString()}</p>
                </div>
              </div>
            </Popup>
          )}
        </Map>
      </div>

      <div style={styles.overlayPanel}>
        <div style={styles.headerTitleRow}>
          <div>
            <h2 style={styles.title}>Radar da Frota</h2>
            <div style={styles.liveIndicator}>
              <span style={{ ...styles.dot, backgroundColor: isConnected ? '#10B981' : '#EF4444' }} />
              <span>{isConnected ? 'Realtime Conectado' : 'Reconectando...'}</span>
            </div>
          </div>
        </div>

        <div style={styles.statsRow}>
          <div 
            onClick={() => setFilter('ALL')} 
            style={{ ...styles.statCard, borderColor: filter === 'ALL' ? '#0F172A' : '#E2E8F0' }}
          >
            <span style={styles.statVal}>{totalOnline}</span>
            <span style={styles.statLbl}>Online</span>
          </div>

          <div 
            onClick={() => setFilter('AVAILABLE')} 
            style={{ ...styles.statCard, borderColor: filter === 'AVAILABLE' ? '#10B981' : '#E2E8F0' }}
          >
            <span style={{ ...styles.statVal, color: '#10B981' }}>{availableCount}</span>
            <span style={styles.statLbl}>Livres</span>
          </div>

          <div 
            onClick={() => setFilter('ON_RIDE')} 
            style={{ ...styles.statCard, borderColor: filter === 'ON_RIDE' ? '#3B82F6' : '#E2E8F0' }}
          >
            <span style={{ ...styles.statVal, color: '#3B82F6' }}>{onRideCount}</span>
            <span style={styles.statLbl}>Em Corrida</span>
          </div>
        </div>

        <input
          type="text"
          placeholder="🔍 Buscar por motorista, placa..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={styles.searchInput}
        />

        <div style={styles.driverList}>
          {filteredDrivers.length === 0 ? (
            <div style={styles.emptyText}>Nenhum motorista encontrado no radar.</div>
          ) : (
            filteredDrivers.map((driver) => (
              <div 
                key={driver.driverId} 
                onClick={() => handleSelectDriver(driver)}
                style={{
                  ...styles.driverListItem,
                  backgroundColor: selectedDriver?.driverId === driver.driverId ? '#F1F5F9' : '#FFFFFF'
                }}
              >
                <div style={styles.driverListInfo}>
                  <strong>{driver.fullName || 'Motorista'}</strong>
                  <span style={styles.driverSubtext}>{driver.vehicleBrand} • {driver.vehiclePlate || 'Sem placa'}</span>
                </div>
                <span style={{
                  ...styles.statusDot,
                  backgroundColor: driver.status === 'ON_RIDE' ? '#3B82F6' : '#10B981'
                }} />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  container: { 
    position: 'relative' as const, 
    width: '100%', 
    height: 'calc(100vh - 80px)',
    minHeight: '500px',
    overflow: 'hidden', 
    fontFamily: 'Inter, system-ui, sans-serif' 
  },
  mapContainer: { 
    width: '100%', 
    height: '100%' 
  },
  overlayPanel: {
    position: 'absolute' as const,
    top: '20px',
    left: '20px',
    width: '340px',
    maxHeight: 'calc(100vh - 120px)',
    backgroundColor: '#FFFFFF',
    borderRadius: '16px',
    padding: '20px',
    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.15)',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '16px',
    zIndex: 10
  },
  headerTitleRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  title: { margin: 0, fontSize: '20px', fontWeight: '800', color: '#0F172A' },
  liveIndicator: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#64748B', marginTop: '2px' },
  dot: { width: '8px', height: '8px', borderRadius: '50%' },
  statsRow: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' },
  statCard: { backgroundColor: '#F8FAFC', padding: '8px 12px', borderRadius: '10px', border: '2px solid #E2E8F0', cursor: 'pointer', textAlign: 'center' as const, transition: 'all 0.2s' },
  statVal: { fontSize: '18px', fontWeight: '800', color: '#0F172A', display: 'block' },
  statLbl: { fontSize: '10px', fontWeight: '700', color: '#64748B', textTransform: 'uppercase' as const },
  searchInput: { padding: '10px 14px', borderRadius: '10px', border: '1px solid #CBD5E1', fontSize: '13px', outline: 'none', backgroundColor: '#F8FAFC' },
  driverList: { overflowY: 'auto' as const, display: 'flex', flexDirection: 'column' as const, gap: '8px', maxHeight: '300px' },
  driverListItem: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', borderRadius: '10px', border: '1px solid #E2E8F0', cursor: 'pointer', transition: 'background-color 0.2s' },
  driverListInfo: { display: 'flex', flexDirection: 'column' as const, fontSize: '13px', color: '#0F172A' },
  driverSubtext: { fontSize: '11px', color: '#64748B' },
  statusDot: { width: '10px', height: '10px', borderRadius: '50%' },
  popupCard: { minWidth: '200px', padding: '4px' },
  popupHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '8px' },
  driverName: { fontWeight: '700', fontSize: '14px', color: '#0F172A' },
  statusBadgePopup: { fontSize: '10px', fontWeight: '800', padding: '2px 8px', borderRadius: '12px' },
  popupBody: { fontSize: '12px', color: '#334155', lineHeight: '1.6' },
  plateTag: { backgroundColor: '#E2E8F0', padding: '2px 6px', borderRadius: '4px', fontFamily: 'monospace', fontWeight: 'bold' },
  timeText: { fontSize: '10px', color: '#94A3B8', marginTop: '4px' },
  emptyText: { textAlign: 'center' as const, fontSize: '12px', color: '#94A3B8', padding: '20px 0' }
};