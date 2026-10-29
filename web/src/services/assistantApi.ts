import api from './api';
import type { NodeType } from '@/types/canvas';

/**
 * AI 助手接口。
 *
 * 后端 `/api/assistant/chat` 只做一件事：把自然语言翻译成**白名单内的画布命令**。
 * 它不操作画布、不扣费——执行权在前端（见 docs/AI助手-智能问答与操作方案.md）。
 *
 * 注意 `api` 的响应拦截器已经把 `{code,msg,data}` 拆开、只返回 `data`，
 * 所以这里的泛型直接写业务类型，不要再套一层 ApiResponse。
 */

/** 发给后端的节点摘要。刻意只带这 4 个字段：完整画布 JSON 里有大量产物 URL，又贵又没必要 */
export interface AssistantCanvasNode {
  id: string;
  type: string;
  label?: string;
  status?: string;
}

export interface AssistantContext {
  projectId?: string;
  nodes: AssistantCanvasNode[];
  selectedIds: string[];
  credits: number;
}

export interface AssistantTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** 后端解析出的一条命令。`command` 必须在前后端共同的白名单内 */
export interface AssistantCommand {
  command: string;
  args: Record<string, unknown>;
}

export interface AssistantReply {
  reply: string;
  commands: AssistantCommand[];
  needConfirm: boolean;
  /** 交互日志 id：目前前端不用它回执，但保留在类型里方便后续接「是否被撤销」 */
  logId: number;
  /** 被白名单拦下的命令数 */
  rejected: number;
}

export interface AssistantChatPayload {
  message: string;
  context: AssistantContext;
  recent: AssistantTurn[];
}

/** 白名单内的节点类型（与后端 commands.go 的 creatableNodeTypes 对齐，不含 group） */
export const ASSISTANT_NODE_TYPES: NodeType[] = [
  'text',
  'image',
  'video',
  'audio',
  'script',
  'previz',
  'enhance',
];

export const assistantApi = {
  chat: (payload: AssistantChatPayload) =>
    // silentError：错误由对话气泡就地展示，不要弹全局 toast
    // （助手答不出来时用户正在看那个面板，toast 飘在角落反而容易错过）
    api.post<AssistantReply>('/assistant/chat', payload, {
      silentError: true,
      timeout: 30_000,
    } as never),
};
