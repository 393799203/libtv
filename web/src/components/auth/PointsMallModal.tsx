import { useEffect, useRef, useState } from 'react';
import { Modal, App } from 'antd';
import { GiftOutlined,
  CheckCircleFilled,
  CrownFilled,
  GoldOutlined,
  ShoppingOutlined,
} from '@ant-design/icons';
import { pointsPackageApi, type PointsPackage } from '@/services/pointsPackageApi';
import { pricingApi } from '@/services/pricingApi';
import { paymentApi } from '@/services/paymentApi';
import { refreshCredits as refreshCreditsGlobal } from '@/utils/refreshCredits';
import { EmptyState } from '../../components/common/EmptyState';

/** 参考单价估算：视频取当前渠道第一个 480p 已配价模型，图片取第一个已配价模型 */
const REF_VIDEO_RESOLUTION = '480p';

/** 参考单价（积分/秒、积分/张），来自运营后台「价格管理」，未配置时为 0 */
interface RefPrices {
  videoPricePerSec: number;
  imagePricePerPiece: number;
  videoModelName: string;
  imageModelName: string;
}

/** 生成「可生成多少视频 / 图片」的参考文案（单价未配置时跳过对应条目） */
/** 平台基准汇率：100 积分 = 1 元（默认价，运营不加赠送时的兑法）。
 *  "多送"就是纯减法：积分 − 售价×100 → 套餐里真金白银多给的部分。*/
const POINTS_PER_YUAN = 100;

function bonusPoints(pkg: PointsPackage): number {
  if (pkg.points <= 0 || pkg.price <= 0) return 0;
  return Math.max(0, Math.round(pkg.points - pkg.price * POINTS_PER_YUAN));
}

function capacityFeatures(points: number, prices: RefPrices): string[] {
  const features: string[] = [];
  if (prices.videoPricePerSec > 0) {
    const videoSeconds = Math.floor(points / prices.videoPricePerSec);
    features.push(`可生成约 ${videoSeconds.toLocaleString()} 秒${prices.videoModelName || '视频'}`);
  }
  if (prices.imagePricePerPiece > 0) {
    const imageCount = Math.floor(points / prices.imagePricePerPiece);
    features.push(`或可生成约 ${imageCount.toLocaleString()} 张${prices.imageModelName || '图片'}`);
  }
  return features;
}

/** 积分超市弹窗：展示积分套餐卡片（套餐数据来自后台「套餐管理」，单价来自「价格管理」） */
export function PointsMallModal({ onClose }: { onClose: () => void }) {
  const { message } = App.useApp();
  const [packages, setPackages] = useState<PointsPackage[]>([]);
  const [prices, setPrices] = useState<RefPrices>({ videoPricePerSec: 0, imagePricePerPiece: 0, videoModelName: '视频', imageModelName: '图片' });
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
    // 按当前登录用户渠道返回（后端 /api/pricing 未传 channel 时按用户最终渠道解析），
    // 参考模型动态取当前渠道第一个有价格的视频/图片模型（电信用户看电信模型估算）
    pricingApi
      .list()
      .then((res) => {
        if (cancelled) return;
        const videoNode = res.nodes?.find((n) => n.node_type === 'video');
        // 视频：取第一个 480p 且已配价的模型作为参考
        const videoModel =
          videoNode?.models.find(
            (m) => (m.resolution || '').toLowerCase() === REF_VIDEO_RESOLUTION && m.price > 0,
          ) ?? videoNode?.models.find((m) => m.price > 0);
        const imageNode = res.nodes?.find((n) => n.node_type === 'image');
        // 图片：取第一个已配价的模型作为参考
        const imageModel =
          imageNode?.models.find((m) => m.price > 0) ?? imageNode?.models[0];
        setPrices({
          videoPricePerSec: videoModel?.price ?? 0,
          imagePricePerPiece: imageModel?.price ?? 0,
          videoModelName: videoModel?.model_name || '视频',
          imageModelName: imageModel?.model_name || '图片',
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  const [payingPkgId, setPayingPkgId] = useState<number | null>(null);
  // 支付轮询定时器（组件销毁时清理）
  const payTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const payTriesRef = useRef(0);

  useEffect(() => {
    return () => {
      if (payTimerRef.current) clearInterval(payTimerRef.current);
    };
  }, []);

  // 余额刷新统一走公共实现（节流 + 并发合并 + 失败静默）
  const refreshCredits = () => refreshCreditsGlobal(true);

  /** 轮询订单直到支付成功（最多 5 分钟） */
  const startPolling = (orderNo: string, points: number) => {
    if (payTimerRef.current) clearInterval(payTimerRef.current);
    payTriesRef.current = 0;
    payTimerRef.current = setInterval(async () => {
      payTriesRef.current += 1;
      try {
        const order = await paymentApi.getOrder(orderNo);
        if (order.status === 'paid') {
          if (payTimerRef.current) clearInterval(payTimerRef.current);
          payTimerRef.current = null;
          message.success(`支付成功，${points.toLocaleString()} 积分已到账`);
          await refreshCredits();
        }
      } catch {
        // 网络抖动忽略，继续轮询
      }
      if (payTriesRef.current >= 100) {
        if (payTimerRef.current) clearInterval(payTimerRef.current);
        payTimerRef.current = null;
      }
    }, 3000);
  };

  const handleBuy = async (pkg: PointsPackage) => {
    if (payingPkgId !== null) return;
    setPayingPkgId(pkg.id);
    try {
      const order = await paymentApi.createOrder(pkg.id);
      // 打开支付宝收银台（新窗口），弹窗内轮询订单状态
      window.open(order.pay_url, '_blank');
      message.info('请在打开的支付宝页面完成支付');
      startPolling(order.order_no, order.points);
    } catch {
      // 失败原因已由 axios 拦截器统一提示（如：支付功能未开启）
    } finally {
      setPayingPkgId(null);
    }
  };

  // 底部参考单价说明（按已配置的单价动态拼接，模型名来自当前渠道）
  const priceNotes: string[] = [];
  if (prices.videoPricePerSec > 0) {
    priceNotes.push(`${prices.videoModelName || '视频'} ${prices.videoPricePerSec} 积分/秒`);
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
      // 4 个及以上套餐一行摆 4 个，模态框相应加宽，卡片才不会被挤窄；
      // 1~3 个仍沿用原来的宽度与列数
      width={packages.length >= 4 ? 1040 : 880}
      destroyOnClose
      // 移动端（<768px）由 index.css 的 .points-mall-modal 规则改为全屏抽屉，卡片才有足够宽度
      wrapClassName="points-mall-modal"
      styles={{
        mask: { backdropFilter: 'blur(4px)' },
        body: { padding: '20px 24px 24px' },
      }}
    >
      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400 text-sm">加载中...</div>
      ) : packages.length === 0 ? (
        <div className="py-10">
          <EmptyState
            icon={<ShoppingOutlined />}
            title="暂无在售套餐"
            hint="套餐上架后会显示在这里，稍后再来看看"
          />
        </div>
      ) : (
        // 列数按套餐数量自适应：4 个及以上一行 4 个（窄屏退化为 2 列，避免卡片被压扁）。
        // Tailwind 静态提取类名，所以只能写完整字面量，不能用 `grid-cols-${n}` 拼。
        // 移动端（<640px）统一 1 列：弹窗被压到 374px 后 3 列每张卡只有 82px，实测还横向溢出 13px。
        <div
          className={`grid gap-4 ${
            packages.length >= 4
              ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
              : packages.length === 3
                ? 'grid-cols-1 sm:grid-cols-3'
                : packages.length === 2
                  ? 'grid-cols-1 sm:grid-cols-2'
                  : 'grid-cols-1'
          }`}
        >
          {packages.map((pkg) => {
            const features = [
              ...capacityFeatures(pkg.points, prices),
              ...(pkg.features || '').split('\n').map((f) => f.trim()).filter(Boolean),
            ];
            const bonus = bonusPoints(pkg);
            return (
              <div
                key={pkg.id}
                className={`relative flex flex-col rounded-2xl p-4 md:p-5 transition-all duration-200 hover:-translate-y-1 hover:shadow-[var(--dv-hairline),var(--dv-elev-2)] ${
                  pkg.recommended
                    ? 'bg-gradient-to-b from-cyan-500/15 via-blue-500/10 to-violet-500/15 shadow-lg ring-2 ring-cyan-400/60'
                    : 'bg-[var(--dv-surface-1)] ring-1 ring-white/10 shadow-[var(--dv-hairline),var(--dv-elev-1)] hover:ring-white/25'
                }`}
              >
                {/* 角标 */}
                {pkg.badge && (
                  <span
                    className={`absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-3 py-0.5 text-[12px] font-medium text-white shadow ${
                      pkg.recommended
                        ? 'bg-gradient-to-r from-cyan-500 to-violet-600'
                        : 'bg-gradient-to-r from-violet-500 to-purple-500'
                    }`}
                  >
                    {pkg.recommended && <CrownFilled className="mr-1" />}
                    {pkg.badge}
                  </span>
                )}

                {/* 套餐名 */}
                <div className={`text-center text-[15px] font-semibold ${pkg.recommended ? 'text-cyan-200' : 'text-gray-700'}`}>
                  {pkg.name}
                </div>

                {/* 积分数量 */}
                <div className="mt-3 text-center">
                  <span className={`text-[32px] md:text-[28px] font-bold leading-none tabular-nums ${pkg.recommended ? 'text-cyan-200' : 'text-[var(--dv-text-1)]'}`}>
                    {pkg.points.toLocaleString()}
                  </span>
                  <span className="ml-1 text-[13px] text-gray-500">积分</span>
                </div>

                {/* 多送积分：只有真的比入门套餐更划算才出现 */}
                {bonus > 0 && (
                  <div className="mt-2 flex justify-center">
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2.5 py-[3px] text-[11px] font-medium text-amber-300 tabular-nums ring-1 ring-amber-300/30">
                      <GiftOutlined className="text-[11px]" />
                      多送 {bonus.toLocaleString()} 积分
                    </span>
                  </div>
                )}

                {/* 价格 + 单价折算（让"值不值"一眼可比） */}
                <div className="mt-2 text-center text-[13px] text-[var(--dv-text-3)]">
                  售价 <span className="text-[17px] font-semibold text-amber-300 tabular-nums">¥{pkg.price}</span>
                  {pkg.points > 0 && (
                    <div className="mt-0.5 text-[11px] tabular-nums text-[var(--dv-text-3)]">
                      基准 {pkg.price * POINTS_PER_YUAN >= 1000 ? (pkg.price * POINTS_PER_YUAN).toLocaleString() : pkg.price * POINTS_PER_YUAN} 积分 · 折合 ¥{(pkg.price / pkg.points).toFixed(4)}/积分
                    </div>
                  )}
                </div>

                {/* 特点列表 */}
                <ul className="mt-4 flex-1 space-y-2 border-t border-[var(--dv-border-1)] pt-4">
                  {features.map((f) => (
                    <li key={f} className="flex items-start gap-1.5 text-[13px] md:text-[12px] leading-5 text-gray-600">
                      <CheckCircleFilled className={`mt-0.5 shrink-0 text-[12px] text-cyan-400`} />
                      {f}
                    </li>
                  ))}
                </ul>

                {/* 购买按钮 */}
                <button
                  onClick={() => handleBuy(pkg)}
                  disabled={payingPkgId !== null}
                  className={`mt-4 w-full rounded-xl md:rounded-lg py-3 md:py-2 text-[15px] md:text-[14px] font-medium text-white transition-all duration-200 hover:shadow-lg active:scale-95 ${
                    payingPkgId !== null
                      ? 'cursor-not-allowed opacity-50'
                      : 'cursor-pointer'
                  } ${
                    pkg.recommended
                      ? 'bg-gradient-to-r from-cyan-500 to-violet-600 hover:from-cyan-400 hover:to-violet-500'
                      : 'bg-gradient-to-r from-[var(--dv-surface-3)] to-[var(--dv-border-2)] hover:brightness-110'
                  }`}
                >
                  {payingPkgId === pkg.id ? '正在跳转支付宝...' : '立即购买'}
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
