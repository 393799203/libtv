import { create } from 'zustand';
import { assistantApi } from '@/services/assistantApi';
import type { AssistantCommand, AssistantContext, AssistantTurn } from '@/services/assistantApi';
import { useCanvasStore } from '@/stores/canvasStore';
import { useAuthStore } from '@/stores/authStore';
import { hasCommand, runCommand } from '@/components/assistant/commands';

/**
 * AI 助手面板的状态与编排。
 *
 * 编排（把回复里的命令拿去执行）刻意放在 store 而不是面板组件里：
 * 面板只负责画；将来若要从别处触发助手（菜单、快捷键、新手引导），
 * 直接调 `useAssistantStore.getState().send(...)` 即可，不必经过 UI。
 */

/** 画布桥：面板挂在 ReactFlowProvider 之外，拿不到 useReactFlow()，
 *  由 WorkspacePage 里的 CanvasBridge 把这几项能力注册进来 */
export interface CanvasBridgeApi {
  /** 视口正中在「画布坐标系」里的位置（新建节点用它，保证节点出现在用户正看的地方） */
  centerFlowPosition: () => { x: number; y: number } | null;
  /** 选中并把视口移到某个节点；返回是否找到 */
  focusNode: (nodeId: string) => boolean;
}

export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** 命令执行结果 / 失败原因，显示在气泡下方的小字 */
  note?: string;
  /** 出错样式（网络失败、助手不可用） */
  error?: boolean;
  /** 执行过的操作可以撤销（免费操作走 canvasStore，天然进撤销栈） */
  undoable?: boolean;
  /** 等待用户确认后才执行的命令（花钱类；M0 的白名单里还没有这种命令，先留着） */
  pending?: { commands: AssistantCommand[] };
  /** 正在等待后端回复 */
  loading?: boolean;
}

/** 发给后端的节点数上限。后端还会再截断一次给模型看的部分，
 *  这里限流是为了别让请求体本身过大（画布可以有几百个节点） */
const MAX_CONTEXT_NODES = 120;

/** 带进请求的历史轮数 */
const MAX_RECENT_TURNS = 8;

let msgSeq = 0;
const nextId = () => `m${++msgSeq}`;

interface AssistantState {
  open: boolean;
  messages: AssistantMessage[];
  sending: boolean;
  bridge: CanvasBridgeApi | null;

  openPanel: () => void;
  closePanel: () => void;
  toggle: () => void;
  registerBridge: (b: CanvasBridgeApi | null) => void;
  reset: () => void;
  send: (text: string) => Promise<void>;
  /** 用户点了「执行」：跑待确认的命令 */
  confirmPending: (messageId: string) => void;
  /** 用户点了「取消」：丢掉待确认的命令，什么都不做 */
  dismissPending: (messageId: string) => void;
  /** 用户点了「撤销」 */
  undoLast: () => void;
}

/**
 * 组装发给后端的画布上下文。
 *
 * 关键取舍：**只发节点摘要，不发完整画布**。完整 JSON 里含图片/视频 URL、
 * 甚至上传中的 base64，既撑大请求又有隐私问题，而指代解析只需要 id + 类型 + 名字。
 */
export function buildAssistantContext(): AssistantContext {
  const canvas = useCanvasStore.getState();
  const user = useAuthStore.getState().user;

  const all = canvas.projectId ? canvas.nodes : [];
  const selected = new Set(canvas.selectedNodeIds);

  // 选中的节点优先保留：用户说「这个」时，被截断掉就彻底猜不出来了
  const ordered = [
    ...all.filter((n) => selected.has(n.id)),
    ...all.filter((n) => !selected.has(n.id)),
  ].slice(0, MAX_CONTEXT_NODES);

  return {
    projectId: canvas.projectId ?? undefined,
    nodes: ordered.map((n) => {
      const data = n.data as Record<string, unknown> | undefined;
      return {
        id: n.id,
        type: n.type,
        label: typeof data?.label === 'string' ? data.label : undefined,
        status: typeof data?.status === 'string' ? data.status : undefined,
      };
    }),
    selectedIds: canvas.selectedNodeIds,
    credits: user?.credits ?? 0,
  };
}

/** 把消息压成后端要的历史轮次（丢掉纯 UI 态） */
function toRecentTurns(messages: AssistantMessage[]): AssistantTurn[] {
  return messages
    .filter((m) => !m.loading && !m.error && m.content.trim() !== '')
    .slice(-MAX_RECENT_TURNS)
    .map((m) => ({ role: m.role, content: m.content }));
}

export const useAssistantStore = create<AssistantState>((set, get) => ({
  open: false,
  messages: [],
  sending: false,
  bridge: null,

  openPanel: () => set({ open: true }),
  closePanel: () => set({ open: false }),
  toggle: () => set((s) => ({ open: !s.open })),
  registerBridge: (b) => set({ bridge: b }),
  reset: () => set({ messages: [], sending: false }),

  send: async (text) => {
    const message = text.trim();
    if (!message || get().sending) return;

    const userMsg: AssistantMessage = { id: nextId(), role: 'user', content: message };
    const loadingMsg: AssistantMessage = { id: nextId(), role: 'assistant', content: '', loading: true };

    const history = toRecentTurns(get().messages); // 取发问之前的历史
    const context = buildAssistantContext();
    const bridge = get().bridge;
    set((s) => ({ messages: [...s.messages, userMsg, loadingMsg], sending: true }));

    try {
      const reply = await assistantApi.chat({
        message,
        context,
        recent: history,
      });
      // Older servers serialized the fallback's nil slice as commands:null.
      // A conversational reply without tools is still a successful response.
      const commands = Array.isArray(reply?.commands)
        ? reply.commands.filter(command => command && typeof command.command === 'string') : [];
      const content = typeof reply?.reply === 'string' && reply.reply.trim()
        ? reply.reply : '助手暂未返回可用回复，请换个说法再试一次';
      const needConfirm = reply?.needConfirm === true;

      // A reply planned outside this canvas must never operate a newly opened
      // project. The project panel has its own project-bound plan lifecycle.
      if ((context.projectId || null) !== useCanvasStore.getState().projectId || bridge !== get().bridge) {
        set(s => ({
          messages: s.messages.map(m => m.id === loadingMsg.id
            ? { ...m, loading: false, content, note: '页面已切换，本次画布操作未执行' } : m),
        }));
        return;
      }

      // 用真实回复替换「思考中」气泡
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === loadingMsg.id
            ? {
                ...m,
                loading: false,
                content,
                // 需要确认的先挂起，等用户点执行
                pending: needConfirm && commands.length > 0
                  ? { commands }
                  : undefined,
              }
            : m
        ),
      }));

      if (!needConfirm && commands.length > 0) {
        executeCommands(loadingMsg.id, commands);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '助手暂时不可用';
      set((s) => ({
        messages: s.messages.map((m) =>
          m.id === loadingMsg.id
            ? { ...m, loading: false, content: msg, error: true }
            : m
        ),
      }));
    } finally {
      set({ sending: false });
    }
  },

  confirmPending: (messageId) => {
    const target = get().messages.find((m) => m.id === messageId);
    if (!target?.pending) return;
    const commands = target.pending.commands;
    set((s) => ({
      messages: s.messages.map((m) => (m.id === messageId ? { ...m, pending: undefined } : m)),
    }));
    executeCommands(messageId, commands);
  },

  dismissPending: (messageId) => {
    useAssistantStore.setState((s) => ({
      messages: s.messages.map((m) => (m.id === messageId ? { ...m, pending: undefined } : m)),
    }));
  },

  undoLast: () => {
    // 撤销走的是画布自己的历史栈，与「是不是助手做的」无关——
    // 用户手动改过之后按撤销，撤的是他自己那一步，这符合直觉
    useCanvasStore.getState().undo();
  },
}));

/**
 * 执行一批命令。
 *
 * 这是「执行权在前端」的落地处：
 *  - 每条命令先查**本地白名单**（`hasCommand`），不在白名单的直接跳过；
 *  - 单条失败不影响其余命令，失败原因写进同一个气泡的 note；
 *  - 只要有一条真的改了画布，就给用户「撤销」入口。
 */
function executeCommands(messageId: string, commands: AssistantCommand[]): void {
  const bridge = useAssistantStore.getState().bridge;
  const notes: string[] = [];
  let mutated = false;

  for (const cmd of commands) {
    if (!hasCommand(cmd.command)) {
      // 后端已经滤过一遍白名单，走到这里说明前后端白名单不同步
      notes.push(`「${cmd.command}」这个操作我暂时还不会`);
      continue;
    }
    try {
      const outcome = runCommand(cmd.command, cmd.args ?? {}, { bridge });
      notes.push(outcome.note);
      if (outcome.mutated) mutated = true;
    } catch (e) {
      notes.push(e instanceof Error ? e.message : '这一步没做成');
    }
  }

  if (notes.length === 0) return;

  useAssistantStore.setState((s) => ({
    messages: s.messages.map((m) =>
      m.id === messageId
        ? { ...m, note: notes.join('；'), undoable: mutated && !m.pending }
        : m
    ),
  }));
}
