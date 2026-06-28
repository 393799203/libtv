import { useEffect } from 'react';
import { LoginModal } from '@/components/auth/LoginModal';
import { useAuthStore } from '@/stores/authStore';

/**
 * 全局组件容器
 * 用于放置需要在整个应用中共享的组件（如登录弹窗）
 * 必须在 RouterProvider 内部使用，因为 LoginModal 需要 useNavigate
 */
export function GlobalComponents() {
  // 应用启动时初始化认证状态（所有页面共享）
  useEffect(() => {
    useAuthStore.getState().initialize();
  }, []);

  return <LoginModal />;
}