import { useEffect, useRef, useState } from 'react';
import { CloseOutlined, MessageOutlined, SendOutlined } from '@ant-design/icons';
import { useAssistantStore, type AssistantMessage } from '@/stores/assistantStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { Z } from '@/utils/zLayers';

/**
 * AI 助手悬浮面板（M0）。
 *
 * 形态：收起时是右下角一个圆钮，展开成右侧 360px 的对话列。
 * 为什么是「悬浮常驻」而不是「独立页面」或「一次性引导弹窗」：
 *  - 助手的价值在于**边看画布边问**（「这个节点为什么没生成」），
 *    跳走一个页面就断了上下文；
 *  - 一次性弹窗是教程思路，用户点掉就再也找不回来；
 *  - 常驻之后，新手引导不必再单独做一套 —— 首次打开时的示例问句就是引导。
 *
 * 面板刻意挂在 GlobalComponents（而不是画布内），这样在首页/项目列表也能问问题；
 * 需要画布坐标的那几个操作由 CanvasBridge 反向注册进来。
 */

/** 首次打开时的示例问句：既当引导，也当「命令能被听懂」的说明书 */
const EXAMPLES = [
  '帮我新建一个文本节点',
  '新建一个图片节点，标题写「首帧图」',
  '把选中的两个节点连起来',
  '新建图片节点要花多少积分？',
];

export function AssistantPanel() {
  const open = useAssistantStore((s) => s.open);
  const messages = useAssistantStore((s) => s.messages);
  const sending = useAssistantStore((s) => s.sending);
  const toggle = useAssistantStore((s) => s.toggle);
  const closePanel = useAssistantStore((s) => s.closePanel);
  const send = useAssistantStore((s) => s.send);
  const confirmPending = useAssistantStore((s) => s.confirmPending);
  const dismissPending = useAssistantStore((s) => s.dismissPending);
  const undoLast = useAssistantStore((s) => s.undoLast);
  const projectId = useCanvasStore((s) => s.projectId);

  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  // 有新消息就滚到底：聊天窗口里「看到最新一条」是默认预期，
  // 否则助手回完话用户还得自己往下翻
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  const submit = () => {
    const text = draft.trim();
    if (!text || sending) return;
    setDraft('');
    void send(text);
  };

  // ── 收起态：右下角圆钮 ──
  if (!open) {
    return (
      <button
        type="button"
        onClick={toggle}
        style={{ zIndex: Z.assistant }}
        aria-label="打开 AI 助手"
        className="fixed right-6 bottom-6 flex h-12 w-12 items-center justify-center rounded-full border border-[var(--dv-cyan-border)] bg-[var(--dv-surface-2)] text-[16px] text-[var(--dv-cyan-text)] shadow-[0_8px_24px_rgba(0,0,0,0.45)] transition-all duration-200 hover:border-[var(--dv-cyan-border-hover)] hover:bg-[var(--dv-surface-3)] hover:text-[var(--dv-cyan-text-strong)]"
      >
        <MessageOutlined />
      </button>
    );
  }

  return (
    <div
      style={{ zIndex: Z.assistant }}
      className="fixed right-6 bottom-6 flex h-[560px] max-h-[calc(100vh-96px)] w-[min(360px,calc(100vw-32px))] flex-col overflow-hidden rounded-2xl border border-[var(--dv-border-1)] bg-[var(--dv-surface-1)] shadow-[0_18px_48px_var(--dv-modal-shadow)]"
    >
      {/* 头部 */}
      <div className="flex items-center gap-2 border-b border-[var(--dv-border-1)] px-3.5 py-2.5">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--dv-cyan-soft)] text-[13px] text-[var(--dv-cyan-text)]">
          <MessageOutlined />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-[var(--dv-text-1)]">蛙导</div>
          <div className="truncate text-[11px] text-[var(--dv-text-3)]">
            {projectId ? '画布操作助手' : '还没打开项目，先聊两句也行'}
          </div>
        </div>
        <button
          type="button"
          onClick={closePanel}
          aria-label="收起助手"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--dv-text-3)] transition hover:bg-[var(--dv-surface-3)] hover:text-[var(--dv-text-1)]"
        >
          <CloseOutlined />
        </button>
      </div>

      {/* 消息区 */}
      <div ref={listRef} className="flex-1 space-y-2.5 overflow-y-auto px-3.5 py-3">
        {messages.length === 0 ? (
          <div className="space-y-2.5 pt-1">
            <p className="text-[12px] leading-relaxed text-[var(--dv-text-2)]">
              我是蛙导。你可以直接说想在画布上做什么，我来帮你操作；
              不懂的功能也可以问我。
            </p>
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => void send(ex)}
                  className="rounded-lg border border-[var(--dv-border-1)] bg-[var(--dv-surface-2)] px-2 py-1 text-[11px] text-[var(--dv-text-2)] transition hover:border-[var(--dv-cyan-border)] hover:text-[var(--dv-cyan-text)]"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                onConfirm={confirmPending}
                onDismiss={dismissPending}
                onUndo={undoLast}
              />
            ))}
            {/* 「能接着说什么」不能只在首次打开时给一次：用户问了跑题的问题之后，
                示例就消失了，对话正断在那儿。所以只要空闲就常驻一条轻提示 + 可点问句。 */}
            {!sending && (
              <div className="space-y-1.5 pt-1.5">
                <div className="text-[10px] text-[var(--dv-text-3)]">
                  试试这样说（点一下直接发送）
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {EXAMPLES.map((ex) => (
                    <button
                      key={ex}
                      type="button"
                      onClick={() => void send(ex)}
                      className="rounded-lg border border-[var(--dv-border-1)] bg-[var(--dv-surface-2)] px-2 py-1 text-[10px] text-[var(--dv-text-3)] transition hover:border-[var(--dv-cyan-border)] hover:text-[var(--dv-cyan-text)]"
                    >
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* 输入区 */}
      <div className="border-t border-[var(--dv-border-1)] px-3 py-2.5">
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter 发送、Shift+Enter 换行 —— 聊天框的通用约定
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            rows={2}
            placeholder="说点什么，比如「新建一个视频节点」"
            className="max-h-[88px] min-h-[44px] flex-1 resize-none rounded-lg border border-[var(--dv-border-1)] bg-[var(--dv-surface-2)] px-2.5 py-1.5 text-[12px] leading-relaxed text-[var(--dv-text-1)] outline-none transition placeholder:text-[var(--dv-text-3)] focus:border-[var(--dv-cyan-border)]"
          />
          <button
            type="button"
            onClick={submit}
            disabled={sending || !draft.trim()}
            aria-label="发送"
            className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg border border-[var(--dv-cyan-border)] bg-[var(--dv-cyan-soft)] text-[13px] text-[var(--dv-cyan-text)] transition hover:bg-[var(--dv-cyan-soft-hover)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <SendOutlined />
          </button>
        </div>
        <div className="mt-1.5 text-[10px] leading-relaxed text-[var(--dv-text-3)]">
          和我聊天不花积分；让 AI 生成内容时才按原价扣你自己的积分。
        </div>
      </div>
    </div>
  );
}

/** 单条消息气泡 */
function MessageBubble({
  message,
  onConfirm,
  onDismiss,
  onUndo,
}: {
  message: AssistantMessage;
  onConfirm: (id: string) => void;
  onDismiss: (id: string) => void;
  onUndo: () => void;
}) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-xl rounded-br-sm bg-[var(--dv-cyan-soft)] px-2.5 py-1.5 text-[12px] leading-relaxed text-[var(--dv-text-1)]">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[88%] space-y-1.5">
        <div
          className={`rounded-xl rounded-bl-sm px-2.5 py-1.5 text-[12px] leading-relaxed ${
            message.error
              ? 'bg-[var(--dv-surface-2)] text-[var(--dv-danger)]'
              : 'bg-[var(--dv-surface-2)] text-[var(--dv-text-1)]'
          }`}
        >
          {message.loading ? (
            <span className="flex items-center gap-1.5 text-[var(--dv-text-3)]">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--dv-cyan)]" />
              思考中…
            </span>
          ) : (
            message.content
          )}
        </div>

        {/* 命令执行结果：把「它到底做了什么」如实写出来，而不是只留一句「好的」 */}
        {message.note && (
          <div className="flex items-start gap-2 pl-1 text-[11px] leading-relaxed text-[var(--dv-text-3)]">
            <span className="flex-1">{message.note}</span>
            {message.undoable && (
              <button
                type="button"
                onClick={onUndo}
                className="shrink-0 rounded border border-[var(--dv-border-1)] px-1.5 py-0.5 text-[10px] text-[var(--dv-text-2)] transition hover:border-[var(--dv-cyan-border)] hover:text-[var(--dv-cyan-text)]"
              >
                撤销
              </button>
            )}
          </div>
        )}

        {/* 花钱操作要用户点头才执行（M0 白名单里还没有这类命令，先把通道留好） */}
        {message.pending && (
          <div className="flex gap-1.5 pl-1">
            <button
              type="button"
              onClick={() => onConfirm(message.id)}
              className="rounded-md border border-[var(--dv-cyan-border)] bg-[var(--dv-cyan-soft)] px-2 py-0.5 text-[11px] text-[var(--dv-cyan-text)] transition hover:bg-[var(--dv-cyan-soft-hover)]"
            >
              执行
            </button>
            <button
              type="button"
              onClick={() => onDismiss(message.id)}
              className="rounded-md border border-[var(--dv-border-1)] px-2 py-0.5 text-[11px] text-[var(--dv-text-3)] transition hover:text-[var(--dv-text-1)]"
            >
              算了
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
