import { memo, useEffect, useState, type CSSProperties } from 'react';
import { Modal, Spin } from 'antd';
import { CloseOutlined } from '@ant-design/icons';

interface MediaPreviewModalProps {
  open: boolean;
  /** image = 静态图；video = 可播放视频 */
  kind: 'image' | 'video';
  /** 媒体地址（图片要传原图 imageUrl，视频传 videoUrl） */
  url?: string;
  title?: string;
  /** 标题右侧的元信息，如「2560 × 1440」；不传且有宽高时自动补上 */
  meta?: string;
  /** 媒体的原始宽高：用于在没有 meta 时补一行尺寸信息 */
  width?: number;
  height?: number;
  onClose: () => void;
}

/**
 * 沉浸式全屏预览（画布双击节点、论坛点正文图片共用）。
 *
 * 视觉效果：整屏压暗模糊的背景 + 媒体本身铺满视口（`object-fit: contain`，
 * 等比放到最大且不裁切），没有任何边框、白色卡片、标题栏、底栏；
 * 关闭按钮与标题尺寸信息以半透明浮层压在画面上，不占布局。
 * 关闭方式：右上角 ×、Esc、点击画面外的空白。
 *
 * 两个要点：
 * 1. 展示的是**原图/原视频**：画布上为了省流量渲染 640px 缩略图、视频只放封面，
 *    论坛正文同理，这里必须换成原地址，否则"查看大图"看到的还是缩略图。
 * 2. **不会跳变**：占位框就是整个视口，与媒体实际尺寸无关，所以媒体加载完成前后
 *    画面布局完全一致，转圈只是浮在画面中央的遮罩。
 * 3. Modal 默认 portal 到 body，不受画布 transform/缩放影响；内容区背景透明，
 *    因此不存在白色留白，媒体能贴到视口边缘。
 */
export const MediaPreviewModal = memo(function MediaPreviewModal({
  open,
  kind,
  url,
  title,
  meta,
  width,
  height,
  onClose,
}: MediaPreviewModalProps) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'error'>('loading');

  // 换媒体或重新打开时重置加载态
  useEffect(() => {
    setStatus('loading');
  }, [open, url]);

  if (!open || !url) return null;

  const hasDims = !!width && !!height && width > 0 && height > 0;
  const caption = [
    title || (kind === 'video' ? '查看视频' : '查看大图'),
    meta || (hasDims ? `${width} × ${height}` : ''),
  ]
    .filter(Boolean)
    .join('  ·  ');

  const mediaStyle: CSSProperties = {
    maxWidth: '100%',
    maxHeight: '100%',
    objectFit: 'contain',
    display: 'block',
    borderRadius: 4,
  };

  // 点画面外空白关闭；点媒体本身（含视频控件）不关
  const handleSurfaceClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) onClose();
  };

  return (
    <Modal
      open
      onCancel={onClose}
      footer={null}
      closable={false}
      centered
      width="100vw"
      style={{ maxWidth: '100vw', top: 0, margin: 0, padding: 0 }}
      // 无边框全屏：白色卡片/内边距/圆角/阴影全部由 .media-preview-immersive 这段 CSS 干掉
      // （antd 各版本容器类名是 -container 或 -content，用 styles 传键名不可靠，实测会被忽略）
      styles={{
        mask: { background: 'rgba(0, 0, 0, 0.9)', backdropFilter: 'blur(8px)' },
        body: { padding: 0, background: 'transparent' },
      }}
      wrapClassName="media-preview-immersive"
    >
      {/* 铺满整个视口：用 h-full/w-full 跟着 modal 容器走，不写 w-screen
          （100vw 含滚动条宽度，会让右上角按钮溢出视口，实测溢出 4px） */}
      <div
        className="relative flex h-full w-full items-center justify-center p-3 sm:p-5"
        onClick={handleSurfaceClick}
      >
        {status === 'loading' && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <Spin />
          </div>
        )}
        {status === 'error' && (
          <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-white/60">
            {kind === 'video' ? '视频加载失败' : '图片加载失败'}
          </div>
        )}

        {kind === 'video' ? (
          <video
            src={url}
            controls
            autoPlay
            playsInline
            onLoadedData={() => setStatus('loaded')}
            onError={() => setStatus('error')}
            style={mediaStyle}
          />
        ) : (
          <img
            src={url}
            alt={title || '原图'}
            onLoad={() => setStatus('loaded')}
            onError={() => setStatus('error')}
            style={mediaStyle}
          />
        )}

        {/* 浮层：关闭按钮压在画面右上角，不占布局 */}
        <button
          type="button"
          aria-label="关闭"
          onClick={onClose}
          className="absolute right-3 top-3 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-[16px] text-white/85 backdrop-blur transition hover:bg-black/60 hover:text-white sm:right-5 sm:top-5"
        >
          <CloseOutlined />
        </button>

        {/* 浮层：标题 / 尺寸压在画面下方居中 */}
        <div className="pointer-events-none absolute bottom-3 left-1/2 z-20 max-w-[90vw] -translate-x-1/2 truncate rounded-full bg-black/35 px-3 py-1 text-[12px] text-white/60 backdrop-blur sm:bottom-5">
          {caption}
        </div>
      </div>
    </Modal>
  );
});