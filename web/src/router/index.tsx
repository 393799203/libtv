import { lazy, Suspense } from 'react';
import {
  createBrowserRouter,
  Navigate,
  Outlet,
  type RouteObject,
} from 'react-router-dom';
import { Spin } from 'antd';
import { AppLayout } from '@/components/layout/AppLayout';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { GlobalComponents } from '@/components/GlobalComponents';

// 懒加载页面
const WorkspacePage = lazy(() => import('@/pages/workspace/WorkspacePage'));
const VideoListPage = lazy(() => import('@/pages/videos/VideoListPage'));
const VideoDetailPage = lazy(() => import('@/pages/videos/VideoDetailPage'));
const MyProjectsPage = lazy(() => import('@/pages/projects/MyProjectsPage'));
const AIModelsPage = lazy(() => import('@/pages/ai-models/AIModelsPage'));
const AdminPage = lazy(() => import('@/pages/admin/AdminPage'));
const PrevizEditor = lazy(() => import('@/pages/previz/PrevizEditor'));
const ForumListPage = lazy(() => import('@/pages/forum/ForumListPage'));
const ForumPostPage = lazy(() => import('@/pages/forum/ForumPostPage'));

const Loading = () => (
  <div className="w-full h-screen flex items-center justify-center">
    <Spin size="large" />
  </div>
);

const LazyLoad = ({ children }: { children: React.ReactNode }) => (
  <Suspense fallback={<Loading />}>{children}</Suspense>
);

export const routes: RouteObject[] = [
  {
    element: (
      <>
        <GlobalComponents />
        <Outlet />
      </>
    ),
    children: [
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
          // 论坛：公开可读（要能当首页 banner 的活动落地页），发帖/回复在页面内自行要求登录
          {
            path: 'forum',
            element: (
              <LazyLoad>
                <ForumListPage />
              </LazyLoad>
            ),
          },
          {
            path: 'forum/:postId',
            element: (
              <LazyLoad>
                <ForumPostPage />
              </LazyLoad>
            ),
          },
          // 需要认证的页面：用 AuthGuard 包裹
          {
            path: 'projects',
            element: (
              <AuthGuard>
                <LazyLoad>
                  <MyProjectsPage />
                </LazyLoad>
              </AuthGuard>
            ),
          },
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
            path: 'project/:projectId/previz/:nodeId',
            element: (
              <AuthGuard>
                <LazyLoad>
                  <PrevizEditor />
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
    ],
  },
];

export const router = createBrowserRouter(routes);
