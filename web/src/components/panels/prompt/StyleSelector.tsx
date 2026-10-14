import { memo, useState, useCallback, useMemo } from 'react';
import { CloseOutlined } from '@ant-design/icons';
import type { ImageNodeData } from '@/types/canvas';
import { useCanvasStore } from '@/stores/canvasStore';
import type { StyleItem } from '@/services/styleApi';
import { createNode } from '@/utils/nodeFactory';
import { StyleMarketModal } from '@/components/style/StyleMarketModal';

interface StyleSelectorProps {
  /** 当前节点 ID，用于定位画布上的风格节点与连线 */
  targetNodeId?: string;
}

/**
 * 节点内的「风格」入口：显示已选风格缩略图，点开风格市场挑一个。
 *
 * 风格图是独立通道：后端从上游连线收集 style- 节点（id 前缀或 data.styleId），
 * 无需往提示词里插 @ 引用，所以这里只做「连/断一个风格节点」这一件事。
 * 浏览市场的 UI 在 StyleMarketModal 里（与左侧「风格素材」入口共用）。
 */
export const StyleSelector = memo<StyleSelectorProps>(function StyleSelector({
  targetNodeId,
}) {
  // 仅订阅 action 函数（zustand 中这些是稳定引用），不订阅 nodes/edges 数组
  const removeEdges = useCanvasStore((s) => s.removeEdges);
  const addNode = useCanvasStore((s) => s.addNode);
  const addEdgeFn = useCanvasStore((s) => s.addEdge);
  const removeNodes = useCanvasStore((s) => s.removeNodes);

  // 风格市场弹窗开关
  const [styleMarketOpen, setStyleMarketOpen] = useState(false);

  // 订阅"当前节点入边里的 style- 节点"签名，画布上直接删节点/断线会自动反映
  const styleSignature = useCanvasStore((s) => {
    if (!targetNodeId) return '';
    const parts: string[] = [];
    for (const e of s.edges) {
      if (e.target !== targetNodeId || !e.source.startsWith('style-')) continue;
      const n = s.nodes.find((x) => x.id === e.source);
      if (n) {
        const d = n.data as Record<string, unknown>;
        parts.push(`${n.id}|${d.label}|${d.imageUrl}|${(d as { styleId?: string }).styleId ?? ''}`);
      } else {
        parts.push(`${e.source}|missing`);
      }
    }
    return parts.join('\n');
  });

  // 已选风格：从画布派生（不再保留本地 state，避免画布删节点/断线后面板状态脱节）
  const { selectedStyle, styleNodeId } = useMemo<{ selectedStyle: StyleItem | undefined; styleNodeId: string | null }>(() => {
    if (!targetNodeId) return { selectedStyle: undefined, styleNodeId: null };
    const { nodes, edges } = useCanvasStore.getState();
    // 找到上游"风格-"节点
    const styleNode = nodes.find((n) =>
      n.id.startsWith('style-') &&
      edges.some((e) => e.source === n.id && e.target === targetNodeId)
    );
    if (!styleNode) return { selectedStyle: undefined, styleNodeId: null };
    // 从风格节点本身取信息（styleId 存在风格节点 data 里）
    const sd = styleNode.data as ImageNodeData;
    return {
      selectedStyle: {
        id: (sd as Record<string, string>).styleId || '',
        name: styleNode.data.label?.replace('风格-', '') ?? '',
        image_url: sd.imageUrl || '',
      } as StyleItem,
      styleNodeId: styleNode.id,
    };
    // styleSignature 已覆盖这里读到的所有字段（作为重算门控，eslint 认为它"多余"是有意为之）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetNodeId, styleSignature]);

  // 选中风格：先清理旧风格，再创建新风格节点 + 连接。
  // 只做画布操作，选中状态由画布派生（画布变更 → styleSignature 变 → UI 自动更新）。
  const handleSelectStyle = useCallback((style: StyleItem) => {
    if (!targetNodeId) return;

    // 如果已有旧风格节点，先删除它和连线
    if (styleNodeId) {
      const { edges } = useCanvasStore.getState();
      const oldEdge = edges.find(
        (ed) => ed.source === styleNodeId && ed.target === targetNodeId
      );
      if (oldEdge) removeEdges([oldEdge.id]);
      removeNodes([styleNodeId]);
    }

    // 按需读取当前节点位置（不订阅 nodes，避免无关更新触发重渲染）
    const { nodes } = useCanvasStore.getState();
    const current = nodes.find((n) => n.id === targetNodeId);
    const posX = (current?.position.x ?? 0) - 350;
    const posY = current?.position.y ?? 0;

    const newNodeId = `style-${Date.now()}`;
    const styleLabel = `风格-${style.name}`;
    const styleNode = createNode('image', { x: posX, y: posY }, { id: newNodeId });
    // styleId 不在 LibTVNodeData 的类型里（历史扩展字段），与左侧「风格素材」入口同一写法：
    // 显式断言一次，不在类型上开 any 的口子。
    styleNode.data = {
      ...styleNode.data,
      label: styleLabel,
      imageUrl: style.image_url,
      styleId: style.id,
    } as typeof styleNode.data;

    addNode(styleNode);
    addEdgeFn({
      id: `e-${newNodeId}-${targetNodeId}`,
      source: newNodeId,
      target: targetNodeId,
      type: 'dataFlow',
    });
  }, [targetNodeId, styleNodeId, addNode, addEdgeFn, removeNodes, removeEdges]);

  // 移除风格：删除连线 + 删除图片节点
  const handleRemoveStyle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();

    if (!styleNodeId || !targetNodeId) return;

    // 按需读取 edges（不订阅，避免无关更新触发重渲染）
    const { edges } = useCanvasStore.getState();
    const edge = edges.find(
      (ed) => ed.source === styleNodeId && ed.target === targetNodeId
    );
    if (edge) removeEdges([edge.id]);

    // 删除图片节点
    removeNodes([styleNodeId]);
  }, [styleNodeId, targetNodeId, removeEdges, removeNodes]);

  return (
    <div className="relative group/style">
      {selectedStyle ? (
        /* 已选风格：显示缩略图 + 可删除 */
        <div className="relative w-[44px] h-[44px] rounded-lg bg-gray-100 border border-gray-200 cursor-pointer" onClick={() => setStyleMarketOpen(true)}>
          {/* 风格缩略图 */}
          <img
            src={selectedStyle.image_url}
            alt={selectedStyle.name}
            className="w-full h-full rounded-lg object-cover"
          />
          {/* 删除按钮 */}
          <button
            onClick={(e) => { handleRemoveStyle(e); }}
            className="absolute top-0 right-0 w-4 h-4 bg-black/60 text-white rounded-full flex items-center justify-center opacity-0 group-hover/style:opacity-100 transition-opacity cursor-pointer z-10"
          >
            <CloseOutlined style={{ fontSize: 10 }} />
          </button>
        </div>
      ) : (
        /* 未选：显示风格图标按钮 */
        <button
          onClick={() => setStyleMarketOpen(true)}
          className="w-[44px] h-[44px] rounded-lg border border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:bg-gray-50 flex flex-col items-center justify-center gap-0.5 transition-colors cursor-pointer"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
            <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
            <line x1="12" y1="22.08" x2="12" y2="12"/>
          </svg>
          <span className="text-[9px] leading-none">风格</span>
        </button>
      )}

      {styleMarketOpen && (
        <StyleMarketModal
          onClose={() => setStyleMarketOpen(false)}
          onPick={handleSelectStyle}
          selectedStyleId={selectedStyle?.id}
        />
      )}
    </div>
  );
});