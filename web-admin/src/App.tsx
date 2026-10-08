import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Drivers } from './pages/Drivers';
import { Passengers } from './pages/Passengers'; 
import { Rides } from './pages/Rides';
import { AdminRadar } from './components/AdminRadar'; 
import { Financial } from './pages/Financial';
import { DriverRequests } from './pages/DriverRequests';
import { RatingsPage } from './pages/Ratings';
import { Tickets } from './pages/Tickets';
import { Settings } from './pages/Settings';
import { SOSMonitor } from './pages/SOSMonitor';
import { TrackRide } from './pages/TrackRide';
import { Admins } from './pages/Admins';

import './App.css';

// Proteção de rotas privadas
function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { admin, loading } = useAuth();
  
  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner"></div>
        <p className="loading-text">Iniciando sistema BAI 245...</p>
      </div>
    );
  }
  
  if (!admin) return <Navigate to="/login" replace />;
  
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      {/* Rotas Públicas */}
      <Route path="/login" element={<Login />} />
      <Route path="/track/:rideId" element={<TrackRide />} />
      
      {/* Rotas Privadas */}
      <Route path="/" element={<PrivateRoute><Layout /></PrivateRoute>}>
        <Route index element={<Dashboard />} />
        <Route path="radar" element={<AdminRadar />} />
        <Route path="rides" element={<Rides />} />
        <Route path="sos" element={<SOSMonitor />} />
        <Route path="driver-requests" element={<DriverRequests />} />
        <Route path="drivers" element={<Drivers />} />
        <Route path="passengers" element={<Passengers />} /> 
        <Route path="admins" element={<Admins />} />
        <Route path="finance" element={<Financial />} />
        <Route path="ratings" element={<RatingsPage />} />
        <Route path="tickets" element={<Tickets />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      
      {/* Redirecionamento de rotas desconhecidas */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}