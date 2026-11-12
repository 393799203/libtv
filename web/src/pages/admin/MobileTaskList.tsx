import { Button, Empty, Spin } from 'antd';
import { DownOutlined } from '@ant-design/icons';
import type { ProviderTask } from '@/services/providerTaskApi';
import { recordCount as count, recordTime } from './recordFormat';

interface Props {
  items: ProviderTask[];
  loading: boolean;
  refunding: number | null;
  statusLabel: (row: ProviderTask) => string;
  typeLabel: (row: ProviderTask) => string;
  canRefund: (row: ProviderTask) => boolean;
  onRefund: (row: ProviderTask) => void;
  onPreview: (row: ProviderTask) => void;
}

export function MobileTaskList({ items, loading, refunding, statusLabel, typeLabel, canRefund, onRefund, onPreview }: Props) {
  return <Spin spinning={loading}><div className="admin-record-list" aria-label="对账记录">
    {!loading && items.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无匹配记录" />}
    {items.map(row => <article className="admin-task-item admin-record-item" key={row.id}>
      <div className="admin-task-status-line">
        <span className="admin-task-type">{typeLabel(row)}</span>
        <span className={`admin-task-status is-${row.status}`}>{statusLabel(row)}</span>
      </div>
      <header className="admin-record-heading">
        <div className="admin-record-identity">
          <h2>{row.project_name || row.project_name_snapshot || row.node_name || '未关联项目'}</h2>
          <p className="admin-record-email">{row.user_name || row.user_email || row.user_id || '用户已注销'}</p>
        </div>
        <div className="admin-record-balance"><span>扣费积分</span><strong>{count(row.charged_amount)}</strong>
          {row.refunded_amount > 0 && <small>已退 {count(row.refunded_amount)}</small>}
        </div>
      </header>
      <p className="admin-task-model">{row.provider === 'wasu' ? '华数' : row.provider === 'dianxin' ? '电信' : row.provider} · {row.model || '未记录模型'}</p>
      {row.alert && <p className="admin-task-alert">此记录存在异常，请查看详情中的处理说明。</p>}
      <footer className="admin-task-footer">
        <time>{recordTime(row.created_at)}</time>
        <div>
          {(row.result_url || row.provider_url) && <Button onClick={() => onPreview(row)}>查看产物</Button>}
          {canRefund(row) && <Button danger loading={refunding === row.id} onClick={() => onRefund(row)}>退费</Button>}
        </div>
      </footer>
      <details className="admin-record-details">
        <summary>任务与计费详情<DownOutlined aria-hidden /></summary>
        <div className="admin-record-detail-body">
          <dl className="admin-record-facts">
            <div><dt>提交时间</dt><dd>{recordTime(row.created_at, true)}</dd></div>
            <div><dt>用户邮箱</dt><dd>{row.user_email || '—'}</dd></div>
            <div><dt>用户 ID</dt><dd>{row.user_id || '—'}</dd></div>
            <div><dt>项目 ID</dt><dd>{row.project_id || '—'}</dd></div>
            <div><dt>任务编号</dt><dd>{row.task_id || '—'}</dd></div>
            <div><dt>上游任务号</dt><dd>{row.upstream_task_id || '—'}</dd></div>
            <div><dt>执行 / 节点</dt><dd>{row.exec_id > 0 ? `exec ${row.exec_id} · ` : ''}{row.node_name || row.node_id || '—'}</dd></div>
            <div><dt>计费规格</dt><dd>{[row.charge_resolution, row.charge_seconds ? `${row.charge_seconds} 秒` : ''].filter(Boolean).join(' · ') || '—'}
              {row.charge_ref_seconds > 0 && `（含参考视频 ${row.charge_ref_seconds} 秒）`}</dd></div>
            <div><dt>上游 Token</dt><dd>{row.provider_tokens > 0 ? count(row.provider_tokens) : '未返回'}</dd></div>
            <div><dt>上游用量</dt><dd>{row.provider_usage || '未返回'}</dd></div>
            {row.refund_source && <div><dt>退费来源</dt><dd>{row.refund_source === 'auto' ? '自动退费' : '人工退费'}</dd></div>}
            {row.alert && <div><dt>异常标记</dt><dd>{row.alert}</dd></div>}
          </dl>
          <div className="admin-task-note"><h3>处理说明</h3><p>{row.note || '暂无补充说明'}</p></div>
          {row.result_url && <a className="admin-record-artifact" href={row.result_url} target="_blank" rel="noreferrer">交付产物地址</a>}
          {row.provider_url && <a className="admin-record-artifact" href={row.provider_url} target="_blank" rel="noreferrer">上游原始产物地址</a>}
        </div>
      </details>
    </article>)}
  </div></Spin>;
}
