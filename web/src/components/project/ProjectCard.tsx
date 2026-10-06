import { memo } from 'react';
import { Card, Typography } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
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
    <div
      className="group h-28 bg-gray-100 relative rounded-lg overflow-hidden cursor-pointer hover:shadow-md"
      onClick={() => onNavigate(project.id)}
      style={{
        willChange: 'transform', // 提示Chrome优化
        contain: 'layout style paint', // CSS containment优化
      }}
    >
      {project.coverUrl ? (
        <img src={project.coverUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-gray-100">
          <img src={`https://picsum.photos/200/150?random=${project.id}`} alt="" className="w-full h-full object-cover" loading="lazy" />
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
      <button
        className="absolute top-1 right-1 z-20 w-6 h-6 max-md:w-9 max-md:h-9 flex items-center justify-center rounded bg-black/50 text-white hover:bg-red-500 cursor-pointer opacity-0 max-md:opacity-100 group-hover:opacity-100 transition-opacity"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(project);
        }}
        title="删除项目"
      >
        <DeleteOutlined className="text-[12px] max-md:text-[16px]" />
      </button>
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1.5">
        <p className="!text-white !text-[13px] md:!text-xs truncate">{project.name}</p>
      </div>
    </div>
  );
});

// 新建项目卡片（虚线「开始创作」，首页与「我的项目」页共用）
export const CreateProjectCard = memo(function CreateProjectCard({ onClick }: { onClick: () => void }) {
  return (
    <div>
      <Card
        hoverable
        /* overflow-hidden：卡片内层那个铺满 body 的 div 是直角的（body padding 为 0），
           不裁的话它会顶到卡片边缘，圆角处只剩月牙；而 hover 时 antd 又会把虚线边框
           变成透明（.ant-card-hoverable:hover { border-color: transparent }），
           于是 hover 上去"圆角像没了"。裁到圆角内，形状就一直是对的。
           （裁的是卡片自己的内容，卡片自身的 hover 阴影不受影响。） */
        className="!rounded-lg border-dashed cursor-pointer overflow-hidden"
        styles={{ body: { padding: 0 } }}
        onClick={onClick}
      >
        <div className="h-28 bg-gray-50 flex flex-col items-center justify-center">
          {/* 圆底用中性灰一档（bg-gray-50 卡片底 → surface-2，圆用 bg-gray-200 → surface-3 才看得出圆），
              + 图标按要求用白色（原来是蓝色，在暗底上偏"外链色"，不像"新建"） */}
          <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center mb-2">
            <PlusOutlined className="text-white" />
          </div>
          <Text type="secondary" className="text-xs">开始创作</Text>
        </div>
      </Card>
    </div>
  );
});
