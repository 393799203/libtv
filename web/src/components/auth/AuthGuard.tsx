import { Navigate, useLocation } from 'react-router-dom';
import { Spin } from 'antd';
import { useAuthStore } from '@/stores/authStore';
import { authPagePath } from '@/utils/authNavigation';

interface AuthGuardProps {
  children: React.ReactNode;
}

/**
 * 路由守卫：需要登录才能访问的页面
 * - 未初始化时显示 loading
 * - 未登录时进入独立登录页，成功后返回完整的原始地址
 */
export function AuthGuard({ children }: AuthGuardProps) {
  const isInitialized = useAuthStore((s) => s.isInitialized);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const location = useLocation();

  // 未初始化时显示 loading
  if (!isInitialized) {
    return (
      <div className="w-full h-screen flex items-center justify-center">
        <Spin size="large" />
      </div>
    );
  }

  // 未登录不渲染子组件
  if (!isAuthenticated) {
    return <Navigate to={authPagePath('login', location.pathname + location.search + location.hash)} replace />;
  }

  return <>{children}</>;
}
