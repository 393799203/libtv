import { createNodeCommand } from './createNode';
import { connectNodesCommand } from './connectNodes';
import { updateNodeCommand } from './updateNode';
import type { CommandContext, CommandHandler, CommandOutcome } from './types';

/**
 * 前端命令注册表。
 *
 * 与后端 assistant/commands.go 的白名单是**两份独立清单**，这是有意的：
 * 后端那份决定「模型能说什么」，前端这份决定「我们真的会做什么」。
 * 两者不一致时前端一律拒绝执行（宁可报「我还不会」也不要跑一个没写好的操作）。
 *
 * M0 只放 3 条。扩张顺序见 docs/AI助手-智能问答与操作方案.md 的路线图。
 */
const registry: Record<string, CommandHandler> = {
  create_node: createNodeCommand,
  connect_nodes: connectNodesCommand,
  update_node: updateNodeCommand,
};

export function hasCommand(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(registry, name);
}

/** 执行一条命令。未知命令与执行失败都抛 Error，由调用方展示给用户 */
export function runCommand(
  name: string,
  args: Record<string, unknown>,
  ctx: CommandContext
): CommandOutcome {
  const handler = registry[name];
  if (!handler) {
    throw new Error(`「${name}」这个操作我暂时还不会`);
  }
  return handler(args, ctx);
}

export type { CommandContext, CommandOutcome };
