import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getSystemHealth } from '../services/api';
import type { SystemHealthResponse } from '../services/api';
import { adminSocket } from '../services/adminSocket';
import { useAdminSocket } from '../hooks/useAdminSocket';
import {
  LayoutDashboard,
  Radio,
  Car,
  ShieldAlert,
  MapPin,
  UserCheck,
  Users,
  UserX,
  UserCog,
  DollarSign,
  Ticket,
  Star,
  Settings,
  LogOut,
  Menu,
  X,
  Download,
  Tag,
  Megaphone,
  BarChart3,
  Building2,
  Award,
  Activity,
  Wifi,
  WifiOff,
  Clock
} from 'lucide-react';
import './Layout.css';

export function Layout() {
  const { signOut, admin, token, inactivityCountdown, resetInactivityTimer } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [health, setHealth] = useState<SystemHealthResponse | null>(null);
  const [socketConnected, setSocketConnected] = useState<boolean>(adminSocket.connected);

  const location = useLocation();
  const navigate = useNavigate();

  // Monitoramento global em tempo real (SOS, chats, tickets) em todas as páginas
  const { incomingSosAlert } = useAdminSocket(admin?.id, token || undefined);
  const [dismissedSosId, setDismissedSosId] = useState<string | null>(null);

  const role = admin?.role || 'OPERATOR';
  const canAccessFinance = ['SUPER_ADMIN', 'ADMIN', 'FINANCE'].includes(role);
  const canAccessSystemAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(role);

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  }, []);

  // Monitoramento ao vivo da conexão WebSocket e Deep Healthcheck (/health)
  useEffect(() => {
    const onConnect = () => setSocketConnected(true);
    const onDisconnect = () => setSocketConnected(false);

    adminSocket.on('connect', onConnect);
    adminSocket.on('disconnect', onDisconnect);
    setSocketConnected(adminSocket.connected);

    let mounted = true;
    const checkHealth = async () => {
      try {
        const res = await getSystemHealth();
        if (mounted) setHealth(res);
      } catch {
        if (mounted) setHealth({ status: 'degraded' });
      }
    };

    checkHealth();
    const healthTimer = window.setInterval(checkHealth, 30000);

    return () => {
      mounted = false;
      adminSocket.off('connect', onConnect);
      adminSocket.off('disconnect', onDisconnect);
      window.clearInterval(healthTimer);
    };
  }, []);

  const handleInstallApp = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };

  const activeGlobalSos =
    incomingSosAlert &&
    incomingSosAlert.status === 'ACTIVE' &&
    incomingSosAlert.id !== dismissedSosId &&
    !location.pathname.startsWith('/sos');

  return (
    <div className="app-layout">
      {/* CABEÇALHO SUPERIOR FIXO (MOBILE) */}
      <header className="mobile-header">
        <button
          type="button"
          className="menu-toggle-btn"
          onClick={() => setIsMobileMenuOpen((prev) => !prev)}
          aria-label="Abrir Menu"
        >
          {isMobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>

        <div className="mobile-logo" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <img
            src="/logo-pwa.png"
            alt="Nô Bai 245"
            style={{ width: 26, height: 26, objectFit: 'contain' }}
          />
          <span><span className="logo-accent">NÔ BAI</span> 245</span>
        </div>

        {deferredPrompt ? (
          <button type="button" className="pwa-install-icon-btn" onClick={handleInstallApp} title="Instalar App">
            <Download size={18} />
            <span className="btn-text-mobile">App</span>
          </button>
        ) : (
          <div className="mobile-header-placeholder" />
        )}
      </header>

      {isMobileMenuOpen && (
        <div
          className="drawer-backdrop"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* MENU LATERAL */}
      <aside className={`sidebar-drawer ${isMobileMenuOpen ? 'drawer-open' : ''}`}>
        <div className="sidebar-brand-box">
          <div className="brand-logo-row">
            <div className="brand-icon" style={{ background: 'transparent', padding: 0 }}>
              <img
                src="/logo-pwa.png"
                alt="BAI 245"
                style={{ width: 32, height: 32, objectFit: 'contain' }}
              />
            </div>
            <div>
              <h1 className="brand-title">BAI 245</h1>
              <p className="brand-subtitle">PAINEL ADMINISTRATIVO</p>
            </div>
          </div>
          {admin?.role && <span className="admin-role-pill">{admin.role}</span>}

          {/* INDICADORES DE TELEMETRIA AO VIVO (API/DB + SOCKET) */}
          <div
            style={{
              marginTop: '10px',
              display: 'flex',
              gap: '6px',
              flexWrap: 'wrap'
            }}
          >
            <span
              title="Status do Servidor, PostgreSQL e Redis"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '10px',
                fontWeight: 700,
                padding: '3px 7px',
                borderRadius: '4px',
                backgroundColor: health?.status === 'ok' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.18)',
                color: health?.status === 'ok' ? '#34d399' : '#fbbf24',
                border: `1px solid ${health?.status === 'ok' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(245, 158, 11, 0.35)'}`
              }}
            >
              <Activity size={11} />
              {health?.status === 'ok' ? 'CORE: ONLINE' : 'CORE: VERIFICANDO'}
            </span>

            <span
              title="Conexão em tempo real WebSocket"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '10px',
                fontWeight: 700,
                padding: '3px 7px',
                borderRadius: '4px',
                backgroundColor: socketConnected ? 'rgba(14, 165, 233, 0.15)' : 'rgba(239, 68, 68, 0.18)',
                color: socketConnected ? '#38bdf8' : '#f87171',
                border: `1px solid ${socketConnected ? 'rgba(14, 165, 233, 0.3)' : 'rgba(239, 68, 68, 0.35)'}`
              }}
            >
              {socketConnected ? <Wifi size={11} /> : <WifiOff size={11} />}
              {socketConnected ? 'LIVE: ATIVO' : 'LIVE: OFF'}
            </span>
          </div>
        </div>

        <nav className="sidebar-menu">
          <div className="menu-category">
            <span className="category-label">OPERACIONAL</span>
            <NavLink to="/" end className={({ isActive }) => `menu-link ${isActive ? 'active' : ''}`}>
              <LayoutDashboard size={18} />
              <span>Centro de Comando</span>
            </NavLink>
            <NavLink to="/radar" className={({ isActive }) => `menu-link ${isActive ? 'active' : ''}`}>
              <Radio size={18} />
              <span>Radar & Mapa Ao Vivo</span>
              <span className="pill-badge pill-live">LIVE</span>
            </NavLink>
            <NavLink to="/rides" className={({ isActive }) => `menu-link ${isActive ? 'active' : ''}`}>
              <Car size={18} />
              <span>Gestão de Corridas</span>
            </NavLink>
            <NavLink to="/landmarks" className={({ isActive }) => `menu-link ${isActive ? 'active' : ''}`}>
              <MapPin size={18} />
              <span>Bairros & Pontos</span>
            </NavLink>
            <NavLink to="/analytics" className={({ isActive }) => `menu-link ${isActive ? 'active' : ''}`}>
              <BarChart3 size={18} />
              <span>Inteligência & BI</span>
            </NavLink>
            <NavLink to="/sos" className={({ isActive }) => `menu-link ${isActive ? 'active' : ''}`}>
              <ShieldAlert size={18} />
              <span>Alertas SOS</span>
              <span className="pill-badge pill-sos">SOS</span>
            </NavLink>
          </div>

          <div className="menu-category">
            <span className="category-label">GESTÃO DE USUÁRIOS</span>
            <NavLink to="/driver-requests" className={({ isActive }) => `menu-link ${isActive ? 'active' : ''}`}>
              <UserCheck size={18} />
              <span>Solicitações de Motorista</span>
            </NavLink>
            <NavLink to="/drivers" className={({ isActive }) => `menu-link ${isActive ? 'active' : ''}`}>
              <Users size={18} />
              <span>Frota de Motoristas</span>
            </NavLink>
            <NavLink to="/passengers" className={({ isActive }) => `menu-link ${isActive ? 'active' : ''}`}>
              <UserX size={18} />
              <span>Base de Passageiros</span>
            </NavLink>
            {canAccessFinance && (
              <NavLink to="/corporate" className={({ isActive }) => `menu-link ${isActive ? 'active' : ''}`}>
                <Building2 size={18} />
                <span>Corporativo & Frotas</span>
              </NavLink>
            )}
            {canAccessSystemAdmin && (
              <NavLink to="/admins" className={({ isActive }) => `menu-link ${isActive ? 'active' : ''}`}>
                <UserCog size={18} />
                <span>Gestão da Equipe</span>
              </NavLink>
            )}
          </div>

          <div className="menu-category">
            <span className="category-label">FINANCEIRO & SUPORTE</span>
            {canAccessFinance && (
              <NavLink to="/financial" className={({ isActive }) => `menu-link ${isActive ? 'active' : ''}`}>
                <DollarSign size={18} />
                <span>Financeiro & Repasses</span>
              </NavLink>
            )}
            <NavLink to="/tickets" className={({ isActive }) => `menu-link ${isActive ? 'active' : ''}`}>
              <Ticket size={18} />
              <span>Chamados de Suporte</span>
            </NavLink>
            <NavLink to="/ratings" className={({ isActive }) => `menu-link ${isActive ? 'active' : ''}`}>
              <Star size={18} />
              <span>Avaliações & Feedbacks</span>
            </NavLink>
            <NavLink to="/promos" className={({ isActive }) => `menu-link ${isActive ? 'active' : ''}`}>
              <Tag size={18} />
              <span>Cupons & Campanhas</span>
            </NavLink>
            <NavLink to="/broadcast" className={({ isActive }) => `menu-link ${isActive ? 'active' : ''}`}>
              <Megaphone size={18} />
              <span>Comunicados & Push</span>
            </NavLink>
            {canAccessFinance && (
              <NavLink to="/governance" className={({ isActive }) => `menu-link ${isActive ? 'active' : ''}`}>
                <Award size={18} />
                <span>Antifraude, Zonas & DRE</span>
              </NavLink>
            )}
            {canAccessSystemAdmin && (
              <NavLink to="/settings" className={({ isActive }) => `menu-link ${isActive ? 'active' : ''}`}>
                <Settings size={18} />
                <span>Configurações Globais</span>
              </NavLink>
            )}
          </div>
        </nav>

        {deferredPrompt && (
          <div className="pwa-drawer-box">
            <button type="button" onClick={handleInstallApp} className="pwa-install-btn">
              <Download size={16} />
              <span>Instalar App no Telemóvel</span>
            </button>
          </div>
        )}

        <div className="sidebar-footer">
          <button type="button" onClick={() => signOut('manual')} className="logout-btn">
            <LogOut size={18} />
            <span>Encerrar Sessão</span>
          </button>
        </div>
      </aside>

      {/* ÁREA PRINCIPAL DO CONTEÚDO */}
      <main className="main-content-wrapper">
        {/* AVISO DE BLOQUEIO POR INATIVIDADE (PADRÃO BANCÁRIO) */}
        {inactivityCountdown !== null && (
          <div
            role="alert"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              flexWrap: 'wrap',
              backgroundColor: '#fef3c7',
              border: '1px solid #f59e0b',
              color: '#92400e',
              padding: '12px 16px',
              borderRadius: '10px',
              marginBottom: '16px',
              fontSize: '13px',
              fontWeight: 600
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Clock size={18} />
              <span>
                Sessão será bloqueada automaticamente por inatividade em <strong>{inactivityCountdown}s</strong>.
              </span>
            </div>
            <button
              type="button"
              onClick={resetInactivityTimer}
              style={{
                backgroundColor: '#d97706',
                color: '#ffffff',
                border: 'none',
                borderRadius: '6px',
                padding: '6px 14px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              Continuar Conectado
            </button>
          </div>
        )}

        {/* BANNER GLOBAL DE ALERTA SOS EM TEMPO REAL */}
        {activeGlobalSos && incomingSosAlert && (
          <div
            role="alert"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              flexWrap: 'wrap',
              backgroundColor: '#dc2626',
              color: '#ffffff',
              padding: '14px 18px',
              borderRadius: '10px',
              marginBottom: '18px',
              boxShadow: '0 8px 20px rgba(220, 38, 38, 0.35)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <ShieldAlert size={22} />
              <div>
                <div style={{ fontWeight: 800, fontSize: '14px' }}>
                  ALERTA SOS ATIVO — {incomingSosAlert.userType === 'DRIVER' ? 'MOTORISTA' : 'PASSAGEIRO'}
                </div>
                <div style={{ fontSize: '12px', opacity: 0.95 }}>
                  {incomingSosAlert.driver?.fullName || incomingSosAlert.passenger?.fullName || 'Usuário em emergência'} •{' '}
                  {incomingSosAlert.driver?.phone || incomingSosAlert.passenger?.phone || 'Sem telefone'}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                type="button"
                onClick={() => navigate('/sos')}
                style={{
                  backgroundColor: '#ffffff',
                  color: '#dc2626',
                  border: 'none',
                  borderRadius: '7px',
                  padding: '8px 14px',
                  fontSize: '12px',
                  fontWeight: 800,
                  cursor: 'pointer'
                }}
              >
                Abrir Central SOS
              </button>
              <button
                type="button"
                onClick={() => setDismissedSosId(incomingSosAlert.id)}
                style={{
                  backgroundColor: 'rgba(0,0,0,0.2)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '7px',
                  padding: '8px 10px',
                  fontSize: '12px',
                  cursor: 'pointer'
                }}
              >
                Ocultar
              </button>
            </div>
          </div>
        )}

        <Outlet />
      </main>
    </div>
  );
}

