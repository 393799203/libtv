import { memo } from 'react';
import { Typography, Empty, Badge } from 'antd';
import { useExecutionStore } from '@/stores/executionStore';

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
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="暂无执行记录"
          className="!my-4"
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
