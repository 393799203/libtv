import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Dropdown, Space, Button, App } from 'antd';
import {
  VideoCameraOutlined,
  LogoutOutlined,
  ControlOutlined,
  SettingOutlined,
  GoldOutlined,
  AccountBookOutlined,
  FileOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { useAuthStore } from '@/stores/authStore';
import { ProfileSettingsModal } from '@/components/auth/ProfileSettingsModal';
import { AssetLibraryModal } from '@/components/auth/AssetLibraryModal';
import { BillingRecordsModal } from '@/components/auth/BillingRecordsModal';
import { getUserAvatarSrc } from '@/utils/avatar';

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
  const [showProfileSettings, setShowProfileSettings] = useState(false);
  const [showAssetLibrary, setShowAssetLibrary] = useState(false);
  const [showBillingRecords, setShowBillingRecords] = useState(false);

  const handleLogout = () => {
    logout();
    message.success('已退出登录');
  };

  const userMenuItems: MenuProps['items'] = [
    { key: 'profile', icon: <SettingOutlined />, label: '个人设置', onClick: () => setShowProfileSettings(true) },
    { key: 'assets', icon: <FileOutlined />, label: '资产管理', onClick: () => setShowAssetLibrary(true) },
    { key: 'billing', icon: <AccountBookOutlined />, label: '费用明细', onClick: () => setShowBillingRecords(true) },
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
      </Layout>
    );
  }

  // 未初始化完成时显示 loading
  if (!isInitialized) {
    return (
      <Layout className="h-screen flex items-center justify-center">
        <div className="text-gray-400">加载中...</div>
      </Layout>
    );
  }

  return (
    <Layout className="h-screen">
      <AntHeader className="!bg-white !px-4 !h-12 flex items-center justify-between border-b border-gray-200 shadow-sm !leading-none">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/')} className="flex items-center gap-3 hover:opacity-80 transition-opacity cursor-pointer">
            <VideoCameraOutlined className="text-lg text-blue-500" />
            <span className="font-semibold text-base text-gray-800">漫蛙AI</span>
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
                  <img 
                    src={getUserAvatarSrc(user)} 
                    alt="" 
                    className="w-6 h-6 rounded-full border border-gray-200" 
                  />
                  <span className="text-sm">{user?.nickname ?? '用户'}</span>
                  <span className="text-[12px] text-amber-500 font-medium">
                    <GoldOutlined className="mr-0.5" />
                    {user?.credits ?? 0} 积分
                  </span>
                </Space>
              </Button>
            </Dropdown>

            {/* 个人设置弹窗（条件挂载，打开时重新初始化表单） */}
            {showProfileSettings && <ProfileSettingsModal onClose={() => setShowProfileSettings(false)} />}

            {/* 个人资产库弹窗 */}
            {showAssetLibrary && <AssetLibraryModal onClose={() => setShowAssetLibrary(false)} />}

            {/* 费用明细弹窗 */}
            {showBillingRecords && <BillingRecordsModal onClose={() => setShowBillingRecords(false)} />}
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
    </Layout>
  );
}
