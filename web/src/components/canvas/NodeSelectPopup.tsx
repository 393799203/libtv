import { memo, useCallback } from 'react';
import {
  FileTextOutlined,
  PictureOutlined,
  VideoCameraOutlined,
  AudioOutlined,
  CodeOutlined,
  SnippetsOutlined,
  DeleteOutlined,
  GroupOutlined,
  UngroupOutlined,
} from '@ant-design/icons';
import { NODE_TYPE_CONFIG, type NodeType } from '@/types/canvas';
import { Z } from '@/utils/zLayers';

const iconMap: Record<string, React.ReactNode> = {
  FileTextOutlined: <FileTextOutlined />,
  PictureOutlined: <PictureOutlined />,
  VideoCameraOutlined: <VideoCameraOutlined />,
  AudioOutlined: <AudioOutlined />,
  CodeOutlined: <CodeOutlined />,
};

const nodeTypeList: NodeType[] = ['text', 'image', 'video', 'audio', 'script', 'previz', 'enhance'];

interface NodeSelectPopupProps {
  position: { x: number; y: number };
  onSelect: (nodeType: NodeType) => void;
  onClose: () => void;
  /** 当前选中节点的名字：提示「复制/删除」作用在哪个节点上 */
  selectedLabel?: string | null;
  /** 有选中节点 → 可删除 */
  canDelete?: boolean;
  /** 剪贴板里已有节点 → 可粘贴 */
  canPaste?: boolean;
  onPaste?: () => void;
  onDelete?: () => void;
  /** 当前框选/多选了多少个节点（≥2 才给「组合」项） */
  selectedCount?: number;
  /** 当前选中的那个节点是不是组合（是则给「取消组合」项） */
  selectedGroupId?: string | null;
  onGroup?: () => void;
  onUngroup?: () => void;
}

/**
 * 画布右键菜单（右键空白处 / 右下角 + 按钮 / 连线拖到空白处共用）
 * 上半部分是画布级操作（粘贴 / 组合 / 取消组合 / 删除选区），下半部分是「选择节点类型」新增节点。
 * 「复制节点」不在这里（复制的对象是选中的那个节点，不在鼠标底下）—— 见下面注释。
 */
export const NodeSelectPopup = memo(function NodeSelectPopup({
  position,
  onSelect,
  onClose,
  selectedLabel,
  canDelete = false,
  canPaste = false,
  onPaste,
  onDelete,
  selectedCount = 0,
  selectedGroupId = null,
  onGroup,
  onUngroup,
}: NodeSelectPopupProps) {
  const handleSelect = useCallback(
    (nodeType: NodeType) => {
      onSelect(nodeType);
      onClose();
    },
    [onSelect, onClose]
  );

  /** 节点操作统一出口：执行后关闭菜单 */
  const run = useCallback(
    (fn?: () => void) => {
      if (!fn) return;
      fn();
      onClose();
    },
    [onClose]
  );

  const actionRow = (
    label: string,
    icon: React.ReactNode,
    enabled: boolean,
    fn?: () => void,
    danger = false,
  ) => (
    <div
      className={`flex items-center gap-2.5 px-3 py-1.5 transition-colors ${
        enabled
          ? danger
            ? 'cursor-pointer hover:bg-red-50 text-red-600'
            : 'cursor-pointer hover:bg-blue-50 text-gray-700'
          : 'text-gray-300 cursor-not-allowed'
      }`}
      onClick={() => enabled && run(fn)}
    >
      <span className="w-4 text-center text-[13px]">{icon}</span>
      <span className="text-sm">{label}</span>
    </div>
  );

  return (
    <div
      className="fixed bg-white rounded-xl shadow-2xl border border-gray-200 py-1.5 min-w-[160px]"
      style={{ zIndex: Z.canvasMenu, left: position.x, top: position.y }}
    >
      <div className="px-3 py-1.5 text-xs text-gray-400 font-medium border-b border-gray-100 mb-0.5 flex items-baseline gap-1.5">
        <span>节点操作</span>
        {selectedLabel && (
          <span className="text-[11px] text-gray-300 truncate max-w-[110px]">{selectedLabel}</span>
        )}
      </div>
      {/* 这里**没有「复制节点」**：复制的对象是"选中的那个节点"，而右键空白处时它并不在
          鼠标底下 —— 挂在画布上等于要求用户先记住选的是谁（要看对象就去右键那个节点，
          它的工具条/菜单里有复制）。粘贴反过来只属于画布：落点就是鼠标位置。 */}
      {actionRow('粘贴节点', <SnippetsOutlined />, canPaste, onPaste)}
      {/* 组合：框选多个节点后出现（只选中 1 个时置灰，避免误点出没有意义的单节点组合） */}
      {actionRow(
        selectedCount >= 2 ? `组合选中的 ${selectedCount} 个节点` : '组合选中节点',
        <GroupOutlined />,
        selectedCount >= 2,
        onGroup
      )}
      {selectedGroupId && actionRow('取消组合', <UngroupOutlined />, true, onUngroup)}
      {/* 删除留在这里是因为它作用于**整片选区**（多选时节点工具条不出现）：
          文案带上数量，免得又变成"说不清作用在谁身上" */}
      {!selectedGroupId &&
        actionRow(
          selectedCount >= 2 ? `删除选中的 ${selectedCount} 个节点` : '删除节点',
          <DeleteOutlined />,
          canDelete,
          onDelete,
          true
        )}
      {selectedGroupId && (
        <div className="px-3 py-1 text-[11px] text-gray-300">组合不支持直接删除，请先「取消组合」</div>
      )}

      <div className="px-3 py-1.5 mt-1 mb-0.5 text-xs text-gray-400 font-medium border-t border-b border-gray-100">
        选择节点类型
      </div>
      {nodeTypeList.map((nodeType) => {
        const config = NODE_TYPE_CONFIG[nodeType];
        return (
          <div
            key={nodeType}
            className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-blue-50 transition-colors"
            onClick={() => handleSelect(nodeType)}
          >
            <div
              className="w-6 h-6 rounded-md flex items-center justify-center text-white text-xs flex-shrink-0"
              style={{ backgroundColor: config.color }}
            >
              {iconMap[config.icon]}
            </div>
            <span className="text-sm text-gray-700">{config.label}</span>
          </div>
        );
      })}
    </div>
  );
});