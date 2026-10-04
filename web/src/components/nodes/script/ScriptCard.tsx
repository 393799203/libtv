import { memo, useCallback } from 'react';
import {
  MenuOutlined,
  RightOutlined,
  FileTextOutlined,
  CodeOutlined,
} from '@ant-design/icons';
import type { ScriptNodeData } from '@/types/canvas';
import { ScriptSteps } from './ScriptSteps';

interface ScriptCardProps {
  data: Pick<ScriptNodeData, 'label' | 'currentStep' | 'shots' | 'scriptContent' | 'characters' | 'scenes' | 'props'> & {
    progressMessage?: string; // 进度消息（如"已运行 10s"）
  };
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

export const ScriptCard = memo<ScriptCardProps>(function ScriptCard({
  data,
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

  // 注意：生成中的加载态由 BaseNode 统一负责，这里**不要**自己判断 status 换掉内容。
  // 原因：重新生成时 BaseNode 要保留上一次的产出做对照（半透明 + 遮罩），
  // 卡片要是自己换成加载框，就变成"旧结果看着像丢了"。
  // 首次生成（无旧结果）时 BaseNode 根本不会渲染 children，这个分支也走不到。

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
            <span className="text-xs font-medium text-gray-700">分镜节点</span>
            <span className="text-[10px] text-gray-400 leading-relaxed">
              从上游文本节点生成分镜
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
            共 {data.shots?.length ?? 0} 个分镜
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
          打开分镜节点
          <RightOutlined className="text-[10px]" />
        </button>
      </div>
    </div>
  );
});
