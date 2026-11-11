import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { captureReferralCode } from '@/utils/referral';
import { authPagePath, isAuthPath } from '@/utils/authNavigation';
import { tokenExpiresAt } from '@/utils/authSession';
import api from '@/services/api';

/**
 * 全局组件容器
 * 初始化认证和邀请信息，并把现有登录入口统一转为独立页面跳转。
 */
export function GlobalComponents() {
  const location = useLocation();
  const navigate = useNavigate();
  const initialized = useAuthStore(s => s.isInitialized);
  const authenticated = useAuthStore(s => s.isAuthenticated);
  const authRequested = useAuthStore(s => s.showLoginModal);
  const authMode = useAuthStore(s => s.authMode);
  // 应用启动时初始化认证状态（所有页面共享）
  useEffect(() => {
    void useAuthStore.getState().initialize();
    // Refresh in the foreground as well as before API requests, so editors
    // using upload headers also receive current access credentials.
    const checkSession = () => {
      const { token, isAuthenticated } = useAuthStore.getState();
      if (!isAuthenticated || !token || document.visibilityState === 'hidden') return;
      if ((tokenExpiresAt(token) ?? 0) - Date.now() < 2 * 60 * 1000) {
        void api.get('/auth/me', { silentError: true }).catch(() => {});
      }
    };
    const timer = window.setInterval(checkSession, 30000);
    window.addEventListener('focus', checkSession);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', checkSession);
    };
  }, []);
  useEffect(() => {
    const code = captureReferralCode(location.search);
    if (code && initialized && !authenticated && !isAuthPath(location.pathname)) {
      navigate(authPagePath('register', '/', location.search), { replace: true });
    }
  }, [location, initialized, authenticated, navigate]);
  useEffect(() => {
    if (!authRequested) return;
    useAuthStore.getState().closeLoginModal();
    navigate(authPagePath(authMode, '/', location.search));
  }, [authRequested, authMode, location, navigate]);

  // 蛙导由具体项目画布挂载，非创作页面没有可操作的画布。
  return null;
}
