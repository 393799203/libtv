import { useEffect, useRef, useState } from 'react';
import { Modal, App } from 'antd';
import { GiftOutlined,
  CheckCircleFilled,
  CrownFilled,
  GoldOutlined,
  ShoppingOutlined,
  AlipayOutlined,
  WechatOutlined,
  QrcodeOutlined,
  CopyOutlined,
} from '@ant-design/icons';
import { pointsPackageApi, type PointsPackage } from '@/services/pointsPackageApi';
import { pricingApi } from '@/services/pricingApi';
import { paymentApi, type PaymentMethods, type PayChannel } from '@/services/paymentApi';
import { refreshCredits as refreshCreditsGlobal } from '@/utils/refreshCredits';
import { EmptyState } from '../../components/common/EmptyState';

/** 参考单价估算：视频取当前渠道第一个 480p 已配价模型，图片取第一个已配价模型 */
const REF_VIDEO_RESOLUTION = '480p';

/** 参考单价（积分/秒、积分/张），来自运营管理中心「价格管理」，未配置时为 0 */
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

/** 是否移动端：与 index.css 里 .points-mall-modal 的全屏抽屉断点保持一致（<768px） */
function isMobileViewport(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return window.innerWidth < 768 || /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
}

/** 积分超市弹窗：展示积分套餐卡片（套餐数据来自后台「套餐管理」，单价来自「价格管理」） */
export function PointsMallModal({ onClose }: { onClose: () => void }) {
  const { message } = App.useApp();
  const [packages, setPackages] = useState<PointsPackage[]>([]);
  const [prices, setPrices] = useState<RefPrices>({ videoPricePerSec: 0, imagePricePerPiece: 0, videoModelName: '视频', imageModelName: '图片' });
  const [loading, setLoading] = useState(true);

  // 支付方式：支付宝默认选中；微信支付未配置时置灰（能力来自后端 /payment/methods）
  const [channel, setChannel] = useState<PayChannel>('alipay');
  const [methods, setMethods] = useState<PaymentMethods | null>(null);
  // 微信 PC 扫码：下单后展示支付链接（项目没有二维码依赖，按「链接 + 扫码说明」呈现，未新装依赖）
  const [wechatPay, setWechatPay] = useState<{ orderNo: string; points: number; amountFen: number; pkgName: string; payLink: string } | null>(null);

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

    // 支付方式能力：微信是否已开通、手机 H5 是否已开通（H5 需商户平台单独申请）
    // 失败时按「微信不可用」处理，支付宝流程照旧（不影响既有购买路径）
    paymentApi
      .methods()
      .then((res) => {
        if (!cancelled) setMethods(res);
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
    setWechatPay(null);
    try {
      // 微信 + 手机 + H5 已开通 → 走 H5 跳转；其余（含手机但 H5 未开通）走 Native 扫码链接
      const useH5 = channel === 'wechat' && isMobileViewport() && wechatH5Available;
      const order = await paymentApi.createOrder(pkg.id, {
        channel,
        client: useH5 ? 'h5' : 'pc',
      });

      if (order.channel === 'wechat') {
        if (order.pay_mode === 'h5' && order.h5_url) {
          message.info('正在打开微信支付...');
          // 手机端 H5：当前窗口跳转微信支付中间页（支付完成由微信跳回本站）
          window.location.assign(order.h5_url);
        } else {
          // PC 扫码（或手机未开通 H5 时的回落）：展示支付链接 + 扫码说明
          setWechatPay({
            orderNo: order.order_no,
            points: order.points,
            amountFen: order.amount_fen,
            pkgName: pkg.name,
            payLink: order.code_url || order.pay_url,
          });
          message.info('请用微信扫一扫完成支付');
        }
      } else {
        // 打开支付宝收银台（新窗口），弹窗内轮询订单状态
        window.open(order.pay_url, '_blank');
        message.info('请在打开的支付宝页面完成支付');
      }
      startPolling(order.order_no, order.points);
    } catch {
      // 失败原因已由 axios 拦截器统一提示（如：微信支付暂未开通）
    } finally {
      setPayingPkgId(null);
    }
  };

  /** 复制微信支付链接（未新装二维码依赖，手机微信里打开链接即可付款） */
  const copyPayLink = (link: string) => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(link)
        .then(() => message.success('支付链接已复制，请在手机微信中打开'))
        .catch(() => message.info('复制失败，请手动选中链接复制'));
      return;
    }
    message.info('请手动选中链接复制到手机微信打开');
  };

  // 底部参考单价说明（按已配置的单价动态拼接，模型名来自当前渠道）
  const priceNotes: string[] = [];
  if (prices.videoPricePerSec > 0) {
    priceNotes.push(`${prices.videoModelName || '视频'} ${prices.videoPricePerSec} 积分/秒`);
  }
  if (prices.imagePricePerPiece > 0) {
    priceNotes.push(`${prices.imageModelName} ${prices.imagePricePerPiece} 积分/张`);
  }

  // 支付能力（接口失败时：微信按不可用处理，支付宝保持原有可用）
  const wechatAvailable = methods?.wechat?.available ?? false;
  const wechatH5Available = wechatAvailable && (methods?.wechat?.h5_available ?? false);
  const wechatReason = methods?.wechat?.reason || '暂未开通';
  const wechatH5Reason = methods?.wechat?.h5_reason || '';

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
      // 1~3 个仍沿用原来的宽度与列数。
      // 2026-10-09：整体再放宽一档（880→940 / 1040→1100）—— 支付方式换成两张并排卡片后
      // 需要更从容的横向空间，套餐卡也跟着更透气；窄屏由 antd 的 max-width 自动收窄，不会溢出。
      width={packages.length >= 4 ? 1100 : 940}
      destroyOnClose
      // 移动端（<768px）由 index.css 的 .points-mall-modal 规则改为全屏抽屉，卡片才有足够宽度
      wrapClassName="points-mall-modal"
      styles={{
        mask: { backdropFilter: 'blur(4px)' },
        body: { padding: '20px 24px 24px' },
      }}
    >
      {/* 支付方式：两张并排的「选择卡」（支付宝 / 微信支付）——
          以前是两个小胶囊按钮挤在"支付方式"三个字后面，看着像筛选标签而不是付款方式。
          现在每张卡有品牌色图标底座 + 名称 + 一句状态说明，选中时整卡高亮 + 右侧对勾，
          未开通时整卡置灰并挂「暂未开通」角标（原因仍放 title，鼠标悬停可看） */}
      {!loading && packages.length > 0 && (
        <div className="mb-5">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-[12px] font-medium text-[var(--dv-text-2)]">支付方式</span>
            {/* 一条细线把标题和小节分开，比孤零零三个字更像"一栏设置" */}
            <span className="h-px flex-1 bg-[var(--dv-border-1)]" />
          </div>
          {/* 两张卡并排但**不铺满整行**：模态框现在很宽，卡片拉满会显得空荡；
              sm 断点以上限宽 560px（每张约 274px），窄屏自动退化成竖排两张 */}
          <div className="grid grid-cols-1 gap-3 sm:max-w-[560px] sm:grid-cols-2">
            <button
              type="button"
              aria-pressed={channel === 'alipay'}
              onClick={() => setChannel('alipay')}
              disabled={payingPkgId !== null}
              className={`group flex items-center gap-3 rounded-2xl px-4 py-3 text-left transition-all duration-200 ${
                channel === 'alipay'
                  ? 'bg-cyan-500/10 ring-2 ring-cyan-400/60 shadow-[0_0_18px_-6px_rgba(34,211,238,0.55)]'
                  : 'bg-[var(--dv-surface-1)] ring-1 ring-white/10 hover:-translate-y-0.5 hover:ring-white/25'
              } ${payingPkgId !== null ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[18px] transition-colors ${
                  channel === 'alipay' ? 'bg-cyan-400/20 text-cyan-300' : 'bg-sky-400/10 text-sky-400'
                }`}
              >
                <AlipayOutlined />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium text-[var(--dv-text-1)]">支付宝</span>
                <span className="block truncate text-[11px] text-[var(--dv-text-3)]">
                  {channel === 'alipay' ? '已选择 · 跳转支付宝完成付款' : '推荐 · 手机/电脑都可直接付款'}
                </span>
              </span>
              {channel === 'alipay' && (
                <CheckCircleFilled className="shrink-0 text-[15px] text-cyan-400" />
              )}
            </button>
            <button
              type="button"
              aria-pressed={channel === 'wechat'}
              onClick={() => wechatAvailable && setChannel('wechat')}
              disabled={!wechatAvailable || payingPkgId !== null}
              title={wechatAvailable ? '微信支付' : wechatReason}
              className={`group flex items-center gap-3 rounded-2xl px-4 py-3 text-left transition-all duration-200 ${
                channel === 'wechat'
                  ? 'bg-emerald-500/10 ring-2 ring-emerald-400/60 shadow-[0_0_18px_-6px_rgba(52,211,153,0.55)]'
                  : 'bg-[var(--dv-surface-1)] ring-1 ring-white/10 hover:-translate-y-0.5 hover:ring-white/25'
              } ${
                !wechatAvailable || payingPkgId !== null
                  ? 'cursor-not-allowed opacity-50'
                  : 'cursor-pointer'
              }`}
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[18px] transition-colors ${
                  channel === 'wechat' ? 'bg-emerald-400/20 text-emerald-300' : 'bg-emerald-400/10 text-emerald-400'
                }`}
              >
                <WechatOutlined />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--dv-text-1)]">
                  微信支付
                  {!wechatAvailable && (
                    <span className="rounded-md bg-white/5 px-1.5 py-[1px] text-[10px] font-normal text-gray-400">
                      暂未开通
                    </span>
                  )}
                </span>
                <span className="block truncate text-[11px] text-[var(--dv-text-3)]">
                  {!wechatAvailable
                    ? wechatReason
                    : channel === 'wechat'
                      ? '已选择 · 微信内完成付款'
                      : wechatH5Available
                        ? '手机端 H5 / 电脑端扫码'
                        : '电脑端扫码支付'}
                </span>
              </span>
              {channel === 'wechat' && wechatAvailable && (
                <CheckCircleFilled className="shrink-0 text-[15px] text-emerald-400" />
              )}
            </button>
          </div>
          {channel === 'wechat' && !wechatH5Available && (
            <div className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-300/90">
              <QrcodeOutlined className="mt-[1px] shrink-0" />
              <span>
                手机端 H5 支付未开通，已回落扫码支付
                {wechatH5Reason ? `（${wechatH5Reason}）` : ''}
              </span>
            </div>
          )}
        </div>
      )}

      {/* 微信 PC 扫码：展示支付链接 + 扫码说明（未新装二维码依赖，故以链接形式呈现） */}
      {wechatPay && (
        <div className="mb-4 rounded-2xl bg-[var(--dv-surface-1)] p-4 ring-1 ring-emerald-400/30">
          <div className="flex items-start gap-3">
            <QrcodeOutlined className="mt-0.5 shrink-0 text-[18px] text-emerald-400" />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-[var(--dv-text-1)]">
                微信扫码支付 · {wechatPay.pkgName}
              </div>
              <div className="mt-1 text-[12px] text-[var(--dv-text-3)] tabular-nums">
                订单 {wechatPay.orderNo} · 应付 ¥{(wechatPay.amountFen / 100).toFixed(2)} · 到账{' '}
                {wechatPay.points.toLocaleString()} 积分
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <a
                  href={wechatPay.payLink}
                  target="_blank"
                  rel="noreferrer"
                  className="max-w-full truncate text-[12px] text-cyan-300 underline"
                >
                  打开微信支付链接
                </a>
                <button
                  onClick={() => copyPayLink(wechatPay.payLink)}
                  className="inline-flex items-center gap-1 rounded-lg px-2 py-[3px] text-[12px] text-[var(--dv-text-2)] ring-1 ring-white/15 hover:ring-white/30 cursor-pointer"
                >
                  <CopyOutlined className="text-[11px]" />
                  复制链接
                </button>
              </div>
              <div className="mt-2 text-[11px] leading-5 text-[var(--dv-text-3)]">
                支付链接需在微信内打开：复制链接发到手机微信（或直接用手机微信扫一扫对应的付款码）即可完成支付；
                本项目未引入二维码组件，故以链接形式展示。
              </div>
              <div className="mt-1 text-[11px] text-[var(--dv-text-3)]">支付完成后本窗口会自动到账，无需手动刷新。</div>
            </div>
          </div>
        </div>
      )}

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
                  {payingPkgId === pkg.id
                    ? channel === 'wechat'
                      ? '正在创建微信支付...'
                      : '正在跳转支付宝...'
                    : '立即购买'}
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
