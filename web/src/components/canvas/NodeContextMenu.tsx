import { memo, useCallback, useEffect, useRef } from 'react';
import { Menu, type MenuProps } from 'antd';
import {
  DownloadOutlined,
  FolderAddOutlined,
  HistoryOutlined,
  CopyOutlined,
  DeleteOutlined,
  GroupOutlined,
  UngroupOutlined,
} from '@ant-design/icons';
import { useMediaNodeActions } from './useMediaNodeActions';
import type { NodeType } from '@/types/canvas';
import { Z } from '@/utils/zLayers';

interface NodeContextMenuProps {
  position: { x: number; y: number };
  nodeType: NodeType;
  onCopy?: () => void;
  onDelete?: () => void;
  /** 右键这颗节点在多选选区里时，删掉整片选区（外部是按 clicked 节点删） */
  onDeleteSelection?: () => void;
  /** 当前框选/多选了多少个节点（≥2 才给「组合」项） */
  selectedCount?: number;
  /** 右键的这个节点是不是组合（是则给「取消组合」项） */
  isGroup?: boolean;
  onGroup?: () => void;
  onUngroup?: () => void;
  onClose: () => void;
  /** 节点的媒体 URL（imageUrl / videoUrl 等）；非媒体节点为空 —— 只在工具条没显示这些动作时兜底 */
  url?: string;
  /** 节点名称（作为资产名） */
  name?: string;
  /** 节点 ID */
  nodeId?: string;
  /** 点击“查看生成历史”回调（仅图片/视频节点） */
  onShowHistory?: (nodeId: string, nodeType: 'image' | 'video', currentUrl: string) => void;
  /** 工具条此刻是否正显示动作图标（是则菜单不再重复这些项，见下面 movedToToolbar） */
  toolbarShowsActions?: boolean;
  /** 更新节点数据的回调（调用方仍按旧签名传入；本菜单目前不用它） */
  onUpdateNode?: (nodeId: string, data: Record<string, any>) => void;
}

/**
 * 节点右键菜单 —— 只留**这个节点/这片选区**的操作：组合 / 取消组合（+ 多选时的"删除选中的 N 个"）。
 *
 * 复制、删除、下载、存到个人资产库、查看生成历史都已经在**节点工具条**里
 * （components/canvas/NodeToolbar.tsx，所有节点类型通用），菜单里不再重复一份。
 * 多选时工具条不出现（它只在唯一选中时出现），所以「删除选中的 N 个」必须留在这里。
 *
 * **没有「粘贴节点」**：粘贴要的是"落在哪里"，那是画布的事（空白处右键，落点就是鼠标位置）；
 * 挂在节点上只能定一条隐形规则（贴着这个节点的右下角），用户看不出粘贴点从哪来。
 */
export const NodeContextMenu = memo(function NodeContextMenu({
  position,
  nodeType,
  url,
  name,
  nodeId,
  onShowHistory,
  toolbarShowsActions = false,
  onUpdateNode: _onUpdateNode,
  onCopy,
  onDelete,
  onDeleteSelection,
  selectedCount = 0,
  isGroup = false,
  onGroup,
  onUngroup,
  onClose,
}: NodeContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  /**
   * 这些项已经挪到**节点工具条**（所有节点类型通用）：复制/删除 + 有素材时的
   * 下载/存资产/看历史 —— 工具条**正在显示**时，菜单里不再重复一份。
   *
   * 判断依据必须是"工具条此刻是否真的在显示动作"（toolbarShowsActions），不能是
   * "这个节点在不在工具条的形式里"：右键**不会**选中节点，所以在未选中的节点上右键时
   * 工具条根本没出现；此时若把复制/删除藏掉，鼠标就没有任何入口了（只剩快捷键）。
   * 多选同理：工具条只在唯一选中时出现，多选时「删除选中的 N 个」必须留在这里。
   *
   * 组合节点是另一回事：它本来就不能复制/删除（会带走成员归属），永远不给。
   */
  const movedToToolbar = nodeType !== 'group' && toolbarShowsActions;
  /** 组合项的文案带上选中数量：用户能一眼确认「要组合的是哪几个」 */
  const groupLabel = selectedCount >= 2 ? `组合选中的 ${selectedCount} 个节点` : '组合选中节点';

  /** 只有带媒体地址的图片/视频节点才有下载、存资产、看历史这些项 */
  const isMedia = (nodeType === 'image' || nodeType === 'video') && !!url;
  const mediaType = nodeType === 'image' ? 'image' : 'video';
  const typeLabel = nodeType === 'image' ? '图片' : '视频';
  // 与节点工具条共用一份实现（useMediaNodeActions）：两个入口各写一遍，
  // 迟早"下载中"文案、重复保存的温和提示、失败处理对不上
  const {
    download: runDownload,
    saveToLibrary: runSave,
    downloading,
    saving,
  } = useMediaNodeActions({ url, name, mediaType, assetType: mediaType });

  const handleDownload = useCallback(async () => {
    if (!url) return;
    onClose();
    await runDownload();
  }, [url, onClose, runDownload]);

  const handleSaveToLibrary = useCallback(async () => {
    if (!url || saving) return;
    await runSave();
    onClose();
  }, [url, saving, runSave, onClose]);

  const handleShowHistory = useCallback(() => {
    if (!url || !nodeId) return;
    onClose();
    onShowHistory?.(nodeId, mediaType, url);
  }, [onClose, onShowHistory, nodeId, mediaType, url]);

  /** 通用节点操作：执行后关闭菜单 */
  const runAction = useCallback(
    (fn?: () => void) => {
      if (!fn) return;
      fn();
      onClose();
    },
    [onClose]
  );

  // 组合是容器不是素材：复制出来是个没有成员的空框，删掉又会带走成员的"归属"，
  // 所以组合节点上这两项直接不出现（拿掉组合的唯一入口是下面的「取消组合」）。
  const actionItems: MenuProps['items'] = [
    ...(isGroup || movedToToolbar
      ? []
      : [
          {
            key: 'copy',
            label: '复制节点',
            icon: <CopyOutlined />,
            onClick: () => runAction(onCopy),
          },
        ]),
    // 组合：框选多个节点后右键才会真正可用（只选中 1 个时置灰）
    {
      key: 'group',
      label: groupLabel,
      icon: <GroupOutlined />,
      disabled: selectedCount < 2,
      onClick: () => runAction(onGroup),
    },
    ...(isGroup
      ? [
          {
            key: 'ungroup',
            label: '取消组合',
            icon: <UngroupOutlined />,
            onClick: () => runAction(onUngroup),
          },
        ]
      : []),
    ...(isGroup || movedToToolbar
      ? []
      : [
          {
            key: 'delete',
            // 右键点在多选选区里 → 删整片选区；点在选区外 → 只删这一颗（与 Figma 等一致）
            label: selectedCount >= 2 ? `删除选中的 ${selectedCount} 个节点` : '删除节点',
            icon: <DeleteOutlined />,
            danger: true,
            onClick: () => runAction(selectedCount >= 2 ? onDeleteSelection : onDelete),
          },
        ]),
  ];

  /**
   * 兜底：工具条**没在显示**这些动作时（节点未被选中 / 多选 / 图片工具的配置条占着），
   * 菜单里仍然要有 下载/存资产/看历史 —— 否则这些动作在这一刻没有任何入口。
   */
  const mediaItems: MenuProps['items'] =
    isMedia && !movedToToolbar
      ? [
          { type: 'divider' },
          {
            key: 'download',
            label: downloading ? `下载${typeLabel}中...` : `下载${typeLabel}`,
            icon: <DownloadOutlined />,
            onClick: handleDownload,
          },
          {
            key: 'save',
            label: saving ? '保存中...' : '存到个人资产库',
            icon: <FolderAddOutlined />,
            onClick: handleSaveToLibrary,
          },
          { type: 'divider' },
          {
            key: 'history',
            label: '查看生成历史',
            icon: <HistoryOutlined />,
            onClick: handleShowHistory,
          },
        ]
      : [];

  const menuItems: MenuProps['items'] = [...actionItems, ...mediaItems];

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('click', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        zIndex: Z.canvasMenu,
      }}
    >
      <Menu
        items={menuItems}
        style={{
          background: 'var(--dv-surface-2)',
          borderRadius: 8,
          boxShadow: 'var(--dv-hairline), var(--dv-elev-2)',
        }}
      />
    </div>
  );
});