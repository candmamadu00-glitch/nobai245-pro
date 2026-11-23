import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import Map, { Marker, Popup, NavigationControl, Source, Layer } from 'react-map-gl/mapbox';
import type { MapRef } from 'react-map-gl/mapbox';
import 'mapbox-gl/dist/mapbox-gl.css';
import { io, Socket } from 'socket.io-client';
import { api, BASE_SERVER_URL } from '../services/api';
import { TopDownVehicle3D } from './TopDownVehicle3D';
import { emergencySiren } from '../utils/emergencySiren';

const rawUrl = import.meta.env?.VITE_API_URL || 'https://api.nobai245.com';
const BACKEND_BASE_URL = rawUrl.replace(/\/api\/?$/, '').replace(/\/$/, '');
const MAPBOX_TOKEN =
  import.meta.env.VITE_MAPBOX_TOKEN ||
  'pk.eyJ1IjoibWFtYWR1Y2FuZGUiLCJhIjoiY211ZGpkMnVtMDMzdDJ4c2U0NHd3dHBtZiJ9.mT0BfmoFsPTgWFzNnblCZg';

const DEFAULT_CENTER = { latitude: 11.8632, longitude: -15.5977, zoom: 13 };

export interface ActiveSosInfo {
  id: string;
  userType: 'PASSENGER' | 'DRIVER';
  lat: number;
  lng: number;
  audioUrl?: string | null;
  createdAt: string;
  passengerName?: string | null;
  phone?: string | null;
}

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
  activeSos?: ActiveSosInfo | null;
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

export function AdminRadar() {
  const mapRef = useRef<MapRef>(null);
  const [drivers, setDrivers] = useState<Record<string, DriverLocation>>({});
  const [orphanSosAlerts, setOrphanSosAlerts] = useState<any[]>([]);
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [followSelected, setFollowSelected] = useState<boolean>(false);
  const [showLabels, setShowLabels] = useState<boolean>(true);
  const [mapTheme, setMapTheme] = useState<'streets' | 'satellite'>('streets');
  const [isConnected, setIsConnected] = useState(false);
  const [filter, setFilter] = useState<'ALL' | 'AVAILABLE' | 'ON_RIDE' | 'SOS'>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [sirenMuted, setSirenMuted] = useState<boolean>(() => emergencySiren.isMuted());

  const fetchOnlineDriversAndSos = useCallback(async () => {
    try {
      const [driversRes, sosRes] = await Promise.all([
        api.get<DriverLocation[]>('/admin/drivers/online'),
        api.get<any[]>('/admin/sos?status=ACTIVE').catch(() => ({ data: [] })),
      ]);

      const activeSosList = Array.isArray(sosRes.data) ? sosRes.data : [];
      const sosByDriverId: Record<string, ActiveSosInfo> = {};
      const unmatchedSos: any[] = [];

      activeSosList.forEach((s: any) => {
        const dId = s.driverId || s.ride?.driverId || s.driver?.id || null;
        if (dId) {
          sosByDriverId[dId] = {
            id: s.id,
            userType: s.userType || 'DRIVER',
            lat: Number(s.lat || 0),
            lng: Number(s.lng || 0),
            audioUrl: s.audioUrl || null,
            createdAt: s.createdAt,
            passengerName: s.passenger?.fullName || null,
            phone: s.passenger?.phone || s.driver?.phone || null,
          };
        } else {
          unmatchedSos.push(s);
        }
      });

      setOrphanSosAlerts(unmatchedSos);

      if (activeSosList.length > 0 && !emergencySiren.isMuted()) {
        emergencySiren.startContinuous();
      } else if (activeSosList.length === 0) {
        emergencySiren.stopContinuous();
      }

      if (Array.isArray(driversRes.data)) {
        setDrivers((prev) => {
          const nextMap: Record<string, DriverLocation> = {};
          driversRes.data.forEach((driver) => {
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
              activeSos: sosByDriverId[driver.driverId] || null,
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
    fetchOnlineDriversAndSos();
    const syncTimer = setInterval(fetchOnlineDriversAndSos, 12000);
    return () => {
      clearInterval(syncTimer);
      emergencySiren.stopContinuous();
    };
  }, [fetchOnlineDriversAndSos]);

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

    socket.on('admin:sos_alert', (sos: any) => {
      emergencySiren.startContinuous();
      const targetDriverId = sos?.driverId || sos?.ride?.driverId || sos?.driver?.id || null;
      const lat = Number(sos?.lat ?? sos?.latitude ?? 11.8632);
      const lng = Number(sos?.lng ?? sos?.longitude ?? -15.5977);

      if (targetDriverId) {
        setDrivers((prev) => {
          const existing = prev[targetDriverId];
          return {
            ...prev,
            [targetDriverId]: {
              driverId: targetDriverId,
              fullName: existing?.fullName || sos?.driverName || sos?.driver?.fullName || 'Motorista em Emergência',
              phone: existing?.phone || sos?.phone || sos?.driver?.phone || '',
              vehiclePlate: existing?.vehiclePlate || sos?.vehiclePlate || sos?.driver?.vehiclePlate || '',
              vehicleBrand: existing?.vehicleBrand || sos?.vehicleModel || sos?.driver?.vehicleBrand || '',
              vehicleType: existing?.vehicleType || sos?.driver?.vehicleType || 'PARTICULAR',
              vehicleColor: existing?.vehicleColor || sos?.vehicleColor || sos?.driver?.vehicleColor || 'Vermelho',
              latitude: lat || existing?.latitude || 11.8632,
              longitude: lng || existing?.longitude || -15.5977,
              heading: existing?.heading || 0,
              status: 'ON_RIDE',
              activeSos: {
                id: sos?.id || sos?.sosId || `sos-${Date.now()}`,
                userType: sos?.userType || 'DRIVER',
                lat,
                lng,
                audioUrl: sos?.audioUrl || null,
                createdAt: sos?.createdAt || new Date().toISOString(),
                passengerName: sos?.passengerName || sos?.passenger?.fullName || null,
                phone: sos?.phone || sos?.passenger?.phone || sos?.driver?.phone || null,
              },
              lastUpdate: new Date(),
            },
          };
        });
        setSelectedDriverId(targetDriverId);
        setFollowSelected(true);
      } else {
        setOrphanSosAlerts((prev) => [sos, ...prev]);
      }

      if (mapRef.current && Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0) {
        mapRef.current.flyTo({ center: [lng, lat], zoom: 16.5, duration: 1100 });
      }
    });

    socket.on('admin:sos_resolved', (evt: any) => {
      if (evt?.driverId) {
        setDrivers((prev) => {
          if (!prev[evt.driverId]) return prev;
          return {
            ...prev,
            [evt.driverId]: { ...prev[evt.driverId], activeSos: null },
          };
        });
      }
      setOrphanSosAlerts((prev) => prev.filter((item) => item.id !== evt?.sosId));
      fetchOnlineDriversAndSos();
    });

    return () => {
      socket.disconnect();
    };
  }, [fetchOnlineDriversAndSos]);

  const driverList = Object.values(drivers);
  const totalOnline = driverList.length;
  const onRideCount = driverList.filter((d) => d.status === 'ON_RIDE').length;
  const availableCount = totalOnline - onRideCount;
  const sosDrivers = driverList.filter((d) => Boolean(d.activeSos));
  const totalSosCount = sosDrivers.length + orphanSosAlerts.length;
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
          : filter === 'SOS'
          ? Boolean(d.activeSos)
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
        duration: 1100,
      });
    }
  };

  const handleResolveSos = async (sosId: string, driverId?: string) => {
    if (!window.confirm('Confirmar encerramento deste chamado de emergência SOS?')) return;
    try {
      await api.patch(`/admin/sos/${sosId}/status`, { status: 'RESOLVED' });
      emergencySiren.stopContinuous();
      if (driverId) {
        setDrivers((prev) =>
          prev[driverId] ? { ...prev, [driverId]: { ...prev[driverId], activeSos: null } } : prev
        );
      }
      fetchOnlineDriversAndSos();
    } catch {
      alert('Falha ao encerrar incidente SOS.');
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

  const toggleSirenMute = () => {
    const next = !sirenMuted;
    setSirenMuted(next);
    emergencySiren.setMuted(next);
    if (!next && totalSosCount > 0) emergencySiren.startContinuous();
  };

  return (
    <div style={styles.container}>
      {totalSosCount > 0 && (
        <div style={styles.emergencyBanner}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 20 }}>🚨</span>
            <div>
              <strong style={{ display: 'block', fontSize: 13, letterSpacing: 0.4 }}>
                EMERGÊNCIA PRIORITÁRIA ATIVA ({totalSosCount} {totalSosCount === 1 ? 'OCORRÊNCIA' : 'OCORRÊNCIAS'})
              </strong>
              <span style={{ fontSize: 11, opacity: 0.92 }}>
                {sosDrivers[0]
                  ? `Veículo ${sosDrivers[0].vehiclePlate || ''} (${sosDrivers[0].fullName || 'Motorista'}) em alerta vermelho no radar`
                  : 'Passageiro acionou SOS — localize no mapa imediato'}
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {sosDrivers[0] && (
              <button
                type="button"
                onClick={() => {
                  handleSelectDriver(sosDrivers[0]);
                  setFollowSelected(true);
                }}
                style={styles.bannerLocateBtn}
              >
                🎯 Localizar Veículo
              </button>
            )}
            <button type="button" onClick={toggleSirenMute} style={styles.bannerMuteBtn}>
              {sirenMuted ? '🔇 Ativar Sirene' : '🔊 Silenciar Sirene'}
            </button>
          </div>
        </div>
      )}

      <div style={styles.mapContainer}>
        <Map
          ref={mapRef}
          initialViewState={DEFAULT_CENTER}
          mapStyle={
            mapTheme === 'satellite'
              ? 'mapbox://styles/mapbox/satellite-streets-v12'
              : 'mapbox://styles/mapbox/streets-v12'
          }
          mapboxAccessToken={MAPBOX_TOKEN}
          onDragStart={() => setFollowSelected(false)}
          style={{ width: '100%', height: '100%' }}
        >
          <NavigationControl position="bottom-right" />

          {selectedTrailGeoJson && (
            <Source id="selected-driver-trail" type="geojson" data={selectedTrailGeoJson}>
              <Layer
                id="selected-driver-trail-line"
                type="line"
                paint={{
                  'line-color': selectedDriver?.activeSos ? '#EF4444' : '#EAB308',
                  'line-width': 4,
                  'line-opacity': 0.85,
                  'line-dasharray': [2, 1],
                }}
              />
            </Source>
          )}

          {filteredDrivers.map((driver) => {
            const isRiding = driver.status === 'ON_RIDE';
            const isEmergency = Boolean(driver.activeSos);
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
                  {isEmergency && (
                    <div
                      style={{
                        backgroundColor: '#DC2626',
                        color: '#FFFFFF',
                        border: '1.5px solid #FEF2F2',
                        borderRadius: 8,
                        padding: '3px 8px',
                        fontSize: 10,
                        fontWeight: 900,
                        marginBottom: 3,
                        whiteSpace: 'nowrap',
                        boxShadow: '0 4px 12px rgba(220,38,38,0.65)',
                      }}
                    >
                      🚨 SOS PRIORITÁRIO • {driver.vehiclePlate || 'ALERTA'}
                    </div>
                  )}

                  {!isEmergency && showLabels && (
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
                    <TopDownVehicle3D
                      vehicleType={driver.vehicleType}
                      vehicleColor={driver.vehicleColor}
                      isRiding={isRiding}
                      isEmergency={isEmergency}
                      size={isEmergency ? 64 : 54}
                    />
                  </div>
                </div>
              </Marker>
            );
          })}

          {orphanSosAlerts.map((sos) => (
            <Marker
              key={`orphan-sos-${sos.id}`}
              latitude={Number(sos.lat || 11.8632)}
              longitude={Number(sos.lng || -15.5977)}
              anchor="center"
            >
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div
                  style={{
                    backgroundColor: '#DC2626',
                    color: '#FFFFFF',
                    padding: '4px 9px',
                    borderRadius: 8,
                    fontSize: 11,
                    fontWeight: 900,
                    boxShadow: '0 4px 14px rgba(220,38,38,0.7)',
                  }}
                >
                  🚨 SOS PASSAGEIRO: {sos.passenger?.fullName || 'Urgente'}
                </div>
              </div>
            </Marker>
          ))}

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
              offset={34}
            >
              <div
                style={{
                  ...styles.popupCard,
                  border: selectedDriver.activeSos ? '2px solid #EF4444' : 'none',
                  borderRadius: 10,
                }}
              >
                {selectedDriver.activeSos && (
                  <div
                    style={{
                      backgroundColor: '#DC2626',
                      color: '#FFFFFF',
                      padding: '6px 8px',
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 900,
                      marginBottom: 8,
                    }}
                  >
                    🚨 ALERTA DE EMERGÊNCIA PRIORITÁRIO ({selectedDriver.activeSos.userType === 'PASSENGER' ? 'PASSAGEIRO' : 'MOTORISTA'})
                  </div>
                )}

                <div style={styles.popupHeader}>
                  <span style={styles.driverName}>{selectedDriver.fullName || 'Motorista sem nome'}</span>
                  <span
                    style={{
                      ...styles.statusBadgePopup,
                      backgroundColor: selectedDriver.activeSos
                        ? '#FEE2E2'
                        : selectedDriver.status === 'ON_RIDE'
                        ? '#DBEAFE'
                        : '#D1FAE5',
                      color: selectedDriver.activeSos
                        ? '#B91C1C'
                        : selectedDriver.status === 'ON_RIDE'
                        ? '#1E40AF'
                        : '#065F46',
                    }}
                  >
                    {selectedDriver.activeSos ? 'EMERGÊNCIA SOS' : selectedDriver.status === 'ON_RIDE' ? 'Em Corrida' : 'Livre'}
                  </span>
                </div>

                <div style={styles.popupBody}>
                  <p>
                    <strong>Telefone:</strong>{' '}
                    <a href={`tel:${selectedDriver.activeSos?.phone || selectedDriver.phone}`} style={{ color: '#0F172A' }}>
                      {selectedDriver.activeSos?.phone || selectedDriver.phone || 'N/A'}
                    </a>
                  </p>
                  <p>
                    <strong>Veículo:</strong> {selectedDriver.vehicleBrand || 'N/A'} ({selectedDriver.vehicleColor || selectedDriver.vehicleType || 'Particular'}){' '}
                    <span style={styles.plateTag}>{selectedDriver.vehiclePlate || 'N/A'}</span>
                  </p>
                  {selectedDriver.activeSos?.passengerName && (
                    <p style={{ color: '#B91C1C' }}>
                      <strong>Passageiro em risco:</strong> {selectedDriver.activeSos.passengerName}
                    </p>
                  )}
                  {selectedDriver.status === 'ON_RIDE' && selectedDriver.destinationAddress && (
                    <p style={{ marginTop: 4, color: '#1E3A8A' }}>
                      <strong>Destino:</strong> {selectedDriver.destinationAddress}
                    </p>
                  )}
                  {selectedDriver.activeSos?.audioUrl && (
                    <audio
                      controls
                      src={`${BASE_SERVER_URL}${selectedDriver.activeSos.audioUrl}`}
                      style={{ width: '100%', height: 30, marginTop: 6 }}
                    />
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8, gap: 6 }}>
                    <span style={styles.timeText}>
                      GPS: {new Date(selectedDriver.lastUpdate).toLocaleTimeString()}
                    </span>
                    <div style={{ display: 'flex', gap: 5 }}>
                      {selectedDriver.activeSos && (
                        <button
                          type="button"
                          onClick={() => handleResolveSos(selectedDriver.activeSos!.id, selectedDriver.driverId)}
                          style={{
                            backgroundColor: '#16A34A',
                            color: '#FFFFFF',
                            border: 'none',
                            borderRadius: 6,
                            padding: '4px 8px',
                            fontSize: 10,
                            fontWeight: 800,
                            cursor: 'pointer',
                          }}
                        >
                          ✅ Resolver SOS
                        </button>
                      )}
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
              </div>
            </Popup>
          )}
        </Map>

        <div style={styles.mapToolbar}>
          <button type="button" onClick={toggleSirenMute} style={styles.toolbarBtn}>
            {sirenMuted ? '🔇 Som SOS Off' : '🔊 Som SOS On'}
          </button>
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
            <h2 style={styles.title}>Radar da Frota 3D</h2>
            <div style={styles.liveIndicator}>
              <span style={{ ...styles.dot, backgroundColor: isConnected ? '#10B981' : '#EF4444' }} />
              <span>{isConnected ? 'Telemetria Realtime Ativa' : 'Reconectando...'}</span>
            </div>
          </div>
        </div>

        <div style={styles.statsRow4}>
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
            <span style={styles.statLbl}>Corrida</span>
          </div>

          <div
            onClick={() => setFilter('SOS')}
            style={{
              ...styles.statCard,
              backgroundColor: totalSosCount > 0 ? '#FEF2F2' : '#F8FAFC',
              borderColor: totalSosCount > 0 ? '#EF4444' : filter === 'SOS' ? '#EF4444' : '#E2E8F0',
            }}
          >
            <span style={{ ...styles.statVal, color: '#DC2626' }}>{totalSosCount}</span>
            <span style={{ ...styles.statLbl, color: '#DC2626' }}>SOS</span>
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
            filteredDrivers.map((driver) => {
              const isSos = Boolean(driver.activeSos);
              return (
                <div
                  key={driver.driverId}
                  onClick={() => handleSelectDriver(driver)}
                  style={{
                    ...styles.driverListItem,
                    backgroundColor: isSos
                      ? '#FEF2F2'
                      : selectedDriver?.driverId === driver.driverId
                      ? '#F1F5F9'
                      : '#FFFFFF',
                    borderColor: isSos
                      ? '#EF4444'
                      : selectedDriver?.driverId === driver.driverId
                      ? '#0F172A'
                      : '#E2E8F0',
                  }}
                >
                  <div style={styles.driverListInfo}>
                    <strong>
                      {isSos ? '🚨 ' : ''}
                      {driver.fullName || 'Motorista'}
                    </strong>
                    <span style={styles.driverSubtext}>
                      {driver.vehicleBrand || 'Veículo'} • {driver.vehiclePlate || 'Sem placa'}
                    </span>
                  </div>
                  <span
                    style={{
                      ...styles.statusDot,
                      backgroundColor: isSos ? '#EF4444' : driver.status === 'ON_RIDE' ? '#3B82F6' : '#10B981',
                    }}
                  />
                </div>
              );
            })
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
  emergencyBanner: {
    position: 'absolute' as const,
    top: '12px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 30,
    backgroundColor: '#DC2626',
    color: '#FFFFFF',
    border: '2px solid #FECACA',
    borderRadius: '14px',
    padding: '10px 16px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '16px',
    boxShadow: '0 14px 30px rgba(220, 38, 38, 0.55)',
    maxWidth: '92%',
  },
  bannerLocateBtn: {
    backgroundColor: '#FFFFFF',
    color: '#B91C1C',
    border: 'none',
    borderRadius: '8px',
    padding: '7px 11px',
    fontSize: '11px',
    fontWeight: '900',
    cursor: 'pointer',
  },
  bannerMuteBtn: {
    backgroundColor: '#7F1D1D',
    color: '#FFFFFF',
    border: '1px solid rgba(255,255,255,0.35)',
    borderRadius: '8px',
    padding: '7px 11px',
    fontSize: '11px',
    fontWeight: '800',
    cursor: 'pointer',
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
    flexWrap: 'wrap' as const,
    zIndex: 10,
  },
  toolbarBtn: {
    backgroundColor: 'rgba(15, 23, 42, 0.9)',
    color: '#F8FAFC',
    border: '1px solid rgba(255,255,255,0.16)',
    borderRadius: '10px',
    padding: '8px 11px',
    fontSize: '11px',
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
  statsRow4: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '6px' },
  statCard: {
    backgroundColor: '#F8FAFC',
    padding: '8px 4px',
    borderRadius: '10px',
    border: '2px solid #E2E8F0',
    cursor: 'pointer',
    textAlign: 'center' as const,
    transition: 'all 0.2s',
  },
  statVal: { fontSize: '15px', fontWeight: '800', color: '#0F172A', display: 'block' },
  statLbl: { fontSize: '9px', fontWeight: '700', color: '#64748B', textTransform: 'uppercase' as const },
  searchInput: {
    padding: '10px 14px',
    borderRadius: '10px',
    border: '1px solid #CBD5E1',
    fontSize: '13px',
    outline: 'none',
    backgroundColor: '#F8FAFC',
  },
  driverList: { overflowY: 'auto' as const, display: 'flex', flexDirection: 'column' as const, gap: '8px', maxHeight: '230px' },
  driverListItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 12px',
    borderRadius: '10px',
    border: '1.5px solid #E2E8F0',
    cursor: 'pointer',
    transition: 'background-color 0.2s',
  },
  driverListInfo: { display: 'flex', flexDirection: 'column' as const, fontSize: '13px', color: '#0F172A' },
  driverSubtext: { fontSize: '11px', color: '#64748B' },
  statusDot: { width: '10px', height: '10px', borderRadius: '50%' },
  popupCard: { minWidth: '225px', padding: '6px' },
  popupHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '8px' },
  driverName: { fontWeight: '800', fontSize: '13px', color: '#0F172A' },
  statusBadgePopup: { fontSize: '10px', fontWeight: '800', padding: '2px 8px', borderRadius: '12px' },
  popupBody: { fontSize: '12px', color: '#334155', lineHeight: '1.6' },
  plateTag: { backgroundColor: '#FEF08A', color: '#0F172A', padding: '2px 6px', borderRadius: '4px', fontFamily: 'monospace', fontWeight: 'bold' },
  timeText: { fontSize: '10px', color: '#94A3B8' },
  emptyText: { textAlign: 'center' as const, fontSize: '12px', color: '#94A3B8', padding: '20px 0' },
};
