import { useEffect, useState } from 'react';
import { Modal, Tag, Select, DatePicker, Button, Pagination, Tooltip } from 'antd';
import {
  FileTextOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { billingApi, type BillingRecord, type BillingType } from '@/services/billingApi';
import { pricingApi } from '@/services/pricingApi';
import { channelLabel, channelTagColor } from '@/constants/channel';
import { EmptyState } from '../../components/common/EmptyState';

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
  const [reloadTick, setReloadTick] = useState(0); // 刷新按钮用：见 handleRefresh

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
  }, [page, reloadTick, filterType, filterScene, filterModel, filterDateRange]);

  // 刷新：回到第一页重新拉取。
  // 只用 setPage(1) 是不够的 —— 已经停在第 1 页时这是"同值更新"，React 不会重新渲染、
  // 依赖 page 的 effect 也不会再跑，点刷新会像没反应一样。用自增的 reloadTick 明确触发一次。
  const handleRefresh = () => {
    setPage(1);
    setReloadTick((t) => t + 1);
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
        {/* 刷新：只留图标（悬停 title 提示），和用户管理/上游对账页的刷新按钮同一套写法 */}
        <Button
          icon={<ReloadOutlined />}
          title="刷新"
          loading={loading}
          onClick={handleRefresh}
        />
      </div>

      {/* 表格区域：固定高度避免抖动 */}
      <div className="h-[520px] flex flex-col">
        {loading ? (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">加载中...</div>
        ) : records.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <EmptyState
              size="sm"
              icon={<FileTextOutlined />}
              title="没有费用记录"
              hint="生成任务扣费、退款与充值都会记在这里；换个时间范围或类型再试试"
            />
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-left">
                <thead className="sticky top-0 bg-white z-10">
                  <tr className="text-gray-400 text-[12px] border-b border-gray-100">
                    <th className="py-2 font-normal">时间</th>
                    <th className="py-2 font-normal">类型</th>
                    <th className="py-2 font-normal">场景</th>
                    <th className="py-2 font-normal">模型 / 订单号</th>
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
                          <div className="flex items-center gap-1">
                            <Tag color={meta.color} className="!m-0">{meta.label}</Tag>
                            {r.type === 'refund' && (
                              <Tooltip
                                title={
                                  <div className="text-[12px] leading-5">
                                    <div>场景：{r.scene || '-'}</div>
                                    <div>渠道：{channelLabel(r.channel) || '-'}</div>
                                    <div>模型：{r.model || '-'}</div>
                                    <div>动作：{r.action || '-'}</div>
                                    <div>备注：{r.remark || '-'}</div>
                                    <div>变动：{r.amount} 分 · 剩余：{r.balance_after} 分</div>
                                  </div>
                                }
                                overlayInnerStyle={{ maxWidth: 360 }}
                              >
                                <QuestionCircleOutlined className="text-gray-400 text-[12px] cursor-help" />
                              </Tooltip>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 text-gray-700 text-[13px]">{r.scene || r.remark || r.action || '-'}</td>
                        <td className="py-2.5 text-gray-500 text-[12px]">
                          {r.order_no ? (
                            /* 充值行：模型列为空，改放支付订单号（对账用）。号很长，截断显示、悬停看全 */
                            <Tooltip
                              title={
                                <div className="text-[12px] leading-5">
                                  <div>商户订单号：{r.order_no}</div>
                                  <div>支付宝交易号：{r.alipay_trade_no || '-'}</div>
                                </div>
                              }
                            >
                              {/* 订单号不省略：弹窗宽 960px，34 位的号一行放得下；实在放不下也换行显示全 */}
                              <span className="inline-block break-all align-bottom cursor-help">{r.order_no}</span>
                            </Tooltip>
                          ) : (
                            <div className="flex items-center gap-1.5">
                              {/* 渠道用标签表示（华数/电信），不再拼在模型名前：
                                   模型列只显示纯模型 ID，一眼能分清「哪个模型」和「走的哪条渠道」 */}
                              {channelLabel(r.channel) && (
                                <Tag
                                  color={channelTagColor(r.channel)}
                                  className="!m-0 shrink-0 !text-[11px] !leading-4"
                                >
                                  {channelLabel(r.channel)}
                                </Tag>
                              )}
                              <span className="truncate">{r.model || '-'}</span>
                              {/* 视频按「分辨率档位 × 计费时长」定价，这两项直接决定金额，挂在模型后面最直观；
                                  带参考视频输入时计费时长 = 输出时长 + 参考视频时长，悬停可看拆分 */}
                              {(!!r.resolution || (r.duration ?? 0) > 0) && (
                                <Tooltip
                                  title={
                                    (r.ref_video_duration ?? 0) > 0 ? (
                                      <div className="text-[12px] leading-5">
                                        <div>计费时长 {(r.duration ?? 0)} 秒 = 输出 {(r.duration ?? 0) - (r.ref_video_duration ?? 0)} 秒 + 参考视频 {r.ref_video_duration} 秒</div>
                                      </div>
                                    ) : undefined
                                  }
                                >
                                  <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600">
                                    {[r.resolution, r.duration ? `${r.duration} 秒` : ''].filter(Boolean).join(' · ')}
                                    {(r.ref_video_duration ?? 0) > 0 && (
                                      <span className="ml-1 text-gray-400">含参考视频 {r.ref_video_duration} 秒</span>
                                    )}
                                  </span>
                                </Tooltip>
                              )}
                            </div>
                          )}
                        </td>
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
            </div>

            {/* 分页 */}
            <div className="flex justify-end pt-4 border-t border-gray-100">
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
      </div>
    </Modal>
  );
}
