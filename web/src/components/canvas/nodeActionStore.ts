import { create } from 'zustand';
import type { LibTVNode } from '@/types/canvas';

/**
 * 节点级操作的共享状态：**剪贴板**、**生成历史弹窗的目标**、**截取画面弹窗的目标**。
 *
 * 为什么从 Canvas 的局部 state 搬到这里：这些动作的入口不再只有右键菜单
 * （用户要求把图片节点菜单里的复制/看历史挪到节点工具条），而工具条长在节点自己的
 * DOM 里（`components/canvas/ImageNodeToolbar.tsx`），拿不到 Canvas 的 useState。
 * 两边共用一个 store 才不会出现"工具条复制的节点，右键粘不出来"这种各存一份的坑。
 *
 * 弹窗本体仍然只由 Canvas 渲染一次（`GenerationHistoryModal` / `FrameCaptureModal`），
 * 这里只存"要看哪个节点"。对截帧弹窗还有一层好处：工具条在点到别处时会随节点取消选中而
 * 卸载，弹窗挂在 Canvas 上就不会被连带关掉 —— 取帧要等好几秒，不能点一下别处就没了。
 */
interface NodeActionState {
  /** 已复制的节点（粘贴的来源），null = 剪贴板为空 */
  clipboard: LibTVNode | null;
  /** 生成历史弹窗要展示的节点；null = 不显示 */
  historyTarget: { nodeId: string; nodeType: 'image' | 'video'; currentUrl: string } | null;
  /**
   * 截取画面弹窗的目标节点；null = 不显示。
   * 只存 id：视频地址/标签/fps 都由弹窗自己从画布 store 现读，避免存快照后和节点脱节。
   */
  frameCaptureNodeId: string | null;
  setClipboard: (node: LibTVNode | null) => void;
  openHistory: (target: { nodeId: string; nodeType: 'image' | 'video'; currentUrl: string }) => void;
  closeHistory: () => void;
  openFrameCapture: (nodeId: string) => void;
  closeFrameCapture: () => void;
}

export const useNodeActionStore = create<NodeActionState>((set) => ({
  clipboard: null,
  historyTarget: null,
  frameCaptureNodeId: null,
  setClipboard: (node) => set({ clipboard: node }),
  openHistory: (target) => set({ historyTarget: target }),
  closeHistory: () => set({ historyTarget: null }),
  openFrameCapture: (nodeId) => set({ frameCaptureNodeId: nodeId }),
  closeFrameCapture: () => set({ frameCaptureNodeId: null }),
}));

/** 非 React 环境读取（事件回调里用，避免为了一个动作去订阅整棵树） */
export const nodeActionState = () => useNodeActionStore.getState();
