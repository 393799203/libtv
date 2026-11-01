import { useEffect, useState } from 'react';
import { Button, Drawer, Input, Table, Tag } from 'antd';
import { ReloadOutlined, TeamOutlined } from '@ant-design/icons';
import { referralApi, type ReferralDashboard as DashboardData, type ReferralRow } from '@/services/referralApi';

const count = (value?: number) => Number(value || 0).toLocaleString('zh-CN');
const money = (fen?: number) => `¥${(Number(fen || 0) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function ReferralDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<ReferralRow | null>(null);
  const [detail, setDetail] = useState<DashboardData | null>(null);
  const [detailPage, setDetailPage] = useState(1);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailFailed, setDetailFailed] = useState(false);
  useEffect(() => {
    let active = true;
    referralApi.dashboard(page, keyword).then(result => {
      if (active) { setData(result); setFailed(false); }
    }).catch(() => { if (active) setFailed(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, keyword, refresh]);
  useEffect(() => {
    if (!selected) return;
    let active = true;
    referralApi.invitees(selected.id, detailPage).then(result => {
      if (active) { setDetail(result); setDetailFailed(false); }
    }).catch(() => { if (active) setDetailFailed(true); }).finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [selected, detailPage, refresh]);
  const s = data?.summary;
  const cards = [
    ['平台用户', s?.platform_users], ['邀请注册用户', s?.invited_users],
    ['有邀请记录的推荐人', s?.inviters], ['邀请用户中的付费人数', s?.paying_users],
    ['成功充值金额', s ? money(s.amount_fen) : undefined], ['净消费积分', s?.net_consumed_points],
  ];
  const identity = {
    title: '用户', key: 'user', width: 230,
    render: (_: unknown, row: ReferralRow) => <div><div className="font-medium">{row.nickname || '未设置昵称'}</div><div className="text-[11px] text-[var(--dv-text-3)]">{row.email}</div></div>,
  };
  const activity = [
    { title: '成功充值', dataIndex: 'amount_fen', key: 'amount_fen', width: 130, render: money },
    { title: '充值订单', dataIndex: 'paid_orders', key: 'paid_orders', width: 100, render: count },
    { title: '付费充值积分', dataIndex: 'paid_points', key: 'paid_points', width: 130, render: count },
    { title: '人工充值/赠送', dataIndex: 'bonus_points', key: 'bonus_points', width: 140, render: count },
    { title: '累计消费', dataIndex: 'consumed_points', key: 'consumed_points', width: 110, render: count },
    { title: '已退积分', dataIndex: 'refunded_points', key: 'refunded_points', width: 110, render: count },
    { title: '净消费积分', dataIndex: 'net_consumed_points', key: 'net_consumed_points', width: 130, render: (value: number) => <span className="font-medium">{count(value)}</span> },
  ];
  return (
    <div className="flex-1 overflow-auto p-4 lg:p-6" aria-label="邀请统计看板">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-xl font-semibold"><TeamOutlined /> 邀请统计</h1><p className="mt-1 text-xs text-[var(--dv-text-3)]">全周期累计 · 当前账号的直接邀请关系</p></div>
        <Button icon={<ReloadOutlined />} onClick={() => {
          setLoading(true); if (selected) setDetailLoading(true); setRefresh(v => v + 1);
        }}>刷新统计</Button>
      </div>
      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-3">
        {cards.map(([label, value]) => <div key={String(label)} className="rounded-xl border border-[var(--dv-border-1)] bg-[var(--dv-surface-1)] p-4">
          <div className="text-xs text-[var(--dv-text-3)]">{label}</div>
          <div className="mt-3 text-2xl font-semibold tabular-nums">{value === undefined ? '—' : typeof value === 'number' ? count(value) : value}</div>
        </div>)}
      </div>
      <div className="mb-4 rounded-xl border border-[var(--dv-border-1)] bg-[var(--dv-surface-1)] p-4 text-xs leading-6 text-[var(--dv-text-3)]">
        充值金额仅统计支付成功的订单，未支付订单不计。人工充值或赠送积分单独列出。净消费 = 累计扣费 − 已退积分。
        上方看板统计全部邀请用户，搜索只筛选下方推荐人列表。
      </div>
      <Input.Search className="mb-4 max-w-md" placeholder="搜索推荐人的昵称、邮箱或推荐码" allowClear
        aria-label="搜索推荐人" onSearch={value => {
          setLoading(true); setKeyword(value.trim()); setPage(1); setRefresh(v => v + 1);
        }} />
      {failed && <p role="alert" className="mb-3 text-sm text-red-300">邀请统计读取失败，请点击刷新重试。</p>}
      <Table<ReferralRow> rowKey="id" size="small" loading={loading} dataSource={Array.isArray(data?.items) ? data.items : []}
        scroll={{ x: 1600 }} pagination={{ current: page, pageSize: 20, total: data?.total || 0, showSizeChanger: false,
          onChange: value => { setLoading(true); setPage(value); } }}
        columns={[
          identity,
          { title: '推荐码', dataIndex: 'referral_code', width: 170, render: (code: string) => <span className="font-mono text-xs">{code || '未领取'}</span> },
          { title: '邀请人数', dataIndex: 'invited_users', width: 100, render: (value: number) => <Tag color={value ? 'cyan' : undefined}>{count(value)}</Tag> },
          { title: '付费人数', dataIndex: 'paying_users', width: 100, render: count },
          ...activity,
          { title: '明细', key: 'detail', width: 120, fixed: 'right', render: (_: unknown, row: ReferralRow) =>
            <Button size="small" disabled={!row.invited_users} onClick={() => {
              setSelected(row); setDetail(null); setDetailPage(1); setDetailFailed(false); setDetailLoading(true);
            }}>邀请用户</Button> },
        ]} />
      <Drawer title={`${selected?.nickname || selected?.email || ''} · 邀请用户`} open={!!selected} width={1060}
        onClose={() => setSelected(null)}>
        <p className="mb-4 text-xs text-[var(--dv-text-3)]">仅显示该推荐人直接邀请的用户及其充值、消费记录。</p>
        {detailFailed && <p role="alert" className="mb-3 text-sm text-red-300">明细读取失败，请重试。</p>}
        <Table<ReferralRow> rowKey="id" size="small" loading={detailLoading} dataSource={Array.isArray(detail?.items) ? detail.items : []}
          scroll={{ x: 1350 }} pagination={{ current: detailPage, pageSize: 20, total: detail?.total || 0, showSizeChanger: false,
            onChange: value => { setDetailLoading(true); setDetailPage(value); } }}
          columns={[
            identity,
            { title: '注册时间', dataIndex: 'created_at', width: 120, render: value => new Date(value).toLocaleDateString('zh-CN') },
            ...activity,
          ]} />
      </Drawer>
    </div>
  );
}
