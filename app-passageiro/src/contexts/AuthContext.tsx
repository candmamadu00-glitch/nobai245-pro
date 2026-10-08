import React, { createContext, useState, useContext, useEffect, ReactNode, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api, setUnauthorizedHandler, SecureStorage } from '../services/api';
import { connectPassengerSocket, disconnectSocket } from '../services/passengerSocket';
import { registerAndSendPushToken, setupNotificationListeners } from '../services/notifications';
import { navigate } from '../utils/navigationHelper';

// Interface ajustada com os tipos do Prisma Schema
export type User = {
  id: string;
  fullName: string;
  email?: string;
  phone: string;
  profilePicture?: string;
  walletBalance?: string | number;
  ratingAverage?: string | number;
  paymentProvider?: string;
  paymentAccountNumber?: string;
};

type AuthContextData = {
  user: User | null;
  loading: boolean;
  signIn: (userData: User, accessToken: string, refreshToken: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshPassengerProfile: () => Promise<void>;
  updateUserContext: (data: Partial<User>) => void;
};

const AuthContext = createContext<AuthContextData>({} as AuthContextData);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const cleanupListenersRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    setUnauthorizedHandler(() => signOut());

    async function loadStorageData() {
      try {
        const storedUser = await AsyncStorage.getItem('@bai245:user');
        const storedToken = await SecureStorage.getItem('@bai245:accessToken');

        if (storedUser && storedToken) {
          api.defaults.headers.common['Authorization'] = `Bearer ${storedToken}`;
          setUser(JSON.parse(storedUser));
          await connectPassengerSocket();
          await refreshPassengerProfile();
          
          registerAndSendPushToken(storedToken).catch(() => {});
        }
      } catch (e) {
        console.error('❌ [AUTH PASSAGEIRO] Erro ao carregar sessão:', e);
      } finally {
        setLoading(false);
      }
    }

    loadStorageData();

    cleanupListenersRef.current = setupNotificationListeners(
      (notification) => {
        console.log('🔔 [PUSH PASSAGEIRO]:', notification?.request?.content?.title);
      },
      (response) => {
        try {
          const data = response?.notification?.request?.content?.data;
          if (data?.rideId) {
            navigate('RideDetails', { rideId: data.rideId });
          }
        } catch (err) {
          console.warn('⚠️ [PUSH] Erro ao redirecionar:', err);
        }
      }
    );

    return () => {
      if (cleanupListenersRef.current) {
        cleanupListenersRef.current();
      }
    };
  }, []);

  function updateUserContext(data: Partial<User>) {
    setUser((prevUser) => {
      if (!prevUser) return null;
      const updated = { ...prevUser, ...data };
      AsyncStorage.setItem('@bai245:user', JSON.stringify(updated)).catch(() => {});
      return updated;
    });
  }

  async function refreshPassengerProfile() {
    try {
      const response = await api.get('/passengers/profile');
      const updatedUser = response.data?.passenger || response.data?.user;
      if (updatedUser) {
        setUser(updatedUser);
        await AsyncStorage.setItem('@bai245:user', JSON.stringify(updatedUser));
      }
    } catch (error: unknown) {
      const err = error as { response?: { status?: number } };
      if (err?.response?.status === 401) {
        await signOut();
      }
    }
  }

  async function signIn(userData: User, accessToken: string, refreshToken: string) {
    try {
      setUser(userData);
      api.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`;

      await AsyncStorage.setItem('@bai245:user', JSON.stringify(userData));
      await SecureStorage.setItem('@bai245:accessToken', accessToken);
      await SecureStorage.setItem('@bai245:refreshToken', refreshToken);

      await connectPassengerSocket();
      registerAndSendPushToken(accessToken).catch(() => {});
    } catch (error) {
      console.error('❌ Erro durante o signIn:', error);
    }
  }

  async function signOut() {
    try {
      setUser(null);
      delete api.defaults.headers.common['Authorization'];
      await AsyncStorage.removeItem('@bai245:user');
      await SecureStorage.removeItem('@bai245:accessToken');
      await SecureStorage.removeItem('@bai245:refreshToken');
    } catch (error) {
      console.error('❌ Erro durante o signOut:', error);
    } finally {
      disconnectSocket();
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut, refreshPassengerProfile, updateUserContext }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}