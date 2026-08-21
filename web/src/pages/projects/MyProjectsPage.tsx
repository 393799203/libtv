import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { App, Button, Pagination, Spin, Typography } from 'antd';
import { PlusOutlined, FolderOpenOutlined } from '@ant-design/icons';
import { projectApi } from '@/services/projectApi';
import { useAuthStore } from '@/stores/authStore';
import type { ProjectListItem } from '@/types/project';
import { ProjectCard, CreateProjectCard } from '@/components/project/ProjectCard';

const { Title, Text } = Typography;

const PAGE_SIZE = 20;

/**
 * 我的项目落地页：全量项目网格 + 分页
 * 首页「最近项目」最多展示两行，超出部分引导到本页
 */
export default function MyProjectsPage() {
  const navigate = useNavigate();
  const { message, modal } = App.useApp();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const loadProjects = useCallback(async (p: number) => {
    if (!isAuthenticated) return;
    setLoading(true);
    try {
      const data = await projectApi.getProjects(p, PAGE_SIZE);
      setProjects(data.list || []);
      setTotal(data.total || 0);
      setPage(data.page || p);
    } catch {
      // HTTP 错误已由 api.ts 拦截器统一 message.error()
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => { loadProjects(1); }, [loadProjects]);

  // 新建项目并进入工作区
  const handleCreateProject = useCallback(async () => {
    try {
      const project = await projectApi.createProject({ name: '未命名', description: '' });
      navigate(`/project/${project.id}`);
    } catch {
      // HTTP 错误已由 api.ts 拦截器统一 message.error()
    }
  }, [navigate]);

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
    <div className="min-h-screen bg-white pb-20">
      <div className="max-w-7xl mx-auto px-6 pt-8">
        {/* 标题栏 */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-baseline gap-2">
            <Title level={4} className="!mb-0">我的项目</Title>
            <Text type="secondary" className="text-[13px]">共 {total} 个</Text>
          </div>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreateProject}>
            新建项目
          </Button>
        </div>

        <Spin spinning={loading}>
          <div style={{ minHeight: '240px' }}>
            {!loading && projects.length === 0 ? (
              <div className="h-[240px] flex flex-col items-center justify-center text-gray-400">
                <FolderOpenOutlined style={{ fontSize: 36 }} className="mb-3 opacity-40" />
                <div className="text-[14px]">暂无项目，点击右上角「新建项目」开始创作</div>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                <CreateProjectCard onClick={handleCreateProject} />
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
