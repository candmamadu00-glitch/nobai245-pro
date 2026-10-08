import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getRideTracking } from '../services/api';

export function TrackRide() {
  const { rideId } = useParams();
  const [rideData, setRideData] = useState<any>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const fetchRide = async () => {
      try {
        if (!rideId) return;
        const data = await getRideTracking(rideId);
        setRideData(data);
      } catch (err) {
        setError(true);
      }
    };

    fetchRide();
    // Você pode adicionar um setInterval aqui para atualizar a posição a cada 5 segundos
    const interval = setInterval(fetchRide, 5000);
    return () => clearInterval(interval);
  }, [rideId]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-xl text-slate-600">Corrida finalizada ou link inválido.</p>
      </div>
    );
  }

  if (!rideData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-100">
      {/* Cabeçalho */}
      <div className="bg-white p-4 shadow-sm flex items-center justify-center">
        <h1 className="text-xl font-bold text-slate-800">Nobai245 Rastreamento</h1>
      </div>

      {/* Mapa do Rastreamento (Pode ser integrado com Mapbox GL JS se desejar) */}
      <div className="flex-1 bg-slate-200 flex items-center justify-center relative">
         {/* Se for usar um mapa real, renderize o mapa aqui apontando para rideData.driverLocation */}
         <p className="text-slate-500 font-medium">Mapa de Rastreamento em Tempo Real</p>
      </div>

      {/* Info do Motorista */}
      <div className="bg-white p-6 rounded-t-3xl shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)] z-10 relative">
        <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-4">Em viagem para: {rideData.dropoffAddress}</h2>
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 bg-slate-200 rounded-full flex items-center justify-center text-xl font-bold">
            {rideData.driverName.charAt(0)}
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-800">{rideData.driverName}</h3>
            <p className="text-slate-600">{rideData.carModel} • {rideData.licensePlate}</p>
          </div>
        </div>
      </div>
    </div>
  );
}