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

// ========== 会话滑动续期 ==========
// 后端 token 有效期 24 小时且不会自动延长，用户干着活被静默登出会丢未保存内容。
// 这里在"剩余寿命不足一半（12 小时）"时，请求前静默换一个新 token：
//   · 阈值取一半而不是每次请求都续签 —— 活跃用户大约 12 小时才续一次，开销可忽略
//   · 续签接口本身受鉴权保护，token 已过期时它会 401，交给下面的统一登出逻辑兜底
const RENEW_THRESHOLD_MS = 12 * 60 * 60 * 1000;
let renewing: Promise<string | null> | null = null;

/** 解析 JWT 的 exp（毫秒）；解析不出来返回 null，表示"不主动续签"，让 401 兜底 */
function tokenExpiresAt(token: string): number | null {
  try {
    const payload = JSON.parse(
      decodeURIComponent(
        atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
          .split('')
          .map((ch) => '%' + ('00' + ch.charCodeAt(0).toString(16)).slice(-2))
          .join(''),
      ),
    );
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function shouldRenew(token: string): boolean {
  const exp = tokenExpiresAt(token);
  return exp !== null && exp - Date.now() < RENEW_THRESHOLD_MS;
}

async function renewSession(currentToken: string): Promise<string | null> {
  // 并发去重：同一时刻可能有多个请求同时判定需要续期，共用一个在途 Promise，只发一次请求
  if (!renewing) {
    renewing = axios
      .post('/api/auth/refresh', {}, { headers: { Authorization: `Bearer ${currentToken}` } })
      .then((res) => {
        const payload = (res as any)?.data?.data ?? (res as any)?.data;
        const newToken: string | undefined = payload?.token;
        if (!newToken) return null;
        // 复用 setAuth 落盘：它本来就负责写 localStorage，续签后刷新页面不会退回旧 token
        const user = payload?.user ?? useAuthStore.getState().user;
        if (user) useAuthStore.getState().setAuth({ token: newToken, user });
        else useAuthStore.setState({ token: newToken });
        return newToken;
      })
      .catch(() => null) // 续签失败不阻断本次请求（旧 token 通常仍可用），401 逻辑会兜底
      .finally(() => { renewing = null; });
  }
  return renewing;
}

// 请求拦截器：注入 token（并在临近过期时先静默续签）
api.interceptors.request.use(async (config) => {
  let token = useAuthStore.getState().token;
  // 续签接口自己不带"先续签"逻辑，否则会递归
  if (token && !String(config.url || '').includes('/auth/refresh') && shouldRenew(token)) {
    const renewed = await renewSession(token);
    if (renewed) token = renewed;
  }
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

    // 登录/注册接口的 401 是业务性失败（如“邮箱或密码错误”），不是 token 失效，
    // 不能走下面的“登录已失效”逻辑，否则真实原因会被吞掉、用户看不到任何提示
    const reqUrl = error.config?.url || '';
    const isAuthEndpoint = reqUrl.includes('/auth/login') || reqUrl.includes('/auth/register');

    // 401 在窗口期内只处理一次：登出 + 弹登录框，后续并发 401 静默拒绝
    if (isUnauthenticated && !isAuthEndpoint) {
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
    let errMsg =
      (errData && (errData.message || errData.msg || errData.error)) ||
      DEFAULT_ERROR_MESSAGES[error.response?.status] ||
      error.message ||
      '请求失败';
    // 后端登录失败信息是英文，转成用户可读的中文提示
    if (isAuthEndpoint && errMsg === 'invalid email or password') {
      errMsg = '邮箱或密码错误';
    }
    if (!(error.config as any)?.silentError) {
      message.error(errMsg);
    }

    return Promise.reject(new Error(errMsg));
  }
);

export default api;
