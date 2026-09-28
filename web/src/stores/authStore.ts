import { create } from 'zustand';
import type { AuthResponse } from '@/types/api';
import api from '@/services/api';

interface AuthState {
  token: string | null;
  user: AuthResponse['user'] | null;
  isAuthenticated: boolean;
  isInitialized: boolean;

  // 登录弹窗状态
  showLoginModal: boolean;
  authMode: 'login' | 'register';
  // 是否正在初始化（用于区分正常请求401 vs 初始化验证401）
  initializing: boolean;

  // Actions
  setAuth: (response: AuthResponse) => void;
  setUser: (user: Partial<AuthResponse['user']>) => void;
  logout: () => void;
  initialize: () => void;
  openLoginModal: (mode?: 'login' | 'register') => void;
  closeLoginModal: () => void;
  setAuthMode: (mode: 'login' | 'register') => void;
}

const AUTH_KEY = 'libtv_auth';

// ---- 跨子域共享登录态 ----------------------------------------------------
// localStorage 是按 origin 隔离的：在 www.yunqueai.cloud 登录后打开
// manwa.yunqueai.cloud 属于另一个 origin，读不到 token，会被要求重新登录。
// 所以在父域（.yunqueai.cloud）上再存一份 cookie，任一子域都能读到。
// 只对多级域名生效；localhost / 纯 IP 下写 Domain 会被浏览器拒绝，直接跳过。
const COOKIE_DOMAIN_SUFFIX = 'yunqueai.cloud';

function sharedCookieDomain(): string | null {
  const host = location.hostname;
  if (host === COOKIE_DOMAIN_SUFFIX) return null;      // 裸域本身就是全站共享，无需 Domain
  if (!host.endsWith('.' + COOKIE_DOMAIN_SUFFIX)) return null;  // localhost / 内网 IP / 其他域
  return '.' + COOKIE_DOMAIN_SUFFIX;
}

function writeSharedAuth(value: string) {
  const domain = sharedCookieDomain();
  if (!domain) return;
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie =
    `${AUTH_KEY}=${encodeURIComponent(value)}; Domain=${domain}; Path=/; ` +
    `Max-Age=2592000; SameSite=Lax${secure}`;
}

function readSharedAuth(): string | null {
  const matched = document.cookie.match(new RegExp(`(?:^|;\\s*)${AUTH_KEY}=([^;]*)`));
  return matched ? decodeURIComponent(matched[1]) : null;
}

function clearSharedAuth() {
  const domain = sharedCookieDomain();
  if (!domain) return;
  document.cookie = `${AUTH_KEY}=; Domain=${domain}; Path=/; Max-Age=0; SameSite=Lax`;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  user: null,
  isAuthenticated: false,
  isInitialized: false,
  showLoginModal: false,
  authMode: 'login',
  initializing: false,

  setAuth: (response: AuthResponse) => {
    const serialized = JSON.stringify(response);
    localStorage.setItem(AUTH_KEY, serialized);
    writeSharedAuth(serialized);   // 同一父域下的其他子域也能直接进入登录态
    set({
      token: response.token,
      user: response.user,
      isAuthenticated: true,
      showLoginModal: false,
    });
  },

  // 更新当前用户信息（个人资料修改后同步到内存与 localStorage）
  setUser: (partial) => {
    const current = get().user;
    if (!current) return;
    const merged = { ...current, ...partial };
    const stored = localStorage.getItem(AUTH_KEY);
    if (stored) {
      try {
        const data = JSON.parse(stored) as AuthResponse;
        data.user = merged;
        localStorage.setItem(AUTH_KEY, JSON.stringify(data));
      } catch {
        // localStorage 数据损坏时忽略
      }
    }
    set({ user: merged });
  },

  logout: () => {
    localStorage.removeItem(AUTH_KEY);
    clearSharedAuth();
    set({ token: null, user: null, isAuthenticated: false });
  },

  initialize: async () => {
    set({ initializing: true });
    try {
      let stored = localStorage.getItem(AUTH_KEY);
      if (!stored) {
        // 本 origin 没有登录态时，尝试从父域共享 cookie 恢复：
        // 用户可能在 www 登录后直接打开了 manwa 子域
        const shared = readSharedAuth();
        if (shared) {
          stored = shared;
          localStorage.setItem(AUTH_KEY, shared);
        }
      }
      if (!stored) {
        set({ isInitialized: true, initializing: false });
        return;
      }

      const data: AuthResponse = JSON.parse(stored);

      // 验证 token 是否仍然有效（此时不设置 isAuthenticated，避免错误拦截器误判）
      try {
        // 临时设置 token 以便请求携带
        set({ token: data.token });

        const me = await api.get('/auth/me') as { id: string; email: string; nickname: string; avatar_url: string; role?: string; credits?: number };
        // token 有效。顺手补写共享 cookie：老版本登录的用户 localStorage 里
        // 已有凭证但父域还没有 cookie，不补写的话换了子域仍会被要求重新登录。
        writeSharedAuth(stored);
        // token 有效
        set({
          user: { id: me.id, email: me.email, nickname: me.nickname, avatarUrl: me.avatar_url, role: me.role, credits: me.credits },
          isAuthenticated: true,
          isInitialized: true,
          initializing: false,
        });
      } catch {
        // token 无效或过期，静默清除（共享 cookie 一并清掉，
        // 否则其他子域每次进来都会拿这个失效 token 重新试一遍）
        localStorage.removeItem(AUTH_KEY);
        clearSharedAuth();
        set({ token: null, user: null, isAuthenticated: false, isInitialized: true, initializing: false });
      }
    } catch {
      localStorage.removeItem(AUTH_KEY);
      clearSharedAuth();
      set({ isInitialized: true, initializing: false });
    }
  },

  openLoginModal: (mode = 'login') => {
    set({ showLoginModal: true, authMode: mode });
  },

  closeLoginModal: () => {
    set({ showLoginModal: false, authMode: 'login' });
  },

  setAuthMode: (mode) => {
    set({ authMode: mode });
  },
}));
