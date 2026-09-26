import { memo, useEffect, useState, type CSSProperties } from 'react';
import { Modal, Spin } from 'antd';

interface MediaPreviewModalProps {
  open: boolean;
  /** image = 静态图；video = 可播放视频 */
  kind: 'image' | 'video';
  /** 媒体地址（图片要传原图 imageUrl，视频传 videoUrl） */
  url?: string;
  title?: string;
  /** 标题右侧的元信息，如「2560 × 1440」 */
  meta?: string;
  /** 媒体的原始宽高：用来**提前撑出占位框**，避免加载完才把弹窗撑大 */
  width?: number;
  height?: number;
  onClose: () => void;
}

// 与画布一致的最大展示范围
const MAX_W = '86vw';
const MAX_H = '78vh';

/**
 * 大图 / 视频预览弹窗（双击节点打开）。
 *
 * 三个要点：
 * 1. 展示的是**原图/原视频**：画布上为了省流量渲染 640px 缩略图、视频只放封面，
 *    这里必须换成原地址，否则"查看大图"看到的还是缩略图。
 * 2. **不跳变**：拿到节点记录里的原始宽高后，先用 `min(原始宽, 86vw, 78vh×宽高比)`
 *    把占位框撑到最终尺寸（配合 aspect-ratio），加载完成的图直接填进这个框，
 *    弹窗尺寸自始至终不变；转圈只是浮在框中央的遮罩。
 *    没有尺寸信息时退回 16:9 的等大占位，同样不会跳。
 * 3. Modal 默认 portal 到 body，不受画布 transform/缩放影响。
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

  // 占位框＝最终展示尺寸：
  // 宽度取「原始宽、86vw、按 78vh 反算出的宽」三者最小值，高度由 aspect-ratio 推导，
  // 这样既保持比例、又同时受限于两个方向，且不放大小图（与图片的 max-width/height 一致）。
  const boxStyle: CSSProperties = hasDims
    ? {
        width: `min(${width}px, ${MAX_W}, calc(${MAX_H} * ${width} / ${height}))`,
        aspectRatio: `${width} / ${height}`,
      }
    : { width: `min(${MAX_W}, 1100px)`, aspectRatio: '16 / 9' };

  const mediaStyle: CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    display: 'block',
  };

  return (
    <Modal
      title={
        <span className="flex items-center gap-2">
          <span>{title || (kind === 'video' ? '查看视频' : '查看大图')}</span>
          {meta && <span className="text-[12px] font-normal text-gray-400">{meta}</span>}
        </span>
      }
      open
      onCancel={onClose}
      footer={null}
      centered
      width="auto"
      styles={{
        mask: { backdropFilter: 'blur(4px)' },
        body: { padding: '12px 16px 16px', textAlign: 'center', minWidth: '320px' },
      }}
    >
      <div className="relative mx-auto" style={boxStyle}>
        {status === 'loading' && (
          <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
            <Spin />
          </div>
        )}
        {status === 'error' && (
          <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-gray-400">
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
      </div>
    </Modal>
  );
});