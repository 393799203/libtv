import { useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Dropdown, Button, App } from 'antd';
import {
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
import { BrandLogo } from '@/components/layout/BrandLogo';
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
        <div className="tech-boot" role="status" aria-live="polite">
          <div className="tech-boot-core">
            <BrandLogo size={28} wordClass="h-[18px]" />
          </div>
          <p>正在同步创作空间</p>
          <span>INITIALIZING WORKSPACE</span>
        </div>
      </Layout>
    );
  }

  return (
    <Layout className="h-screen">
      {/* 底色不再写死 !bg-white（Tailwind 的 ! 强制类会绕过主题映射，导致"白底白字"），
            改由 ConfigProvider 的暗色 headerBg 提供；再压深一档，让导航文字对比更强 */}
        <AntHeader className="tech-header !py-0 !pl-4 !pr-2 md:!px-4 !h-14 md:!h-12 flex items-center justify-between border-b border-[#232427] !leading-none">
        <span className="tech-header-scan" aria-hidden="true" />
        <div className="flex items-center gap-1.5 md:gap-3">
          <button
            type="button"
            onClick={() => navigate('/')}
            aria-label="返回首页"
            className="group flex cursor-pointer items-center gap-2 rounded-lg transition-all hover:brightness-110 active:scale-[0.98] md:gap-3"
          >
            {/* 品牌标：矢量描摹标（见 BrandMarkTraced.tsx，从用户提供的那张图描摹而来），替掉原来那颗通用相机图标 ——
                antd 的 VideoCameraFilled 是"通用图标库里的相机"，谁都能用，配一行普通字重的文字
                读起来就是"干燥的文字"，不像一枚品牌标。
                现在是：开口圆环（镜筒/眼白）+ 偏移实心圆（瞳孔，也是镜头高光），
                字标两个字形共用一条青→蓝→紫→品红的横向渐变。
                另外三个候选方向见 web/public/logo-lab.html。
                H5 上标缩到 24px、字缩到 15px，跟头部的紧凑尺寸对齐。 */}
            <BrandLogo size={28} wordClass="h-[17px] md:h-[18px]" markClass="max-sm:h-5 max-sm:w-auto" />
            <span className="tech-brand-pulse hidden h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_10px_#22d3ee] md:block" aria-hidden="true" />
          </button>
          {/* 移动端隐藏：390px 宽的头部放不下，且社区/积分超市入口更需要位置 */}
          <span className="hidden sm:inline-block w-px h-4 bg-gray-200 mx-1.5 align-middle" />
          <span className="hidden md:inline text-sm text-gray-400">AI 视频创作工作台</span>
          {/* 论坛入口：放在登录态判断之外——论坛是公开可读的，
              未登录访客（含从 banner 活动落地进来的）也要能看到这个入口
              移动端保留入口但不显示图标（只留文字） */}
          <span className="hidden sm:inline-block w-px h-4 bg-gray-200 mx-1.5 align-middle" />
          <button
            type="button"
            onClick={() => navigate('/forum')}
            aria-current={location.pathname.startsWith('/forum') ? 'page' : undefined}
            className={`tech-nav-item flex h-10 w-auto cursor-pointer flex-row items-center justify-center gap-0.5 rounded-lg px-2.5 py-0 text-[12px] leading-none transition-all md:h-auto md:gap-1.5 md:px-3 md:py-1.5 md:text-[13px] ${
              location.pathname.startsWith('/forum')
                ? 'bg-cyan-400/10 text-cyan-200'
                : 'text-gray-400 hover:bg-cyan-400/[0.07] hover:text-cyan-100'
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
          type="button"
          onClick={() => navigate(`/forum/${GUIDE_POST_ID}`)}
          className={`tech-nav-item hidden cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] transition-all md:flex ${
            location.pathname === `/forum/${GUIDE_POST_ID}`
              ? 'bg-cyan-400/10 text-cyan-200'
              : 'text-gray-400 hover:bg-cyan-400/[0.07] hover:text-cyan-100'
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
                type="button"
                onClick={() => navigate('/admin')}
                className={`tech-nav-item hidden cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] transition-all md:flex ${
                  location.pathname.startsWith('/admin')
                    ? 'bg-cyan-400/10 text-cyan-200'
                    : 'text-gray-400 hover:bg-cyan-400/[0.07] hover:text-cyan-100'
                }`}
              >
                <ControlOutlined />
                运营管理
              </button>
            )}

            {/* 积分超市入口（移动端也要显示，内边距收窄以便和社区入口并排） */}
            <button
              type="button"
              onClick={() => setShowPointsMall(true)}
              className="tech-credits hidden h-12 w-14 cursor-pointer items-center justify-center gap-0.5 rounded-xl px-0 py-0 text-[12px] leading-none text-amber-300 transition-all hover:border-amber-300/30 hover:bg-amber-300/10 hover:text-amber-200 md:flex md:h-auto md:w-auto md:flex-row md:gap-1.5 md:rounded-lg md:px-3 md:py-1.5 md:text-[13px]"
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
            type="button"
            onClick={() => openLoginModal()}
            className="tech-login-button rounded-lg px-4 py-1.5 text-sm font-medium text-cyan-50 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97]"
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
