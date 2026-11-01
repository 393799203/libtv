import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { LoginModal } from '@/components/auth/LoginModal';
import { useAuthStore } from '@/stores/authStore';
import { captureReferralCode } from '@/utils/referral';

/**
 * 全局组件容器
 * 用于放置需要在整个应用中共享的组件（如登录弹窗）
 * 必须在 RouterProvider 内部使用，因为 LoginModal 需要 useNavigate
 */
export function GlobalComponents() {
  const { search } = useLocation();
  const initialized = useAuthStore(s => s.isInitialized);
  const authenticated = useAuthStore(s => s.isAuthenticated);
  // 应用启动时初始化认证状态（所有页面共享）
  useEffect(() => {
    useAuthStore.getState().initialize();
  }, []);
  useEffect(() => {
    const code = captureReferralCode(search);
    if (code && initialized && !authenticated) useAuthStore.getState().openLoginModal('register');
  }, [search, initialized, authenticated]);

  // 蛙导由具体项目画布挂载，非创作页面没有可操作的画布。
  return <LoginModal />;
}
