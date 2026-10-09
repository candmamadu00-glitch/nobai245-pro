import axios from 'axios';

// Captura a URL do ambiente ou usa a produção por padrão
const rawUrl = import.meta.env?.VITE_API_URL || 'https://api.nobai245.com';
const cleanUrl = rawUrl.replace(/\/$/, '');

// Garante que a URL termina com /api sem duplicar
export const API_URL = cleanUrl.endsWith('/api') ? cleanUrl : `${cleanUrl}/api`;

export const api = axios.create({
  baseURL: API_URL,
});
// Interceptador para adicionar o token de administrador em todas as requisições
api.interceptors.request.use(
  async (config) => {
    const token = localStorage.getItem('@bai245:admin_token');
    
    if (token) {
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${token}`;
    }
    
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Interceptador para capturar sessões expiradas ou não autorizadas (401)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('@bai245:admin_token');
      localStorage.removeItem('@bai245:admin_user');
      
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

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