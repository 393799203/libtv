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
    try {
      const stored = localStorage.getItem(AUTH_KEY);
      if (!stored) {
        set({ isInitialized: true });
        return;
      }

      const data: AuthResponse = JSON.parse(stored);
      // 先设置 token，让 API 请求能带上
      set({ token: data.token, user: data.user, isAuthenticated: true });

      // 验证 token 是否仍然有效
      try {
        const me = await api.get('/auth/me') as { id: number; email: string; nickname: string; avatar_url: string };
        // token 有效，更新用户信息
        set({
          user: { id: me.id, email: me.email, nickname: me.nickname, avatarUrl: me.avatar_url },
          isInitialized: true,
        });
      } catch {
        // token 无效，清除认证状态（不弹登录框）
        localStorage.removeItem(AUTH_KEY);
        set({ token: null, user: null, isAuthenticated: false, isInitialized: true });
      }
    } catch {
      localStorage.removeItem(AUTH_KEY);
      set({ isInitialized: true });
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
