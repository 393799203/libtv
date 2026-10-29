import { useEffect } from 'react';
import { useReactFlow } from '@xyflow/react';
import { useAssistantStore } from '@/stores/assistantStore';
import { useCanvasStore } from '@/stores/canvasStore';

/**
 * 画布桥：把 React Flow 的视口能力交给助手面板。
 *
 * 为什么需要这一层：助手面板挂在 GlobalComponents（RouterProvider 之内、AppLayout 之外），
 * 那里**没有 ReactFlowProvider**，拿不到 useReactFlow()；而「新节点落在哪」
 * 「聚焦到某个节点」这两件事只有画布内部才做得到。
 *
 * 与其把面板塞进画布（那样一离开画布页它就不存在了，而助手在首页也该能用），
 * 不如由画布侧主动把这两项能力注册出去 —— 依赖方向反过来，两边都不必知道对方。
 *
 * 本组件只产生副作用，渲染 null。
 */
export function CanvasBridge() {
  const { screenToFlowPosition, setCenter } = useReactFlow();
  const registerBridge = useAssistantStore((s) => s.registerBridge);

  useEffect(() => {
    registerBridge({
      centerFlowPosition: () => {
        // 用画布容器自身的矩形，而不是 window：左侧有侧边标签、右侧可能开着面板，
        // 按 window 中心算出来的落点会偏到画布外面去
        const rect = document.querySelector('.react-flow')?.getBoundingClientRect();
        if (!rect) return null;
        return screenToFlowPosition({
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        });
      },

      focusNode: (nodeId: string) => {
        const node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
        if (!node) return false;
        // 先选中：让用户一眼看到助手动的是哪一个
        useCanvasStore.getState().onNodesChange([{ type: 'select', id: nodeId, selected: true }]);
        // nodeOrigin 是 [0.5, 0.5]（见 Canvas.tsx 的 nodeOrigin），position 就是节点中心
        void setCenter(node.position.x, node.position.y, { zoom: 1, duration: 400 });
        return true;
      },
    });

    // 离开画布页要注销：否则面板还握着一个已经卸载的画布实例，
    // centerFlowPosition 会返回上一页的坐标，节点就建到看不见的地方去了
    return () => registerBridge(null);
  }, [registerBridge, screenToFlowPosition, setCenter]);

  return null;
}
