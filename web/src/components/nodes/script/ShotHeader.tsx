import { memo } from 'react';
import { Button, Typography } from 'antd';
import { CalendarOutlined, PlusOutlined, RightOutlined, LeftOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useCanvasStore } from '@/stores/canvasStore';
import type { ScriptNodeData, ScriptCharacter, ScriptScene, ScriptProp } from '@/types/canvas';

const { Text } = Typography;

interface ShotHeaderProps {
  data: Pick<ScriptNodeData, 'label' | 'author' | 'createdAt' | 'shots' | 'characters' | 'scenes' | 'props'>;
  onAddShot?: () => void;
  /** 下一步按钮文案，null 时不显示 */
  nextStepLabel?: string | null;
  onNextStep?: () => void;
  nextLoading?: boolean;
  /** 上一步按钮文案，null 时不显示 */
  prevStepLabel?: string | null;
  onPrevStep?: () => void;
  prevLoading?: boolean;
  /** 是否显示缺少设定图的警告，仅在准备资产阶段显示 */
  showMissingAssetsWarning?: boolean;
}

export const ShotHeader = memo<ShotHeaderProps>(function ShotHeader({
  data,
  onAddShot,
  nextStepLabel,
  onNextStep,
  nextLoading,
  prevStepLabel,
  onPrevStep,
  prevLoading,
  showMissingAssetsWarning,
}) {
  // 计算缺少设定图的数量（通过 nodeId 检查节点是否有图片）
  const nodes = useCanvasStore((s) => s.nodes);

  const missingChars = (data.characters || []).filter((c: ScriptCharacter) => {
    if (!c.nodeId) return true; // 没有关联节点
    const node = nodes.find(n => n.id === c.nodeId);
    return !node?.data?.imageUrl; // 节点不存在或没有图片
  }).length;

  const missingScenes = (data.scenes || []).filter((s: ScriptScene) => {
    if (!s.nodeId) return true;
    const node = nodes.find(n => n.id === s.nodeId);
    return !node?.data?.imageUrl;
  }).length;

  const missingProps = (data.props || []).filter((p: ScriptProp) => {
    if (!p.nodeId) return true;
    const node = nodes.find(n => n.id === p.nodeId);
    return !node?.data?.imageUrl;
  }).length;

  const parts: string[] = [];
  if (missingChars > 0) parts.push(`${missingChars} 个人物角色`);
  if (missingScenes > 0) parts.push(`${missingScenes} 个场景`);
  if (missingProps > 0) parts.push(`${missingProps} 个道具`);

  const hasMissingAssets = parts.length > 0;

  return (
    <div className="flex items-center justify-between">
      {/* 左侧：标题 + 统计（去掉 Avatar） */}
      <div className="flex flex-col">
        <Text strong className="text-sm">{data.label}</Text>
        <div className="flex items-center gap-2 flex-wrap">
          <Text type="secondary" className="text-[11px]">
            {data.shots.length} 条镜头已拆至新场景
            {data.createdAt && (
              <span className="ml-2">
                <CalendarOutlined className="mr-0.5" />
                {dayjs(data.createdAt).format('YYYY/MM/DD')}
              </span>
            )}
          </Text>
          {showMissingAssetsWarning && hasMissingAssets && (
            <Text className="text-[11px] text-orange-600">
              <span className="text-orange-400 mr-1">⚠</span>
              检测到有{parts.join('和')}没有设定图，您可以手动上传或让AI批量生成
            </Text>
          )}
        </div>
      </div>

      {/* 右侧：操作按钮 */}
      <div className="flex items-center gap-2">
        {onAddShot && (
          <Button
            size="small"
            type="primary"
            icon={<PlusOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              onAddShot();
            }}
            /* 三颗按钮都用 ! ：antd 的 CSS-in-JS 是运行时注入的，同特异度下排在 Tailwind 之后，
               不写 ! 的话 h-9 / px-3 / rounded-md / text-xs / bg-* 全都不生效
               （实测：不写 ! 时按钮高 24px、圆角 4px、底色是 antd 默认值 —— 本文件里原有的
               h-9 与 bg-[var(--dv-surface-2)] 其实一直是空转的） */
            className="!text-xs !font-medium !h-9 !px-3 !rounded-md
                       !bg-[var(--dv-surface-3)] !border-[var(--dv-border-1)] !text-[var(--dv-text-1)]
                       hover:!bg-[var(--dv-surface-4)] hover:!border-[var(--dv-border-2)]"
          >
            添加镜头
          </Button>
        )}
        {/* 上一步：次级动作 —— 描边款（透明底 + 一档描边），hover 才浮起一档底色。
            原来是默认按钮 + border-black/hover:border-gray-800：暗色下 border-black 就是隐形边框，
            看着像个"没边框的按钮"，hover 又突然冒出框来。 */}
        {prevStepLabel && onPrevStep && (
          <Button
            size="small"
            icon={<LeftOutlined />}
            loading={prevLoading}
            onClick={(e) => {
              e.stopPropagation();
              onPrevStep();
            }}
            className="!text-xs !font-medium !h-9 !px-3 !rounded-md
                       !bg-transparent !border-[var(--dv-border-1)] !text-[var(--dv-text-2)]
                       hover:!bg-[var(--dv-surface-2)] hover:!border-[var(--dv-border-2)] hover:!text-[var(--dv-text-1)]"
          >
            {prevStepLabel}
          </Button>
        )}
        {/* 下一步：主推进动作 —— 强调色"软"款（浅青底 + 青描边 + 浅青字），
            与「添加镜头」的中性灰底区分开（原来两个都是一样的灰底，分不出主次）。
            箭头放在文字后面：指向"往前走"的方向（iconPosition="end"）。 */}
        {nextStepLabel && onNextStep && (
          <Button
            size="small"
            icon={<RightOutlined />}
            iconPosition="end"
            loading={nextLoading}
            onClick={(e) => {
              e.stopPropagation();
              onNextStep();
            }}
            className="!text-xs !font-medium !h-9 !px-3 !rounded-md
                       !bg-[var(--dv-cyan-soft)] !border-[var(--dv-cyan-border)] !text-[var(--dv-cyan-text)]
                       hover:!bg-[var(--dv-cyan-soft-hover)] hover:!border-[var(--dv-cyan-border-hover)] hover:!text-[var(--dv-cyan-text-strong)]"
          >
            {nextStepLabel}
          </Button>
        )}
      </div>
    </div>
  );
});
