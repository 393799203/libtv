/**
 * 「节点自己的提示词面板该不该显示」这条规则。
 *
 * 抽成纯函数是为了能脱开 React 直接测 —— 这条规则被用户反馈改过：
 *   - 拖动/框选期间不显示（拖完再弹，否则面板跟着节点乱跳）；
 *   - **选中图片工具（切分/元素编辑/画质/多视图）期间不显示**：工具自己带输入框
 *     （元素编辑那句就写在选区旁边），两个提示词框同时出现既互相盖住，
 *     又让人分不清该写哪一个；而且此刻节点自己那份提示词本来就不参与这次生成。
 */
export interface PromptPanelConditions {
  /** 选中的节点类型（null = 没选中节点） */
  nodeType?: string | null;
  /** 风格图片节点不给提示词面板（它的提示词来自风格，不在这里写） */
  styleId?: string | null;
  /** 拖动/框选期间 */
  suppressed?: boolean;
  /** 当前打开的图片工具（null = 没开工具） */
  opsMode?: string | null;
}

/** 支持提示词面板的节点类型（风格图片节点、组合节点等不在其中） */
export const PROMPT_PANEL_NODE_TYPES = ['text', 'image', 'video', 'audio', 'script'];

export function shouldShowPromptPanel(c: PromptPanelConditions): boolean {
  if (!c.nodeType) return false;
  if (c.suppressed) return false;
  if (c.opsMode) return false;
  if (c.styleId) return false;
  return PROMPT_PANEL_NODE_TYPES.includes(c.nodeType);
}
