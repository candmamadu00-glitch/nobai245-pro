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
  Download,
  Shield
} from 'lucide-react';
import './Layout.css';

export function Layout() {
  const { signOut, admin } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const location = useLocation();

  // Fecha o menu lateral automaticamente ao navegar para outra página
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  // Captura o evento nativo para instalação como Aplicativo (PWA)
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
    <div className="app-layout">
      {/* 📱 CABEÇALHO SUPERIOR FIXO (EXCLUSIVO PARA TELEMÓVEIS) */}
      <header className="mobile-header">
        <button
          type="button"
          className="menu-toggle-btn"
          onClick={() => setIsMobileMenuOpen((prev) => !prev)}
          aria-label="Abrir Menu"
        >
          {isMobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>

        <div className="mobile-logo">
          <span className="logo-accent">NÔ BAI</span> 245
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

      {/* 🌑 OVERLAY/MÁSCARA ESCURA PARA FECHAR O MENU AO TOCAR FORA */}
      {isMobileMenuOpen && (
        <div
          className="drawer-backdrop"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* 🚪 MENU LATERAL (SLIDE-OVER DRAWER DARK MODE) */}
      <aside className={`sidebar-drawer ${isMobileMenuOpen ? 'drawer-open' : ''}`}>
        <div className="sidebar-brand-box">
          <div className="brand-logo-row">
            <div className="brand-icon">
              <Shield size={20} />
            </div>
            <div>
              <h1 className="brand-title">BAI 245</h1>
              <p className="brand-subtitle">PAINEL ADMINISTRATIVO</p>
            </div>
          </div>
          {admin?.role && <span className="admin-role-pill">{admin.role}</span>}
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
            <NavLink to="/admins" className={({ isActive }) => `menu-link ${isActive ? 'active' : ''}`}>
              <UserCog size={18} />
              <span>Gestão da Equipe</span>
            </NavLink>
          </div>

          <div className="menu-category">
            <span className="category-label">FINANCEIRO & SUPORTE</span>
            <NavLink to="/financial" className={({ isActive }) => `menu-link ${isActive ? 'active' : ''}`}>
              <DollarSign size={18} />
              <span>Financeiro & Repasses</span>
            </NavLink>
            <NavLink to="/tickets" className={({ isActive }) => `menu-link ${isActive ? 'active' : ''}`}>
              <Ticket size={18} />
              <span>Chamados de Suporte</span>
            </NavLink>
            <NavLink to="/ratings" className={({ isActive }) => `menu-link ${isActive ? 'active' : ''}`}>
              <Star size={18} />
              <span>Avaliações & Feedbacks</span>
            </NavLink>
            <NavLink to="/settings" className={({ isActive }) => `menu-link ${isActive ? 'active' : ''}`}>
              <Settings size={18} />
              <span>Configurações Globais</span>
            </NavLink>
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
          <button type="button" onClick={signOut} className="logout-btn">
            <LogOut size={18} />
            <span>Encerrar Sessão</span>
          </button>
        </div>
      </aside>

      {/* 🖥️ ÁREA PRINCIPAL DO CONTEÚDO */}
      <main className="main-content-wrapper">
        <Outlet />
      </main>
    </div>
  );
}