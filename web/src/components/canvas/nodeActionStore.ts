import { create } from 'zustand';
import type { LibTVNode } from '@/types/canvas';

/**
 * 节点级操作的共享状态：**剪贴板** 与 **生成历史弹窗的目标**。
 *
 * 为什么从 Canvas 的局部 state 搬到这里：这两个动作的入口不再只有右键菜单
 * （用户要求把图片节点菜单里的复制/看历史挪到节点工具条），而工具条长在节点自己的
 * DOM 里（`components/canvas/ImageNodeToolbar.tsx`），拿不到 Canvas 的 useState。
 * 两边共用一个 store 才不会出现"工具条复制的节点，右键粘不出来"这种各存一份的坑。
 *
 * 弹窗本体仍然只由 Canvas 渲染一次（`GenerationHistoryModal`），这里只存"要看哪个节点"。
 */
interface NodeActionState {
  /** 已复制的节点（粘贴的来源），null = 剪贴板为空 */
  clipboard: LibTVNode | null;
  /** 生成历史弹窗要展示的节点；null = 不显示 */
  historyTarget: { nodeId: string; nodeType: 'image' | 'video'; currentUrl: string } | null;
  setClipboard: (node: LibTVNode | null) => void;
  openHistory: (target: { nodeId: string; nodeType: 'image' | 'video'; currentUrl: string }) => void;
  closeHistory: () => void;
}

export const useNodeActionStore = create<NodeActionState>((set) => ({
  clipboard: null,
  historyTarget: null,
  setClipboard: (node) => set({ clipboard: node }),
  openHistory: (target) => set({ historyTarget: target }),
  closeHistory: () => set({ historyTarget: null }),
}));

/** 非 React 环境读取（事件回调里用，避免为了一个动作去订阅整棵树） */
export const nodeActionState = () => useNodeActionStore.getState();
