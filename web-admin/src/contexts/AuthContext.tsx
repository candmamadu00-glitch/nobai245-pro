import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { api } from '../services/api';

export interface Admin {
  id: string;
  name: string;
  email: string;
  role: 'SUPER_ADMIN' | 'OPERATOR' | 'FINANCE';
}

interface AuthContextData {
  admin: Admin | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextData | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const storedToken = localStorage.getItem('@bai245:admin_token');
    const storedAdmin = localStorage.getItem('@bai245:admin_user');

    if (storedToken && storedAdmin) {
      try {
        const parsedAdmin = JSON.parse(storedAdmin);
        setAdmin(parsedAdmin);
        api.defaults.headers.common['Authorization'] = `Bearer ${storedToken}`;
      } catch (error) {
        console.error('Erro ao restaurar sessão local:', error);
        localStorage.removeItem('@bai245:admin_token');
        localStorage.removeItem('@bai245:admin_user');
        delete api.defaults.headers.common['Authorization'];
        setAdmin(null);
      }
    }

    setLoading(false);
  }, []);

  async function signIn(email: string, password: string) {
    const response = await api.post('/admin/login', { email, password });
    
    const { token, admin: adminData } = response.data;

    localStorage.setItem('@bai245:admin_token', token);
    localStorage.setItem('@bai245:admin_user', JSON.stringify(adminData));

    api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    setAdmin(adminData);
  }

  function signOut() {
    localStorage.removeItem('@bai245:admin_token');
    localStorage.removeItem('@bai245:admin_user');
    delete api.defaults.headers.common['Authorization'];
    setAdmin(null);
  }

  return (
    <AuthContext.Provider value={{ admin, loading, signIn, signOut }}>
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