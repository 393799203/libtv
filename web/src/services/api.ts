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

// 401 统一处理去重：token 失效瞬间往往有多个在途请求并发返回 401，
// 窗口期内只提示一次、只触发一次登出+弹登录框，避免 toast 轰炸
const UNAUTH_DEDUP_MS = 2000;
let lastUnauthHandledAt = 0;

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
    const isUnauthenticated = error.response?.status === 401;

    // 401 在窗口期内只处理一次：登出 + 弹登录框，后续并发 401 静默拒绝
    if (isUnauthenticated) {
      const now = Date.now();
      if (now - lastUnauthHandledAt > UNAUTH_DEDUP_MS) {
        const { isAuthenticated, initializing, logout, openLoginModal } = useAuthStore.getState();
        if (isAuthenticated && !initializing) {
          lastUnauthHandledAt = now;
          logout();
          message.error('登录已失效，请重新登录');
          // 延迟弹窗，避免初始化验证时弹出
          setTimeout(() => {
            if (!useAuthStore.getState().isAuthenticated) {
              openLoginModal();
            }
          }, 100);
        }
      }
      return Promise.reject(new Error('登录已失效，请重新登录'));
    }

    // 统一提取错误消息并展示（请求配置 silentError 时由调用方自行处理提示）
    const errData = error.response?.data;
    const errMsg =
      (errData && (errData.message || errData.msg || errData.error)) ||
      DEFAULT_ERROR_MESSAGES[error.response?.status] ||
      error.message ||
      '请求失败';
    if (!(error.config as any)?.silentError) {
      message.error(errMsg);
    }

    return Promise.reject(new Error(errMsg));
  }
);

export default api;
