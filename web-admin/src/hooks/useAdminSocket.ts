import { useEffect, useState } from 'react';
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

export function useAdminSocket(adminId?: string, token?: string) {
  const [liveChats, setLiveChats] = useState<MonitoredChatMessage[]>([]);
  const [liveCalls, setLiveCalls] = useState<MonitoredCallLog[]>([]);
  const [sharedTrips, setSharedTrips] = useState<SharedTripAlert[]>([]);
  const [ticketMessages, setTicketMessages] = useState<TicketSocketMessage[]>([]);
  const [incomingSosAlert, setIncomingSosAlert] = useState<SosAlertPayload | null>(null);

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
    };

    const handleTicketMessage = (messageData: TicketSocketMessage) => {
      setTicketMessages((prev) => [...prev, messageData]);
    };

    const handleSosAlert = (sosData: SosAlertPayload) => {
      setIncomingSosAlert(sosData);
    };

    adminSocket.on('admin:chat_monitored', handleChat);
    adminSocket.on('admin:call_monitored', handleCall);
    adminSocket.on('admin:trip_shared_alert', handleSharedTrip);
    adminSocket.on('ticket:receive_message', handleTicketMessage);
    adminSocket.on('admin:sos_triggered', handleSosAlert);

    return () => {
      adminSocket.off('admin:chat_monitored', handleChat);
      adminSocket.off('admin:call_monitored', handleCall);
      adminSocket.off('admin:trip_shared_alert', handleSharedTrip);
      adminSocket.off('ticket:receive_message', handleTicketMessage);
      adminSocket.off('admin:sos_triggered', handleSosAlert);
    };
  }, [adminId, token]);

  return { liveChats, liveCalls, sharedTrips, ticketMessages, incomingSosAlert };
}