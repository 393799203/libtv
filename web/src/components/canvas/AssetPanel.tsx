import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Empty, Input, Popconfirm, App } from 'antd';
import {
  CloseOutlined,
  SearchOutlined,
  DownloadOutlined,
  CheckOutlined,
  DeleteOutlined,
  CaretRightOutlined,
  PictureOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import { assetApi, type UserAsset, type UserAssetType } from '@/services/assetApi';
import { downloadFile } from '@/utils/download';
import { deriveThumbUrl } from '@/utils/thumbUrl';
import { emitAssetDrop, setDraggingAsset } from '@/components/canvas/assetDnd';

/**
 * 个人资产库（画布左侧停靠面板）
 *
 * 设计取舍：
 * - 与右侧提示词面板对称，**停靠**而不是弹窗：看图选图时不该把画布挡掉，
 *   用户经常是"看着画布上的分镜，从库里挑一张"。
 * - 建节点只走"拖出来"这一条路（单击=选中预览，不建节点：选素材时手滑的概率远高于真想插入）；
 *   删除只删库里的副本，不动画布上的节点（沿用原弹窗的语义，文案也保留）。
 * - 网格用缩略图（`xxx.thumb.webp`），加载失败回退原图：面板窄、图多，
 *   直接拉原图既慢又费流量。
 * - 窄面板不上 Tabs：改成两个分段按钮并显示数量，省一行高度。
 */
const PANEL_WIDTH = 300;

interface AssetPanelProps {
  onClose: () => void;
}

/**
 * 卡片缩略图。
 * - 图片：优先约定缩略图，404 回退原图（和画布节点同一套路）
 * - 视频：**不能用 <img>** —— 视频资产的 url 是 .mp4，<img src="x.mp4"> 必然破图
 *   （之前就是这个现象：卡片是破图，但点播放又能放）。改用 <video> 拉元数据 +
 *   `#t=0.5` 强制定位一帧当封面；失败则给一个深色占位图标。
 * - 两种都设 draggable={false}：元素自带的原生拖拽会顶掉卡片上设的拖拽数据，
 *   导致「拖到画布」失效（只能拖成浏览器打开图片）。
 */
function AssetThumb({ asset }: { asset: UserAsset }) {
  const [failed, setFailed] = useState(false);

  if (asset.type === 'video') {
    if (failed) {
      return (
        <div className="w-full h-full flex items-center justify-center bg-gray-800 text-white/50">
          <VideoCameraOutlined />
        </div>
      );
    }
    return (
      // eslint-disable-next-line jsx-a11y/media-has-caption
      <video
        src={`${asset.url}#t=0.5`}
        muted
        playsInline
        preload="metadata"
        draggable={false}
        className="w-full h-full object-cover bg-black"
        onError={() => setFailed(true)}
      />
    );
  }

  const thumb = deriveThumbUrl(asset.url);
  const src = failed || !thumb ? asset.url : thumb;
  return (
    <img
      src={src}
      alt={asset.name}
      loading="lazy"
      draggable={false}
      className="w-full h-full object-cover"
      onError={() => setFailed(true)}
    />
  );
}

export function AssetPanel({ onClose }: AssetPanelProps) {
  const { message } = App.useApp();
  const [type, setType] = useState<UserAssetType>('image');
  const [assets, setAssets] = useState<UserAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [playingId, setPlayingId] = useState<string | null>(null);
  /** 当前选中的资产：单击只"选中/预览"，绝不建节点（建节点只走"拖到画布"这一条路） */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** 两类资产的数量（分段按钮上显示，切过一次就记下来） */
  const counts = useRef<Partial<Record<UserAssetType, number>>>({});

  const fetchAssets = useCallback(async (t: UserAssetType) => {
    try {
      const list = await assetApi.list(t);
      counts.current[t] = (list || []).length;
      setAssets(list || []);
    } catch (err) {
      console.error('加载资产失败:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchAssets(type);
  }, [type, fetchAssets]);

  /** 按名称过滤（资产列表不大，本地过滤足够，避免每敲一个字打一次接口） */
  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return assets;
    return assets.filter((a) => (a.name || '').toLowerCase().includes(kw));
  }, [assets, keyword]);

  /**
   * 拖到画布：**指针拖拽**（不用 HTML5 draggable —— 实测在本项目里拖出来松手没反应）。
   * 按下后超过 5px 才算拖拽（避免影响单击选中），期间用跟随光标的缩略图预览，
   * 松手时把「资产 + 屏幕坐标」投递给画布，由画布判断是否落在自己区域内。
   */
  const dragRef = useRef<{ asset: UserAsset; startX: number; startY: number; moved: boolean } | null>(null);
  /** 刚拖完的那次点击要忽略掉，否则松手会顺带触发 onClick 的选中切换 */
  const suppressClickRef = useRef(false);
  const [dragPreview, setDragPreview] = useState<{ asset: UserAsset; x: number; y: number } | null>(null);

  const handlePointerDown = useCallback((e: React.PointerEvent, asset: UserAsset) => {
    if (e.button !== 0) return; // 只处理左键
    dragRef.current = { asset, startX: e.clientX, startY: e.clientY, moved: false };

    const onMove = (ev: PointerEvent) => {
      const st = dragRef.current;
      if (!st) return;
      if (!st.moved && Math.hypot(ev.clientX - st.startX, ev.clientY - st.startY) < 5) return;
      if (!st.moved) {
        st.moved = true;
        setDraggingAsset(st.asset);
      }
      setDragPreview({ asset: st.asset, x: ev.clientX, y: ev.clientY });
    };

    const onUp = (ev: PointerEvent) => {
      const st = dragRef.current;
      cleanup();
      if (!st) return;
      if (st.moved) {
        suppressClickRef.current = true; // 拖拽结束，忽略随之而来的 click
        emitAssetDrop({ asset: st.asset, x: ev.clientX, y: ev.clientY });
      }
      dragRef.current = null;
      setDragPreview(null);
      setDraggingAsset(null);
    };

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, []);

  const handleDelete = useCallback(
    async (asset: UserAsset) => {
      try {
        await assetApi.delete(asset.id);
        counts.current[type] = Math.max(0, (counts.current[type] ?? 1) - 1);
        setAssets((prev) => prev.filter((a) => a.id !== asset.id));
        if (playingId === asset.id) setPlayingId(null);
        message.success('已删除');
      } catch (err) {
        console.error('删除资产失败:', err);
      }
    },
    [type, playingId, message],
  );

  const handleDownload = useCallback(
    async (asset: UserAsset) => {
      try {
        await downloadFile(asset.url, asset.name || undefined);
      } catch (err) {
        console.error('下载失败:', err);
        message.error('下载失败');
      }
    },
    [message],
  );

  const segments: { key: UserAssetType; label: string; icon: React.ReactNode }[] = [
    { key: 'image', label: '图片', icon: <PictureOutlined /> },
    { key: 'video', label: '视频', icon: <VideoCameraOutlined /> },
  ];

  return (
    <div
      className="relative flex flex-col bg-white border-r border-gray-200 shadow-[2px_0_8px_rgba(0,0,0,0.04)]"
      style={{ width: PANEL_WIDTH }}
    >
      {/* 头部：标题 + 关闭 */}
      <div className="flex items-center justify-between px-3 h-11 border-b border-gray-100 flex-shrink-0">
        <span className="text-[13px] font-medium text-gray-700">个人资产库</span>
        <button
          onClick={onClose}
          title="收起（只收起面板，资产不受影响）"
          className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 cursor-pointer"
        >
          <CloseOutlined className="text-[12px]" />
        </button>
      </div>

      {/* 类型切换 + 搜索 */}
      <div className="px-3 py-2 space-y-2 border-b border-gray-100 flex-shrink-0">
        <div className="flex gap-1.5">
          {segments.map((seg) => {
            const active = type === seg.key;
            const n = counts.current[seg.key];
            return (
              <button
                key={seg.key}
                onClick={() => {
                  if (seg.key !== type) {
                    setLoading(!counts.current[seg.key]);
                    setPlayingId(null);
                    setType(seg.key);
                  }
                }}
                className={`flex-1 flex items-center justify-center gap-1.5 h-7 rounded-md text-[12px] transition-colors cursor-pointer ${
                  active
                    ? 'bg-blue-50 text-blue-600 font-medium'
                    : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
                }`}
              >
                {seg.icon}
                {seg.label}
                {n != null && <span className="text-[11px] opacity-70">{n}</span>}
              </button>
            );
          })}
        </div>
        <Input
          size="small"
          allowClear
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          prefix={<SearchOutlined className="text-gray-300" />}
          placeholder="搜索资产名称"
        />
      </div>

      {/* 资产网格 */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {loading ? (
          <div className="grid grid-cols-2 gap-2.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="aspect-video rounded-lg bg-gray-100 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            className="mt-10"
            description={
              <span className="text-[12px] text-gray-400">
                {keyword
                  ? '没有匹配的资产'
                  : type === 'image'
                    ? '暂无图片资产：在画布图片节点上右键可保存'
                    : '暂无视频资产：在画布视频节点上右键可保存'}
              </span>
            }
          />
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {filtered.map((asset) => (
              <div
                key={asset.id}
                onPointerDown={(e) => handlePointerDown(e, asset)}
                // 拖拽期间禁止浏览器默认行为（选中文字、原生图片拖影），避免和指针拖拽打架
                onDragStart={(e) => e.preventDefault()}
                onClick={() => {
                  if (suppressClickRef.current) {
                    suppressClickRef.current = false; // 这次 click 是拖拽的尾巴，不当作选中
                    return;
                  }
                  setSelectedId((cur) => (cur === asset.id ? null : asset.id));
                }}
                title={`${asset.name || '未命名'}（拖到画布生成节点）`}
                className="group relative aspect-video rounded-lg overflow-hidden bg-gray-100 cursor-pointer select-none"
              >
                {/* 图片/视频封面：无边框铺满，hover 轻微放大（与首页 tv show 卡片同一手法） */}
                <div className="absolute inset-0 transition-transform duration-300 group-hover:scale-[1.04]">
                  <AssetThumb asset={asset} />
                </div>

                {/* hover 蒙层：压暗图片，让底部文字和右上角操作更清楚 */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/25 transition-colors pointer-events-none" />

                {/* 视频：中央播放按钮（首页同款黑色半透明圆钮） */}
                {asset.type === 'video' && playingId !== asset.id && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setPlayingId(asset.id);
                    }}
                    className="absolute inset-0 flex items-center justify-center cursor-pointer"
                    title="播放"
                  >
                    <span className="w-6 h-6 rounded-full bg-black/50 group-hover:bg-black/70 text-white flex items-center justify-center transition-colors">
                      <CaretRightOutlined className="text-[10px]" />
                    </span>
                  </button>
                )}
                {asset.type === 'video' && playingId === asset.id && (
                  // eslint-disable-next-line jsx-a11y/media-has-caption
                  <video
                    src={asset.url}
                    autoPlay
                    controls
                    className="absolute inset-0 w-full h-full object-cover bg-black"
                    onClick={(e) => e.stopPropagation()}
                    onEnded={() => setPlayingId(null)}
                  />
                )}

                {/* 选中态：无边框模式用角标表示，不给卡片描边 */}
                {selectedId === asset.id && (
                  <span className="absolute left-1.5 top-1.5 z-20 w-5 h-5 rounded-full bg-blue-500 text-white flex items-center justify-center shadow-sm">
                    <CheckOutlined className="text-[11px]" />
                  </span>
                )}

                {/* 悬浮操作：下载 / 删除（沿用首页那种黑色半透明小圆钮，不给卡片加边框） */}
                <div className="absolute top-1.5 right-1.5 z-20 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDownload(asset);
                    }}
                    title="下载"
                    className="w-6 h-6 rounded-full bg-black/55 hover:bg-black/75 text-white flex items-center justify-center cursor-pointer backdrop-blur-sm"
                  >
                    <DownloadOutlined className="text-[11px]" />
                  </button>
                  <Popconfirm
                    title="删除该资产？"
                    description="仅删除资产库中的副本，不影响画布上的原节点"
                    onConfirm={() => handleDelete(asset)}
                    okText="删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                  >
                    <button
                      onClick={(e) => e.stopPropagation()}
                      title="删除"
                      className="w-6 h-6 rounded-full bg-black/55 hover:bg-red-500 text-white flex items-center justify-center cursor-pointer backdrop-blur-sm"
                    >
                      <DeleteOutlined className="text-[11px]" />
                    </button>
                  </Popconfirm>
                </div>

                {/* 名称：压在图上的底部渐变条里（首页同款），完整名字看 title */}
                <div className="absolute bottom-0 left-0 right-0 rounded-b-lg bg-gradient-to-t from-black/75 via-black/35 to-transparent px-2 pb-1.5 pt-6 pointer-events-none">
                  <div className="text-[10px] text-white truncate">{asset.name || '未命名'}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 底部提示 */}
      <div className="px-3 py-2 border-t border-gray-100 text-[10px] text-gray-400 flex-shrink-0">
        把资产拖到画布上即可生成节点
      </div>

      {/* 拖拽预览：正中压在光标上（之前偏到右下，和"落点＝光标"对不上） */}
      {dragPreview && (
        <div
          className="fixed z-[9999] pointer-events-none"
          style={{
            left: dragPreview.x,
            top: dragPreview.y,
            transform: 'translate(-50%, -50%)',
          }}
        >
          <div className="w-[112px] aspect-video rounded-lg overflow-hidden shadow-2xl ring-2 ring-white/60 bg-black/50">
            <AssetThumb asset={dragPreview.asset} />
          </div>
        </div>
      )}
    </div>
  );
}