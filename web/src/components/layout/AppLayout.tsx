import { useEffect, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Dropdown, Avatar, Space, Button, App } from 'antd';
import {
  VideoCameraOutlined,
 UserOutlined,
  LogoutOutlined,
  ControlOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { useAuthStore } from '@/stores/authStore';
import { LoginModal } from '@/components/auth/LoginModal';

const { Header: AntHeader, Content } = Layout;

export function AppLayout() {
  const { message } = App.useApp();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isInitialized = useAuthStore((s) => s.isInitialized);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const openLoginModal = useAuthStore((s) => s.openLoginModal);
  const navigate = useNavigate();
  const location = useLocation();

  // 应用启动时初始化认证状态
  useEffect(() => {
    useAuthStore.getState().initialize();
  }, []);

  const handleLogout = () => {
    logout();
    message.success('已退出登录');
  };

  const userMenuItems: MenuProps['items'] = [
    { type: 'divider' },
    { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true, onClick: handleLogout },
  ];

  // 工作台页面使用全屏布局
  const isWorkspace = location.pathname.startsWith('/project/');

  if (isWorkspace) {
    return (
      <Layout className="h-screen">
        <Content className="relative overflow-hidden">
          <Outlet />
        </Content>
        <LoginModal />
      </Layout>
    );
  }

  // 未初始化完成时显示 loading
  if (!isInitialized) {
    return (
      <Layout className="h-screen flex items-center justify-center">
        <div className="text-gray-400">加载中...</div>
        <LoginModal />
      </Layout>
    );
  }

  return (
    <Layout className="h-screen">
      <AntHeader className="!bg-white !px-4 !h-12 flex items-center justify-between border-b border-gray-200 shadow-sm !leading-none">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} className="flex items-center gap-3 hover:opacity-80 transition-opacity cursor-pointer">
            <VideoCameraOutlined className="text-lg text-blue-500" />
            <span className="font-semibold text-base text-gray-800">LibTV</span>
          </button>
          <span className="text-gray-300">|</span>
          <span className="text-sm text-gray-400">AI 视频创作工作台</span>
        </div>

        {isAuthenticated ? (
          <div className="flex items-center gap-2">
            {/* 系统管理入口（仅管理员） */}
            {user?.role === 'admin' && (
              <button
                onClick={() => navigate('/admin')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-[13px] rounded-lg transition-colors cursor-pointer ${
                  location.pathname.startsWith('/admin')
                    ? 'text-blue-600 bg-blue-50'
                    : 'text-gray-600 hover:text-blue-600 hover:bg-blue-50'
                }`}
              >
                <ControlOutlined />
                运营管理
              </button>
            )}

            <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
              <Button type="text" size="small">
                <Space>
                  <Avatar size={24} icon={<UserOutlined />} src={user?.avatarUrl || undefined} />
                  <span className="text-sm">{user?.nickname ?? '用户'}</span>
                </Space>
              </Button>
            </Dropdown>
          </div>
        ) : (
          <button
            onClick={() => openLoginModal()}
            className="px-4 py-1.5 text-sm text-white rounded-lg transition-all duration-200 hover:shadow-lg hover:scale-105 active:scale-95"
            style={{
              background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
              border: '1px solid rgba(255,255,255,0.1)',
            }}
          >
            登录
          </button>
        )}
      </AntHeader>

      <Content className="bg-white overflow-auto">
        <Outlet />
      </Content>

      <LoginModal />
    </Layout>
  );
}
