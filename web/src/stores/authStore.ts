import { create } from 'zustand';
import axios from 'axios';
import type { ApiResponse, AuthResponse } from '@/types/api';
import { tokenExpiresAt } from '@/utils/authSession';

interface AuthState {
  token: string | null;
  user: AuthResponse['user'] | null;
  isAuthenticated: boolean;
  isInitialized: boolean;
  initializing: boolean;
  showLoginModal: boolean;
  authMode: 'login' | 'register';
  setAuth: (response: AuthResponse) => void;
  setUser: (user: Partial<AuthResponse['user']>) => void;
  clearAuth: () => void;
  logout: () => Promise<void>;
  refresh: () => Promise<string | null>;
  initialize: () => Promise<void>;
  openLoginModal: (mode?: 'login' | 'register') => void;
  closeLoginModal: () => void;
  setAuthMode: (mode: 'login' | 'register') => void;
}

const EVENT_KEY = 'libtv_auth_event';
const cookieRequest = { headers: { 'X-Requested-With': 'libtv' }, withCredentials: true, timeout: 15000 };
let revision = 0;
let refreshing: Promise<string | null> | null = null;
let initializing: Promise<void> | null = null;

function announce(type: 'login' | 'logout') {
  try {
    localStorage.setItem(EVENT_KEY, JSON.stringify({ type, nonce: Date.now() + Math.random() }));
  } catch { /* Storage restrictions must not prevent login or logout. */ }
}

function removeLegacyAuth() {
  try { localStorage.removeItem('libtv_auth'); } catch { /* Storage may be disabled. */ }
  document.cookie = 'libtv_auth=; Path=/; Max-Age=0; SameSite=Lax';
  if (location.hostname === 'yunqueai.cloud' || location.hostname.endsWith('.yunqueai.cloud')) {
    document.cookie = 'libtv_auth=; Domain=yunqueai.cloud; Path=/; Max-Age=0; SameSite=Lax';
  }
}

function authFields(response: AuthResponse) {
  if (!response.token || !response.user?.id || (tokenExpiresAt(response.token) ?? 0) <= Date.now()) {
    throw new Error('登录信息无效，请重新登录');
  }
  return {
    token: response.token,
    user: { ...response.user, avatarUrl: response.user.avatarUrl ?? response.user.avatar_url },
    isAuthenticated: true,
    showLoginModal: false,
  };
}

export const useAuthStore = create<AuthState>((set, get) => ({
  token: null,
  user: null,
  isAuthenticated: false,
  isInitialized: false,
  initializing: false,
  showLoginModal: false,
  authMode: 'login',

  setAuth: response => {
    revision++;
    set(authFields(response));
    removeLegacyAuth();
    announce('login');
  },

  setUser: partial => {
    const current = get().user;
    if (current) set({ user: { ...current, ...partial } });
  },

  clearAuth: () => {
    revision++;
    removeLegacyAuth();
    set({ token: null, user: null, isAuthenticated: false });
  },

  logout: async () => {
    revision++;
    await axios.post('/api/auth/logout', {}, cookieRequest);
    get().clearAuth();
    announce('logout');
  },

  refresh: () => {
    if (refreshing) return refreshing;
    const startedAt = revision;
    const pending = axios.request<ApiResponse<AuthResponse>>({
      ...cookieRequest, method: 'POST', url: '/api/auth/refresh', data: {},
    }).then(response => {
      if (startedAt !== revision) return null;
      if (response.data?.code !== 0) throw new Error('登录信息无效，请重新登录');
      const auth = response.data.data as AuthResponse;
      set(authFields(auth));
      return auth.token;
    });
    const settled = pending.finally(() => {
      if (refreshing === settled) refreshing = null;
    });
    refreshing = settled;
    return settled;
  },

  initialize: () => {
    if (initializing) return initializing;
    removeLegacyAuth();
    set({ initializing: true });
    initializing = get().refresh().then(() => undefined).catch(() => {
      get().clearAuth();
    }).finally(() => {
      set({ isInitialized: true, initializing: false });
      initializing = null;
    });
    return initializing;
  },

  openLoginModal: (mode = 'login') => set({ showLoginModal: true, authMode: mode }),
  closeLoginModal: () => set({ showLoginModal: false, authMode: 'login' }),
  setAuthMode: mode => set({ authMode: mode }),
}));

// Tabs share the HttpOnly session cookie; broadcasts carry no credentials.
window.addEventListener('storage', event => {
  if (event.key !== EVENT_KEY || !event.newValue) return;
  try {
    const { type } = JSON.parse(event.newValue);
    if (type === 'logout') useAuthStore.getState().clearAuth();
    if (type === 'login') {
      useAuthStore.getState().clearAuth();
      void useAuthStore.getState().initialize();
    }
  } catch { /* Ignore malformed events from old tabs. */ }
});
