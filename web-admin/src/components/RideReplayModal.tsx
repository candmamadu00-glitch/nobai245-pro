import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Play, Pause, X, RotateCcw } from 'lucide-react';
import { getRideTelemetry } from '../services/api';

// Ícone Verde - Origem
const originIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

// Ícone Vermelho - Destino
const destIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

// Ícone do Carrinho em Movimento
const carDivIcon = L.divIcon({
  className: 'custom-car-icon',
  html: '<div style="font-size:28px; transform: translate(-50%, -50%);">🚖</div>',
  iconSize: [30, 30],
  iconAnchor: [15, 15]
});

// Componente para reajustar o enquadramento do mapa no trajeto
function MapBoundsSetter({ coordinates }: { coordinates: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (coordinates && coordinates.length > 0) {
      const bounds = L.latLngBounds(coordinates);
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [coordinates, map]);
  return null;
}

interface RideReplayModalProps {
  rideId: string | null;
  onClose: () => void;
}

export const RideReplayModal: React.FC<RideReplayModalProps> = ({ rideId, onClose }) => {
  const [loading, setLoading] = useState(true);
  const [positions, setPositions] = useState<[number, number][]>([]);
  const [rideDetails, setRideDetails] = useState<any>(null);
  const [isRouted, setIsRouted] = useState(false);
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [speedMultiplier, setSpeedMultiplier] = useState(1);

  useEffect(() => {
    if (!rideId) return;

    const loadTelemetryAndRoute = async () => {
      try {
        setLoading(true);
        const res = await getRideTelemetry(rideId);
        
        let rawTelemetry: any[] = [];
        if (res.success || res.telemetry) {
          rawTelemetry = res.telemetry || [];
          setRideDetails(res.ride || null);
        }

        let parsedPositions: [number, number][] = rawTelemetry.map(p => [Number(p.lat), Number(p.lng)]);

        // Se houver apenas 2 pontos (Início e Fim), consulta as ruas reais via OSRM
        if (parsedPositions.length === 2) {
          const [start, end] = parsedPositions;
          try {
            const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${start[1]},${start[0]};${end[1]},${end[0]}?overview=full&geometries=geojson`;
            const osrmRes = await fetch(osrmUrl);
            const osrmData = await osrmRes.json();

            if (osrmData.routes && osrmData.routes[0] && osrmData.routes[0].geometry) {
              const routeCoords: [number, number][] = osrmData.routes[0].geometry.coordinates.map(
                (coord: [number, number]) => [coord[1], coord[0]]
              );
              if (routeCoords.length > 0) {
                parsedPositions = routeCoords;
                setIsRouted(true);
              }
            }
          } catch (osrmErr) {
            console.warn('Falha ao obter trajeto de ruas OSRM:', osrmErr);
          }
        }

        setPositions(parsedPositions);
        setCurrentIndex(0);
      } catch (err) {
        console.error('Erro ao carregar telemetria:', err);
      } finally {
        setLoading(false);
      }
    };

    loadTelemetryAndRoute();
  }, [rideId]);

  // Animação do Replay
  useEffect(() => {
    if (!isPlaying || positions.length === 0) return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => {
        if (prev >= positions.length - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, (isRouted ? 80 : 500) / speedMultiplier);

    return () => clearInterval(interval);
  }, [isPlaying, positions, speedMultiplier, isRouted]);

  if (!rideId) return null;

  const currentPoint = positions[currentIndex] || positions[0];

  return (
    <div style={overlayStyle}>
      <div style={contentStyle}>
        <div style={headerStyle}>
          <div>
            <h3 style={{ margin: 0, fontSize: '18px', color: '#111827' }}>🎬 Replay de Trajeto da Corrida</h3>
            {rideDetails && (
              <p style={{ margin: '4px 0 0', fontSize: '13px', color: '#6B7280' }}>
                Motorista: <strong>{rideDetails.driver?.fullName || 'N/A'}</strong> | Passageiro: <strong>{rideDetails.passenger?.fullName || 'N/A'}</strong>
              </p>
            )}
          </div>
          <button onClick={onClose} style={closeButtonStyle}>
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <div style={loadingStyle}>
            <span>Calculando trajeto e curvas das ruas...</span>
          </div>
        ) : positions.length === 0 ? (
          <div style={loadingStyle}>
            <span>Nenhum ponto de GPS foi encontrado para esta corrida.</span>
          </div>
        ) : (
          <>
            <div style={{ height: '420px', width: '100%', borderRadius: '8px', overflow: 'hidden' }}>
              <MapContainer 
                center={positions[0]} 
                zoom={14} 
                style={{ height: '100%', width: '100%' }}
              >
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                <MapBoundsSetter coordinates={positions} />

                {/* Trajeto com Curvas e Ruas Reais */}
                <Polyline positions={positions} color="#2563EB" weight={5} opacity={0.8} />

                {/* Marcador de Origem */}
                <Marker position={positions[0]} icon={originIcon}>
                  <Popup>Ponto de Partida</Popup>
                </Marker>

                {/* Marcador de Destino */}
                <Marker position={positions[positions.length - 1]} icon={destIcon}>
                  <Popup>Ponto de Chegada</Popup>
                </Marker>

                {/* Carrinho em Movimento */}
                {currentPoint && (
                  <Marker position={currentPoint} icon={carDivIcon} />
                )}
              </MapContainer>
            </div>

            {/* Painel de Controle */}
            <div style={controlsStyle}>
              <button 
                onClick={() => {
                  if (currentIndex >= positions.length - 1) setCurrentIndex(0);
                  setIsPlaying(!isPlaying);
                }} 
                style={playBtnStyle}
              >
                {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                <span>{isPlaying ? 'Pausar' : 'Play'}</span>
              </button>

              <button 
                onClick={() => {
                  setCurrentIndex(0);
                  setIsPlaying(false);
                }}
                style={resetBtnStyle}
                title="Reiniciar"
              >
                <RotateCcw size={16} />
              </button>

              <input
                type="range"
                min={0}
                max={positions.length - 1}
                value={currentIndex}
                onChange={(e) => {
                  setCurrentIndex(Number(e.target.value));
                  setIsPlaying(false);
                }}
                style={{ flex: 1, margin: '0 15px', cursor: 'pointer' }}
              />

              <span style={{ fontSize: '13px', fontWeight: 'bold', minWidth: '60px', color: '#374151' }}>
                {currentIndex + 1} / {positions.length}
              </span>

              <div style={{ display: 'flex', gap: '4px', marginLeft: '10px' }}>
                {[1, 2, 4].map((spd) => (
                  <button
                    key={spd}
                    onClick={() => setSpeedMultiplier(spd)}
                    style={{
                      ...spdBtnStyle,
                      backgroundColor: speedMultiplier === spd ? '#2563EB' : '#E5E7EB',
                      color: speedMultiplier === spd ? '#FFFFFF' : '#374151'
                    }}
                  >
                    {spd}x
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// Estilos
const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.7)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 9999,
};

const contentStyle: React.CSSProperties = {
  backgroundColor: '#FFFFFF',
  width: '90%',
  maxWidth: '900px',
  borderRadius: '12px',
  padding: '20px',
  boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '15px',
};

const closeButtonStyle: React.CSSProperties = {
  background: '#F3F4F6',
  border: 'none',
  padding: '8px',
  borderRadius: '50%',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const loadingStyle: React.CSSProperties = {
  height: '420px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#6B7280',
};

const controlsStyle: React.CSSProperties = {
  marginTop: '15px',
  display: 'flex',
  alignItems: 'center',
  padding: '12px',
  backgroundColor: '#F8FAFC',
  borderRadius: '8px',
  border: '1px solid #E2E8F0',
};

const playBtnStyle: React.CSSProperties = {
  backgroundColor: '#10B981',
  color: '#FFF',
  border: 'none',
  padding: '8px 16px',
  borderRadius: '6px',
  fontWeight: 'bold',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
};

const resetBtnStyle: React.CSSProperties = {
  backgroundColor: '#E5E7EB',
  color: '#374151',
  border: 'none',
  padding: '8px',
  borderRadius: '6px',
  cursor: 'pointer',
  marginLeft: '6px',
  display: 'flex',
  alignItems: 'center',
};

const spdBtnStyle: React.CSSProperties = {
  border: 'none',
  padding: '4px 10px',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '12px',
  fontWeight: 'bold',
};