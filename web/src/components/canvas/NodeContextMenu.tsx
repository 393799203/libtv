import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Menu, App, type MenuProps } from 'antd';
import { DownloadOutlined, FolderAddOutlined } from '@ant-design/icons';
import { assetApi } from '@/services/assetApi';
import { downloadFile } from '@/utils/download';

interface NodeContextMenuProps {
  position: { x: number; y: number };
  nodeType: 'image' | 'video';
  /** 节点的媒体 URL（imageUrl / videoUrl） */
  url: string;
  /** 节点名称（作为资产名） */
  name: string;
  onClose: () => void;
}

/**
 * 图片/视频节点右键菜单
 * - 下载图片 / 下载视频
 * - 存到个人资产库
 */
export const NodeContextMenu = memo(function NodeContextMenu({
  position,
  nodeType,
  url,
  name,
  onClose,
}: NodeContextMenuProps) {
  const { message } = App.useApp();
  const menuRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [saving, setSaving] = useState(false);

  const typeLabel = nodeType === 'image' ? '图片' : '视频';

  const handleDownload = useCallback(async () => {
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
    if (saving) return;
    setSaving(true);
    try {
      await assetApi.create({ type: nodeType, url, name });
      message.success(`已存入个人资产库`);
      onClose();
    } catch (err) {
      console.error('保存资产失败:', err);
      // HTTP 错误已由 api.ts 拦截器统一提示，此处仅兜底
      if (!(err instanceof Error) || !err.message) {
        message.error('保存失败，请重试');
      }
    } finally {
      setSaving(false);
    }
  }, [nodeType, url, name, saving, onClose, message]);

  const menuItems: MenuProps['items'] = [
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
  ];

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
          borderRadius: 8,
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
        }}
      />
    </div>
  );
});
