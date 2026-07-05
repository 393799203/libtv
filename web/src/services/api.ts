import axios from 'axios';
import type { AxiosInstance } from 'axios';
import { message } from 'antd';
import { useAuthStore } from '@/stores/authStore';

declare module 'axios' {
  interface AxiosInstance {
    get<T = any>(url: string, config?: any): Promise<T>;
    post<T = any>(url: string, data?: any, config?: any): Promise<T>;
    put<T = any>(url: string, data?: any, config?: any): Promise<T>;
    delete<T = any>(url: string, config?: any): Promise<T>;
  }
}

// 常见 HTTP 状态码的默认错误提示
const DEFAULT_ERROR_MESSAGES: Record<number, string> = {
  400: '请求参数错误',
  401: '未授权，请重新登录',
  403: '没有权限访问',
  404: '请求的资源不存在',
  500: '服务器内部错误',
  502: '网关错误',
  503: '服务暂不可用',
};

const api = axios.create({
  baseURL: '/api',
  timeout: 60000, // 统一60秒超时
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
    const { code, msg, message: msgMessage, data } = response.data;
    if (code !== 0) {
      const errMsg = msg || msgMessage || '请求失败';
      message.error(errMsg);
      return Promise.reject(new Error(errMsg));
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

    // 统一提取错误消息并展示
    const errData = error.response?.data;
    const errMsg =
      (errData && (errData.message || errData.msg || errData.error)) ||
      DEFAULT_ERROR_MESSAGES[error.response?.status] ||
      error.message ||
      '请求失败';
    message.error(errMsg);

    return Promise.reject(new Error(errMsg));
  }
);

export default api;
