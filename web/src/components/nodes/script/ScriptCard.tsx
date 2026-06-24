import { memo, useCallback } from 'react';
import {
  MenuOutlined,
  RightOutlined,
  FileTextOutlined,
  CodeOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import type { NodeExecutionStatus, ScriptNodeData } from '@/types/canvas';
import { ScriptSteps } from './ScriptSteps';

interface ScriptCardProps {
  data: Pick<ScriptNodeData, 'label' | 'currentStep' | 'shots' | 'scriptContent'>;
  status: NodeExecutionStatus;
  onOpen: () => void;
}

/** 是否有内容（脚本文本或分镜数据） */
function hasContent(data: Pick<ScriptNodeData, 'scriptContent' | 'shots'>): boolean {
  return !!(data.scriptContent?.trim() || data.shots.length > 0);
}

/** 是否正在生成中 */
function isGenerating(status: NodeExecutionStatus): boolean {
  return status === 'running' || status === 'pending';
}

export const ScriptCard = memo<ScriptCardProps>(function ScriptCard({
  data,
  status,
  onOpen,
}) {
  const handleOpenClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onOpen();
    },
    [onOpen]
  );

  const isEmpty = !hasContent(data);
  const generating = isGenerating(status);

  // ========== 生成中状态 ==========
  if (generating) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-6 px-4 min-h-[200px]">
        <div className="flex flex-col items-center gap-3 w-full">
          {/* 动画图标 */}
          <div className="relative w-12 h-12 flex items-center justify-center">
            <div className="absolute inset-0 rounded-xl bg-amber-100 animate-pulse" />
            <LoadingOutlined className="relative text-xl text-amber-500 animate-spin" />
          </div>

          {/* 状态文字 */}
          <span className="text-xs font-medium text-gray-700">
            {status === 'pending' ? '等待生成中...' : '正在生成分镜...'}
          </span>

          {/* 打开按钮（可查看实时进度） */}
          <button
            onClick={handleOpenClick}
            className="mt-1 flex items-center gap-1.5 px-4 py-1.5 rounded-lg border border-amber-300 text-xs text-amber-700 font-medium hover:bg-amber-50 transition-colors cursor-pointer"
          >
            查看详情
            <RightOutlined className="text-[10px]" />
          </button>
        </div>
      </div>
    );
  }

  // ========== 空状态（无内容且不在生成中）==========
  if (isEmpty) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-6 px-4 min-h-[200px]">
        <div className="flex flex-col items-center gap-3">
          {/* 图标 */}
          <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center">
            <CodeOutlined className="text-xl text-amber-400" />
          </div>

          {/* 提示文字 */}
          <div className="flex flex-col items-center gap-1 text-center">
            <span className="text-xs font-medium text-gray-700">脚本节点</span>
            <span className="text-[10px] text-gray-400 leading-relaxed">
              从上游文本节点生成脚本
              <br />
              或手动创建分镜内容
            </span>
          </div>

          {/* 打开按钮 */}
          <button
            onClick={handleOpenClick}
            className="mt-2 flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-600 text-xs text-white font-medium transition-colors cursor-pointer shadow-sm"
          >
            <FileTextOutlined className="text-[10px]" />
            打开脚本节点
            <RightOutlined className="text-[10px]" />
          </button>
        </div>
      </div>
    );
  }

  // ========== 有内容：显示预览摘要 + 步骤条 ==========
  return (
    <div className="flex flex-col items-center justify-between h-full py-4 px-3 min-h-[200px]">
      {/* 中央预览区 */}
      <div className="flex-1 flex items-center justify-center w-full min-h-0">
        <button
          onClick={handleOpenClick}
          className="flex flex-col items-center gap-2 p-3 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer group w-full"
          title="打开脚本详情"
        >
          <MenuOutlined className="text-xl text-gray-300 group-hover:text-gray-500 transition-colors" />
          <span className="text-[10px] text-gray-400 group-hover:text-gray-500 text-center leading-relaxed">
            共 {data.shots.length} 个分镜
          </span>
        </button>
      </div>

      {/* 底部：步骤条 + 打开按钮 */}
      <div className="w-full space-y-3 pt-2 border-t border-gray-100">
        <ScriptSteps currentStep={data.currentStep} />

        <button
          onClick={handleOpenClick}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-xs text-gray-700 font-medium transition-colors cursor-pointer"
        >
          打开脚本节点
          <RightOutlined className="text-[10px]" />
        </button>
      </div>
    </div>
  );
});
