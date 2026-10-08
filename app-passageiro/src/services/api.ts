import axios from 'axios';
import * as Sentry from '@sentry/react-native';
import { updateSocketToken } from './passengerSocket';
import { SecureStorage } from './storage';

const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'https://api.nobai245.com').replace(/\/api\/?$/, '');

export { SecureStorage };

export const api = axios.create({
  baseURL: `${API_URL}/api`,
  timeout: 25000,
  headers: {
    'Content-Type': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
  },
});

let isRefreshing = false;
let failedQueue: Array<{ resolve: (token: string) => void; reject: (err: unknown) => void }> = [];
let onSignOutHandler: (() => void) | null = null;

export const setUnauthorizedHandler = (handler: () => void) => {
  onSignOutHandler = handler;
};

const processQueue = (error: unknown, token: string | null = null) => {
  failedQueue.forEach((promise) => {
    if (error) promise.reject(error);
    else promise.resolve(token!);
  });
  failedQueue = [];
};

api.interceptors.request.use(
  async (config) => {
    const token = await SecureStorage.getItem('@bai245:accessToken');
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            originalRequest.headers.Authorization = `Bearer ${token}`;
            return api(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const refreshToken = await SecureStorage.getItem('@bai245:refreshToken');
        if (!refreshToken) {
          throw new Error('SECURE_AUTH_EXPIRED: Nenhum Refresh Token disponível.');
        }

        const res = await axios.post(
          `${API_URL}/api/passengers/refresh-token`,
          { refreshToken },
          { timeout: 10000 }
        );
        const { accessToken } = res.data;

        if (!accessToken) {
          throw new Error('SECURE_AUTH_FAILED: Resposta inválida do servidor.');
        }

        await SecureStorage.setItem('@bai245:accessToken', accessToken);
        updateSocketToken(accessToken);

        api.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`;
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;

        processQueue(null, accessToken);
        return api(originalRequest);
      } catch (refreshErr) {
        processQueue(refreshErr, null);
        Sentry.captureException(refreshErr);

        await SecureStorage.removeItem('@bai245:accessToken');
        await SecureStorage.removeItem('@bai245:refreshToken');
        delete api.defaults.headers.common['Authorization'];

        if (onSignOutHandler) onSignOutHandler();

        return Promise.reject(refreshErr);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error);
  }
);

// 📱 Função auxiliar para pagamento Mobile Money via API
export const initiateMobileMoneyPayment = async (payload: {
  phone: string;
  amount: number;
  provider: 'ORANGE_MONEY' | 'MTN_MOMO';
  passengerId: string;
}, options?: { signal?: AbortSignal }) => {
  const response = await api.post('/passengers/payments/initiate', payload, {
    signal: options?.signal,
  });
  return response.data;
};