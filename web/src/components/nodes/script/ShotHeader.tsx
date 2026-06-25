import { memo } from 'react';
import { Button, Typography } from 'antd';
import { ExportOutlined, CalendarOutlined, PlusOutlined, RightOutlined, LeftOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { ScriptNodeData } from '@/types/canvas';

const { Text } = Typography;

interface ShotHeaderProps {
  data: Pick<ScriptNodeData, 'label' | 'author' | 'createdAt' | 'shots'>;
  onExport?: () => void;
  onAddShot?: () => void;
  /** 下一步按钮文案，null 时不显示 */
  nextStepLabel?: string | null;
  onNextStep?: () => void;
  nextLoading?: boolean;
  /** 上一步按钮文案，null 时不显示 */
  prevStepLabel?: string | null;
  onPrevStep?: () => void;
  prevLoading?: boolean;
}

export const ShotHeader = memo<ShotHeaderProps>(function ShotHeader({
  data,
  onExport,
  onAddShot,
  nextStepLabel,
  onNextStep,
  nextLoading,
  prevStepLabel,
  onPrevStep,
  prevLoading,
}) {
  return (
    <div className="flex items-center justify-between">
      {/* 左侧：标题 + 统计（去掉 Avatar） */}
      <div className="flex flex-col">
        <Text strong className="text-sm">{data.label}</Text>
        <Text type="secondary" className="text-[11px]">
          {data.shots.length} 条镜头已拆至新场景
          {data.createdAt && (
            <span className="ml-2">
              <CalendarOutlined className="mr-0.5" />
              {dayjs(data.createdAt).format('YYYY/MM/DD')}
            </span>
          )}
        </Text>
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
        {onExport && (
          <Button
            size="small"
            icon={<ExportOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              onExport?.();
            }}
            className="text-xs"
          >
            导出
          </Button>
        )}
      </div>
    </div>
  );
});
