import { memo, useCallback } from 'react';
import {
  MenuOutlined,
  RightOutlined,
  FileTextOutlined,
  CodeOutlined,
} from '@ant-design/icons';
import type { NodeExecutionStatus, ScriptNodeData } from '@/types/canvas';
import { ScriptSteps } from './ScriptSteps';
import { NodeLoadingState } from '../NodeLoadingState';

interface ScriptCardProps {
  data: Pick<ScriptNodeData, 'label' | 'currentStep' | 'shots' | 'scriptContent' | 'characters' | 'scenes' | 'props'> & {
    progressMessage?: string; // 进度消息（如"已运行 10s"）
  };
  status: NodeExecutionStatus;
  onOpen: () => void;
}

/** 是否有内容（脚本文本、分镜数据或资产数据） */
function hasContent(data: Pick<ScriptNodeData, 'scriptContent' | 'shots' | 'characters' | 'scenes' | 'props'>): boolean {
  // 检查是否有任何数据
  const hasScriptContent = !!data.scriptContent?.trim();
  const hasShots = data.shots && data.shots.length > 0;
  const hasCharacters = data.characters && data.characters.length > 0;
  const hasScenes = data.scenes && data.scenes.length > 0;
  const hasProps = data.props && data.props.length > 0;

  // 只有有实际数据时才返回 true
  return hasScriptContent || hasShots || hasCharacters || hasScenes || hasProps;
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
      // ✅ 使用统一的loading组件
      <NodeLoadingState
        status={status}
        statusText={data.progressMessage || (status === 'pending' ? '等待生成脚本...' : '正在生成脚本...')}
        iconBgColor="bg-amber-100"
        iconColor="text-amber-500"
      />    );
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

          {/* ✅ 空状态不显示打开按钮 */}
        </div>
      </div>
    );
  }

  // ========== 有内容：显示预览摘要 + 步骤条 ==========
  return (
    <div className="flex flex-col items-center justify-between h-full py-4 px-3 min-h-[200px]">
      {/* 中央预览区 */}
      <div className="flex-1 flex items-center justify-center w-full min-h-0">
        <div className="flex flex-col items-center gap-2 p-3 w-full select-none">
          <MenuOutlined className="text-xl text-gray-300" />
          <span className="text-[10px] text-gray-400 text-center leading-relaxed">
            共 {data.shots.length} 个分镜
          </span>
        </div>
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
