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
  logout: () => void;
  initialize: () => void;
  openLoginModal: (mode?: 'login' | 'register') => void;
  closeLoginModal: () => void;
  setAuthMode: (mode: 'login' | 'register') => void;
}

const AUTH_KEY = 'libtv_auth';

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  user: null,
  isAuthenticated: false,
  isInitialized: false,
  showLoginModal: false,
  authMode: 'login',
  initializing: false,

  setAuth: (response: AuthResponse) => {
    localStorage.setItem(AUTH_KEY, JSON.stringify(response));
    set({
      token: response.token,
      user: response.user,
      isAuthenticated: true,
      showLoginModal: false,
    });
  },

  logout: () => {
    localStorage.removeItem(AUTH_KEY);
    set({ token: null, user: null, isAuthenticated: false });
  },

  initialize: async () => {
    set({ initializing: true });
    try {
      const stored = localStorage.getItem(AUTH_KEY);
      if (!stored) {
        set({ isInitialized: true, initializing: false });
        return;
      }

      const data: AuthResponse = JSON.parse(stored);

      // 验证 token 是否仍然有效（此时不设置 isAuthenticated，避免错误拦截器误判）
      try {
        // 临时设置 token 以便请求携带
        set({ token: data.token });

        const me = await api.get('/auth/me') as { id: number; email: string; nickname: string; avatar_url: string; role?: string };
        // token 有效
        set({
          user: { id: me.id, email: me.email, nickname: me.nickname, avatarUrl: me.avatar_url, role: me.role },
          isAuthenticated: true,
          isInitialized: true,
          initializing: false,
        });
      } catch {
        // token 无效或过期，静默清除
        localStorage.removeItem(AUTH_KEY);
        set({ token: null, user: null, isAuthenticated: false, isInitialized: true, initializing: false });
      }
    } catch {
      localStorage.removeItem(AUTH_KEY);
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
