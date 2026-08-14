/**
 * 提示词资产引用匹配工具
 *
 * 分镜提示词中 LLM 会输出 (@类型-名称) 形式的资产引用（如 (@角色-南方)）。
 * 关联到画布资产图片节点时以资产 nodeId 为锚点，
 * 名字解析采用"精确优先、模糊兜底"策略，避免名字轻微变化就关联失败。
 */

export interface PromptRefToken {
  /** 资产类型：角色/场景/道具 */
  type: string;
  /** 引用中的资产名称 */
  name: string;
  /** 完整原文（含括号），如 "（@角色-南方）" */
  raw: string;
}

/** 提取提示词中所有 (@类型-名称) 引用标记 */
export function extractPromptRefTokens(prompt: string): PromptRefToken[] {
  const tokens: PromptRefToken[] = [];
  const regex = /[（(]@(角色|场景|道具)-([^（()）]+)[）)]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(prompt)) !== null) {
    tokens.push({ type: match[1], name: match[2].trim(), raw: match[0] });
  }
  return tokens;
}

/** 名称归一化：去掉所有空白字符，降低空格差异导致的失配 */
export function normalizeAssetName(name: string): string {
  return name.replace(/\s+/g, '');
}

/**
 * 判断引用标记是否指向指定资产（名字轻微变化也能命中）
 * 1. 类型必须一致
 * 2. 归一化后精确匹配
 * 3. 模糊兜底：双向包含（双方名字长度都 >= 2，避免单字误配）
 */
export function tokenMatchesAsset(token: PromptRefToken, assetType: string, assetName: string): boolean {
  if (token.type !== assetType) return false;
  const t = normalizeAssetName(token.name);
  const a = normalizeAssetName(assetName);
  if (!t || !a) return false;
  if (t === a) return true;
  if (t.length >= 2 && a.length >= 2 && (t.includes(a) || a.includes(t))) return true;
  return false;
}
