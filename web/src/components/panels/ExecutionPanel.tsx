import { memo } from 'react';
import { Typography, Badge } from 'antd';
import { useExecutionStore } from '@/stores/executionStore';
import { HistoryOutlined } from '@ant-design/icons';
import { EmptyState } from '@/components/common/EmptyState';

const { Title } = Typography;

export const ExecutionPanel = memo(function ExecutionPanel() {
  const currentExecution = useExecutionStore((s) => s.currentExecution);
  const status = useExecutionStore((s) => s.status);

  if (!currentExecution) {
    return (
      <div className="p-3">
        <Title level={5} className="!mb-3 !text-sm">
          执行控制台
        </Title>
        <EmptyState
          size="sm"
          icon={<HistoryOutlined />}
          title="暂无执行记录"
          hint="生成任务开始后，这里会显示排队顺序、进度与耗时"
        />
      </div>
    );
  }

  return (
    <div className="p-3">
      <Title level={5} className="!mb-3 !text-sm flex items-center gap-2">
        执行控制台
        <Badge
          status={
            status === 'running' ? 'processing' :
            status === 'completed' ? 'success' :
            status === 'failed' ? 'error' : 'default'
          }
        />
      </Title>
      <div className="space-y-1 text-xs max-h-32 overflow-auto">
        {currentExecution.nodes.map((node) => (
          <div key={node.nodeId} className="flex items-center justify-between py-0.5">
            <span className="text-gray-600 truncate">{node.nodeId}</span>
            <Badge
              status={
                node.status === 'running' ? 'processing' :
                node.status === 'success' ? 'success' :
                node.status === 'failed' ? 'error' : 'default'
              }
              text={<span className="text-[10px]">{node.status}</span>}
            />
          </div>
        ))}
      </div>
    </div>
  );
});
