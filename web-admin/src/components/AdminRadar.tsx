import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import Map, { Marker, Popup, NavigationControl, Source, Layer } from 'react-map-gl/mapbox';
import type { MapRef } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import { io, Socket } from 'socket.io-client';
import { api } from '../services/api';

const rawUrl = import.meta.env?.VITE_API_URL || 'https://api.nobai245.com';
const BACKEND_BASE_URL = rawUrl.replace(/\/api\/?$/, '').replace(/\/$/, '');
const MAPBOX_TOKEN =
  import.meta.env.VITE_MAPBOX_TOKEN ||
  'pk.eyJ1IjoibWFtYWR1Y2FuZGUiLCJhIjoiY211ZGpkMnVtMDMzdDJ4c2U0NHd3dHBtZiJ9.mT0BfmoFsPTgWFzNnblCZg';

const DEFAULT_CENTER = { latitude: 11.8632, longitude: -15.5977, zoom: 13 };

export interface DriverLocation {
  driverId: string;
  fullName?: string;
  phone?: string;
  profilePicture?: string | null;
  vehiclePlate?: string;
  vehicleBrand?: string;
  vehicleType?: string;
  vehicleColor?: string;
  latitude: number;
  longitude: number;
  heading?: number;
  speed?: number;
  status: 'AVAILABLE' | 'ON_RIDE';
  rideStatus?: string | null;
  activeRideId?: string | null;
  originAddress?: string | null;
  destinationAddress?: string | null;
  passengerName?: string | null;
  trail?: Array<[number, number]>;
  lastUpdate: Date;
}

function calculateBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function resolveCarPalette(vehicleType?: string, vehicleColor?: string) {
  const type = String(vehicleType || 'PARTICULAR').toUpperCase();
  const color = String(vehicleColor || '').toLowerCase();

  if (type.includes('TAXI')) {
    return { body: '#FACC15', roof: '#FEF08A', accent: '#0F172A', isTaxi: true, isMoto: false, isVan: false };
  }
  if (type.includes('MOTO')) {
    return { body: '#EAB308', roof: '#F8FAFC', accent: '#0F172A', isTaxi: false, isMoto: true, isVan: false };
  }
  if (type.includes('EXEC') || type.includes('COMFORT') || color.includes('pret') || color.includes('black')) {
    return { body: '#1E293B', roof: '#334155', accent: '#EAB308', isTaxi: false, isMoto: false, isVan: false };
  }
  if (type.includes('VAN') || type.includes('XL')) {
    return { body: '#F8FAFC', roof: '#E2E8F0', accent: '#0284C7', isTaxi: false, isMoto: false, isVan: true };
  }
  if (color.includes('prata') || color.includes('cinz') || color.includes('silver') || color.includes('gray')) {
    return { body: '#CBD5E1', roof: '#E2E8F0', accent: '#334155', isTaxi: false, isMoto: false, isVan: false };
  }
  if (color.includes('azul') || color.includes('blue')) {
    return { body: '#2563EB', roof: '#60A5FA', accent: '#0F172A', isTaxi: false, isMoto: false, isVan: false };
  }
  if (color.includes('vermelh') || color.includes('red')) {
    return { body: '#DC2626', roof: '#F87171', accent: '#0F172A', isTaxi: false, isMoto: false, isVan: false };
  }
  return { body: '#FFFFFF', roof: '#F1F5F9', accent: '#0F172A', isTaxi: false, isMoto: false, isVan: false };
}

function TopDownVehicleIcon({
  vehicleType,
  vehicleColor,
  isRiding,
}: {
  vehicleType?: string;
  vehicleColor?: string;
  isRiding: boolean;
}) {
  const palette = resolveCarPalette(vehicleType, vehicleColor);
  const haloColor = isRiding ? 'rgba(59, 130, 246, 0.25)' : 'rgba(16, 185, 129, 0.22)';
  const ringColor = isRiding ? '#3B82F6' : '#10B981';

  if (palette.isMoto) {
    return (
      <div style={{ position: 'relative', width: 46, height: 46, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ position: 'absolute', width: 40, height: 40, borderRadius: '50%', backgroundColor: haloColor, border: `1.5px solid ${ringColor}` }} />
        <svg width="36" height="36" viewBox="0 0 64 64" fill="none">
          <ellipse cx="32" cy="34" rx="9" ry="21" fill="rgba(15,23,42,0.3)" />
          <rect x="29" y="8" width="6" height="12" rx="3" fill="#0F172A" />
          <rect x="28" y="44" width="8" height="12" rx="3" fill="#0F172A" />
          <path d="M24 22C24 17 40 17 40 22L38 44C38 48 26 48 26 44L24 22Z" fill="#EAB308" stroke="#0F172A" strokeWidth="2.2" />
          <rect x="20" y="21" width="24" height="3.5" rx="1.7" fill="#0F172A" />
          <circle cx="32" cy="31" r="6" fill="#FFFFFF" stroke="#0F172A" strokeWidth="2" />
          <circle cx="32" cy="11" r="2.2" fill="#FEF08A" />
        </svg>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', width: 50, height: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'absolute', width: 44, height: 44, borderRadius: '50%', backgroundColor: haloColor, border: `1.5px solid ${ringColor}` }} />
      <svg width="40" height="40" viewBox="0 0 64 64" fill="none">
        <ellipse cx="32" cy="34" rx="16" ry="25" fill="rgba(15,23,42,0.32)" />
        <rect x="14" y="14" width="4" height="9" rx="2" fill="#0F172A" />
        <rect x="46" y="14" width="4" height="9" rx="2" fill="#0F172A" />
        <rect x="14" y="41" width="4" height="9" rx="2" fill="#0F172A" />
        <rect x="46" y="41" width="4" height="9" rx="2" fill="#0F172A" />
        <rect
          x="17"
          y={palette.isVan ? '6' : '8'}
          width="30"
          height={palette.isVan ? '52' : '48'}
          rx="10"
          fill={palette.body}
          stroke="#0F172A"
          strokeWidth="2.2"
        />
        <path d="M21 17C21 14 43 14 43 17L41 24H23L21 17Z" fill="#0F172A" />
        <path d="M23 43H41L42 49C42 51 22 51 22 49L23 43Z" fill="#0F172A" />
        <rect
          x="22"
          y="24"
          width="20"
          height={palette.isVan ? '20' : '18'}
          rx="4"
          fill={palette.roof}
          stroke="#94A3B8"
          strokeWidth="1"
        />
        {palette.isTaxi && (
          <>
            <rect x="25" y="30" width="14" height="5" rx="2" fill="#0F172A" />
            <rect x="27" y="31" width="10" height="3" rx="1" fill="#FACC15" />
          </>
        )}
        <rect x="20" y="9" width="6" height="2.5" rx="1.2" fill="#FEF9C3" />
        <rect x="38" y="9" width="6" height="2.5" rx="1.2" fill="#FEF9C3" />
        <rect x="20" y="53" width="6" height="2" rx="1" fill="#EF4444" />
        <rect x="38" y="53" width="6" height="2" rx="1" fill="#EF4444" />
      </svg>
    </div>
  );
}

export function AdminRadar() {
  const mapRef = useRef<MapRef>(null);
  const [drivers, setDrivers] = useState<Record<string, DriverLocation>>({});
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [followSelected, setFollowSelected] = useState<boolean>(false);
  const [showLabels, setShowLabels] = useState<boolean>(true);
  const [mapTheme, setMapTheme] = useState<'streets' | 'satellite'>('streets');
  const [isConnected, setIsConnected] = useState(false);
  const [filter, setFilter] = useState<'ALL' | 'AVAILABLE' | 'ON_RIDE'>('ALL');
  const [searchTerm, setSearchTerm] = useState('');

  const fetchOnlineDrivers = useCallback(async () => {
    try {
      const response = await api.get<DriverLocation[]>('/admin/drivers/online');
      if (Array.isArray(response.data)) {
        setDrivers((prev) => {
          const nextMap: Record<string, DriverLocation> = {};
          response.data.forEach((driver) => {
            const existing = prev[driver.driverId];
            const prevTrail = existing?.trail || [];
            const nextPoint: [number, number] = [Number(driver.longitude), Number(driver.latitude)];
            const lastPt = prevTrail[prevTrail.length - 1];
            const moved = !lastPt || lastPt[0] !== nextPoint[0] || lastPt[1] !== nextPoint[1];
            const updatedTrail = moved ? [...prevTrail.slice(-24), nextPoint] : prevTrail;

            let resolvedHeading = Number(driver.heading || existing?.heading || 0);
            if (existing && (existing.latitude !== driver.latitude || existing.longitude !== driver.longitude)) {
              resolvedHeading = calculateBearing(
                existing.latitude,
                existing.longitude,
                Number(driver.latitude),
                Number(driver.longitude)
              );
            }

            nextMap[driver.driverId] = {
              ...existing,
              ...driver,
              latitude: Number(driver.latitude),
              longitude: Number(driver.longitude),
              heading: resolvedHeading,
              trail: updatedTrail,
              lastUpdate: new Date(driver.lastUpdate || Date.now()),
            };
          });
          return nextMap;
        });
      }
    } catch {
      // Aguarda próximo ciclo ou WebSocket
    }
  }, []);

  useEffect(() => {
    fetchOnlineDrivers();
    const syncTimer = setInterval(fetchOnlineDrivers, 15000);
    return () => clearInterval(syncTimer);
  }, [fetchOnlineDrivers]);

  useEffect(() => {
    const token = localStorage.getItem('@bai245:admin_token');
    const socket: Socket = io(BACKEND_BASE_URL, {
      transports: ['websocket', 'polling'],
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
      const newLat = Number(data.latitude);
      const newLng = Number(data.longitude);
      if (!Number.isFinite(newLat) || !Number.isFinite(newLng)) return;

      setDrivers((prev) => {
        const existing = prev[data.driverId];
        let nextHeading = Number(data.heading ?? existing?.heading ?? 0);
        if (existing && (existing.latitude !== newLat || existing.longitude !== newLng)) {
          const dist = Math.hypot(newLat - existing.latitude, newLng - existing.longitude);
          if (dist > 0.000015) {
            nextHeading = calculateBearing(existing.latitude, existing.longitude, newLat, newLng);
          }
        }

        const prevTrail = existing?.trail || [];
        const updatedTrail: Array<[number, number]> = [...prevTrail.slice(-24), [newLng, newLat]];

        return {
          ...prev,
          [data.driverId]: {
            ...existing,
            ...data,
            driverId: data.driverId,
            latitude: newLat,
            longitude: newLng,
            heading: nextHeading,
            trail: updatedTrail,
            lastUpdate: new Date(),
          },
        };
      });
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
            rideStatus: isRiding ? data.status : null,
            lastUpdate: new Date(),
          },
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
  const selectedDriver = selectedDriverId ? drivers[selectedDriverId] || null : null;

  useEffect(() => {
    if (followSelected && selectedDriver && mapRef.current) {
      mapRef.current.easeTo({
        center: [selectedDriver.longitude, selectedDriver.latitude],
        duration: 800,
      });
    }
  }, [followSelected, selectedDriver]);

  const filteredDrivers = useMemo(() => {
    return driverList.filter((d) => {
      const matchesFilter =
        filter === 'ALL'
          ? true
          : filter === 'AVAILABLE'
          ? d.status === 'AVAILABLE'
          : d.status === 'ON_RIDE';

      const searchLower = searchTerm.toLowerCase();
      const matchesSearch =
        !searchTerm ||
        (d.fullName && d.fullName.toLowerCase().includes(searchLower)) ||
        (d.vehiclePlate && d.vehiclePlate.toLowerCase().includes(searchLower)) ||
        (d.vehicleBrand && d.vehicleBrand.toLowerCase().includes(searchLower)) ||
        (d.phone && d.phone.includes(searchTerm));

      return matchesFilter && matchesSearch;
    });
  }, [driverList, filter, searchTerm]);

  const handleSelectDriver = (driver: DriverLocation) => {
    setSelectedDriverId(driver.driverId);
    if (mapRef.current) {
      mapRef.current.flyTo({
        center: [driver.longitude, driver.latitude],
        zoom: 16,
        duration: 1200,
      });
    }
  };

  const handleFitAllFleet = () => {
    setFollowSelected(false);
    if (!mapRef.current) return;
    if (filteredDrivers.length === 0) {
      mapRef.current.flyTo({ center: [DEFAULT_CENTER.longitude, DEFAULT_CENTER.latitude], zoom: 13 });
      return;
    }
    if (filteredDrivers.length === 1) {
      mapRef.current.flyTo({
        center: [filteredDrivers[0].longitude, filteredDrivers[0].latitude],
        zoom: 15,
      });
      return;
    }
    const lngs = filteredDrivers.map((d) => d.longitude);
    const lats = filteredDrivers.map((d) => d.latitude);
    mapRef.current.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 90, maxZoom: 15, duration: 1000 }
    );
  };

  const selectedTrailGeoJson = useMemo(() => {
    if (!selectedDriver?.trail || selectedDriver.trail.length < 2) return null;
    return {
      type: 'Feature' as const,
      properties: {},
      geometry: {
        type: 'LineString' as const,
        coordinates: selectedDriver.trail,
      },
    };
  }, [selectedDriver]);

  return (
    <div style={styles.container}>
      <div style={styles.mapContainer}>
         setFollowSelected(false)}
          style={{ width: '100%', height: '100%' }}
        >
          <NavigationControl position="bottom-right" />

          {selectedTrailGeoJson && (
            <Source id="selected-driver-trail" type="geojson" data={selectedTrailGeoJson}>
              <Layer
                id="selected-driver-trail-line"
                type="line"
                paint={{
                  'line-color': '#EAB308',
                  'line-width': 4,
                  'line-opacity': 0.85,
                  'line-dasharray': [2, 1],
                }}
              />
            </Source>
          )}

          {filteredDrivers.map((driver) => {
            const isRiding = driver.status === 'ON_RIDE';
            const isSelected = selectedDriver?.driverId === driver.driverId;

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
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer' }}>
                  {showLabels && (
                    <div
                      style={{
                        backgroundColor: isSelected ? '#0F172A' : 'rgba(15, 23, 42, 0.86)',
                        color: '#F8FAFC',
                        border: `1px solid ${isSelected ? '#EAB308' : 'rgba(255,255,255,0.2)'}`,
                        borderRadius: 8,
                        padding: '2px 7px',
                        fontSize: 10,
                        fontWeight: 800,
                        marginBottom: 2,
                        whiteSpace: 'nowrap',
                        boxShadow: '0 2px 6px rgba(0,0,0,0.28)',
                      }}
                    >
                      {driver.vehiclePlate || (driver.fullName ? driver.fullName.split(' ')[0] : 'Motorista')}
                    </div>
                  )}

                  <div
                    title={`${driver.fullName || 'Motorista'} • ${driver.vehiclePlate || 'Sem placa'}`}
                    style={{
                      transform: `rotate(${Math.round(driver.heading || 0)}deg)`,
                      transition: 'transform 0.55s linear',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <TopDownVehicleIcon
                      vehicleType={driver.vehicleType}
                      vehicleColor={driver.vehicleColor}
                      isRiding={isRiding}
                    />
                  </div>
                </div>
              </Marker>
            );
          })}

          {selectedDriver && (
            <Popup
              latitude={selectedDriver.latitude}
              longitude={selectedDriver.longitude}
              onClose={() => {
                setSelectedDriverId(null);
                setFollowSelected(false);
              }}
              closeOnClick={false}
              anchor="bottom"
              offset={30}
            >
              <div style={styles.popupCard}>
                <div style={styles.popupHeader}>
                  <span style={styles.driverName}>{selectedDriver.fullName || 'Motorista sem nome'}</span>
                  <span
                    style={{
                      ...styles.statusBadgePopup,
                      backgroundColor: selectedDriver.status === 'ON_RIDE' ? '#DBEAFE' : '#D1FAE5',
                      color: selectedDriver.status === 'ON_RIDE' ? '#1E40AF' : '#065F46',
                    }}
                  >
                    {selectedDriver.status === 'ON_RIDE' ? 'Em Corrida' : 'Livre'}
                  </span>
                </div>

                <div style={styles.popupBody}>
                  <p>
                    <strong>Telefone:</strong> {selectedDriver.phone || 'N/A'}
                  </p>
                  <p>
                    <strong>Veículo:</strong> {selectedDriver.vehicleBrand || 'N/A'} ({selectedDriver.vehicleType || 'PARTICULAR'}){' '}
                    <span style={styles.plateTag}>{selectedDriver.vehiclePlate || 'N/A'}</span>
                  </p>
                  {selectedDriver.status === 'ON_RIDE' && selectedDriver.destinationAddress && (
                    <p style={{ marginTop: 4, color: '#1E3A8A' }}>
                      <strong>Destino:</strong> {selectedDriver.destinationAddress}
                    </p>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                    <span style={styles.timeText}>
                      GPS: {new Date(selectedDriver.lastUpdate).toLocaleTimeString()}
                    </span>
                    <button
                      type="button"
                      onClick={() => setFollowSelected((v) => !v)}
                      style={{
                        backgroundColor: followSelected ? '#EAB308' : '#0F172A',
                        color: followSelected ? '#0F172A' : '#FFFFFF',
                        border: 'none',
                        borderRadius: 6,
                        padding: '4px 8px',
                        fontSize: 10,
                        fontWeight: 800,
                        cursor: 'pointer',
                      }}
                    >
                      {followSelected ? 'Seguindo ✓' : 'Seguir carro'}
                    </button>
                  </div>
                </div>
              </div>
            </Popup>
          )}
        </Map>

        {/* Barra flutuante de controles operacionais no canto superior direito */}
        <div style={styles.mapToolbar}>
          <button type="button" onClick={handleFitAllFleet} style={styles.toolbarBtn}>
            🗺️ Enquadrar Frota
          </button>
          <button type="button" onClick={() => setShowLabels((v) => !v)} style={styles.toolbarBtn}>
            {showLabels ? '🏷️ Ocultar Placas' : '🏷️ Mostrar Placas'}
          </button>
          <button
            type="button"
            onClick={() => setMapTheme((t) => (t === 'streets' ? 'satellite' : 'streets'))}
            style={styles.toolbarBtn}
          >
            {mapTheme === 'streets' ? '🛰️ Satélite' : '🛣️ Mapa Ruas'}
          </button>
        </div>
      </div>

      <div style={styles.overlayPanel}>
        <div style={styles.headerTitleRow}>
          <div>
            <h2 style={styles.title}>Radar da Frota</h2>
            <div style={styles.liveIndicator}>
              <span style={{ ...styles.dot, backgroundColor: isConnected ? '#10B981' : '#EF4444' }} />
              <span>{isConnected ? 'Telemetria Realtime Ativa' : 'Reconectando...'}</span>
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
          placeholder="🔍 Buscar por motorista, modelo ou placa..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={styles.searchInput}
        />

        <div style={styles.driverList}>
          {filteredDrivers.length === 0 ? (
            <div style={styles.emptyText}>Nenhum veículo ativo encontrado no radar.</div>
          ) : (
            filteredDrivers.map((driver) => (
              <div
                key={driver.driverId}
                onClick={() => handleSelectDriver(driver)}
                style={{
                  ...styles.driverListItem,
                  backgroundColor: selectedDriver?.driverId === driver.driverId ? '#F1F5F9' : '#FFFFFF',
                  borderColor: selectedDriver?.driverId === driver.driverId ? '#0F172A' : '#E2E8F0',
                }}
              >
                <div style={styles.driverListInfo}>
                  <strong>{driver.fullName || 'Motorista'}</strong>
                  <span style={styles.driverSubtext}>
                    {driver.vehicleBrand || 'Veículo'} • {driver.vehiclePlate || 'Sem placa'}
                  </span>
                </div>
                <span
                  style={{
                    ...styles.statusDot,
                    backgroundColor: driver.status === 'ON_RIDE' ? '#3B82F6' : '#10B981',
                  }}
                />
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
    fontFamily: 'Inter, system-ui, sans-serif',
  },
  mapContainer: {
    width: '100%',
    height: '100%',
  },
  mapToolbar: {
    position: 'absolute' as const,
    top: '12px',
    right: '12px',
    display: 'flex',
    gap: '8px',
    zIndex: 10,
  },
  toolbarBtn: {
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    color: '#F8FAFC',
    border: '1px solid rgba(255,255,255,0.16)',
    borderRadius: '10px',
    padding: '8px 12px',
    fontSize: '12px',
    fontWeight: '700',
    cursor: 'pointer',
    boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
  },
  overlayPanel: {
    position: 'absolute' as const,
    top: '12px',
    left: '12px',
    width: 'calc(100% - 24px)',
    maxWidth: '340px',
    maxHeight: 'calc(100vh - 120px)',
    backgroundColor: '#FFFFFF',
    borderRadius: '16px',
    padding: '16px',
    boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.15)',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '12px',
    zIndex: 10,
  },
  headerTitleRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  title: { margin: 0, fontSize: '18px', fontWeight: '800', color: '#0F172A' },
  liveIndicator: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#64748B', marginTop: '2px' },
  dot: { width: '8px', height: '8px', borderRadius: '50%' },
  statsRow: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' },
  statCard: {
    backgroundColor: '#F8FAFC',
    padding: '8px 6px',
    borderRadius: '10px',
    border: '2px solid #E2E8F0',
    cursor: 'pointer',
    textAlign: 'center' as const,
    transition: 'all 0.2s',
  },
  statVal: { fontSize: '16px', fontWeight: '800', color: '#0F172A', display: 'block' },
  statLbl: { fontSize: '9px', fontWeight: '700', color: '#64748B', textTransform: 'uppercase' as const },
  searchInput: {
    padding: '10px 14px',
    borderRadius: '10px',
    border: '1px solid #CBD5E1',
    fontSize: '13px',
    outline: 'none',
    backgroundColor: '#F8FAFC',
  },
  driverList: { overflowY: 'auto' as const, display: 'flex', flexDirection: 'column' as const, gap: '8px', maxHeight: '240px' },
  driverListItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 12px',
    borderRadius: '10px',
    border: '1px solid #E2E8F0',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
  driverListInfo: { display: 'flex', flexDirection: 'column' as const, fontSize: '13px', color: '#0F172A' },
  driverSubtext: { fontSize: '11px', color: '#64748B' },
  statusDot: { width: '10px', height: '10px', borderRadius: '50%' },
  popupCard: { minWidth: '210px', padding: '4px' },
  popupHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '8px' },
  driverName: { fontWeight: '800', fontSize: '13px', color: '#0F172A' },
  statusBadgePopup: { fontSize: '10px', fontWeight: '800', padding: '2px 8px', borderRadius: '12px' },
  popupBody: { fontSize: '12px', color: '#334155', lineHeight: '1.6' },
  plateTag: { backgroundColor: '#FEF08A', color: '#0F172A', padding: '2px 6px', borderRadius: '4px', fontFamily: 'monospace', fontWeight: 'bold' },
  timeText: { fontSize: '10px', color: '#94A3B8' },
  emptyText: { textAlign: 'center' as const, fontSize: '12px', color: '#94A3B8', padding: '20px 0' },
};
