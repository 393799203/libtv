/**
 * 资产描述（脚本/分镜流程产出的角色、场景、道具描述）的文本处理。
 *
 * 脚本节点会给每个资产描述追加一段"视图要求"（【角色四视图】/【场景四视图】/
 * 【道具六视图】，历史版本用过【三视图要求】等）。这段要求只对**用资产描述生成资产设定图**
 * 有意义；一旦把整段描述塞进"生成分镜帧提示词"的输入里，模型会把"四视图 / 2×2 宫格 /
 * 只留极窄浅灰间隙（不要画白色分割线）"抄进**单帧**画面提示词，出图就变成设定图宫格而不是一个镜头。
 *
 * 后端 server/internal/llm/prompt.go 的 stripViewRequirementBlocks 是同一套规则
 * （那边负责帧提示词，这边负责界面展示），改规则时两边要一起改。
 */

/** 视图要求块的开头标记 */
const VIEW_HEAD_RE = /^【(?:角色三视图|角色四视图|场景四视图|道具六视图|三视图要求|四视图要求|六视图要求)】/;

/**
 * 去掉描述里的"视图要求"块：从【…视图】那一行起，到下一个【…】小节或结尾为止。
 * 外观、空间、材质等描述会原样保留 —— 那些才是帧提示词和界面预览要用的信息。
 */
export function stripViewRequirement(description: string): string {
  const kept: string[] = [];
  let skipping = false;
  for (const line of description.split('\n')) {
    const trimmed = line.trim();
    if (VIEW_HEAD_RE.test(trimmed)) {
      skipping = true;
      continue;
    }
    // 遇到下一个【…】小节就结束跳过（视图要求块本身可能是多行）
    if (skipping && trimmed.startsWith('【')) skipping = false;
    if (skipping) continue;
    kept.push(line);
  }
  return kept.join('\n').trim();
}
