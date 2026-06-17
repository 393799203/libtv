import { memo } from 'react';
import { Avatar, Button, Typography } from 'antd';
import { ExportOutlined, CalendarOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { ScriptNodeData } from '@/types/canvas';

const { Text } = Typography;

interface ShotHeaderProps {
  data: Pick<ScriptNodeData, 'label' | 'author' | 'createdAt' | 'shots'>;
  onExport?: () => void;
}

export const ShotHeader = memo<ShotHeaderProps>(function ShotHeader({ data, onExport }) {
  return (
    <div className="flex items-center justify-between">
      {/* 左侧：用户信息 + 统计 */}
      <div className="flex items-center gap-3">
        <Avatar size={36} className="!bg-blue-500 !text-xs">
          {(data.author || '用户').charAt(0)}
        </Avatar>
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
      </div>

      {/* 右侧：操作按钮 */}
      <div className="flex items-center gap-2">
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
      </div>
    </div>
  );
});
