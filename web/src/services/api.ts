import axios from 'axios';
import type { AxiosInstance } from 'axios';
import { useAuthStore } from '@/stores/authStore';

declare module 'axios' {
  interface AxiosInstance {
    get<T = any>(url: string, config?: any): Promise<T>;
    post<T = any>(url: string, data?: any, config?: any): Promise<T>;
    put<T = any>(url: string, data?: any, config?: any): Promise<T>;
    delete<T = any>(url: string, config?: any): Promise<T>;
  }
}

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 请求拦截器：注入 token
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 响应拦截器：统一错误处理
api.interceptors.response.use(
  (response) => {
    const { code, msg, data } = response.data;
    if (code !== 0) {
      return Promise.reject(new Error(msg || '请求失败'));
    }
    return data;
  },
  (error) => {
    if (error.response?.status === 401) {
      const { isAuthenticated, initializing, logout, openLoginModal } = useAuthStore.getState();
      if (isAuthenticated && !initializing) {
        logout();
        // 延迟弹窗，避免初始化验证时弹出
        setTimeout(() => {
          if (!useAuthStore.getState().isAuthenticated) {
            openLoginModal();
          }
        }, 100);
      }
    }
    return Promise.reject(error);
  }
);

export default api;
