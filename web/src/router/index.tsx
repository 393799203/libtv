import { lazy, Suspense } from 'react';
import {
  createBrowserRouter,
  Navigate,
  type RouteObject,
} from 'react-router-dom';
import { Spin } from 'antd';
import { AppLayout } from '@/components/layout/AppLayout';
import { AuthGuard } from '@/components/auth/AuthGuard';

// 懒加载页面
const WorkspacePage = lazy(() => import('@/pages/workspace/WorkspacePage'));
const VideoListPage = lazy(() => import('@/pages/videos/VideoListPage'));
const VideoDetailPage = lazy(() => import('@/pages/videos/VideoDetailPage'));
const AIModelsPage = lazy(() => import('@/pages/ai-models/AIModelsPage'));
const SettingsPage = lazy(() => import('@/pages/settings/SettingsPage'));
const AdminPage = lazy(() => import('@/pages/admin/AdminPage'));

const Loading = () => (
  <div className="w-full h-screen flex items-center justify-center">
    <Spin size="large" />
  </div>
);

const LazyLoad = ({ children }: { children: React.ReactNode }) => (
  <Suspense fallback={<Loading />}>{children}</Suspense>
);

export const routes: RouteObject[] = [
  // 视频详情页（全屏，公开，无需登录）
  {
    path: 'videos/:id',
    element: (
      <LazyLoad>
        <VideoDetailPage />
      </LazyLoad>
    ),
  },
  {
    path: '/',
    element: <AppLayout />,
    children: [
      {
        index: true,
        element: (
          <LazyLoad>
            <VideoListPage />
          </LazyLoad>
        ),
      },
      // 需要认证的页面：用 AuthGuard 包裹
      {
        path: 'project/:projectId',
        element: (
          <AuthGuard>
            <LazyLoad>
              <WorkspacePage />
            </LazyLoad>
          </AuthGuard>
        ),
      },
      {
        path: 'ai-models',
        element: (
          <AuthGuard>
            <LazyLoad>
              <AIModelsPage />
            </LazyLoad>
          </AuthGuard>
        ),
      },
      {
        path: 'settings',
        element: (
          <AuthGuard>
            <LazyLoad>
              <SettingsPage />
            </LazyLoad>
          </AuthGuard>
        ),
      },
      {
        path: 'admin/:tab?',
        element: (
          <AuthGuard>
            <LazyLoad>
              <AdminPage />
            </LazyLoad>
          </AuthGuard>
        ),
      },
    ],
  },
  {
    path: '*',
    element: <Navigate to="/" replace />,
  },
];

export const router = createBrowserRouter(routes);
