import { useCallback, useEffect, useMemo, useState } from 'react';
import { App, Button, InputNumber, Tooltip } from 'antd';
import {
  FileTextOutlined,
  ReadOutlined,
  PictureOutlined,
  VideoCameraOutlined,
  AudioOutlined,
  DeploymentUnitOutlined,
  LoadingOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import { pricingApi, type NodePriceGroup } from '@/services/pricingApi';

// 节点图标（与画布节点类型对应）
const NODE_ICONS: Record<string, React.ReactNode> = {
  text: <FileTextOutlined />,
  script: <ReadOutlined />,
  image: <PictureOutlined />,
  video: <VideoCameraOutlined />,
  audio: <AudioOutlined />,
  previz: <DeploymentUnitOutlined />,
};

/**
 * 价格管理：展示各节点下不同模型的价格设置
 * - 文本 / 剧本 / 图片模型：按次价格（积分/次）
 * - 视频模型：按秒单价（积分/秒）；支持参考视频计费的模型（3 个 Seedance）额外可配
 *   「带参考视频」单价，未单独配置时按无参考视频单价的 6 折（与计费侧同一预设）
 * - 语音模型：按字单价（积分/100字）
 * - 价格按（节点 + 模型）维度独立配置：同一模型在不同节点可设不同价格
 */
export default function PricingManagement() {
  const { message } = App.useApp();
  const [nodes, setNodes] = useState<NodePriceGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  // 当前查看的渠道（价格按渠道独立配置）
  const [channel, setChannel] = useState<'wasu' | 'dianxin'>('wasu');
  // 编辑中的价格：「node_type|model_id|resolution」-> 新价格（各节点独立编辑，互不影响）；
  // 「带参考视频」单价用同键 + '|ref' 后缀，两类编辑互不覆盖
  const [edits, setEdits] = useState<Record<string, number>>({});
  // 已点「恢复默认」的条目（同键 + '|ref'）：保存时清除后台那一档配置，回到 6 折预设
  const [refResets, setRefResets] = useState<Record<string, boolean>>({});

  const load = useCallback((ch: 'wasu' | 'dianxin' = channel) => {
    setLoading(true);
    pricingApi.list(ch)
      .then((res) => {
        setNodes(res?.nodes || []);
        setEdits({});
        setRefResets({});
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [channel]);

  useEffect(() => {
    load();
  }, [load]);

  // 折扣文案：0.6 → 「6 折」（非整数折保留一位小数，如 0.55 → 5.5 折）
  const discountLabel = (discount?: number) => {
    const zhe = (discount ?? 0.6) * 10;
    return `${Number.isInteger(zhe) ? zhe : zhe.toFixed(1)} 折`;
  };

  // 某条目的「带参考视频」当前值：优先取用户编辑值；未编辑时用后台已配置值，
  // 没配置过（或已点恢复默认）则按「当前无参考视频单价 × 折扣」实时推算（改常规单价时预设跟着走）
  const refVideoValue = (
    refKey: string,
    model: NodePriceGroup['models'][number],
    basePrice: number,
    discount?: number,
  ) => {
    if (edits[refKey] !== undefined) return edits[refKey];
    if (model.ref_video_price_configured && !refResets[refKey]) return model.ref_video_price ?? 0;
    if (basePrice <= 0) return 0;
    return Math.round(basePrice * (discount ?? 0.6));
  };

  // 发生变更的条目（仅提交被修改的（节点 + 模型 + 分辨率）条目）
  const dirtyItems = useMemo(() => {
    const items: {
      node_type: string;
      model_id: string;
      resolution?: string;
      price: number;
      ref_video_price?: number;
      clear_ref_video_price?: boolean;
    }[] = [];
    for (const node of nodes) {
      for (const m of node.models) {
        const editKey = `${node.node_type}|${m.model_id}|${m.resolution || ''}`;
        const baseValue = edits[editKey] ?? m.price;
        const baseChanged = edits[editKey] !== undefined && edits[editKey] !== m.price;

        // 「带参考视频」单价：只有用户真的改过这一档（或点了恢复默认）才提交，
        // 没动过就不提交 —— 后台保持「6 折预设实时计算」（改一次常规价预设跟着变），
        // 不会被固化成一条死配置。加载时页面显示的就是后台返回的 ref_video_price
        const refKey = `${editKey}|ref`;
        const refEdited = edits[refKey];
        const refChanged = m.ref_video_billing && refEdited !== undefined && refEdited !== (m.ref_video_price ?? 0);
        const refReset = m.ref_video_billing && m.ref_video_price_configured && !!refResets[refKey];

        if (!baseChanged && !refChanged && !refReset) continue;
        items.push({
          node_type: node.node_type,
          model_id: m.model_id,
          resolution: m.resolution || undefined,
          price: baseValue,
          ref_video_price: refChanged ? refEdited : undefined,
          clear_ref_video_price: refReset || undefined,
        });
      }
    }
    return items;
  }, [nodes, edits, refResets]);

  const handleSave = () => {
    if (dirtyItems.length === 0) return;
    setSaving(true);
    pricingApi.save(channel, dirtyItems)
      .then(() => {
        message.success('价格设置已保存');
        load();
      })
      .catch(() => {})
      .finally(() => setSaving(false));
  };

  return (
    <div className="flex-1 overflow-y-auto">
      {/* 工具栏 */}
      <div className="bg-white px-6 py-3 border-b border-gray-100 flex items-center gap-3 sticky top-0 z-10">
        {/* 说明文案：让它自己占满并换行，不许挤窄右边的渠道 Tab */}
        <div className="flex-1 min-w-0">
          <div className="text-[11px] text-gray-400 mt-0.5">
            文本/图片按次、视频按秒、语音按字（每 100 字）计费，价格为 0 表示暂不扣费。
            3 个 Seedance 模型带参考视频输入时按「有参」单价计费（默认取无参价 6 折），计费时长 = 输出 + 参考视频
          </div>
        </div>
        {/* 渠道 Tab：华数 / 电信 价格独立配置（固定宽度，不被左侧文案挤压成竖排） */}
        <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-0.5 shrink-0">
          {(['wasu', 'dianxin'] as const).map((ch) => (
            <button
              key={ch}
              onClick={() => {
                setChannel(ch);
                load(ch);
              }}
              className={`w-14 shrink-0 whitespace-nowrap py-1 rounded-md text-[12px] font-medium text-center transition-colors cursor-pointer ${
                channel === ch
                  ? 'bg-white shadow-sm text-blue-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {ch === 'wasu' ? '华数' : '电信'}
            </button>
          ))}
        </div>
        {dirtyItems.length > 0 && (
          <span className="text-[12px] text-orange-500 shrink-0 whitespace-nowrap">
            {dirtyItems.length} 项未保存
          </span>
        )}
        <Button
          size="small"
          onClick={() => load()}
          disabled={saving}
        >
          刷新
        </Button>
        <Button
          type="primary"
          size="small"
          loading={saving}
          disabled={dirtyItems.length === 0}
          onClick={handleSave}
        >
          保存设置
        </Button>
      </div>

      {/* 节点分组列表：宽屏下两列瀑布流（columns + break-inside-avoid），卡片按自身高度紧密排列；卡片内模型条目两列 */}
      <div className="p-6 columns-1 xl:columns-2 gap-4">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-400">
            <LoadingOutlined className="mr-2" /> 加载中...
          </div>
        ) : nodes.length === 0 ? (
          <div className="text-center py-20 text-gray-400 text-[13px]">暂无模型配置</div>
        ) : (
          nodes.map((node) => (
            <div key={node.node_type} className="bg-white rounded-xl border border-gray-200 overflow-hidden break-inside-avoid mb-4">
              {/* 分组头 */}
              <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2.5 bg-gray-50/60">
                <span className="text-gray-500 text-[15px]">{NODE_ICONS[node.node_type]}</span>
                <span className="text-[13px] font-semibold text-gray-800">{node.node_name}</span>
                {node.billing_type === 'per_call' ? (
                  <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 text-[11px] font-medium">按次计费</span>
                ) : node.billing_type === 'per_char' ? (
                  <span className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 text-[11px] font-medium">按字计费</span>
                ) : (
                  <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 text-[11px] font-medium">按秒计费</span>
                )}
                <span className="text-[11px] text-gray-400">
                  {node.billing_type === 'per_call' ? '单价单位：积分 / 次' : node.billing_type === 'per_char' ? '单价单位：积分 / 100字' : '单价单位：积分 / 秒'}
                </span>
              </div>

              {/* 模型价格列表：卡片内两列，hairline 分隔线 */}
              {node.models.length === 0 ? (
                <div className="px-5 py-6 text-center text-[12px] text-gray-400">该节点暂无可用模型</div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-px bg-gray-100">
                  {node.models.map((m) => {
                    const editKey = `${node.node_type}|${m.model_id}|${m.resolution || ''}`;
                    const refKey = `${editKey}|ref`;
                    // 单价单位文案（视频节点统一为积分/秒）
                    const unitLabel = node.billing_type === 'per_call' ? '积分/次' : node.billing_type === 'per_char' ? '积分/100字' : '积分/秒';
                    // 「带参考视频」输入框：仅支持该计费方式的模型（3 个 Seedance）展示
                    const showRefPrice = node.node_type === 'video' && !!m.ref_video_billing;
                    const baseValue = edits[editKey] ?? m.price;
                    const refValue = refVideoValue(refKey, m, baseValue, node.ref_video_discount);
                    // 当前「无参考视频单价 × 折扣」的实时预设值：用来提示已配置的那一档是否还跟得上常规价
                    const presetRefValue = node.ref_video_discount ? Math.round(baseValue * node.ref_video_discount) : 0;
                    // 输入框通用配置（两类单价用法一致）
                    const numberProps = {
                      size: 'small' as const,
                      min: 0,
                      step: 1,
                      precision: 0,
                      // 单价都是整数、最多三四位，输入框不用这么宽（视频行两档叠着更显空）
                      className: 'w-12',
                      style: { paddingInline: 6 },
                    };
                    return (
                    <div key={editKey} className="bg-white px-4 py-2.5 flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[13px] text-gray-800 font-medium truncate">{m.model_name}</span>
                          {m.resolution && (
                            <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-[11px] font-medium shrink-0">{m.resolution}</span>
                          )}
                        </div>
                        {m.description && (
                          <div className="text-[11px] text-gray-400 mt-0.5 truncate">{m.description}</div>
                        )}
                      </div>
                      {showRefPrice ? (
                        /* 视频节点：一档常规单价 + 一档「带参考视频」单价（未配置时按常规价 6 折预设） */
                        <div className="flex flex-col gap-1.5 shrink-0">
                          <div className="flex items-center justify-end gap-1">
                            <span className="text-[11px] text-gray-400 whitespace-nowrap">无参</span>
                            <InputNumber
                              {...numberProps}
                              value={baseValue}
                              onChange={(v) => {
                                setEdits((prev) => {
                                  const next = { ...prev };
                                  if (v === null || v === undefined) {
                                    delete next[editKey];
                                  } else {
                                    next[editKey] = v;
                                  }
                                  return next;
                                });
                              }}
                            />
                            <span className="text-[11px] text-gray-400 whitespace-nowrap">{unitLabel}</span>
                          </div>
                          <div className="flex items-center justify-end gap-1">
                            <span className="text-[11px] text-gray-400 whitespace-nowrap">有参</span>
                            <InputNumber
                              {...numberProps}
                              value={refValue}
                              onChange={(v) => {
                                setEdits((prev) => {
                                  const next = { ...prev };
                                  if (v === null || v === undefined) {
                                    delete next[refKey];
                                  } else {
                                    next[refKey] = v;
                                  }
                                  return next;
                                });
                                // 手动改过就不再是「恢复默认」状态
                                setRefResets((prev) => {
                                  if (!prev[refKey]) return prev;
                                  const next = { ...prev };
                                  delete next[refKey];
                                  return next;
                                });
                              }}
                            />
                            <span className="text-[11px] text-gray-400 whitespace-nowrap">{unitLabel}</span>
                            {/* 已单独配置过才出现：一键回到「无参单价的 6 折」实时预设
                                （保存时删除那一档配置）。常规单价改过之后已配置的值不会自动跟着变，
                                所以提示里带上当前 6 折应该是多少 */}
                            {m.ref_video_price_configured && !refResets[refKey] && (
                              <Tooltip
                                title={`恢复默认：按无参单价 ${discountLabel(node.ref_video_discount)} 计费（当前 ${presetRefValue}）`}
                              >
                                <button
                                  type="button"
                                  className="text-gray-300 hover:text-blue-500 cursor-pointer shrink-0"
                                  onClick={() => {
                                    setRefResets((prev) => ({ ...prev, [refKey]: true }));
                                    setEdits((prev) => {
                                      if (prev[refKey] === undefined) return prev;
                                      const next = { ...prev };
                                      delete next[refKey];
                                      return next;
                                    });
                                  }}
                                >
                                  <UndoOutlined className="text-[12px]" />
                                </button>
                              </Tooltip>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 shrink-0">
                          <InputNumber
                            {...numberProps}
                            value={baseValue}
                            onChange={(v) => {
                              setEdits((prev) => {
                                const next = { ...prev };
                                if (v === null || v === undefined) {
                                  delete next[editKey];
                                } else {
                                  next[editKey] = v;
                                }
                                return next;
                              });
                            }}
                          />
                          <span className="text-[11px] text-gray-400 whitespace-nowrap">{unitLabel}</span>
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
