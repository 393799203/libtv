import axios from 'axios';
import type { AxiosRequestConfig as RequestConfig, InternalAxiosRequestConfig } from 'axios';
import { message } from '@/utils/antdApp';
import { useAuthStore } from '@/stores/authStore';
import { tokenExpiresAt } from '@/utils/authSession';

declare module 'axios' {
  interface AxiosInstance {
    get<T = unknown>(url: string, config?: RequestConfig): Promise<T>;
    post<T = unknown>(url: string, data?: unknown, config?: RequestConfig): Promise<T>;
    put<T = unknown>(url: string, data?: unknown, config?: RequestConfig): Promise<T>;
    delete<T = unknown>(url: string, config?: RequestConfig): Promise<T>;
  }
  interface AxiosRequestConfig {
    silentError?: boolean;
  }
}

const DEFAULT_ERRORS: Record<number, string> = {
  400: '请求参数错误', 401: '邮箱或密码错误', 403: '没有权限访问',
  404: '请求的资源不存在', 429: '操作过于频繁，请稍后再试',
  500: '服务器内部错误', 502: '网关错误', 503: '服务暂不可用',
};

const api = axios.create({
  baseURL: '/api', timeout: 60000, withCredentials: true,
  headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'libtv' },
});

function publicAuth(url = '') {
  return /^\/auth\/(login|register|register-code|forgot-password|reset-password)$/.test(url);
}

function expireSession(reason = '登录已失效，请重新登录') {
  const store = useAuthStore.getState();
  const wasAuthenticated = store.isAuthenticated;
  store.clearAuth();
  if (wasAuthenticated && !store.initializing) {
    message.error(reason);
    store.openLoginModal();
  }
}

api.interceptors.request.use(async config => {
  if (publicAuth(config.url)) return config;
  let token = useAuthStore.getState().token;
  if (token && (tokenExpiresAt(token) ?? 0) - Date.now() < 60000) {
    try {
      token = await useAuthStore.getState().refresh();
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        expireSession(error.response?.data?.msg);
      }
      throw error;
    }
  }
  if (token) config.headers.Authorization = `Bearer ${token}`;
  else config.headers.delete('Authorization');
  return config;
});

api.interceptors.response.use(
  response => {
    const { code, msg, message: alternateMessage, data } = response.data;
    if (code !== 0) {
      const reason = msg || alternateMessage || '请求失败';
      message.error(reason);
      return Promise.reject(new Error(reason));
    }
    return data;
  },
  async error => {
    const config = error.config as (InternalAxiosRequestConfig & { authRetried?: boolean; silentError?: boolean }) | undefined;
    if (error.response?.status === 401 && config && !publicAuth(config.url)) {
      const sentToken = String(config.headers?.Authorization || '').replace(/^Bearer /, '');
      const currentToken = useAuthStore.getState().token;
      // Ignore responses from a previous login after a newer login or logout.
      if (!currentToken || (sentToken && sentToken !== currentToken)) return Promise.reject(error);
      if (!config.authRetried) {
        config.authRetried = true;
        try {
          const token = await useAuthStore.getState().refresh();
          if (token) return api.request(config);
        } catch (refreshError) {
          if (!axios.isAxiosError(refreshError) || refreshError.response?.status !== 401) {
            if (!config.silentError) message.error('暂时无法验证登录，请检查网络后重试');
            return Promise.reject(refreshError);
          }
          expireSession(refreshError.response.data?.msg);
          return Promise.reject(refreshError);
        }
      }
      expireSession();
      return Promise.reject(error);
    }
    let reason = error.response?.data?.msg || error.response?.data?.message ||
      DEFAULT_ERRORS[error.response?.status] || error.message || '请求失败';
    if (reason === 'invalid email or password') reason = '邮箱或密码错误';
    if (!config?.silentError) message.error(reason);
    return Promise.reject(error);
  },
);

export default api;
