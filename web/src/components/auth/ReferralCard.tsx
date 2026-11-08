import { useEffect, useState } from 'react';
import { App, Button, Modal, Popover, QRCode, Spin } from 'antd';
import { CopyOutlined, QrcodeOutlined, TeamOutlined, BarChartOutlined } from '@ant-design/icons';
import { referralApi, type MyReferralStats } from '@/services/referralApi';
import { referralLink } from '@/utils/referral';
import { Z } from '@/utils/zLayers';

export function ReferralCard() {
  const { message } = App.useApp();
  const [data, setData] = useState<{ code: string; invited_users: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [showStats, setShowStats] = useState(false);
  const [stats, setStats] = useState<MyReferralStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsFailed, setStatsFailed] = useState(false);
  const loadStats = async () => {
    setShowStats(true); setStatsLoading(true); setStatsFailed(false);
    try { setStats(await referralApi.myStats()); }
    catch { setStatsFailed(true); }
    finally { setStatsLoading(false); }
  };
  useEffect(() => {
    let active = true;
    referralApi.mine().then(value => { if (active) { setData(value); setFailed(false); } })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [attempt]);
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); message.success('已复制'); }
    catch { message.info('复制失败，可以选中下方内容手动复制'); }
  };
  return (
    <section className="mb-6 rounded-xl border border-[var(--dv-border-1)] bg-[var(--dv-surface-2)] p-4" aria-label="我的推荐码">
      <div className="mb-2 flex items-center justify-between gap-2 text-[13px]">
        <span><TeamOutlined /> 邀请好友</span>
        {data && <span className="text-[11px] text-[var(--dv-text-3)]">已邀请 {data.invited_users} 人</span>}
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-[var(--dv-text-3)]">好友通过邀请链接或填写推荐码注册后，会计入你的邀请人数。</p>
      {data ? <>
        <div className="mb-2 flex items-center gap-2">
          <input readOnly value={data.code} aria-label="我的推荐码" onFocus={e => e.target.select()}
            className="min-w-0 flex-1 rounded-lg border border-[var(--dv-border-1)] bg-[var(--dv-surface-1)] p-2 font-mono text-[13px] tracking-wider" />
          <Button size="small" icon={<CopyOutlined />} onClick={() => void copy(data.code)}>复制推荐码</Button>
        </div>
        <div className="referral-link-row">
          <input readOnly value={referralLink(data.code)} aria-label="我的邀请链接" onFocus={e => e.target.select()}
            className="min-w-0 flex-1 rounded-lg border border-[var(--dv-border-1)] bg-[var(--dv-surface-1)] p-2 text-[11px] text-[var(--dv-text-3)]" />
          <Button size="small" aria-label="复制邀请链接" icon={<CopyOutlined />}
            onClick={() => void copy(referralLink(data.code))}>复制</Button>
        </div>
        <div className="flex gap-2">
          <Popover trigger="click" placement="top" zIndex={Z.modalTopAbove}
            title="二维码邀请链接"
            content={<div className="referral-qr-content">
              <div role="img" aria-label="带漫蛙标志的邀请二维码">
                <QRCode type="svg" value={referralLink(data.code)} size={208}
                  icon="/logo-mark-color.svg" iconSize={40} errorLevel="H"
                  color="#111827" bgColor="#fff" marginSize={4} bordered={false} />
              </div>
              <p>好友扫码即可通过你的邀请链接注册</p>
            </div>}>
            <Button className="flex-1" size="small" aria-label="二维码邀请链接" icon={<QrcodeOutlined />}>二维码邀请链接</Button>
          </Popover>
          <Button className="flex-1" size="small" aria-label="我的邀请统计" icon={<BarChartOutlined />} onClick={() => void loadStats()}>我的邀请统计</Button>
        </div>
      </> : failed ? <Button size="small" onClick={() => setAttempt(v => v + 1)}>重新读取推荐码</Button>
        : <p className="text-[12px] text-[var(--dv-text-3)]">正在读取推荐码…</p>}
      <Modal title="我的邀请统计" open={showStats} footer={null} width={680} zIndex={Z.modalTop}
        styles={{ body: { maxHeight: 'calc(90dvh - 90px)', overflowY: 'auto' } }}
        onCancel={() => setShowStats(false)}>
        <p className="mb-5 text-xs text-[var(--dv-text-3)]">仅统计你直接邀请并注册成功的用户，日期按北京时间计算。</p>
        {statsLoading ? <div className="py-10 text-center"><Spin /></div>
          : statsFailed ? <div role="alert" className="py-6 text-center"><p className="mb-3">邀请统计读取失败</p><Button onClick={() => void loadStats()}>重新读取</Button></div>
          : stats && <div aria-label="我的邀请数据">
            <div className="grid grid-cols-3 gap-3">
              {[['累计邀请',stats.invited_users],['近7天新增',stats.last_7_days],['近30天新增',stats.last_30_days]].map(([label,value]) =>
                <div key={label} className="rounded-xl border border-[var(--dv-border-1)] p-3">
                  <div className="text-[11px] text-[var(--dv-text-3)]">{label}</div>
                  <div className="mt-2 text-2xl font-medium tabular-nums">{value}<small className="ml-1 text-xs text-[var(--dv-text-3)]">人</small></div>
                </div>)}
            </div>
            <section className="mt-5" aria-label="被邀请用户充值与消耗">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-[13px] font-medium">被邀请用户充值与消耗</h3>
                <span className="text-[10px] text-[var(--dv-text-3)]">全部直接邀请用户 · 累计</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-[var(--dv-border-1)] bg-[var(--dv-surface-2)] p-3">
                  <div className="text-[11px] text-[var(--dv-text-3)]">成功充值金额</div>
                  <div className="mt-2 text-2xl font-medium tabular-nums">¥{(Number(stats.amount_fen ?? 0) / 100).toLocaleString('zh-CN', {
                    minimumFractionDigits: 2, maximumFractionDigits: 2,
                  })}</div>
                </div>
                <div className="rounded-xl border border-[var(--dv-border-1)] bg-[var(--dv-surface-2)] p-3">
                  <div className="text-[11px] text-[var(--dv-text-3)]">净消费积分</div>
                  <div className="mt-2 text-2xl font-medium tabular-nums">{Number(stats.net_consumed_points ?? 0).toLocaleString('zh-CN')}
                    <small className="ml-1 text-xs text-[var(--dv-text-3)]">积分</small>
                  </div>
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2 text-[11px] sm:grid-cols-3">
                {[
                  ['付费用户', stats.paying_users, '人'], ['成功充值', stats.paid_orders, '笔'],
                  ['充值到账', stats.paid_points, '积分'], ['人工充值 / 赠送', stats.bonus_points, '积分'],
                  ['累计消费', stats.consumed_points, '积分'], ['已退还', stats.refunded_points, '积分'],
                ].map(([label, value, unit]) => <div key={label} className="flex flex-wrap justify-between gap-1">
                  <dt className="text-[var(--dv-text-3)]">{label}</dt>
                  <dd className="tabular-nums">{Number(value ?? 0).toLocaleString('zh-CN')} {unit}</dd>
                </div>)}
              </dl>
              <p className="mt-3 text-[10px] leading-relaxed text-[var(--dv-text-3)]">
                仅计支付成功的充值订单，人工充值 / 赠送单列。净消费 = 累计消费 − 已退还积分。
              </p>
            </section>
            <div className="mb-3 mt-6 text-[13px]">近30天邀请注册趋势</div>
            <div className="flex h-28 items-end gap-1 border-b border-[var(--dv-border-1)]" role="img" aria-label={`近30天邀请注册${stats.last_30_days}人`}>
              {(stats.days || []).map(day => <div key={day.date} title={`${day.date}：${day.users}人`}
                className="flex-1 rounded-t bg-cyan-400/50" style={{
                  height: `${day.users ? Math.max(6,day.users/Math.max(1,...stats.days.map(d=>d.users))*100) : 2}%`,
                  opacity: day.users ? 1 : .2,
                }} />)}
            </div>
            <div className="mt-2 flex justify-between text-[10px] text-[var(--dv-text-3)]">
              <span>{stats.days?.[0]?.date}</span><span>{stats.days?.at(-1)?.date}</span>
            </div>
            {!stats.invited_users && <p className="mt-5 text-center text-xs text-[var(--dv-text-3)]">还没有邀请记录，复制邀请链接分享给好友吧。</p>}
          </div>}
      </Modal>
    </section>
  );
}
