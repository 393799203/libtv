import { memo } from 'react';
import { Card, Spin, Typography } from 'antd';
import { PlusOutlined, DeleteOutlined, LoadingOutlined } from '@ant-design/icons';
import type { ProjectListItem } from '@/types/project';

const { Text } = Typography;

// 项目卡片组件（首页「最近项目」与「我的项目」页共用）- 使用memo优化
export const ProjectCard = memo(function ProjectCard({
  project,
  onNavigate,
  onDelete,
}: {
  project: ProjectListItem;
  onNavigate: (id: string) => void;
  onDelete: (project: ProjectListItem) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`打开项目：${project.name}`}
      className="project-card tech-card group relative h-32 w-full overflow-hidden rounded-xl border border-white/[0.06] bg-gray-100 text-left cursor-pointer focus-visible:outline-none"
      onClick={() => onNavigate(project.id)}
      style={{
        willChange: 'transform', // 提示Chrome优化
        contain: 'layout style paint', // CSS containment优化
      }}
    >
      {project.coverUrl ? (
        <img src={project.coverUrl} alt="" className="project-card-media w-full h-full object-cover" loading="lazy" />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-gray-100">
          <img src={`https://picsum.photos/200/150?random=${project.id}`} alt="" className="project-card-media w-full h-full object-cover" loading="lazy" />
        </div>
      )}
      {/* 已发布三角角标（右上角缎带，不响应点击，避免挡住卡片跳转） */}
      {project.showStatus === 'published' && (
        <div className="absolute top-0 right-0 w-16 h-16 overflow-hidden pointer-events-none z-10">
          <div className="absolute top-[13px] right-[-29px] w-[88px] text-center rotate-45 bg-gradient-to-r from-emerald-500 to-green-500 text-white text-[10px] font-medium leading-4 shadow-sm">
            已发布
          </div>
        </div>
      )}
      {/* 删除按钮：桌面 hover 显示；移动端恒显示并放大到 36px
          —— 触摸屏没有 hover，原来 opacity-0 group-hover:opacity-100 等于手机上根本点不到 */}
      <span
        role="button"
        tabIndex={0}
        aria-label={`删除项目：${project.name}`}
        className="absolute top-1.5 right-1.5 z-20 w-7 h-7 max-md:w-9 max-md:h-9 flex items-center justify-center rounded-lg border border-white/10 bg-black/55 text-white hover:bg-red-500 active:scale-90 cursor-pointer opacity-0 max-md:opacity-100 group-hover:opacity-100 transition-all"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(project);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            onDelete(project);
          }
        }}
        title="删除项目"
      >
        <DeleteOutlined className="text-[12px] max-md:text-[16px]" />
      </span>
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/45 to-transparent px-3 pb-2.5 pt-10">
        <p className="!mb-0 !text-white !text-[13px] md:!text-xs truncate">{project.name}</p>
        <p className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-white/45">
          {project.showStatus === 'published' ? 'Published' : 'Canvas ready'}
        </p>
      </div>
    </button>
  );
});

// 新建项目卡片（虚线「开始创作」，首页与「我的项目」页共用）
export const CreateProjectCard = memo(function CreateProjectCard({
  onClick,
  loading = false,
}: {
  onClick: () => void;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      className="create-project-card tech-create-card group relative h-32 w-full overflow-hidden rounded-xl text-left cursor-pointer disabled:cursor-wait"
      onClick={onClick}
      disabled={loading}
      aria-busy={loading}
      aria-label={loading ? '正在创建项目' : '创建一个新项目'}
    >
      <Card
        hoverable
        className="!h-full !rounded-xl border-dashed border-cyan-400/20 overflow-hidden"
        styles={{ body: { padding: 0, height: '100%' } }}
      >
        <div className="relative h-full bg-gray-50 flex flex-col items-center justify-center">
          <div className="relative mb-2 flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-300/20 bg-cyan-400/[0.08] text-cyan-200 shadow-[0_0_30px_rgba(34,211,238,0.12)]">
            {loading ? <Spin indicator={<LoadingOutlined spin />} size="small" /> : <PlusOutlined />}
          </div>
          <Text type="secondary" className="relative text-xs">
            {loading ? '正在创建创作空间…' : '开始创作'}
          </Text>
          <span className="relative mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-cyan-200/55">
            Init canvas
          </span>
        </div>
      </Card>
    </button>
  );
});
