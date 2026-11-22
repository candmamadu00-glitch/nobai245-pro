import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  BellRing,
  CheckCheck,
  Trash2,
  ShieldAlert,
  UserCheck,
  UserPlus,
  Ticket,
  DollarSign,
  Car,
  Star,
  Volume2,
  VolumeX,
  ExternalLink,
} from 'lucide-react';
import type { AdminNotificationItem } from '../hooks/useAdminSocket';

interface AdminNotificationCenterProps {
  notifications: AdminNotificationItem[];
  unreadCount: number;
  soundMuted: boolean;
  onToggleMute: () => void;
  onMarkRead: (id: string) => void;
  onMarkAllRead: () => void;
  onClearAll: () => void;
}

export function AdminNotificationCenter({
  notifications,
  unreadCount,
  soundMuted,
  onToggleMute,
  onMarkRead,
  onMarkAllRead,
  onClearAll,
}: AdminNotificationCenterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [pushPermission, setPushPermission] = useState<NotificationPermission | 'unsupported'>(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    return Notification.permission;
  });

  const panelRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleEnableBrowserPush = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) {
      alert('Este navegador não suporta notificações Push.');
      return;
    }
    const perm = await Notification.requestPermission();
    setPushPermission(perm);
    if (perm === 'granted') {
      new Notification('Nô Bai 245 Admin • Push Ativado ✅', {
        body: 'Você receberá alertas em tempo real sempre que motoristas ou passageiros solicitarem ações.',
        icon: '/logo-pwa.png',
      });
    }
  };

  const getCategoryVisual = (category: AdminNotificationItem['category']) => {
    switch (category) {
      case 'SOS':
        return { icon: <ShieldAlert size={16} />, bg: '#FEE2E2', color: '#DC2626' };
      case 'DRIVER_REGISTER':
      case 'DRIVER_CHANGE':
        return { icon: <UserCheck size={16} />, bg: '#FEF3C7', color: '#D97706' };
      case 'PASSENGER_REGISTER':
        return { icon: <UserPlus size={16} />, bg: '#E0F2FE', color: '#0284C7' };
      case 'TICKET':
        return { icon: <Ticket size={16} />, bg: '#EDE9FE', color: '#7C3AED' };
      case 'FINANCE':
        return { icon: <DollarSign size={16} />, bg: '#DCFCE7', color: '#059669' };
      case 'RATING':
        return { icon: <Star size={16} />, bg: '#FEF9C3', color: '#CA8A04' };
      default:
        return { icon: <Car size={16} />, bg: '#F1F5F9', color: '#334155' };
    }
  };

  return (
    <div className="admin-notif-wrapper" ref={panelRef}>
      {pushPermission === 'default' && (
        <button
          type="button"
          onClick={handleEnableBrowserPush}
          className="enable-push-pill"
          title="Ativar notificações Push no navegador e celular"
        >
          <BellRing size={14} />
          <span className="hide-xs">Ativar Push</span>
        </button>
      )}

      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`notif-bell-btn ${unreadCount > 0 ? 'has-unread' : ''}`}
        aria-label="Central de Notificações"
        title="Central de Notificações em Tempo Real"
      >
        <Bell size={19} />
        {unreadCount > 0 && (
          <span className="notif-badge-count">{unreadCount > 99 ? '99+' : unreadCount}</span>
        )}
      </button>

      {isOpen && (
        <div className="notif-dropdown-panel">
          <div className="notif-dropdown-header">
            <div>
              <strong>Central de Notificações</strong>
              <span className="notif-sub-count">
                {unreadCount > 0 ? `${unreadCount} não lida(s)` : 'Tudo em dia'}
              </span>
            </div>

            <div className="notif-header-actions">
              <button
                type="button"
                onClick={onToggleMute}
                className="notif-icon-action"
                title={soundMuted ? 'Ativar alerta sonoro' : 'Silenciar alerta sonoro'}
              >
                {soundMuted ? <VolumeX size={15} /> : <Volume2 size={15} />}
              </button>
              {notifications.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={onMarkAllRead}
                    className="notif-icon-action"
                    title="Marcar todas como lidas"
                  >
                    <CheckCheck size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={onClearAll}
                    className="notif-icon-action danger"
                    title="Limpar histórico"
                  >
                    <Trash2 size={15} />
                  </button>
                </>
              )}
            </div>
          </div>

          {pushPermission !== 'granted' && pushPermission !== 'unsupported' && (
            <div className="notif-push-banner">
              <span>Receba alertas Push mesmo com a aba minimizada:</span>
              <button type="button" onClick={handleEnableBrowserPush}>
                Permitir Push
              </button>
            </div>
          )}

          <div className="notif-list-scroll">
            {notifications.length === 0 ? (
              <div className="notif-empty-state">
                <Bell size={28} />
                <p>Nenhuma notificação recente.</p>
                <small>
                  Cadastros, alterações de motoristas, tickets, recargas e SOS aparecerão aqui instantaneamente.
                </small>
              </div>
            ) : (
              notifications.map((item) => {
                const vis = getCategoryVisual(item.category);
                return (
                  <div
                    key={item.id}
                    className={`notif-item-row ${!item.read ? 'unread' : ''} severity-${item.severity}`}
                    onClick={() => {
                      onMarkRead(item.id);
                      setIsOpen(false);
                      if (item.route) navigate(item.route);
                    }}
                  >
                    <div
                      className="notif-cat-icon"
                      style={{ backgroundColor: vis.bg, color: vis.color }}
                    >
                      {vis.icon}
                    </div>
                    <div className="notif-item-body">
                      <div className="notif-item-top">
                        <strong>{item.title}</strong>
                        <span className="notif-time">
                          {new Date(item.createdAt).toLocaleTimeString('pt-BR', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <p>{item.message}</p>
                      <span className="notif-link-hint">
                        Abrir aba <ExternalLink size={11} />
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
