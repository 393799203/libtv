import { Navigate, useLocation } from 'react-router-dom';
import { Spin } from 'antd';
import { useAuthStore } from '@/stores/authStore';
import { authPagePath } from '@/utils/authNavigation';
import { useCanManageOnDevice } from '@/hooks/useCanManageOnDevice';

interface AuthGuardProps {
  children: React.ReactNode;
  adminOnly?: boolean;
}

/**
 * 路由守卫：需要登录才能访问的页面
 * - 未初始化时显示 loading
 * - 登录成功统一进入首页；后台页面额外要求管理员角色
 */
export function AuthGuard({ children, adminOnly = false }: AuthGuardProps) {
  const isInitialized = useAuthStore((s) => s.isInitialized);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const role = useAuthStore((s) => s.user?.role);
  const location = useLocation();
  const canManageOnDevice = useCanManageOnDevice();

  // 在后台挂载、加载数据之前拦截移动设备，窗口缩窄时同样退出后台。
  if (adminOnly && !canManageOnDevice) return <Navigate to="/" replace />;

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
    return <Navigate to={authPagePath('login', '/', location.search)} replace />;
  }

  if (adminOnly && role !== 'admin') return <Navigate to="/" replace />;

  return <>{children}</>;
}
