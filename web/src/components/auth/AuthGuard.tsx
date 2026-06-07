import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Spin } from 'antd';
import { useAuthStore } from '@/stores/authStore';

interface AuthGuardProps {
  children: React.ReactNode;
}

/**
 * 路由守卫：需要登录才能访问的页面
 * - 未初始化时显示 loading
 * - 未登录时重定向到首页并弹出登录框
 */
export function AuthGuard({ children }: AuthGuardProps) {
  const isInitialized = useAuthStore((s) => s.isInitialized);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const openLoginModal = useAuthStore((s) => s.openLoginModal);
  const navigate = useNavigate();
  const location = useLocation();
  const [hasRedirected, setHasRedirected] = useState(false);

  useEffect(() => {
    if (isInitialized && !isAuthenticated && !hasRedirected) {
      // 记录原始路径，登录后可以跳回
      sessionStorage.setItem('auth_redirect', location.pathname);
      setHasRedirected(true);
      openLoginModal();
      navigate('/', { replace: true });
    }
  }, [isInitialized, isAuthenticated, navigate, location, hasRedirected, openLoginModal]);

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
    return null;
  }

  return <>{children}</>;
}
