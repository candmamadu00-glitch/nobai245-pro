import axios from 'axios';

// Captura a URL do ambiente ou usa a produção por padrão
const rawUrl = import.meta.env?.VITE_API_URL || 'https://api.nobai245.com';
const cleanUrl = rawUrl.replace(/\/$/, '');

// Garante que a URL termina com /api, mas NUNCA duplica para /api/api
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

export default api;