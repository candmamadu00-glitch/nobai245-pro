import axios from 'axios';
import type { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { disconnectAdminSocket } from './adminSocket';

const rawUrl = import.meta.env?.VITE_API_URL || 'https://api.nobai245.com';
const cleanUrl = rawUrl.replace(/\/$/, '');

export const BASE_SERVER_URL = cleanUrl.replace(/\/api$/, '');
export const API_URL = cleanUrl.endsWith('/api') ? cleanUrl : `${cleanUrl}/api`;

export const api = axios.create({
  baseURL: API_URL,
  timeout: 20000,
  headers: {
    'X-Requested-With': 'XMLHttpRequest'
  }
});

let isRedirectingToLogin = false;

api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('@bai245:admin_token');
    if (token) {
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as (InternalAxiosRequestConfig & { _retryCount?: number }) | undefined;
    const status = error.response?.status;

    // Retry seguro APENAS para requisições de leitura (GET) em falhas transitórias de rede/gateway
    const isIdempotentGet = config?.method?.toUpperCase() === 'GET';
    const isTransientFailure = !status || status === 502 || status === 503 || status === 504;

    if (config && isIdempotentGet && isTransientFailure && (config._retryCount || 0) < 1) {
      config._retryCount = (config._retryCount || 0) + 1;
      await new Promise((resolve) => setTimeout(resolve, 900));
      return api.request(config);
    }

    if (status === 401) {
      localStorage.removeItem('@bai245:admin_token');
      localStorage.removeItem('@bai245:admin_user');
      disconnectAdminSocket();

      if (!window.location.pathname.startsWith('/login') && !isRedirectingToLogin) {
        isRedirectingToLogin = true;
        window.location.href = '/login?reason=expired';
      }
    }

    return Promise.reject(error);
  }
);

export interface SystemHealthResponse {
  status: 'ok' | 'degraded';
  uptime?: number;
  checks?: {
    database?: { status: string; latencyMs?: number };
    redis?: { status: string; latencyMs?: number };
  };
}

export const getSystemHealth = async (): Promise<SystemHealthResponse> => {
  const response = await axios.get<SystemHealthResponse>(`${BASE_SERVER_URL}/health`, {
    timeout: 6000
  });
  return response.data;
};

// ==========================================
// 🛰️ TELEMETRIA GPS DA CORRIDA
// ==========================================
export const getRideTelemetry = async (rideId: string) => {
  const response = await api.get(`/admin/rides/${rideId}/telemetry`);
  return response.data;
};

// ==========================================
// 💳 PAGAMENTOS MOBILE MONEY
// ==========================================
export interface InitiatePaymentDTO {
  phone: string;
  amount: number;
  provider: 'ORANGE_MONEY' | 'MTN_MOMO';
  passengerId: string;
}

export const initiateMobileMoneyPayment = async (data: InitiatePaymentDTO) => {
  const response = await api.post('/payments/mobile-money/initiate', data);
  return response.data;
};

export const checkPaymentStatus = async (transactionId: string) => {
  const response = await api.get(`/payments/mobile-money/status/${transactionId}`);
  return response.data;
};

// ==========================================
// 📍 RASTREAMENTO PÚBLICO DE CORRIDA
// ==========================================
export const getRideTracking = async (rideId: string) => {
  const response = await api.get(`/rides/tracking/${rideId}`);
  return response.data;
};

export default api;

