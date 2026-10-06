import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Menu, App, type MenuProps } from 'antd';
import {
  DownloadOutlined,
  FolderAddOutlined,
  HistoryOutlined,
  CopyOutlined,
  SnippetsOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { assetApi } from '@/services/assetApi';
import { downloadFile } from '@/utils/download';
import type { NodeType } from '@/types/canvas';

interface NodeContextMenuProps {
  position: { x: number; y: number };
  nodeType: NodeType;
  /** 节点的媒体 URL（imageUrl / videoUrl）；非媒体节点为空 */
  url?: string;
  /** 节点名称（作为资产名） */
  name: string;
  /** 节点 ID */
  nodeId: string;
  /** 更新节点数据的回调 */
  onUpdateNode?: (nodeId: string, data: Record<string, any>) => void;
  /** 点击“查看生成历史”回调（仅图片/视频节点） */
  onShowHistory?: (nodeId: string, nodeType: 'image' | 'video', currentUrl: string) => void;
  /** 剪贴板里是否已有节点 */
  canPaste?: boolean;
  onCopy?: () => void;
  onPaste?: () => void;
  onDelete?: () => void;
  onClose: () => void;
}

/**
 * 节点右键菜单
 * - 通用：复制节点 / 粘贴节点 / 删除节点（任何节点类型都有）
 * - 图片·视频：下载、存到个人资产库、查看生成历史
 */
export const NodeContextMenu = memo(function NodeContextMenu({
  position,
  nodeType,
  url,
  name,
  nodeId,
  onUpdateNode: _onUpdateNode,
  onShowHistory,
  canPaste = false,
  onCopy,
  onPaste,
  onDelete,
  onClose,
}: NodeContextMenuProps) {
  const { message } = App.useApp();
  const menuRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [saving, setSaving] = useState(false);

  /** 只有带媒体地址的图片/视频节点才有下载、存资产、看历史这些项 */
  const isMedia = (nodeType === 'image' || nodeType === 'video') && !!url;
  const mediaType = nodeType === 'image' ? 'image' : 'video';
  const typeLabel = nodeType === 'image' ? '图片' : '视频';

  const handleDownload = useCallback(async () => {
    if (!url) return;
    onClose();
    setDownloading(true);
    try {
      await downloadFile(url);
    } catch (err) {
      console.error('下载失败:', err);
      message.error(`下载${typeLabel}失败`);
    } finally {
      setDownloading(false);
    }
  }, [url, typeLabel, onClose, message]);

  const handleSaveToLibrary = useCallback(async () => {
    if (!url || saving) return;
    setSaving(true);
    try {
      await assetApi.create({ type: mediaType, url, name }, { silentError: true });
      message.success(`已存入个人资产库`);
      onClose();
    } catch (err) {
      console.error('保存资产失败:', err);
      // 重复保存：温和提示已保存；其他错误兜底提示
      if (err instanceof Error && err.message.includes('已保存')) {
        message.warning('当前资产已保存');
      } else {
        message.error('保存失败，请重试');
      }
    } finally {
      setSaving(false);
    }
  }, [mediaType, url, name, saving, onClose, message]);

  const handleShowHistory = useCallback(() => {
    if (!url) return;
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

  const actionItems: MenuProps['items'] = [
    {
      key: 'copy',
      label: '复制节点',
      icon: <CopyOutlined />,
      onClick: () => runAction(onCopy),
    },
    {
      key: 'paste',
      label: '粘贴节点',
      icon: <SnippetsOutlined />,
      disabled: !canPaste,
      onClick: () => runAction(onPaste),
    },
    {
      key: 'delete',
      label: '删除节点',
      icon: <DeleteOutlined />,
      danger: true,
      onClick: () => runAction(onDelete),
    },
  ];

  const mediaItems: MenuProps['items'] = isMedia
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
        zIndex: 1000,
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