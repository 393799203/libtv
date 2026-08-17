import { useCallback, useEffect, useMemo, useState } from 'react';
import { App, Button, InputNumber } from 'antd';
import {
  FileTextOutlined,
  ReadOutlined,
  PictureOutlined,
  VideoCameraOutlined,
  AudioOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import { pricingApi, type NodePriceGroup } from '@/services/pricingApi';

// 节点图标（与画布节点类型对应）
const NODE_ICONS: Record<string, React.ReactNode> = {
  text: <FileTextOutlined />,
  script: <ReadOutlined />,
  image: <PictureOutlined />,
  video: <VideoCameraOutlined />,
  audio: <AudioOutlined />,
};

/**
 * 价格管理：展示各节点下不同模型的价格设置
 * - 文本 / 剧本 / 图片模型：按次价格（积分/次）
 * - 视频 / 语音模型：按秒单价（积分/秒）
 * - 价格按（节点 + 模型）维度独立配置：同一模型在不同节点可设不同价格
 */
export default function PricingManagement() {
  const { message } = App.useApp();
  const [nodes, setNodes] = useState<NodePriceGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  // 编辑中的价格：「node_type|model_id」-> 新价格（各节点独立编辑，互不影响）
  const [edits, setEdits] = useState<Record<string, number>>({});

  const load = useCallback(() => {
    setLoading(true);
    pricingApi.list()
      .then((res) => {
        setNodes(res?.nodes || []);
        setEdits({});
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 发生变更的条目（仅提交被修改的（节点 + 模型）条目）
  const dirtyItems = useMemo(() => {
    const items: { node_type: string; model_id: string; price: number }[] = [];
    for (const node of nodes) {
      for (const m of node.models) {
        const edited = edits[`${node.node_type}|${m.model_id}`];
        if (edited !== undefined && edited !== m.price) {
          items.push({ node_type: node.node_type, model_id: m.model_id, price: edited });
        }
      }
    }
    return items;
  }, [nodes, edits]);

  const handleSave = () => {
    if (dirtyItems.length === 0) return;
    setSaving(true);
    pricingApi.save(dirtyItems)
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
        <div>
          <div className="text-[14px] font-medium text-gray-800">价格管理</div>
          <div className="text-[11px] text-gray-400 mt-0.5">
            文本 / 图片模型按次计费，视频 / 语音模型按秒计费；价格为 0 表示暂不扣费
          </div>
        </div>
        <div className="flex-1" />
        {dirtyItems.length > 0 && (
          <span className="text-[12px] text-orange-500">{dirtyItems.length} 项未保存</span>
        )}
        <Button
          size="small"
          onClick={load}
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

      {/* 节点分组列表 */}
      <div className="p-6 space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-gray-400">
            <LoadingOutlined className="mr-2" /> 加载中...
          </div>
        ) : nodes.length === 0 ? (
          <div className="text-center py-20 text-gray-400 text-[13px]">暂无模型配置</div>
        ) : (
          nodes.map((node) => (
            <div key={node.node_type} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              {/* 分组头 */}
              <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2.5 bg-gray-50/60">
                <span className="text-gray-500 text-[15px]">{NODE_ICONS[node.node_type]}</span>
                <span className="text-[13px] font-semibold text-gray-800">{node.node_name}</span>
                {node.billing_type === 'per_call' ? (
                  <span className="px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 text-[11px] font-medium">按次计费</span>
                ) : (
                  <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 text-[11px] font-medium">按秒计费</span>
                )}
                <span className="text-[11px] text-gray-400">
                  {node.billing_type === 'per_call' ? '单价单位：积分 / 次' : '单价单位：积分 / 秒'}
                </span>
              </div>

              {/* 模型价格列表 */}
              {node.models.length === 0 ? (
                <div className="px-5 py-6 text-center text-[12px] text-gray-400">该节点暂无可用模型</div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {node.models.map((m) => {
                    const editKey = `${node.node_type}|${m.model_id}`;
                    return (
                    <div key={m.model_id} className="px-5 py-3 flex items-center gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] text-gray-800 font-medium truncate">{m.model_name}</div>
                        {m.description && (
                          <div className="text-[11px] text-gray-400 mt-0.5 truncate">{m.description}</div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <InputNumber
                          size="small"
                          min={0}
                          step={1}
                          precision={0}
                          value={edits[editKey] ?? m.price}
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
                          className="w-28"
                        />
                        <span className="text-[12px] text-gray-500 w-16">
                          {node.billing_type === 'per_call' ? '积分 / 次' : '积分 / 秒'}
                        </span>
                      </div>
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
