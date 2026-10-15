import { memo, useCallback } from 'react';
import {
  FileTextOutlined,
  PictureOutlined,
  VideoCameraOutlined,
  AudioOutlined,
  CodeOutlined,
  CopyOutlined,
  SnippetsOutlined,
  DeleteOutlined,
  GroupOutlined,
  UngroupOutlined,
} from '@ant-design/icons';
import { NODE_TYPE_CONFIG, type NodeType } from '@/types/canvas';

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
  /** 有选中节点 → 可复制 / 可删除 */
  canCopy?: boolean;
  /** 剪贴板里已有节点 → 可粘贴 */
  canPaste?: boolean;
  onCopy?: () => void;
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
 * 上半部分是节点操作（复制 / 粘贴 / 删除），下半部分是「选择节点类型」新增节点。
 */
export const NodeSelectPopup = memo(function NodeSelectPopup({
  position,
  onSelect,
  onClose,
  selectedLabel,
  canCopy = false,
  canPaste = false,
  onCopy,
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
      className="fixed z-[9999] bg-white rounded-xl shadow-2xl border border-gray-200 py-1.5 min-w-[160px]"
      style={{ left: position.x, top: position.y }}
    >
      <div className="px-3 py-1.5 text-xs text-gray-400 font-medium border-b border-gray-100 mb-0.5 flex items-baseline gap-1.5">
        <span>节点操作</span>
        {selectedLabel && (
          <span className="text-[11px] text-gray-300 truncate max-w-[110px]">{selectedLabel}</span>
        )}
      </div>
      {/* 组合节点上不给复制/删除：复制出来是没有成员的空框，删除会带走成员的归属 */}
      {!selectedGroupId && actionRow('复制节点', <CopyOutlined />, canCopy, onCopy)}
      {actionRow('粘贴节点', <SnippetsOutlined />, canPaste, onPaste)}
      {/* 组合：框选多个节点后出现（只选中 1 个时置灰，避免误点出没有意义的单节点组合） */}
      {actionRow(
        selectedCount >= 2 ? `组合选中的 ${selectedCount} 个节点` : '组合选中节点',
        <GroupOutlined />,
        selectedCount >= 2,
        onGroup
      )}
      {selectedGroupId && actionRow('取消组合', <UngroupOutlined />, true, onUngroup)}
      {!selectedGroupId && actionRow('删除节点', <DeleteOutlined />, canCopy, onDelete, true)}
      {selectedGroupId && (
        <div className="px-3 py-1 text-[11px] text-gray-300">组合不支持复制 / 删除，请先「取消组合」</div>
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