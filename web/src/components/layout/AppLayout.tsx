import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Dropdown, Space, Button, App } from 'antd';
import {
  VideoCameraFilled,
  LogoutOutlined,
  ControlOutlined,
  SettingOutlined,
  GoldOutlined,
  AccountBookOutlined,
  FolderOutlined,
  ShopOutlined,
  CommentOutlined,
  ReadOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { useAuthStore } from '@/stores/authStore';
import { useIsMobile } from '@/hooks/useIsMobile';
import { ProfileSettingsModal } from '@/components/auth/ProfileSettingsModal';
import { AssetLibraryModal } from '@/components/auth/AssetLibraryModal';
import { BillingRecordsModal } from '@/components/auth/BillingRecordsModal';
import { PointsMallModal } from '@/components/auth/PointsMallModal';
import { getUserAvatarSrc } from '@/utils/avatar';
import { useCreditsSync } from '@/hooks/useCreditsSync';

const { Header: AntHeader, Content } = Layout;

// 论坛里那篇《漫蛙AI 使用指南》帖子的 id，导航中间的「漫蛙AI使用指南」入口指向它。
// 这里写死 id 而不是"动态找一篇教程"：导航入口需要稳定；帖子若被删掉，
// 这个入口会进 404，届时改这一行或换一篇帖子即可。
const GUIDE_POST_ID = 'ff69a939-9e29-427c-bc86-4478869bf36a';

export function AppLayout() {
  // 全局头部显示余额：进页面拉一次 + 窗口聚焦再拉（余额可能在别处被扣/被退/被充）
  useCreditsSync();

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
  const [showPointsMall, setShowPointsMall] = useState(false);

  const handleLogout = () => {
    logout();
    message.success('已退出登录');
  };

  // 移动端 <768px：用于菜单项这类无法用 CSS 表达的差异
  const isMobile = useIsMobile();

  const userMenuItems: MenuProps['items'] = isMobile
    ? [
        // 移动端只留退出登录：个人设置/资产管理/费用明细本身是桌面布局，手机上进不去也没法用
        { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true, onClick: handleLogout },
      ]
    : [
        { key: 'profile', icon: <SettingOutlined />, label: '个人设置', onClick: () => setShowProfileSettings(true) },
        { key: 'assets', icon: <FolderOutlined />, label: '资产管理', onClick: () => setShowAssetLibrary(true) },
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
      {/* 底色不再写死 !bg-white（Tailwind 的 ! 强制类会绕过主题映射，导致"白底白字"），
            改由 ConfigProvider 的暗色 headerBg 提供；再压深一档，让导航文字对比更强 */}
        <AntHeader className="!py-0 !pl-4 !pr-2 md:!px-4 !h-14 md:!h-12 flex items-center justify-between border-b border-[#232427] !leading-none">
        <div className="flex items-center gap-1.5 md:gap-3">
          <button onClick={() => navigate('/')} className="flex items-center gap-2 md:gap-3 text-gray-800 hover:opacity-80 transition-opacity cursor-pointer">
            {/* 品牌标：白色"实心"相机（原先是蓝色线性描边图标 —— 蓝色在头部跟导航激活态撞色，
                线性描边在玻璃暗底上也偏轻、不像一个"标"）。实心白在暗底上最干净、对比最足。
                颜色写在 button 上让它继承：antd 的 .anticon{color:inherit} 是运行时注入的
                （排在静态样式表之后，同特异度下永远赢），直接写在图标上的 text-white 会被盖掉 ——
                这就是社区入口那段注释里踩过的同一个坑。 */}
            <VideoCameraFilled className="text-lg shrink-0" />
            <span className="font-semibold text-base text-gray-800">漫蛙</span>
          </button>
          {/* 移动端隐藏：390px 宽的头部放不下，且社区/积分超市入口更需要位置 */}
          <span className="hidden sm:inline-block w-px h-4 bg-gray-200 mx-1.5 align-middle" />
          <span className="hidden md:inline text-sm text-gray-400">AI 视频创作工作台</span>
          {/* 论坛入口：放在登录态判断之外——论坛是公开可读的，
              未登录访客（含从 banner 活动落地进来的）也要能看到这个入口
              移动端保留入口但不显示图标（只留文字） */}
          <span className="hidden sm:inline-block w-px h-4 bg-gray-200 mx-1.5 align-middle" />
          <button
            onClick={() => navigate('/forum')}
            className={`flex flex-row items-center justify-center gap-0.5 md:gap-1.5 w-auto h-10 md:h-auto rounded-lg px-2.5 md:px-3 py-0 md:py-1.5 text-[12px] md:text-[13px] leading-none cursor-pointer transition-colors ${
              location.pathname.startsWith('/forum')
                ? 'bg-blue-50 text-blue-600'
                : 'text-gray-600 hover:bg-blue-50 hover:text-blue-600'
            }`}
          >
            {/* 移动端不显示图标。这里必须用外层 span 控制显隐：
                antd 图标自带 .anticon{display:inline-flex}，与 Tailwind 的 display 工具类同特异度，
                而 antd 样式是运行时注入的（在静态样式表之后），所以给图标加 hidden 永远赢不了。 */}
            <span className="hidden md:inline-flex">
              <CommentOutlined className="text-[18px] md:text-[14px]" />
            </span>
            漫蛙社区
          </button>
        </div>

        {/* 使用指南入口：放在导航正中间（左组与右组之间） */}
        <button
          onClick={() => navigate(`/forum/${GUIDE_POST_ID}`)}
          className={`hidden cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] transition-colors md:flex ${
            location.pathname === `/forum/${GUIDE_POST_ID}`
              ? 'bg-blue-50 text-blue-600'
              : 'text-gray-600 hover:bg-blue-50 hover:text-blue-600'
          }`}
        >
          <ReadOutlined />
          漫蛙AI使用指南
        </button>

        {isAuthenticated ? (
          <div className="flex items-center gap-2">
            {/* 系统管理入口（仅管理员）。移动端隐藏：390px 头部装不下，且运营管理本身是为 PC 设计的 */}
            {user?.role === 'admin' && (
              <button
                onClick={() => navigate('/admin')}
                className={`hidden md:flex items-center gap-1.5 px-3 py-1.5 text-[13px] rounded-lg transition-colors cursor-pointer ${
                  location.pathname.startsWith('/admin')
                    ? 'text-blue-600 bg-blue-50'
                    : 'text-gray-600 hover:text-blue-600 hover:bg-blue-50'
                }`}
              >
                <ControlOutlined />
                运营管理
              </button>
            )}

            {/* 积分超市入口（移动端也要显示，内边距收窄以便和社区入口并排） */}
            <button
              onClick={() => setShowPointsMall(true)}
              className="hidden md:flex md:flex-row items-center justify-center gap-0.5 md:gap-1.5 w-14 h-12 md:w-auto md:h-auto rounded-xl md:rounded-lg px-0 md:px-3 py-0 md:py-1.5 text-[12px] md:text-[13px] leading-none text-amber-500 transition-colors cursor-pointer hover:text-amber-400 hover:bg-amber-50"
            >
              <ShopOutlined className="text-[18px] md:text-[14px]" />
              积分超市
            </button>

            <Dropdown menu={{ items: userMenuItems }} placement="bottomRight">
              {/* 移动端只剩头像，把点击区补到 44px；左右内边距收紧，避免头像右边留白比左边宽 */}
              <Button type="text" size="small" className="!min-h-[44px] md:!min-h-0 !px-1 md:!px-2">
                {/* 用普通 flex 取代 AntD Space：Space 会给每个子元素套 .ant-space-item，
                    被 hidden 的昵称/积分仍在那里占位，头像右边就多出 ~17px 留白 */}
                <span className="flex items-center gap-2">
                  <img 
                    src={getUserAvatarSrc(user)} 
                    alt="" 
                    className="w-7 h-7 md:w-6 md:h-6 rounded-full ring-2 ring-gray-100 border border-gray-200" 
                  />
                  <span className="hidden sm:inline text-sm">{user?.nickname ?? '用户'}</span>
                  <span className="hidden sm:inline text-[12px] text-amber-500 font-medium">
                    <GoldOutlined className="mr-0.5" />
                    {user?.credits ?? 0} 积分
                  </span>
                </span>
              </Button>
            </Dropdown>

            {/* 个人设置弹窗（条件挂载，打开时重新初始化表单） */}
            {showProfileSettings && <ProfileSettingsModal onClose={() => setShowProfileSettings(false)} />}

            {/* 个人资产库弹窗 */}
            {showAssetLibrary && <AssetLibraryModal onClose={() => setShowAssetLibrary(false)} />}

            {/* 费用明细弹窗 */}
            {showBillingRecords && <BillingRecordsModal onClose={() => setShowBillingRecords(false)} />}

            {/* 积分超市弹窗 */}
            {showPointsMall && <PointsMallModal onClose={() => setShowPointsMall(false)} />}
          </div>
        ) : (
          <button
            onClick={() => openLoginModal()}
            className="px-4 py-1.5 text-sm text-white rounded-lg transition-all duration-200 hover:shadow-lg hover:scale-105 active:scale-95"
            style={{
              background: 'linear-gradient(135deg, #33353a 0%, #26282c 50%, #1a1b1e 100%)',
              border: '1px solid rgba(255,255,255,0.1)',
            }}
          >
            登录
          </button>
        )}
      </AntHeader>

      <Content className="page-bg overflow-auto">
        <Outlet />
      </Content>
    </Layout>
  );
}
