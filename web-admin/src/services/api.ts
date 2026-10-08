import axios from 'axios';

// Captura a URL do ambiente ou usa a URL de produção HTTPS por padrão
const rawUrl = import.meta.env?.VITE_API_URL || 'https://api.nobai245.com';
const cleanUrl = rawUrl.replace(/\/$/, '');

// Garante que a URL base termina em /api
export const API_URL = cleanUrl.endsWith('/api') ? cleanUrl : `${cleanUrl}/api`;

export const api = axios.create({
  baseURL: API_URL,
});

// Interceptador para tratar rotas duplicadas e injetar o token de autenticação
api.interceptors.request.use(
  async (config) => {
    // Remove /api do início da URL relativa se a baseURL já possuir /api
    if (config.url?.startsWith('/api/')) {
      config.url = config.url.replace(/^\/api/, '');
    }

    const token = localStorage.getItem('@bai245:admin_token');
    if (token) {
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
  },
  (error) => Promise.reject(error)
);

// Interceptador para sessões expiradas (401)
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