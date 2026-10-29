/**
 * 助手命令的前端契约。
 *
 * 术语：这里的「命令」= 助手能执行的一个画布操作（create_node 等），
 * 与 docs/skill-integration-design.md 里那个 `skill` 节点类型不是一回事。
 */

export interface CommandOutcome {
  /** 给用户看的一句话结果（渲染在气泡下方的小字），必须是已发生的事实 */
  note: string;
  /** 是否真的改动了画布。改了就提示可撤销 */
  mutated: boolean;
}

export interface CommandContext {
  /** 画布桥；助手面板挂在 ReactFlowProvider 之外，只能靠它拿到视口能力 */
  bridge: import('@/stores/assistantStore').CanvasBridgeApi | null;
}

export type CommandHandler = (args: Record<string, unknown>, ctx: CommandContext) => CommandOutcome;

/** 安全取字符串参数（模型偶尔会给出 null / 数字） */
export function argString(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  return typeof v === 'string' ? v.trim() : '';
}
