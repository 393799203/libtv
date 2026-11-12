import { Button, Empty, Pagination, Spin } from 'antd';
import { DownOutlined } from '@ant-design/icons';
import type { ReferralRow } from '@/services/referralApi';
import { recordCount as count, recordMoney as money, recordTime } from './recordFormat';

interface Props {
  items: ReferralRow[];
  loading: boolean;
  page: number;
  total: number;
  onPage: (page: number) => void;
  onInvitees?: (row: ReferralRow) => void;
}

export function MobileReferralList({ items, loading, page, total, onPage, onInvitees }: Props) {
  return <Spin spinning={loading}>
    <div className="admin-record-list" aria-label={onInvitees ? '推荐人列表' : '邀请用户列表'}>
      {!loading && items.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无匹配记录" />}
      {items.map(row => <article key={row.id} className="admin-referral-item admin-record-item">
        <header className="admin-record-heading">
          <div className="admin-record-identity">
            <h2>{row.nickname || '未设置昵称'}</h2>
            <p className="admin-record-email">{row.email}</p>
          </div>
          <div className="admin-record-balance"><span>成功充值</span><strong>{money(row.amount_fen)}</strong></div>
        </header>
        <dl className="admin-record-metrics">
          {onInvitees
            ? <><div><dt>邀请人数</dt><dd>{count(row.invited_users)}</dd></div>
              <div><dt>付费人数</dt><dd>{count(row.paying_users)}</dd></div></>
            : <><div><dt>充值订单</dt><dd>{count(row.paid_orders)}</dd></div>
              <div><dt>剩余积分</dt><dd>{count(row.credits)}</dd></div></>}
          <div><dt>净消费积分</dt><dd>{count(row.net_consumed_points)}</dd></div>
        </dl>
        {onInvitees && <Button className="admin-record-link" type="link" disabled={!row.invited_users}
          onClick={() => onInvitees(row)}>查看邀请用户</Button>}
        <details className="admin-record-details">
          <summary>充值与消费明细<DownOutlined aria-hidden /></summary>
          <dl className="admin-record-facts admin-record-detail-body">
            {onInvitees && <div><dt>推荐码</dt><dd>{row.referral_code || '未领取'}</dd></div>}
            <div><dt>注册时间</dt><dd>{recordTime(row.created_at, true)}</dd></div>
            <div><dt>充值订单</dt><dd>{count(row.paid_orders)}</dd></div>
            <div><dt>付费积分</dt><dd>{count(row.paid_points)}</dd></div>
            <div><dt>赠送积分</dt><dd>{count(row.bonus_points)}</dd></div>
            <div><dt>累计消费</dt><dd>{count(row.consumed_points)}</dd></div>
            <div><dt>已退积分</dt><dd>{count(row.refunded_points)}</dd></div>
          </dl>
        </details>
      </article>)}
    </div>
    {total > 0 && <Pagination className="admin-record-pagination" simple current={page} pageSize={20} total={total}
      showSizeChanger={false} onChange={onPage} />}
  </Spin>;
}
