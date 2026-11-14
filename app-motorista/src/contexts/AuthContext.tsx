import React, { createContext, useState, useContext, useEffect, useCallback, useMemo, useRef, ReactNode } from 'react';
import { Platform, Alert, Vibration } from 'react-native';
import * as Device from 'expo-device';
import { api, setUnauthorizedHandler } from '../services/api';
import { socket, connectDriverSocket, disconnectDriverSocket } from '../services/socket';
import { registerAndSendPushToken } from '../services/notifications';
import { storage } from '../services/storage';

export type Driver = {
  id: string;
  fullName: string;
  phone: string;
  status: 'PENDING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'SUSPENDED' | 'INACTIVE' | 'BANNED';
  vehiclePlate: string;
  profilePicture?: string | null;
  kycVerified?: boolean;
  walletBalance?: number;
};

type AuthContextData = {
  driver: Driver | null;
  loading: boolean;
  deviceId: string;
  signIn: (driverData: Driver, accessToken: string, refreshToken: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshDriverProfile: () => Promise<void>;
};

interface ApiError {
  response?: {
    status?: number;
  };
}

const AuthContext = createContext<AuthContextData>({} as AuthContextData);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [driver, setDriver] = useState<Driver | null>(null);
  const [loading, setLoading] = useState(true);

  const deviceId = useMemo(() => `${Device.brand || 'Device'}-${Device.modelName || 'Hardware'}-${Device.osInternalBuildId || Platform.OS}`, []);

  useEffect(() => {
    setUnauthorizedHandler(() => signOut());

    async function loadStorageData() {
      try {
        const storedDriver = await storage.getDriver();
        const storedToken = await storage.getAccessToken();

        if (storedDriver && storedToken) {
          api.defaults.headers.common['Authorization'] = `Bearer ${storedToken}`;
          setDriver(storedDriver);

          await connectDriverSocket();
          refreshDriverProfile().catch(console.warn);

          registerAndSendPushToken(deviceId).catch(console.warn);
        }
      } catch (e) {
        console.error('❌ [AUTH MOTORISTA] Erro ao carregar sessão:', e);
      } finally {
        setLoading(false);
      }
    }
    loadStorageData();
  }, []);

  const lastWalletEventRef = useRef<string>('');

  const refreshDriverProfile = useCallback(async () => {
    try {
      const response = await api.get('/drivers/profile', {
        headers: { 'x-device-id': deviceId },
      });
      const updatedDriver = response.data?.driver || response.data;
      
      if (updatedDriver) {
        setDriver(updatedDriver);
        await storage.setDriver(updatedDriver);
      }
    } catch (error: unknown) {
      const err = error as ApiError;
      if (err.response && (err.response.status === 401 || err.response.status === 403)) {
        await signOut();
      }
    }
  }, [deviceId]);

  useEffect(() => {
    if (!socket || !driver?.id) return;

    const handleRealtimeWalletUpdate = (data: any) => {
      if (data?.driverId && String(data.driverId) !== String(driver.id)) return;

      const sig = `${data?.walletBalance ?? ''}-${data?.amount ?? ''}-${data?.source ?? ''}`;
      if (lastWalletEventRef.current === sig) return;
      lastWalletEventRef.current = sig;
      setTimeout(() => {
        if (lastWalletEventRef.current === sig) lastWalletEventRef.current = '';
      }, 3500);

      if (typeof data?.walletBalance === 'number') {
        setDriver((prev) => {
          if (!prev) return prev;
          const updated = { ...prev, walletBalance: Number(data.walletBalance) };
          storage.setDriver(updated).catch(() => {});
          return updated;
        });
      }

      refreshDriverProfile().catch(() => {});

      if (data?.source === 'ADMIN_RECHARGE' || data?.message) {
        try { Vibration.vibrate([0, 250, 120, 250]); } catch {}
        Alert.alert(
          '💰 Recarga Administrativa',
          data?.message || 'O saldo da sua carteira foi atualizado pela administração.'
        );
      }
    };

    socket.on('wallet:updated', handleRealtimeWalletUpdate);
    return () => {
      socket.off('wallet:updated', handleRealtimeWalletUpdate);
    };
  }, [driver?.id, refreshDriverProfile]);

  async function signIn(driverData: Driver, accessToken: string, refreshToken: string) {
    setDriver(driverData);
    api.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`;

    await storage.setAuthData(driverData, accessToken, refreshToken);

    await connectDriverSocket();
    await registerAndSendPushToken(deviceId);
  }

  async function signOut() {
    setDriver(null);
    delete api.defaults.headers.common['Authorization'];
    await storage.clearAuth();
    disconnectDriverSocket();
  }

  return (
    <AuthContext.Provider value={{ driver, loading, deviceId, signIn, signOut, refreshDriverProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}