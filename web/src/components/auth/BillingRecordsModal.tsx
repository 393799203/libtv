import { useEffect, useState } from 'react';
import { Modal, Empty, Tag, Select, DatePicker, Button, Pagination } from 'antd';
import { SearchOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { billingApi, type BillingRecord, type BillingType } from '@/services/billingApi';
import { pricingApi } from '@/services/pricingApi';

const { RangePicker } = DatePicker;

/** 账单类型展示配置 */
const TYPE_META: Record<BillingType, { label: string; color: string; sign: string }> = {
  deduct: { label: '扣费', color: 'red', sign: '-' },
  refund: { label: '退款', color: 'orange', sign: '+' },
  recharge: { label: '充值', color: 'green', sign: '+' },
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false });
}

/** 场景选项（基于计费动作） */
const SCENE_OPTIONS = [
  { label: '全部场景', value: '' },
  { label: '故事生成', value: '故事生成' },
  { label: '分镜剧本生成', value: '分镜剧本生成' },
  { label: '图片生成', value: '图片生成' },
  { label: '视频生成', value: '视频生成' },
  { label: '音频生成', value: '音频生成' },
  { label: '提示词生成', value: '提示词生成' },
];

/**
 * 费用明细弹窗：当前账户所有的扣费 / 退款 / 充值记录（分页 + 筛选，按时间倒序）
 * @param userId 可选，管理员查看其他用户的账单
 */
export function BillingRecordsModal({ onClose, userId }: { onClose: () => void; userId?: string }) {
  const [records, setRecords] = useState<BillingRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  // 筛选状态
  const [filterType, setFilterType] = useState<BillingType | ''>('');
  const [filterScene, setFilterScene] = useState('');
  const [filterModel, setFilterModel] = useState('');
  const [filterDateRange, setFilterDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null);
  const [modelOptions, setModelOptions] = useState<{ label: string; value: string }[]>([{ label: '全部', value: '' }]);

  const pageSize = 10;

  // 加载模型选项
  useEffect(() => {
    pricingApi
      .list()
      .then((res) => {
        const models = new Map<string, string>();
        res.nodes?.forEach((node) => {
          node.models.forEach((m) => {
            models.set(m.model_id, m.model_name);
          });
        });
        setModelOptions([
          { label: '全部模型', value: '' },
          ...Array.from(models, ([id, name]) => ({ label: name || id, value: id })),
        ]);
      })
      .catch(() => {});
  }, []);

  // 加载数据
  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const params: Record<string, any> = {
      page,
      page_size: pageSize,
    };
    if (userId) params.user_id = userId;
    if (filterType) params.type = filterType;
    if (filterScene) params.scene = filterScene;
    if (filterModel) params.model = filterModel;
    if (filterDateRange) {
      params.start_time = filterDateRange[0].format('YYYY-MM-DD');
      params.end_time = filterDateRange[1].format('YYYY-MM-DD');
    }

    billingApi
      .list(params)
      .then((res) => {
        if (cancelled) return;
        setRecords(res.items || []);
        setTotal(res.total || 0);
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
  }, [page, filterType, filterScene, filterModel, filterDateRange]);

  // 重置筛选
  const handleReset = () => {
    setFilterType('');
    setFilterScene('');
    setFilterModel('');
    setFilterDateRange(null);
    setPage(1);
  };

  // 查询（重置到第一页）
  const handleSearch = () => {
    setPage(1);
  };

  return (
    <Modal
      title="费用明细"
      open
      onCancel={onClose}
      footer={null}
      width={960}
      destroyOnClose
      styles={{
        mask: { backdropFilter: 'blur(4px)' },
        body: { padding: '12px 16px 16px' },
      }}
    >
      {/* 筛选栏 */}
      <div className="flex items-center gap-3 mb-4">
        <Select
          value={filterType}
          onChange={setFilterType}
          placeholder="类型"
          allowClear
          className="w-26"
          options={[
            { label: '全部类型', value: '' },
            { label: '扣费', value: 'deduct' },
            { label: '退款', value: 'refund' },
            { label: '充值', value: 'recharge' },
          ]}
        />
        <Select
          value={filterScene}
          onChange={setFilterScene}
          placeholder="场景"
          allowClear
          className="w-28"
          options={SCENE_OPTIONS}
        />
        <Select
          value={filterModel}
          onChange={setFilterModel}
          placeholder="模型"
          allowClear
          showSearch
          optionFilterProp="label"
          className="w-32"
          options={modelOptions}
        />
        <RangePicker
          value={filterDateRange}
          onChange={(dates) => setFilterDateRange(dates as [dayjs.Dayjs, dayjs.Dayjs] | null)}
          format="YYYY-MM-DD"
          className="flex-1"
        />
        <Button type="primary" icon={<SearchOutlined />} onClick={handleSearch}>
          查询
        </Button>
        <Button icon={<ReloadOutlined />} onClick={handleReset}>
          重置
        </Button>
      </div>

      {/* 表格 */}
      {loading ? (
        <div className="py-16 text-center text-gray-400 text-sm">加载中...</div>
      ) : records.length === 0 ? (
        <Empty description="暂无费用记录" className="py-12" />
      ) : (
        <>
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

          {/* 分页 */}
          <div className="flex justify-end mt-4">
            <Pagination
              current={page}
              total={total}
              pageSize={pageSize}
              onChange={setPage}
              showTotal={(t) => `共 ${t} 条`}
              showSizeChanger={false}
            />
          </div>
        </>
      )}
    </Modal>
  );
}
