import { useReactFlow } from '@xyflow/react';
import { useCanvasStore } from '@/stores/canvasStore';

export function useAssistantNodeFocus() {
  const { fitView } = useReactFlow();
  return (ids: string[]) => {
    const store = useCanvasStore.getState();
    const targets = ids.filter(id => store.nodes.some(n => n.id === id));
    if (!targets.length) return;
    store.onNodesChange(store.nodes.map(n => ({
      type: 'select' as const, id: n.id, selected: targets.includes(n.id),
    })));
    void fitView({ nodes: targets.map(id => ({ id })), padding: 0.5, duration: 350, maxZoom: 1 });
  };
}
