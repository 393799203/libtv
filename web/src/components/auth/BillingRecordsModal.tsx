import { useEffect, useState } from 'react';
import { Modal, Empty, Tag } from 'antd';
import { billingApi, type BillingRecord, type BillingType } from '@/services/billingApi';
import { useAuthStore } from '@/stores/authStore';

/** 账单类型展示配置 */
const TYPE_META: Record<BillingType, { label: string; color: string; sign: string }> = {
  deduct: { label: '扣费', color: 'red', sign: '-' },
  refund: { label: '退款', color: 'orange', sign: '+' },
  recharge: { label: '充值', color: 'green', sign: '+' },
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false });
}

/**
 * 费用明细弹窗：当前账户所有的扣费 / 退款 / 充值记录（按时间倒序）
 */
export function BillingRecordsModal({ onClose }: { onClose: () => void }) {
  const [records, setRecords] = useState<BillingRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    billingApi
      .list()
      .then((list) => {
        if (cancelled) return;
        setRecords(list || []);
        // 最新一条记录的 balance_after 即当前余额，同步到头部展示
        if (list && list.length > 0) {
          useAuthStore.getState().setUser({ credits: list[0].balance_after });
        }
      })
      .catch((err) => {
        console.error('加载费用明细失败:', err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Modal
      title="费用明细"
      open
      onCancel={onClose}
      footer={null}
      width={880}
      destroyOnClose
      styles={{ body: { padding: '8px 16px 16px', height: '60vh', overflowY: 'auto' } }}
    >
      {loading ? (
        <div className="py-16 text-center text-gray-400 text-sm">加载中...</div>
      ) : records.length === 0 ? (
        <Empty description="暂无费用记录" className="py-12" />
      ) : (
        <table className="w-full text-left">
          <thead>
            <tr className="text-gray-400 text-[12px] border-b border-gray-100">
              <th className="py-2 font-normal">时间</th>
              <th className="py-2 font-normal">类型</th>
              <th className="py-2 font-normal">场景</th>
              <th className="py-2 font-normal">模型</th>
              <th className="py-2 font-normal text-right">积分变动</th>
              <th className="py-2 font-normal text-right">剩余积分</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => {
              const meta = TYPE_META[r.type] || TYPE_META.deduct;
              return (
                <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                  <td className="py-2.5 text-gray-500 text-[12px] whitespace-nowrap">{formatTime(r.created_at)}</td>
                  <td className="py-2.5">
                    <Tag color={meta.color} className="!m-0">{meta.label}</Tag>
                  </td>
                  <td className="py-2.5 text-gray-700 text-[13px]">{r.scene || r.remark || r.action || '-'}</td>
                  <td className="py-2.5 text-gray-500 text-[12px]">{r.model || '-'}</td>
                  <td
                    className={`py-2.5 text-right text-[13px] font-medium whitespace-nowrap ${
                      r.type === 'deduct' ? 'text-red-500' : 'text-green-600'
                    }`}
                  >
                    {r.amount === 0 ? '0' : `${meta.sign}${r.amount}`}
                  </td>
                  <td className="py-2.5 text-right text-gray-600 text-[13px] whitespace-nowrap">{r.balance_after}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
