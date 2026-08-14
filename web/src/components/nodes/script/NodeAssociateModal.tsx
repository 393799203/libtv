import { memo } from 'react';
import { Modal, Empty } from 'antd';
import { PictureOutlined, CheckCircleFilled } from '@ant-design/icons';
import { useCanvasStore } from '@/stores/canvasStore';

interface NodeAssociateModalProps {
  open: boolean;
  /** 正在关联的资产名称（用于标题） */
  assetName: string;
  /** 当前已关联的节点 ID（高亮显示） */
  currentNodeId?: string | null;
  /** 选中节点后回调 */
  onAssociate: (nodeId: string) => void;
  onClose: () => void;
}

/**
 * 关联已有图片节点弹窗
 * 列出画布上所有图片节点（缩略图 + 名字），点击即关联到目标资产
 */
export const NodeAssociateModal = memo<NodeAssociateModalProps>(
  function NodeAssociateModal({
    open,
    assetName,
    currentNodeId,
    onAssociate,
    onClose,
  }) {
    const nodes = useCanvasStore((s) => s.nodes);
    const imageNodes = nodes.filter((n) => n.type === 'image');

    const handleSelect = (nodeId: string) => {
      if (nodeId === currentNodeId) {
        onClose();
        return;
      }
      onAssociate(nodeId);
      onClose();
    };

    return (
      <Modal
        title={`关联已有图片节点 — ${assetName}`}
        open={open}
        onCancel={onClose}
        footer={null}
        width={720}
        destroyOnClose
      >
        {imageNodes.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="画布上暂无图片节点"
            className="py-8"
          />
        ) : (
          <div className="grid grid-cols-4 gap-3 max-h-[480px] overflow-y-auto py-1">
            {imageNodes.map((n) => {
              const d = n.data as { label?: string; imageUrl?: string };
              const isCurrent = n.id === currentNodeId;
              return (
                <div
                  key={n.id}
                  onClick={() => handleSelect(n.id)}
                  className={`relative rounded-lg border-2 overflow-hidden cursor-pointer transition-colors ${
                    isCurrent
                      ? 'border-blue-500'
                      : 'border-transparent hover:border-blue-300'
                  }`}
                  title={n.id}
                >
                  {/* 缩略图 */}
                  <div className="w-full h-[100px] bg-gray-100 flex items-center justify-center">
                    {d?.imageUrl ? (
                      <img
                        src={d.imageUrl}
                        alt={d.label || n.id}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <PictureOutlined className="text-2xl text-gray-300" />
                    )}
                  </div>

                  {/* 名字 */}
                  <div className="px-2 py-1.5 bg-white border-t border-gray-100">
                    <div className="text-xs text-gray-800 font-medium truncate">
                      {d?.label || n.id}
                    </div>
                    {!d?.imageUrl && (
                      <div className="text-[10px] text-gray-400">无图片</div>
                    )}
                  </div>

                  {/* 当前关联标记 */}
                  {isCurrent && (
                    <div className="absolute top-1.5 right-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded bg-blue-500 text-white text-[10px]">
                      <CheckCircleFilled />
                      当前关联
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-3 text-[11px] text-gray-400">
          点击选择要关联的图片节点，关联后该节点的图将作为此资产的参考图，用于后续分镜的图生图
        </div>
      </Modal>
    );
  }
);
