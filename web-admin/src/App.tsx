import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import type { AdminRole } from './contexts/AuthContext';
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
import Landmarks from './pages/Landmarks';
import { Promos } from './pages/Promos';
import { Broadcast } from './pages/Broadcast';
import { Analytics } from './pages/Analytics';
import { Corporate } from './pages/Corporate';
import { Governance } from './pages/Governance';
import { ShieldAlert } from 'lucide-react';

import './App.css';

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

function RoleRoute({
  allowedRoles,
  children
}: {
  allowedRoles: AdminRole[];
  children: React.ReactNode;
}) {
  const { admin } = useAuth();

  if (!admin) return <Navigate to="/login" replace />;

  if (!allowedRoles.includes(admin.role)) {
    return (
      <div
        style={{
          maxWidth: '480px',
          margin: '60px auto',
          padding: '28px',
          backgroundColor: '#ffffff',
          borderRadius: '14px',
          border: '1px solid #fee2e2',
          textAlign: 'center',
          boxShadow: '0 10px 25px rgba(15, 23, 42, 0.06)'
        }}
      >
        <div
          style={{
            width: '52px',
            height: '52px',
            borderRadius: '50%',
            backgroundColor: '#fef2f2',
            color: '#dc2626',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 14px'
          }}
        >
          <ShieldAlert size={26} />
        </div>
        <h2 style={{ margin: '0 0 8px', fontSize: '19px', color: '#0f172a' }}>
          Acesso Restrito ao Perfil ({admin.role})
        </h2>
        <p style={{ margin: '0 0 20px', fontSize: '13px', color: '#64748b', lineHeight: 1.5 }}>
          O seu nível de permissão não autoriza visualização ou operações financeiras/administrativas neste módulo.
        </p>
        <Link
          to="/"
          style={{
            display: 'inline-block',
            padding: '10px 18px',
            backgroundColor: '#059669',
            color: '#ffffff',
            borderRadius: '8px',
            textDecoration: 'none',
            fontWeight: 600,
            fontSize: '13px'
          }}
        >
          Voltar ao Centro de Comando
        </Link>
      </div>
    );
  }

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
        <Route path="ratings" element={<RatingsPage />} />
        <Route path="tickets" element={<Tickets />} />
        <Route path="landmarks" element={<Landmarks />} />
        <Route path="promos" element={<Promos />} />
        <Route path="broadcast" element={<Broadcast />} />
        <Route path="analytics" element={<Analytics />} />

        {/* Rotas Financeiras & Corporativas (RBAC) */}
        <Route
          path="financial"
          element={
            <RoleRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'FINANCE']}>
              <Financial />
            </RoleRoute>
          }
        />
        <Route
          path="finance"
          element={
            <RoleRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'FINANCE']}>
              <Financial />
            </RoleRoute>
          }
        />
        <Route
          path="corporate"
          element={
            <RoleRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'FINANCE']}>
              <Corporate />
            </RoleRoute>
          }
        />
        <Route
          path="governance"
          element={
            <RoleRoute allowedRoles={['SUPER_ADMIN', 'ADMIN', 'FINANCE']}>
              <Governance />
            </RoleRoute>
          }
        />

        {/* Rotas Críticas de Gestão de Equipe e Configurações (RBAC) */}
        <Route
          path="admins"
          element={
            <RoleRoute allowedRoles={['SUPER_ADMIN', 'ADMIN']}>
              <Admins />
            </RoleRoute>
          }
        />
        <Route
          path="settings"
          element={
            <RoleRoute allowedRoles={['SUPER_ADMIN', 'ADMIN']}>
              <Settings />
            </RoleRoute>
          }
        />
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

