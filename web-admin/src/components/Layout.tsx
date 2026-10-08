import React from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { 
  LayoutDashboard, 
  Users, 
  Car, 
  LogOut, 
  Wallet, 
  ShieldAlert, 
  MapPin, 
  Radio,
  UserCheck, 
  Star, 
  LifeBuoy,
  Settings,
  Bell,
  ShieldCheck,
  UserPlus
} from 'lucide-react';
import './Layout.css';

interface MenuItem {
  path: string;
  icon: React.ReactNode;
  label: string;
  badge?: string;
  badgeAlert?: boolean;
  roles: Array<'SUPER_ADMIN' | 'OPERATOR' | 'FINANCE'>;
}

interface MenuSection {
  title: string;
  items: MenuItem[];
}

export function Layout() {
  const { admin, signOut } = useAuth();
  const currentRole = (admin?.role || 'SUPER_ADMIN') as 'SUPER_ADMIN' | 'OPERATOR' | 'FINANCE';

  // Estrutura completa de Menus com Matriz de Permissões (RBAC)
  const menuSections: MenuSection[] = [
    {
      title: 'OPERACIONAL',
      items: [
        { 
          path: '/', 
          icon: <LayoutDashboard size={18} />, 
          label: 'Centro de Comando', 
          roles: ['SUPER_ADMIN', 'OPERATOR', 'FINANCE'] 
        },
        { 
          path: '/radar', 
          icon: <Radio size={18} />, 
          label: 'Radar & Mapa Ao Vivo', 
          badge: 'Live', 
          roles: ['SUPER_ADMIN', 'OPERATOR'] 
        },
        { 
          path: '/rides', 
          icon: <MapPin size={18} />, 
          label: 'Gestão de Corridas', 
          roles: ['SUPER_ADMIN', 'OPERATOR', 'FINANCE'] 
        },
        { 
          path: '/sos', 
          icon: <ShieldAlert size={18} />, 
          label: 'Alertas SOS', 
          badgeAlert: true, 
          roles: ['SUPER_ADMIN', 'OPERATOR'] 
        },
      ]
    },
    {
      title: 'GESTÃO DE USUÁRIOS',
      items: [
        { 
          path: '/driver-requests', 
          icon: <UserCheck size={18} />, 
          label: 'Solicitações de Motorista', 
          roles: ['SUPER_ADMIN', 'OPERATOR'] 
        },
        { 
          path: '/drivers', 
          icon: <Car size={18} />, 
          label: 'Frota de Motoristas', 
          roles: ['SUPER_ADMIN', 'OPERATOR', 'FINANCE'] 
        },
        { 
          path: '/passengers', 
          icon: <Users size={18} />, 
          label: 'Base de Passageiros', 
          roles: ['SUPER_ADMIN', 'OPERATOR', 'FINANCE'] 
        },
        { 
          path: '/admins', 
          icon: <UserPlus size={18} />, 
          label: 'Gestão da Equipe', 
          roles: ['SUPER_ADMIN'] 
        },
      ]
    },
    {
      title: 'FINANCEIRO & SUPORTE',
      items: [
        { 
          path: '/finance', 
          icon: <Wallet size={18} />, 
          label: 'Balanço Financeiro', 
          roles: ['SUPER_ADMIN', 'FINANCE'] 
        },
        { 
          path: '/ratings', 
          icon: <Star size={18} />, 
          label: 'Avaliações & Notas', 
          roles: ['SUPER_ADMIN', 'OPERATOR', 'FINANCE'] 
        },
        { 
          path: '/tickets', 
          icon: <LifeBuoy size={18} />, 
          label: 'Central de Suporte', 
          roles: ['SUPER_ADMIN', 'OPERATOR'] 
        },
        { 
          path: '/settings', 
          icon: <Settings size={18} />, 
          label: 'Configurações', 
          roles: ['SUPER_ADMIN'] 
        },
      ]
    }
  ];

  // Filtra itens e seções conforme o perfil do usuário logado
  const filteredSections = menuSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => item.roles.includes(currentRole))
    }))
    .filter((section) => section.items.length > 0);

  return (
    <div className="app-layout">
      {/* Sidebar de Navegação */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <div className="logo-box">
            <h2>BAI 245</h2>
            <span className="sub-logo">PAINEL ADMINISTRATIVO</span>
          </div>
          <span className="admin-badge">
            <ShieldCheck size={12} />
            {currentRole.replace('_', ' ')}
          </span>
        </div>

        <nav className="sidebar-nav">
          {filteredSections.map((section, idx) => (
            <div key={idx} className="nav-section">
              <span className="section-title">{section.title}</span>
              {section.items.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.path === '/'}
                  className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                >
                  <span className="nav-icon">{item.icon}</span>
                  <span className="nav-label">{item.label}</span>
                  {item.badge && <span className="nav-badge-live">{item.badge}</span>}
                  {item.badgeAlert && <span className="nav-badge-sos">SOS</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button onClick={signOut} className="btn-logout">
            <LogOut size={18} />
            <span>Encerrar Sessão</span>
          </button>
        </div>
      </aside>

      {/* Área Principal das Abas */}
      <div className="main-wrapper">
        <header className="top-header">
          <div className="header-left">
            <span className="system-status">
              <span className="status-dot animate-pulse"></span>
              Sistema Operacional (+245)
            </span>
          </div>

          <div className="header-right">
            <button className="icon-button" title="Notificações">
              <Bell size={18} />
            </button>
            <div className="user-profile">
              <div className="avatar-circle">
                {admin?.name?.charAt(0).toUpperCase() || 'A'}
              </div>
              <div className="user-info">
                <span className="user-name">{admin?.name || 'Administrador'}</span>
                <span className="user-email">{admin?.email || 'admin@bai245.com'}</span>
              </div>
            </div>
          </div>
        </header>

        <main className="page-content">
          <Outlet /> 
        </main>
      </div>
    </div>
  );
}