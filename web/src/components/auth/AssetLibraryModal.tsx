import { useCallback, useEffect, useState } from 'react';
import { Modal, Tabs, Empty, App, Popconfirm } from 'antd';
import { CaretRightOutlined } from '@ant-design/icons';
import { assetApi, type UserAsset, type UserAssetType } from '@/services/assetApi';
import { downloadFile } from '@/utils/download';

interface AssetLibraryModalProps {
  onClose: () => void;
  /** 选择模式：仅展示指定类型的资产，点击卡片选中并回调（画布节点导入资产用） */
  pickType?: UserAssetType;
  onPick?: (asset: UserAsset) => void;
}

/** 格式化保存时间（短格式） */
function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false });
}

/** 悬浮操作按钮行的公共样式 */
const ACTION_BTN_CLS = 'flex-1 px-2 py-1 text-[11px] rounded transition-colors cursor-pointer';

/**
 * 单个资产卡片（样式对齐运营管理页，统一横屏 16:9）：
 * - 图片：16:9 裁切展示（object-cover），悬浮渐变遮罩 + 标题 + 操作按钮行
 * - 视频：16:9 展示，中央播放按钮 + 底部信息栏
 */
function AssetCard({
  asset,
  onDelete,
  playing,
  onPlay,
  onPlayEnd,
}: {
  asset: UserAsset;
  onDelete: (asset: UserAsset) => Promise<void>;
  playing: boolean;
  onPlay: () => void;
  onPlayEnd: () => void;
}) {
  const { message } = App.useApp();
  const [downloading, setDownloading] = useState(false);

  const handleDownload = useCallback(async () => {
    setDownloading(true);
    try {
      await downloadFile(asset.url, asset.name || undefined);
    } catch (err) {
      console.error('下载失败:', err);
      message.error('下载失败');
    } finally {
      setDownloading(false);
    }
  }, [asset.url, asset.name, message]);

  // 悬浮操作按钮行（下载 + 删除，删除带二次确认）
  const actionButtons = (
    <div className="flex items-center gap-1.5">
      <button
        onClick={(e) => { e.stopPropagation(); handleDownload(); }}
        disabled={downloading}
        className={`${ACTION_BTN_CLS} bg-white/20 text-white hover:bg-white/30`}
      >
        {downloading ? '下载中...' : '下载'}
      </button>
      <Popconfirm
        title="删除该资产？"
        description="仅删除资产库中的副本，不影响画布上的原节点"
        onConfirm={() => onDelete(asset)}
        okText="删除"
        cancelText="取消"
        okButtonProps={{ danger: true }}
      >
        <button
          onClick={(e) => e.stopPropagation()}
          className={`${ACTION_BTN_CLS} bg-red-500/80 text-white hover:bg-red-500`}
        >
          删除
        </button>
      </Popconfirm>
    </div>
  );

  if (asset.type === 'image') {
    // 图片卡片：横屏 16:9 裁切展示
    return (
      <div className="group relative bg-white rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow">
        <div className="relative bg-gray-100 aspect-video">
          <img src={asset.url} alt={asset.name} className="w-full h-full object-cover" loading="lazy" />
          {/* 悬浮遮罩层：标题 + 时间 + 操作按钮 */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-3">
            <h3 className="text-[13px] font-medium text-white truncate">{asset.name || '未命名'}</h3>
            <p className="text-white/60 text-[10px] mb-2">{formatTime(asset.created_at)}</p>
            {actionButtons}
          </div>
        </div>
      </div>
    );
  }

  // 视频卡片：横屏 16:9 展示
  return (
    <div className="group relative rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-all">
      <div className="relative bg-gray-900 aspect-video">
        {playing ? (
          <video
            src={asset.url}
            className="absolute inset-0 w-full h-full"
            autoPlay
            controls
            playsInline
            onEnded={onPlayEnd}
          />
        ) : (
          <>
            <video
              src={asset.url}
              className="absolute inset-0 w-full h-full object-cover"
              muted
              preload="metadata"
            />

            {/* 播放按钮 */}
            <button
              onClick={onPlay}
              className="absolute inset-0 m-auto w-10 h-10 bg-black/50 backdrop-blur-sm rounded-full flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity z-20 cursor-pointer"
              title="播放"
            >
              <CaretRightOutlined style={{ fontSize: 18, marginLeft: 2 }} />
            </button>

            {/* 悬浮操作按钮（右上角） */}
            <div className="absolute top-2 right-2 z-30 opacity-0 group-hover:opacity-100 transition-opacity w-24">
              {actionButtons}
            </div>

            {/* 底部信息遮罩 */}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/65 via-black/30 to-transparent px-3 pt-8 pb-2.5 z-10">
              <div className="flex items-center justify-between">
                <p className="text-white text-[13px] font-medium truncate drop-shadow flex-1">{asset.name || '未命名'}</p>
                <span className="text-white/70 text-[10px] ml-2 shrink-0">{formatTime(asset.created_at)}</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * 选择模式卡片（画布节点导入资产用）：整卡点击选中，同样横屏 16:9
 */
function PickCard({ asset, onPick }: { asset: UserAsset; onPick: (asset: UserAsset) => void }) {
  const cardCls = 'group relative rounded-lg overflow-hidden shadow-sm hover:shadow-md hover:ring-2 hover:ring-blue-400 transition-all cursor-pointer';
  const nameBar = (
    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/65 via-black/30 to-transparent px-3 pt-8 pb-2.5">
      <p className="text-white text-[13px] font-medium truncate drop-shadow">{asset.name || '未命名'}</p>
    </div>
  );

  if (asset.type === 'image') {
    return (
      <div
        onClick={() => onPick(asset)}
        title="点击选择该资产"
        className={`${cardCls} bg-white`}
      >
        <div className="relative bg-gray-100 aspect-video">
          <img src={asset.url} alt={asset.name} className="w-full h-full object-cover" loading="lazy" />
          {nameBar}
        </div>
      </div>
    );
  }

  return (
    <div onClick={() => onPick(asset)} title="点击选择该资产" className={cardCls}>
      <div className="relative bg-gray-900 aspect-video">
        <video
          src={asset.url}
          className="absolute inset-0 w-full h-full object-cover"
          muted
          preload="metadata"
        />
        {nameBar}
      </div>
    </div>
  );
}

/**
 * 个人资产库弹窗
 * - 两个 Tab：图片资产 / 视频资产
 * - 图片 / 视频统一横屏 16:9 展示，一行 3 列
 * - 选择模式（pickType + onPick）：画布节点导入资产用，点击卡片即选中
 */
export function AssetLibraryModal({ onClose, pickType, onPick }: AssetLibraryModalProps) {
  const { message } = App.useApp();
  // 选择模式：固定展示对应类型资产，隐藏 Tabs（画布节点导入用）
  const isPickMode = !!pickType;
  const [activeTab, setActiveTab] = useState<UserAssetType>(pickType || 'image');
  const [images, setImages] = useState<UserAsset[]>([]);
  const [videos, setVideos] = useState<UserAsset[]>([]);
  // 正在播放的视频资产 ID（同视频管理卡片：点击播放后就地切换为播放器）
  const [playingAssetId, setPlayingAssetId] = useState<string | null>(null);
  // 初始为 true：首次加载由下方 effect 触发，无需在 effect 内同步置位
  const [loading, setLoading] = useState(true);

  const fetchAssets = useCallback(async (type: UserAssetType) => {
    try {
      const list = await assetApi.list(type);
      if (type === 'image') {
        setImages(list || []);
      } else {
        setVideos(list || []);
      }
    } catch (err) {
      console.error('加载资产失败:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // 切换 Tab 时拉取对应类型的资产（数据获取场景：setState 均在 await 之后，非同步置位）
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchAssets(activeTab);
  }, [activeTab, fetchAssets]);

  const handleDelete = useCallback(async (asset: UserAsset) => {
    try {
      await assetApi.delete(asset.id);
      message.success('已删除');
      if (asset.type === 'image') {
        setImages((prev) => prev.filter((a) => a.id !== asset.id));
      } else {
        setVideos((prev) => prev.filter((a) => a.id !== asset.id));
      }
    } catch (err) {
      console.error('删除资产失败:', err);
    }
  }, [message]);

  // 选择模式下点击卡片：选中资产并关闭弹窗
  const handlePick = useCallback((asset: UserAsset) => {
    if (!isPickMode) return;
    onPick?.(asset);
    onClose();
  }, [isPickMode, onPick, onClose]);

  const currentList = activeTab === 'image' ? images : videos;

  return (
    <Modal
      title={isPickMode ? (pickType === 'image' ? '从资产库选择图片' : '从资产库选择视频') : '资产管理'}
      open
      onCancel={onClose}
      footer={null}
      width={960}
      destroyOnClose
      styles={{ body: { padding: '8px 20px 20px', height: '68vh', overflowY: 'auto' } }}
    >
      {!isPickMode && (
        <Tabs
          activeKey={activeTab}
          onChange={(key) => {
            const type = key as UserAssetType;
            if (type !== activeTab) {
              setLoading(true); // 在事件回调里置位，避免 effect 内同步 setState
              setPlayingAssetId(null); // 切 Tab 时停止播放
            }
            setActiveTab(type);
          }}
          items={[
            { key: 'image', label: `图片资产（${images.length}）` },
            { key: 'video', label: `视频资产（${videos.length}）` },
          ]}
        />
      )}

      {loading ? (
        <div className="py-16 text-center text-gray-400 text-sm">加载中...</div>
      ) : currentList.length === 0 ? (
        <Empty
          description={activeTab === 'image' ? '暂无图片资产，在画布图片节点上右键可保存' : '暂无视频资产，在画布视频节点上右键可保存'}
          className="py-12"
        />
      ) : activeTab === 'image' ? (
        // 图片：3 列网格，横屏 16:9 展示
        <div className="grid grid-cols-3 gap-4">
          {images.map((asset) =>
            isPickMode ? (
              <PickCard key={asset.id} asset={asset} onPick={handlePick} />
            ) : (
              <AssetCard
                key={asset.id}
                asset={asset}
                onDelete={handleDelete}
                playing={false}
                onPlay={() => {}}
                onPlayEnd={() => {}}
              />
            )
          )}
        </div>
      ) : (
        // 视频：3 列网格，横屏 16:9 展示
        <div className="grid grid-cols-3 gap-4">
          {videos.map((asset) =>
            isPickMode ? (
              <PickCard key={asset.id} asset={asset} onPick={handlePick} />
            ) : (
              <AssetCard
                key={asset.id}
                asset={asset}
                onDelete={handleDelete}
                playing={playingAssetId === asset.id}
                onPlay={() => setPlayingAssetId(asset.id)}
                onPlayEnd={() => setPlayingAssetId(null)}
              />
            )
          )}
        </div>
      )}
    </Modal>
  );
}
