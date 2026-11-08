import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { captureReferralCode } from '@/utils/referral';
import { authPagePath, isAuthPath } from '@/utils/authNavigation';

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
    useAuthStore.getState().initialize();
  }, []);
  useEffect(() => {
    const code = captureReferralCode(location.search);
    if (code && initialized && !authenticated && !isAuthPath(location.pathname)) {
      navigate(authPagePath('register', location.pathname + location.search + location.hash, location.search), { replace: true });
    }
  }, [location, initialized, authenticated, navigate]);
  useEffect(() => {
    if (!authRequested) return;
    const returnPath = isAuthPath(location.pathname)
      ? new URLSearchParams(location.search).get('redirect') || '/'
      : location.pathname + location.search + location.hash;
    useAuthStore.getState().closeLoginModal();
    navigate(authPagePath(authMode, returnPath, location.search));
  }, [authRequested, authMode, location, navigate]);

  // 蛙导由具体项目画布挂载，非创作页面没有可操作的画布。
  return null;
}
