import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import type { AdminRole } from './contexts/AuthContext';
import { Layout } from './components/Layout';
import { ShieldAlert } from 'lucide-react';

import './App.css';

// Carregamento sob demanda (Code Splitting) para alta velocidade em redes móveis
const Login = lazy(() => import('./pages/Login').then((m) => ({ default: m.Login })));
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })));
const Drivers = lazy(() => import('./pages/Drivers').then((m) => ({ default: m.Drivers })));
const Passengers = lazy(() => import('./pages/Passengers').then((m) => ({ default: m.Passengers })));
const Rides = lazy(() => import('./pages/Rides').then((m) => ({ default: m.Rides })));
const AdminRadar = lazy(() => import('./components/AdminRadar').then((m) => ({ default: m.AdminRadar })));
const Financial = lazy(() => import('./pages/Financial').then((m) => ({ default: m.Financial })));
const DriverRequests = lazy(() => import('./pages/DriverRequests').then((m) => ({ default: m.DriverRequests })));
const RatingsPage = lazy(() => import('./pages/Ratings').then((m) => ({ default: m.RatingsPage })));
const Tickets = lazy(() => import('./pages/Tickets').then((m) => ({ default: m.Tickets })));
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })));
const SOSMonitor = lazy(() => import('./pages/SOSMonitor').then((m) => ({ default: m.SOSMonitor })));
const TrackRide = lazy(() => import('./pages/TrackRide').then((m) => ({ default: m.TrackRide })));
const EmergencyDispatch = lazy(() => import('./pages/EmergencyDispatch').then((m) => ({ default: m.EmergencyDispatch })));
const Admins = lazy(() => import('./pages/Admins').then((m) => ({ default: m.Admins })));
const Landmarks = lazy(() => import('./pages/Landmarks'));
const Promos = lazy(() => import('./pages/Promos').then((m) => ({ default: m.Promos })));
const Broadcast = lazy(() => import('./pages/Broadcast').then((m) => ({ default: m.Broadcast })));
const Analytics = lazy(() => import('./pages/Analytics').then((m) => ({ default: m.Analytics })));
const Corporate = lazy(() => import('./pages/Corporate').then((m) => ({ default: m.Corporate })));
const B2BPortal = lazy(() => import('./pages/B2BPortal').then((m) => ({ default: m.B2BPortal })));
const Governance = lazy(() => import('./pages/Governance').then((m) => ({ default: m.Governance })));

function RouteFallback() {
  return (
    <div className="loading-screen" style={{ minHeight: '55vh' }}>
      <div className="loading-spinner"></div>
      <p className="loading-text">Carregando módulo operacional...</p>
    </div>
  );
}

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { admin, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner"></div>
        <p className="loading-text">Iniciando sistema NÔ BAI 245...</p>
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
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        {/* Rotas Públicas */}
        <Route path="/login" element={<Login />} />
        <Route path="/track/:rideId" element={<TrackRide />} />
        <Route path="/emergencia" element={<EmergencyDispatch />} />
        <Route path="/portal-b2b" element={<B2BPortal />} />

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
    </Suspense>
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
