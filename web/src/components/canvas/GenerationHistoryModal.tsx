import { memo, useEffect, useState, useCallback } from 'react';
import { Modal, Empty, Pagination, Spin, App } from 'antd';
import { ClockCircleOutlined, CheckOutlined } from '@ant-design/icons';
import { generationHistoryApi, type GenerationHistoryItem } from '@/services/generationHistoryApi';
import dayjs from 'dayjs';

interface GenerationHistoryModalProps {
  nodeId: string;
  nodeType: 'image' | 'video';
  currentUrl?: string;
  onSelect: (url: string) => void;
  onClose: () => void;
}

/**
 * 图片/视频节点生成历史弹窗
 * - 展示该节点所有生成过的图片/视频
 * - 支持分页
 * - 点击选中并替换当前节点内容
 */
export const GenerationHistoryModal = memo(function GenerationHistoryModal({
  nodeId,
  nodeType,
  currentUrl,
  onSelect,
  onClose,
}: GenerationHistoryModalProps) {
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<GenerationHistoryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 20;

  const fetchHistory = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await generationHistoryApi.list({
        node_id: nodeId,
        page: p,
        page_size: pageSize,
      });
      setItems(res.items || []);
      setTotal(res.total || 0);
    } catch (err) {
      console.error('加载生成历史失败:', err);
      message.error('加载生成历史失败');
    } finally {
      setLoading(false);
    }
  }, [nodeId, message]);

  useEffect(() => {
    fetchHistory(page);
  }, [page, fetchHistory]);

  const handleSelect = (url: string) => {
    onSelect(url);
    onClose();
  };

  const typeLabel = nodeType === 'image' ? '图片' : '视频';

  return (
    <Modal
      title={`${typeLabel}生成历史`}
      open
      onCancel={onClose}
      footer={null}
      width={900}
      styles={{
        mask: { backdropFilter: 'blur(4px)' },
        body: { padding: '16px 20px 20px' },
      }}
    >
      <Spin spinning={loading}>
        {items.length === 0 && !loading ? (
          <Empty description={`暂无${typeLabel}生成记录`} />
        ) : (
          <>
            <div className="grid grid-cols-4 gap-3 mb-4 max-h-[60vh] overflow-y-auto">
              {items.map((item) => {
                const isCurrent = item.result_url === currentUrl;
                return (
                  <div
                    key={item.id}
                    className={`relative group cursor-pointer rounded-lg overflow-hidden border-2 transition-all ${
                      isCurrent
                        ? 'border-blue-500 ring-2 ring-blue-200'
                        : 'border-transparent hover:border-blue-300'
                    }`}
                    onClick={() => handleSelect(item.result_url)}
                  >
                    {nodeType === 'image' ? (
                      <img
                        src={item.result_url}
                        alt="Generated"
                        className="w-full aspect-square object-cover"
                      />
                    ) : (
                      <video
                        src={item.result_url}
                        className="w-full aspect-video object-cover"
                        muted
                        preload="metadata"
                      />
                    )}
                    {/* 当前选中标志 */}
                    {isCurrent && (
                      <div className="absolute top-1.5 right-1.5 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center">
                        <CheckOutlined className="text-white text-xs" />
                      </div>
                    )}
                    {/* 悬浮遮罩：时间 + 提示 */}
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2">
                      <div className="flex items-center gap-1 text-white text-[10px]">
                        <ClockCircleOutlined />
                        {dayjs(item.created_at).format('MM-DD HH:mm')}
                      </div>
                      <div className="text-white text-[10px] mt-0.5 truncate">
                        {item.prompt || '无提示词'}
                      </div>
                      {!isCurrent && (
                        <div className="text-white/80 text-[10px] mt-1">点击使用此{typeLabel}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            {total > pageSize && (
              <div className="flex justify-center">
                <Pagination
                  current={page}
                  total={total}
                  pageSize={pageSize}
                  onChange={setPage}
                  showSizeChanger={false}
                  showTotal={(t) => `共 ${t} 条`}
                  size="small"
                />
              </div>
            )}
          </>
        )}
      </Spin>
    </Modal>
  );
});
