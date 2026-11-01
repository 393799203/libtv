import { memo, useState } from 'react';
import { PlusOutlined, DeleteOutlined, LoadingOutlined } from '@ant-design/icons';
import type { ProjectListItem } from '@/types/project';
import './projectCard.css';

/**
 * 无封面时的兜底图：项目名首字 + 由 id 哈希出的两个色相，本地渲染、零网络请求。
 *
 * 以前这里挂的是 `https://picsum.photos/200/150?random=${project.id}` —— 图库随机图：
 * 同一个 id 结果稳定，但内容与项目毫无关系，几个项目摆在一起完全分不清
 * （用户反馈「退出后再进来很难找到想继续创作的项目」）；而且它是境外域名，
 * 大陆访问经常超时，卡片会长时间空白。
 *
 * 真封面由后端在视频生成成功时写入（projects.cover_url），所以走到兜底只可能是
 * 「还没生成过视频」或「存量项目尚未回填」。
 */
function fallbackCover(project: ProjectListItem): { background: string; initial: string } {
  let hash = 0;
  for (let i = 0; i < project.id.length; i += 1) {
    hash = (hash * 31 + project.id.charCodeAt(i)) % 360;
  }
  return {
    background: `linear-gradient(135deg, hsl(${hash} 42% 34%), hsl(${(hash + 42) % 360} 48% 16%))`,
    initial: project.name?.trim().charAt(0) || '·',
  };
}

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
  const fallback = fallbackCover(project);
  const [failedCover, setFailedCover] = useState('');
  const hasCover = project.coverUrl && project.coverUrl !== failedCover;
  const date = new Date(project.updatedAt);
  const updated = Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  return (
    <article className="project-card" aria-label={`项目：${project.name}`}>
      <button type="button" className="project-card-open" aria-label={`打开项目：${project.name}`}
        onClick={() => onNavigate(project.id)}>
      <div className="project-card-cover">
      {hasCover ? (
        <img src={project.coverUrl} alt="" className="project-card-media" loading="lazy" decoding="async"
          onError={() => setFailedCover(project.coverUrl)} />
      ) : (
        <div
          className="project-card-media project-card-fallback"
          style={{ background: fallback.background }}
          aria-hidden="true"
        >
          <span>{fallback.initial}</span>
        </div>
      )}
      {project.showStatus === 'published' && (
        <span className="project-card-published">已发布</span>
      )}
      </div>
      <div className="project-card-caption">
        <p title={project.name}>{project.name}</p>
        <span>{updated ? `${updated}更新` : '创作画布'}</span>
      </div>
      </button>
      <button
        type="button"
        aria-label={`删除项目：${project.name}`}
        className="project-card-delete"
        onClick={() => onDelete(project)}
        title="删除项目"
      >
        <DeleteOutlined />
      </button>
    </article>
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
      className="create-project-card"
      onClick={onClick}
      disabled={loading}
      aria-busy={loading}
      aria-label={loading ? '正在创建项目' : '创建一个新项目'}
    >
      <span className="create-project-icon" aria-hidden="true">{loading ? <LoadingOutlined spin /> : <PlusOutlined />}</span>
      <strong>{loading ? '正在创建…' : '开始创作'}</strong>
      <span>新建一张创作画布</span>
    </button>
  );
});
