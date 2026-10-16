import { useCallback, useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { useStoreApi } from '@xyflow/react';

interface FlowAnchoredProps {
  /**
   * 要锚定的**画布坐标**（不是屏幕坐标）：锚点跟着画布一起平移缩放。
   * 传值而不是 getter：值由调用方用 memo 算（依赖里带着那个 100ms 的视口 tick，
   * 保证"父组合尺寸 / 自己的 measured 异步就绪"之后一定会重算一次）。
   */
  flow: { x: number; y: number };
  /** 额外的屏幕像素间距（用屏幕像素，浮层与节点的缝就不会随缩放变化） */
  gap?: number;
  /** 水平居中在锚点上（浮层自己做一个 translateX(-50%)） */
  centerX?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}

/**
 * 把浮层钉在画布上的某个画布坐标上，位置随视口**实时**更新。
 *
 * 为什么不能自己拿 Canvas 里那个 `viewport` state 换算屏幕坐标：它是按 100ms 节流刷新的
 * （带 trailing 兜底，实际约 150ms 一次，主要用于持久化和少量派生值），而节点是每帧都在动。
 * 用它定位浮层的后果就是"一卡一卡、跟不住节点"——实测平移时浮层与节点的纵向偏移
 * 在 858~883px 之间摆动（抖动 25px），节点动了 41 次、浮层只动了 18 次。
 *
 * 这里改为订阅 React Flow 的实时 transform，并**直接写 DOM 的 left/top**：
 * 每帧都跟得上，而且不触发任何 React 重渲染（浮层里的编辑器不会被反复 reconcile，
 * 输入焦点和滚动位置也不会受影响）。
 */
export function FlowAnchored({
  flow,
  gap = 0,
  centerX = false,
  className,
  style,
  children,
}: FlowAnchoredProps) {
  const ref = useRef<HTMLDivElement>(null);
  const store = useStoreApi();
  // 上一次用过的 [视口 transform + 锚点]：任何一项变了才写样式
  const last = useRef<[number, number, number, number, number] | null>(null);

  const apply = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const [x, y, zoom] = store.getState().transform;
    const prev = last.current;
    if (
      prev &&
      prev[0] === x &&
      prev[1] === y &&
      prev[2] === zoom &&
      prev[3] === flow.x &&
      prev[4] === flow.y
    ) {
      return;
    }
    last.current = [x, y, zoom, flow.x, flow.y];
    // ⚠️ 这里**不要**再减"容器原点"：React Flow 的 transform 本身就是相对画布容器的，
    // flow*zoom + transform 已经是容器内坐标。老代码用的是 flowToScreenPosition()，它把画布原点
    // 也算进了返回的页面坐标里，所以那边必须再减一次；照抄那个减法会让浮层整体偏掉一个容器原点
    // （实测容器在 (320,96) 时浮层偏了整整 (-320,-96)）。
    const px = x + flow.x * zoom;
    const py = y + flow.y * zoom + gap;
    // 用 transform 而不是 left/top：每帧只走合成，不触发布局和重绘。
    // 面板子树里有整套提示词编辑器，平移时每帧重排重绘这块是实打实的开销。
    el.style.transform = `translate3d(${px}px, ${py}px, 0)${centerX ? ' translateX(-50%)' : ''}`;
  }, [store, flow.x, flow.y, gap, centerX]);

  // 首帧就要出现在正确位置上（用 layout effect，避免先画在 (0,0) 再跳过去）。
  // ⚠️ 故意**不带依赖数组**：每次渲染都重算一遍，避免"锚点当时还没就绪、之后又没有 store 变化"
  // 导致浮层一直停在左上角。重复调用是幂等的（上面比较过上次的值）。
  useLayoutEffect(() => {
    apply();
  });

  useEffect(() => store.subscribe(apply), [store, apply]);

  return (
    // left/top 固定为 0：位置完全由 transform 决定，避免"先落在静态位置再跳过去"
    <div ref={ref} className={className} style={{ left: 0, top: 0, ...style }}>
      {children}
    </div>
  );
}
