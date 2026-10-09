import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  LayoutDashboard,
  Radio,
  Car,
  ShieldAlert,
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
  Download
} from 'lucide-react';
import './Layout.css';

export function Layout() {
  const { signOut, admin } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const location = useLocation();

  // Fecha o menu ao mudar de página
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  // Captura o evento nativo de instalação PWA
  useEffect(() => {
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  }, []);

  const handleInstallApp = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };

  return (
    <div className="layout-root">
      {/* CABEÇALHO SUPERIOR EXCLUSIVO PARA TELEMÓVEIS */}
      <header className="mobile-navbar">
        <button
          className="mobile-toggle-btn"
          onClick={() => setIsMobileMenuOpen((prev) => !prev)}
          aria-label="Alternar Menu"
        >
          {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
        <span className="mobile-brand-title">BAI 245 Admin</span>
        
        {deferredPrompt && (
          <button className="mobile-install-btn" onClick={handleInstallApp} title="Baixar Aplicativo">
            <Download size={18} />
          </button>
        )}
      </header>

      {/* BACKDROP PARA FECHAR O MENU AO CLICAR FORA */}
      {isMobileMenuOpen && (
        <div
          className="sidebar-overlay"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* BARRA LATERAL (SIDEBAR RESPONSIVA) */}
      <aside className={`sidebar-container ${isMobileMenuOpen ? 'open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <h2>BAI 245</h2>
            <p>PAINEL ADMINISTRATIVO</p>
          </div>
          {admin?.role && <span className="admin-badge">{admin.role}</span>}
        </div>

        <nav className="sidebar-nav">
          <div className="nav-group">
            <span className="group-title">OPERACIONAL</span>
            <NavLink to="/" end className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <LayoutDashboard size={18} />
              <span>Centro de Comando</span>
            </NavLink>
            <NavLink to="/radar" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <Radio size={18} />
              <span>Radar & Mapa Ao Vivo</span>
              <span className="badge-live">LIVE</span>
            </NavLink>
            <NavLink to="/rides" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <Car size={18} />
              <span>Gestão de Corridas</span>
            </NavLink>
            <NavLink to="/sos" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <ShieldAlert size={18} />
              <span>Alertas SOS</span>
              <span className="badge-sos">SOS</span>
            </NavLink>
          </div>

          <div className="nav-group">
            <span className="group-title">GESTÃO DE USUÁRIOS</span>
            <NavLink to="/driver-requests" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <UserCheck size={18} />
              <span>Solicitações de Motorista</span>
            </NavLink>
            <NavLink to="/drivers" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <Users size={18} />
              <span>Frota de Motoristas</span>
            </NavLink>
            <NavLink to="/passengers" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <UserX size={18} />
              <span>Base de Passageiros</span>
            </NavLink>
            <NavLink to="/admins" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <UserCog size={18} />
              <span>Gestão da Equipe</span>
            </NavLink>
          </div>

          <div className="nav-group">
            <span className="group-title">FINANCEIRO & SUPORTE</span>
            <NavLink to="/financial" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <DollarSign size={18} />
              <span>Financeiro & Repasses</span>
            </NavLink>
            <NavLink to="/tickets" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <Ticket size={18} />
              <span>Chamados de Suporte</span>
            </NavLink>
            <NavLink to="/ratings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <Star size={18} />
              <span>Avaliações & Feedbacks</span>
            </NavLink>
            <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <Settings size={18} />
              <span>Configurações Globais</span>
            </NavLink>
          </div>
        </nav>

        {deferredPrompt && (
          <div className="pwa-install-banner">
            <button onClick={handleInstallApp} className="pwa-btn">
              <Download size={16} />
              <span>Baixar App no Telemóvel</span>
            </button>
          </div>
        )}

        <div className="sidebar-footer">
          <button onClick={signOut} className="btn-logout">
            <LogOut size={18} />
            <span>Encerrar Sessão</span>
          </button>
        </div>
      </aside>

      {/* ÁREA PRINCIPAL DO CONTEÚDO */}
      <main className="main-viewport">
        <Outlet />
      </main>
    </div>
  );
}