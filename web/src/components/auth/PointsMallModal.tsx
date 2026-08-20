import { useEffect, useState } from 'react';
import { Modal, App, Empty } from 'antd';
import { GoldOutlined, CheckCircleFilled, CrownFilled } from '@ant-design/icons';
import { pointsPackageApi, type PointsPackage } from '@/services/pointsPackageApi';
import { pricingApi } from '@/services/pricingApi';

/** 容量估算参考模型：视频取 Seedance 2.0 480p，图片取默认的 Seedream 5.0 Lite */
const REF_VIDEO_MODEL_ID = 'doubao-seedance-2.0';
const REF_VIDEO_RESOLUTION = '480p';
const REF_IMAGE_MODEL_ID = 'doubao-seedream-5.0-lite';

/** 参考单价（积分/秒、积分/张），来自运营后台「价格管理」，未配置时为 0 */
interface RefPrices {
  videoPricePerSec: number;
  imagePricePerPiece: number;
  imageModelName: string;
}

/** 生成「可生成多少视频 / 图片」的参考文案（单价未配置时跳过对应条目） */
function capacityFeatures(points: number, prices: RefPrices): string[] {
  const features: string[] = [];
  if (prices.videoPricePerSec > 0) {
    const videoSeconds = Math.floor(points / prices.videoPricePerSec);
    features.push(`可生成约 ${videoSeconds.toLocaleString()} 秒 Seedance 2.0 480p 视频`);
  }
  if (prices.imagePricePerPiece > 0) {
    const imageCount = Math.floor(points / prices.imagePricePerPiece);
    features.push(`或可生成约 ${imageCount.toLocaleString()} 张图片`);
  }
  return features;
}

/** 积分超市弹窗：展示积分套餐卡片（套餐数据来自后台「套餐管理」，单价来自「价格管理」） */
export function PointsMallModal({ onClose }: { onClose: () => void }) {
  const { message } = App.useApp();
  const [packages, setPackages] = useState<PointsPackage[]>([]);
  const [prices, setPrices] = useState<RefPrices>({ videoPricePerSec: 0, imagePricePerPiece: 0, imageModelName: '图片' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    // 套餐列表
    pointsPackageApi
      .list()
      .then((res) => {
        if (!cancelled) setPackages(res.items || []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    // 参考单价（价格管理实时配置）
    pricingApi
      .list()
      .then((res) => {
        if (cancelled) return;
        const videoNode = res.nodes?.find((n) => n.node_type === 'video');
        const videoModel = videoNode?.models.find(
          (m) => m.model_id === REF_VIDEO_MODEL_ID && m.resolution === REF_VIDEO_RESOLUTION,
        );
        const imageNode = res.nodes?.find((n) => n.node_type === 'image');
        const imageModel =
          imageNode?.models.find((m) => m.model_id === REF_IMAGE_MODEL_ID) ?? imageNode?.models[0];
        setPrices({
          videoPricePerSec: videoModel?.price ?? 0,
          imagePricePerPiece: imageModel?.price ?? 0,
          imageModelName: imageModel?.model_name || '图片',
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  const handleBuy = (pkg: PointsPackage) => {
    message.info(`「${pkg.name}」支付功能即将上线，敬请期待`);
  };

  // 底部参考单价说明（按已配置的单价动态拼接）
  const priceNotes: string[] = [];
  if (prices.videoPricePerSec > 0) {
    priceNotes.push(`Seedance 2.0 480p 视频 ${prices.videoPricePerSec} 积分/秒`);
  }
  if (prices.imagePricePerPiece > 0) {
    priceNotes.push(`${prices.imageModelName} ${prices.imagePricePerPiece} 积分/张`);
  }

  return (
    <Modal
      title={
        <span className="flex items-center gap-2">
          <GoldOutlined className="text-amber-500" />
          积分超市
        </span>
      }
      open
      onCancel={onClose}
      footer={null}
      width={880}
      destroyOnClose
      styles={{
        mask: { backdropFilter: 'blur(4px)' },
        body: { padding: '20px 24px 24px' },
      }}
    >
      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400 text-sm">加载中...</div>
      ) : packages.length === 0 ? (
        <div className="py-10">
          <Empty description="暂无在售套餐" />
        </div>
      ) : (
        <div className={`grid gap-4 ${packages.length >= 3 ? 'grid-cols-3' : packages.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {packages.map((pkg) => {
            const features = [
              ...capacityFeatures(pkg.points, prices),
              ...(pkg.features || '').split('\n').map((f) => f.trim()).filter(Boolean),
            ];
            return (
              <div
                key={pkg.id}
                className={`relative flex flex-col rounded-2xl p-5 transition-all duration-200 hover:-translate-y-1 hover:shadow-xl ${
                  pkg.recommended
                    ? 'bg-gradient-to-b from-amber-50 to-orange-50 shadow-lg ring-2 ring-amber-400'
                    : 'bg-gray-50 ring-1 ring-gray-200 hover:ring-gray-300'
                }`}
              >
                {/* 角标 */}
                {pkg.badge && (
                  <span
                    className={`absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-3 py-0.5 text-[12px] font-medium text-white shadow ${
                      pkg.recommended
                        ? 'bg-gradient-to-r from-amber-500 to-orange-500'
                        : 'bg-gradient-to-r from-violet-500 to-purple-500'
                    }`}
                  >
                    {pkg.recommended && <CrownFilled className="mr-1" />}
                    {pkg.badge}
                  </span>
                )}

                {/* 套餐名 */}
                <div className={`text-center text-[15px] font-semibold ${pkg.recommended ? 'text-amber-700' : 'text-gray-700'}`}>
                  {pkg.name}
                </div>

                {/* 积分数量 */}
                <div className="mt-3 text-center">
                  <span className={`text-[28px] font-bold leading-none ${pkg.recommended ? 'text-amber-600' : 'text-gray-800'}`}>
                    {pkg.points.toLocaleString()}
                  </span>
                  <span className="ml-1 text-[13px] text-gray-500">积分</span>
                </div>

                {/* 价格 */}
                <div className="mt-1.5 text-center text-[13px] text-gray-400">
                  售价 <span className="text-[16px] font-semibold text-red-500">¥{pkg.price}</span>
                </div>

                {/* 特点列表 */}
                <ul className="mt-4 flex-1 space-y-2 border-t border-gray-200/70 pt-4">
                  {features.map((f) => (
                    <li key={f} className="flex items-start gap-1.5 text-[12px] leading-5 text-gray-600">
                      <CheckCircleFilled className={`mt-0.5 shrink-0 text-[12px] ${pkg.recommended ? 'text-amber-500' : 'text-green-500'}`} />
                      {f}
                    </li>
                  ))}
                </ul>

                {/* 购买按钮 */}
                <button
                  onClick={() => handleBuy(pkg)}
                  className={`mt-4 w-full cursor-pointer rounded-lg py-2 text-[14px] font-medium text-white transition-all duration-200 hover:shadow-lg active:scale-95 ${
                    pkg.recommended
                      ? 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600'
                      : 'bg-gradient-to-r from-gray-700 to-gray-900 hover:from-gray-800 hover:to-black'
                  }`}
                >
                  立即购买
                </button>
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-4 text-center text-[12px] text-gray-400">
        积分可用于故事、分镜、图片、视频、音频等全部 AI 生成功能
        {priceNotes.length > 0 && (
          <>
            <br />
            参考单价：{priceNotes.join('，')}
          </>
        )}
      </p>
    </Modal>
  );
}
