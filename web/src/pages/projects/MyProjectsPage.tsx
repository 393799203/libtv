import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { App, Button, Pagination, Spin, Typography } from 'antd';
import { PlusOutlined, FolderOpenOutlined } from '@ant-design/icons';
import { projectApi } from '@/services/projectApi';
import { useAuthStore } from '@/stores/authStore';
import type { ProjectListItem } from '@/types/project';
import { ProjectCard } from '@/components/project/ProjectCard';
import { usePageMeta } from '@/hooks/usePageMeta';
import { EmptyState } from '@/components/common/EmptyState';

const { Title, Text } = Typography;

const PAGE_SIZE = 20;

/**
 * 我的项目落地页：全量项目网格 + 分页
 * 首页「最近项目」最多展示两行，超出部分引导到本页
 */
export default function MyProjectsPage() {
  // 应用内页：不被搜索引擎收录（nginx 的 add_header 到不了这里，见 web/libtv-app.conf 说明）
  usePageMeta({ title: '我的项目', noindex: true });
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [creating, setCreating] = useState(false);

  const loadProjects = useCallback(async (p: number) => {
    if (!isAuthenticated) return;
    setLoading(true);
    setLoadError(false);
    try {
      const data = await projectApi.getProjects(p, PAGE_SIZE);
      setProjects(data.list || []);
      setTotal(data.total || 0);
      setPage(data.page || p);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => { loadProjects(1); }, [loadProjects]);

  // 新建项目并进入工作区
  const handleCreateProject = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      const project = await projectApi.createProject({ name: '未命名', description: '' });
      message.success('创作空间已就绪');
      navigate(`/project/${project.id}`);
    } catch {
      // HTTP 错误已由 api.ts 拦截器统一 message.error()
    } finally {
      setCreating(false);
    }
  }, [creating, message, navigate]);

  // 删除项目：刷新当前页；若删空且非第一页则回退一页
  const handleDeleteProject = useCallback((project: ProjectListItem) => {
    modal.confirm({
      title: '确认删除',
      content: `确定要删除项目「${project.name}」吗？此操作不可恢复。`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await projectApi.deleteProject(project.id);
          message.success('项目已删除');
          if (projects.length === 1 && page > 1) {
            loadProjects(page - 1);
          } else {
            loadProjects(page);
          }
        } catch {
          // HTTP 错误已由 api.ts 拦截器统一 message.error()
        }
      },
    });
  }, [modal, message, projects.length, page, loadProjects]);

  return (
    <div className="min-h-screen page-bg pb-20">
      <div className="library-shell pt-8 md:pt-10">
        {/* 标题栏 */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <div className="flex items-baseline gap-2">
              <Title level={4} className="!mb-0">我的项目</Title>
              <Text type="secondary" className="text-[13px]">共 {total} 个</Text>
            </div>
          </div>
          <Button
            type="primary"
            className="max-md:!h-11"
            icon={<PlusOutlined />}
            loading={creating}
            aria-busy={creating}
            onClick={handleCreateProject}
          >
            {creating ? '正在创建…' : '新建项目'}
          </Button>
        </div>

        {loadError && <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--dv-border-1)] bg-[var(--dv-surface-1)] p-4" role="alert">
          <span className="text-sm text-[var(--dv-text-2)]">项目列表暂时无法加载，已保留当前内容。</span>
          <Button onClick={() => void loadProjects(page)}>重新加载</Button>
        </div>}
        <Spin spinning={loading && projects.length > 0}>
          <div style={{ minHeight: '240px' }}>
            {loading && !projects.length ? (
              <div className="library-project-grid" role="status" aria-label="正在加载项目">
                {Array.from({ length: 5 }, (_, i) => <div key={i} className="project-card-skeleton" />)}
              </div>
            ) : !loadError && projects.length === 0 ? (
              <EmptyState icon={<FolderOpenOutlined />} title="从第一个项目开始"
                hint="在画布中组织故事、分镜和素材，保存后可随时回来继续创作。"
                action={<Button type="primary" icon={<PlusOutlined />} loading={creating} onClick={() => void handleCreateProject()}>新建项目</Button>} />
            ) : (
              <div className="library-project-grid">
                {/* 有项目时保持内容网格；空状态提供就地的新建操作。 */}
                {projects.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    onNavigate={(id) => navigate(`/project/${id}`)}
                    onDelete={handleDeleteProject}
                  />
                ))}
              </div>
            )}
          </div>
        </Spin>

        {/* 分页 */}
        {total > PAGE_SIZE && (
          <div className="flex justify-end mt-6">
            <Pagination
              current={page}
              pageSize={PAGE_SIZE}
              total={total}
              showSizeChanger={false}
              onChange={(p) => loadProjects(p)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
