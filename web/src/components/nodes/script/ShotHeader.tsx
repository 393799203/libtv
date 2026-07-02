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
            icon={<PlusOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              onAddShot();
            }}
            className="text-xs"
          >
            添加镜头
          </Button>
        )}
        {prevStepLabel && onPrevStep && (
          <Button
            size="small"
            icon={<LeftOutlined />}
            loading={prevLoading}
            onClick={(e) => {
              e.stopPropagation();
              onPrevStep();
            }}
            className="text-xs"
          >
            {prevStepLabel}
          </Button>
        )}
        {nextStepLabel && onNextStep && (
          <Button
            size="small"
            type="primary"
            icon={<RightOutlined />}
            loading={nextLoading}
            onClick={(e) => {
              e.stopPropagation();
              onNextStep();
            }}
            className="text-xs"
          >
            {nextStepLabel}
          </Button>
        )}
      </div>
    </div>
  );
});
