import React, { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react';
import { api } from '../services/api';
import { disconnectAdminSocket } from '../services/adminSocket';

export type AdminRole = 'SUPER_ADMIN' | 'ADMIN' | 'OPERATOR' | 'FINANCE';

export interface Admin {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
}

interface AuthContextData {
  admin: Admin | null;
  token: string | null;
  loading: boolean;
  inactivityCountdown: number | null;
  resetInactivityTimer: () => void;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: (reason?: 'manual' | 'expired' | 'inactivity') => void;
}

const TOKEN_KEY = '@bai245:admin_token';
const USER_KEY = '@bai245:admin_user';

// Padrão bancário: aviso aos 14 min e bloqueio automático aos 15 min sem atividade
const INACTIVITY_LIMIT_MS = 15 * 60 * 1000;
const WARNING_THRESHOLD_MS = 60 * 1000;

function isJwtExpired(jwtToken: string): boolean {
  try {
    const parts = jwtToken.split('.');
    if (parts.length !== 3) return true;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const payload = JSON.parse(atob(padded));
    if (!payload.exp) return false;
    // Margem de segurança de 15 segundos
    return Date.now() >= (payload.exp * 1000) - 15000;
  } catch {
    return true;
  }
}

const AuthContext = createContext<AuthContextData | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [inactivityCountdown, setInactivityCountdown] = useState<number | null>(null);

  const lastActivityRef = useRef<number>(Date.now());

  const clearSessionState = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    delete api.defaults.headers.common['Authorization'];
    disconnectAdminSocket();
    setAdmin(null);
    setToken(null);
    setInactivityCountdown(null);
  }, []);

  const signOut = useCallback((reason: 'manual' | 'expired' | 'inactivity' = 'manual') => {
    clearSessionState();
    if (reason === 'expired' || reason === 'inactivity') {
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = `/login?reason=${reason}`;
      }
    }
  }, [clearSessionState]);

  const resetInactivityTimer = useCallback(() => {
    lastActivityRef.current = Date.now();
    setInactivityCountdown(null);
  }, []);

  // Restauração segura da sessão na inicialização
  useEffect(() => {
    const storedToken = localStorage.getItem(TOKEN_KEY);
    const storedAdmin = localStorage.getItem(USER_KEY);

    if (storedToken && storedAdmin) {
      try {
        if (isJwtExpired(storedToken)) {
          clearSessionState();
        } else {
          const parsedAdmin = JSON.parse(storedAdmin) as Admin;
          setAdmin(parsedAdmin);
          setToken(storedToken);
          api.defaults.headers.common['Authorization'] = `Bearer ${storedToken}`;
          lastActivityRef.current = Date.now();
        }
      } catch {
        clearSessionState();
      }
    }

    setLoading(false);
  }, [clearSessionState]);

  // Sincronização de logout entre múltiplas abas abertas
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === TOKEN_KEY && !e.newValue) {
        clearSessionState();
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [clearSessionState]);

  // Monitoramento de inatividade e expiração periódica do JWT
  useEffect(() => {
    if (!admin || !token) return;

    const activityEvents = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    const onUserActivity = () => {
      // Só reseta automaticamente se ainda não entrou no aviso crítico final de 60s
      if (Date.now() - lastActivityRef.current < INACTIVITY_LIMIT_MS - WARNING_THRESHOLD_MS) {
        lastActivityRef.current = Date.now();
      }
    };

    activityEvents.forEach((evt) => window.addEventListener(evt, onUserActivity, { passive: true }));

    const interval = window.setInterval(() => {
      const currentStoredToken = localStorage.getItem(TOKEN_KEY);
      if (!currentStoredToken || isJwtExpired(currentStoredToken)) {
        signOut('expired');
        return;
      }

      const idleMs = Date.now() - lastActivityRef.current;
      const remainingMs = INACTIVITY_LIMIT_MS - idleMs;

      if (remainingMs <= 0) {
        signOut('inactivity');
      } else if (remainingMs <= WARNING_THRESHOLD_MS) {
        setInactivityCountdown(Math.ceil(remainingMs / 1000));
      } else {
        setInactivityCountdown(null);
      }
    }, 1000);

    return () => {
      activityEvents.forEach((evt) => window.removeEventListener(evt, onUserActivity));
      window.clearInterval(interval);
    };
  }, [admin, token, signOut]);

  async function signIn(email: string, password: string) {
    const response = await api.post('/admin/login', { email, password });
    const { token: newToken, admin: adminData } = response.data;

    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(USER_KEY, JSON.stringify(adminData));

    api.defaults.headers.common['Authorization'] = `Bearer ${newToken}`;
    lastActivityRef.current = Date.now();
    setToken(newToken);
    setAdmin(adminData);
    setInactivityCountdown(null);
  }

  return (
    <AuthContext.Provider
      value={{
        admin,
        token,
        loading,
        inactivityCountdown,
        resetInactivityTimer,
        signIn,
        signOut
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser utilizado dentro de um AuthProvider');
  }
  return context;
}
