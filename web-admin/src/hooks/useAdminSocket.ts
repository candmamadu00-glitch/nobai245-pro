import { useEffect, useState, useCallback } from 'react';
import { adminSocket, connectAdminSocket } from '../services/adminSocket';

export interface SosAlertPayload {
  id: string;
  rideId?: string;
  userType: 'PASSENGER' | 'DRIVER';
  passengerId?: string;
  driverId?: string;
  lat: number;
  lng: number;
  status: 'ACTIVE' | 'RESOLVED' | 'FALSE_ALARM';
  audioUrl?: string;
  createdAt: string;
  passenger?: { fullName: string; phone: string };
  driver?: { fullName: string; phone: string; vehiclePlate?: string };
}

export interface MonitoredChatMessage {
  id: string;
  rideId: string;
  senderId: string;
  senderType: 'PASSENGER' | 'DRIVER';
  message: string;
  createdAt: string;
}

export interface MonitoredCallLog {
  id: string;
  rideId: string;
  callerId: string;
  callerType: 'PASSENGER' | 'DRIVER';
  receiverId: string;
  createdAt: string;
}

export interface SharedTripAlert {
  rideId: string;
  shareUrl: string;
}

export interface TicketSocketMessage {
  id: string;
  ticketId: string;
  sender: 'ADMIN' | 'PASSENGER' | 'DRIVER';
  message: string;
  createdAt: string;
}

export interface AdminNotificationItem {
  id: string;
  category: 'SOS' | 'DRIVER_REGISTER' | 'DRIVER_CHANGE' | 'PASSENGER_REGISTER' | 'TICKET' | 'FINANCE' | 'RIDE' | 'RATING';
  title: string;
  message: string;
  route: string;
  severity: 'critical' | 'warning' | 'success' | 'info';
  createdAt: string;
  read: boolean;
}

const STORAGE_KEY = 'nobai245_admin_notifications_v1';
const SOUND_MUTE_KEY = 'nobai245_admin_sound_muted';

function playAdminNotificationTone(isUrgent = false) {
  try {
    if (localStorage.getItem(SOUND_MUTE_KEY) === '1') return;
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = isUrgent ? 'sawtooth' : 'sine';
    osc.frequency.setValueAtTime(isUrgent ? 880 : 660, now);
    osc.frequency.exponentialRampToValueAtTime(isUrgent ? 1180 : 880, now + 0.16);

    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (isUrgent ? 0.45 : 0.28));

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + (isUrgent ? 0.46 : 0.3));
  } catch {
    // Ignora bloqueio antes da primeira interação
  }
}

function triggerBrowserPushNotification(title: string, body: string, route: string) {
  try {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission === 'granted') {
      const notif = new Notification(`Nô Bai 245 • ${title}`, {
        body,
        icon: '/logo-pwa.png',
        badge: '/logo-pwa.png',
        tag: `nobai-admin-${title}`,
      });
      notif.onclick = () => {
        window.focus();
        if (route) window.location.assign(route);
        notif.close();
      };
    }
  } catch {
    // Fallback silencioso
  }
}

export function useAdminSocket(adminId?: string, token?: string) {
  const [liveChats, setLiveChats] = useState<MonitoredChatMessage[]>([]);
  const [liveCalls, setLiveCalls] = useState<MonitoredCallLog[]>([]);
  const [sharedTrips, setSharedTrips] = useState<SharedTripAlert[]>([]);
  const [ticketMessages, setTicketMessages] = useState<TicketSocketMessage[]>([]);
  const [incomingSosAlert, setIncomingSosAlert] = useState<SosAlertPayload | null>(null);
  const [soundMuted, setSoundMuted] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SOUND_MUTE_KEY) === '1';
    } catch {
      return false;
    }
  });

  const [notifications, setNotifications] = useState<AdminNotificationItem[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const pushNotification = useCallback((item: Omit<AdminNotificationItem, 'read'>) => {
    setNotifications((prev) => {
      if (prev.some((n) => n.id === item.id)) return prev;
      const next: AdminNotificationItem[] = [{ ...item, read: false }, ...prev].slice(0, 60);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });

    playAdminNotificationTone(item.severity === 'critical');
    triggerBrowserPushNotification(item.title, item.message, item.route);
  }, []);

  const markNotificationAsRead = useCallback((id: string) => {
    setNotifications((prev) => {
      const next = prev.map((n) => (n.id === id ? { ...n, read: true } : n));
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const markAllNotificationsAsRead = useCallback(() => {
    setNotifications((prev) => {
      const next = prev.map((n) => ({ ...n, read: true }));
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
  }, []);

  const toggleSoundMute = useCallback(() => {
    setSoundMuted((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SOUND_MUTE_KEY, next ? '1' : '0');
      } catch {}
      return next;
    });
  }, []);

  useEffect(() => {
    if (!adminId || !token) return;

    connectAdminSocket(adminId, token);

    const handleChat = (chatData: MonitoredChatMessage) => {
      setLiveChats((prev) => [chatData, ...prev]);
    };

    const handleCall = (callData: MonitoredCallLog) => {
      setLiveCalls((prev) => [callData, ...prev]);
    };

    const handleSharedTrip = (tripData: SharedTripAlert) => {
      setSharedTrips((prev) => [tripData, ...prev]);
      pushNotification({
        id: `share-${tripData.rideId}-${Date.now()}`,
        category: 'RIDE',
        title: 'Corrida Compartilhada ao Vivo',
        message: `Passageiro compartilhou o link de rastreio da corrida #${String(tripData.rideId).slice(0, 8)}.`,
        route: '/rides',
        severity: 'info',
        createdAt: new Date().toISOString(),
      });
    };

    const handleTicketMessage = (messageData: TicketSocketMessage) => {
      setTicketMessages((prev) => [...prev, messageData]);
      if (messageData.sender !== 'ADMIN') {
        pushNotification({
          id: `tkt-msg-${messageData.id || Date.now()}`,
          category: 'TICKET',
          title: 'Nova Mensagem no Suporte',
          message: `${messageData.sender === 'DRIVER' ? 'Motorista' : 'Passageiro'}: ${messageData.message.slice(0, 70)}`,
          route: '/tickets',
          severity: 'warning',
          createdAt: messageData.createdAt || new Date().toISOString(),
        });
      }
    };

    const handleTicketAlert = (data: any) => {
      pushNotification({
        id: `tkt-new-${data?.ticketId || Date.now()}`,
        category: 'TICKET',
        title: 'Novo Chamado de Suporte',
        message: data?.message || 'Um usuário abriu um novo ticket de atendimento.',
        route: '/tickets',
        severity: 'warning',
        createdAt: new Date().toISOString(),
      });
    };

    const handlePayoutAlert = (data: any) => {
      pushNotification({
        id: `pay-${data?.transactionId || data?.rideId || Date.now()}`,
        category: 'FINANCE',
        title: 'Alerta Financeiro / Repasse',
        message: data?.reason || `Movimentação de ${data?.amount || 0} XOF registrada no financeiro.`,
        route: '/financial',
        severity: 'warning',
        createdAt: new Date().toISOString(),
      });
    };

    const handleRideUpdate = (data: any) => {
      if (data?.status === 'CANCELLED') {
        pushNotification({
          id: `ride-canc-${data?.rideId || Date.now()}`,
          category: 'RIDE',
          title: 'Corrida Cancelada',
          message: `A corrida #${String(data?.rideId || '').slice(0, 8)} foi cancelada.`,
          route: '/rides',
          severity: 'warning',
          createdAt: new Date().toISOString(),
        });
      }
    };

    const handleActivityNotification = (data: any) => {
      if (!data) return;
      pushNotification({
        id: String(data.id || `act-${Date.now()}`),
        category: data.category || 'RIDE',
        title: String(data.title || 'Nova Atividade no Sistema'),
        message: String(data.message || 'Atualização recebida em tempo real.'),
        route: String(data.route || '/'),
        severity: data.severity || 'info',
        createdAt: data.createdAt || new Date().toISOString(),
      });
    };

    const handleSosAlert = (sosData: SosAlertPayload) => {
      setIncomingSosAlert(sosData);
      const actor = sosData?.userType === 'DRIVER' ? 'Motorista' : 'Passageiro';
      const name = sosData?.driver?.fullName || sosData?.passenger?.fullName || 'Usuário';
      pushNotification({
        id: `sos-${sosData?.id || (sosData as any)?.sosId || Date.now()}`,
        category: 'SOS',
        title: `EMERGÊNCIA SOS — ${actor.toUpperCase()}`,
        message: `${name} acionou o botão de pânico! Atendimento imediato necessário.`,
        route: '/sos',
        severity: 'critical',
        createdAt: sosData?.createdAt || new Date().toISOString(),
      });
    };

    adminSocket.on('admin:chat_monitored', handleChat);
    adminSocket.on('admin:call_monitored', handleCall);
    adminSocket.on('admin:trip_shared_alert', handleSharedTrip);
    adminSocket.on('ticket:receive_message', handleTicketMessage);
    adminSocket.on('admin:ticket_alert', handleTicketAlert);
    adminSocket.on('admin:payout_alert', handlePayoutAlert);
    adminSocket.on('admin:ride_update', handleRideUpdate);
    adminSocket.on('admin:activity_notification', handleActivityNotification);
    adminSocket.on('admin:sos_alert', handleSosAlert);
    adminSocket.on('admin:sos_triggered', handleSosAlert);

    return () => {
      adminSocket.off('admin:chat_monitored', handleChat);
      adminSocket.off('admin:call_monitored', handleCall);
      adminSocket.off('admin:trip_shared_alert', handleSharedTrip);
      adminSocket.off('ticket:receive_message', handleTicketMessage);
      adminSocket.off('admin:ticket_alert', handleTicketAlert);
      adminSocket.off('admin:payout_alert', handlePayoutAlert);
      adminSocket.off('admin:ride_update', handleRideUpdate);
      adminSocket.off('admin:activity_notification', handleActivityNotification);
      adminSocket.off('admin:sos_alert', handleSosAlert);
      adminSocket.off('admin:sos_triggered', handleSosAlert);
    };
  }, [adminId, token, pushNotification]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return {
    liveChats,
    liveCalls,
    sharedTrips,
    ticketMessages,
    incomingSosAlert,
    notifications,
    unreadCount,
    soundMuted,
    toggleSoundMute,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    clearNotifications,
  };
}
