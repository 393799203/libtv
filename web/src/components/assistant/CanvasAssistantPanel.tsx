import { useEffect, useRef, useState } from 'react';
import { Button, Input, Select, Tooltip } from 'antd';
import {
  BulbOutlined, CloseOutlined, DeleteOutlined, SendOutlined,
  ArrowRightOutlined, AimOutlined, CheckCircleOutlined, LoadingOutlined,
} from '@ant-design/icons';
import { useReactFlow } from '@xyflow/react';
import { useCanvasStore } from '@/stores/canvasStore';
import { useModelStore } from '@/stores/modelStore';
import { useAuthStore } from '@/stores/authStore';
import { chatWithCanvasAssistant } from '@/services/canvasAssistantApi';
import { pricingApi, type PricingListResponse } from '@/services/pricingApi';
import { buildAssistantSnapshot, canvasBasis, chooseAssistantModel, estimateGeneration, generationBasisMatches, normalizeAssistantPlan } from '@/utils/assistantPlan';
import { applyAssistantPlan, submitAssistantGeneration } from '@/utils/assistantCanvas';
import { persistCanvasBeforeRun } from '@/utils/persistCanvas';
import { refreshCredits } from '@/utils/refreshCredits';
import { newId } from '@/utils/nodeFactory';
import { getCanvasGuidance } from '@/utils/canvasGuidance';
import { referencedNodes, nodeReferenceLabel } from '@/utils/assistantReferences';
import { AssistantContent, AssistantNodeLink } from './AssistantContent';
import { useAssistantNodeFocus } from './useAssistantNodeFocus';
import type { AssistantMessage, AssistantTask, AssistantNodeReference } from '@/types/assistant';
import './assistant.css';

const EXAMPLES = [
  { title: '我想做一个30秒国风短片', detail: '从一个具体想法开始聊' },
  { title: '帮我搭建短片创作流程', detail: '从故事开始，创建节点并连接起来' },
  { title: '根据选中内容创建下游节点', detail: '引用画布里的故事、分镜或图片' },
];

function readConversation(key: string): AssistantMessage[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || '[]');
    if (!Array.isArray(value)) return [];
    return value.filter(m => m && typeof m.id === 'string' &&
      ['user', 'assistant'].includes(m.role) && typeof m.content === 'string').slice(-40).map(m => ({
        ...m,
        references: Array.isArray(m.references) ? m.references.filter(r =>
          r && typeof r.id === 'string' && typeof r.label === 'string' &&
          (r.alias === undefined || typeof r.alias === 'string')) : [],
        // A corrupted local record must never become an executable task.
        task: m.task && typeof m.task.basis === 'string' && Array.isArray(m.task.nodeIds) &&
          m.task.nodeIds.length <= 8 && m.task.nodeIds.every((id: unknown) => typeof id === 'string')
          ? m.task : undefined,
      }));
  } catch {
    return [];
  }
}

const statusLabels: Record<string, string> = {
  idle: '待生成', pending: '已提交', running: '生成中', success: '已完成', failed: '失败',
};

function GenerationCard({ task, prices, projectId, disabled, onTaskChange, onReplan }: {
  task: AssistantTask; prices: PricingListResponse | null; projectId: string;
  disabled: boolean; onTaskChange: (task: AssistantTask) => void;
  onReplan: (nodeIds: string[]) => void;
}) {
  const nodes = useCanvasStore(s => s.nodes);
  const edges = useCanvasStore(s => s.edges);
  const loadingCanvas = useCanvasStore(s => s.isLoading);
  const modelStore = useModelStore();
  const focusNodes = useAssistantNodeFocus();
  const [submitting, setSubmitting] = useState(false);
  const lock = useRef(false);
  const targets = task.nodeIds.map(id => nodes.find(n => n.id === id));
  const missing = targets.some(n => !n);
  const changed = !loadingCanvas && !task.submitted && !generationBasisMatches(task.basis, task.nodeIds, nodes, edges);
  const estimated = missing ? null : estimateGeneration(targets, prices);
  const active = targets.some(n => n && ['pending', 'running'].includes(n.data.status));
  const accepted = new Set(task.submittedNodeIds || []);
  const completed = targets.filter(n => n?.data.status === 'success' && accepted.has(n.id)).length;

  const generate = async () => {
    if (lock.current || task.submitted) return;
    lock.current = true;
    setSubmitting(true);
    // Once a submission has been attempted, this card cannot be used to retry.
    // The original request may have reached the server even when its reply was lost.
    const current: AssistantTask = { ...task, submitted: true, error: undefined, submittedNodeIds: [] };
    onTaskChange(current);
    try {
      await submitAssistantGeneration(projectId, task, (id) => {
        current.submittedNodeIds = [...current.submittedNodeIds, id];
        onTaskChange({ ...current });
      });
    } catch (error) {
      current.error = error instanceof Error ? error.message : '任务提交失败';
      onTaskChange({ ...current });
    } finally {
      lock.current = false;
      setSubmitting(false);
      void refreshCredits();
    }
  };

  return (
    <div className="assistant-task">
      <div className="assistant-task-heading">
        <span>{active ? <LoadingOutlined /> : <BulbOutlined />} 生成任务 · {targets.length} 个节点</span>
        <Tooltip title="在画布中定位这些节点">
          <Button type="text" size="small" icon={<AimOutlined />} aria-label="定位生成节点"
            onClick={() => focusNodes(task.nodeIds)} />
        </Tooltip>
      </div>
      {targets.map((node, index) => (
        <div key={task.nodeIds[index]} className="assistant-task-node">
          <span className="assistant-task-node-title" title={String(node?.data.label || '')}>
            <AssistantNodeLink reference={{ id: task.nodeIds[index], label: String(node?.data.label || '节点') }} />
            {node && <small>{[
              ...modelStore.llmModels, ...modelStore.imageModels, ...modelStore.videoModels, ...modelStore.audioModels,
            ].find(m => m.ID === node.data.model)?.Name || String(node.data.model || '尚未选择模型')}</small>}
          </span>
          <span data-status={node?.data.status}>{node ? statusLabels[node.data.status] || '待生成' : '不可用'}</span>
        </div>
      ))}
      {!task.submitted && (
        <>
          <p className="assistant-muted">
            {estimated === null ? '暂无法估算积分，以实际生成计费为准' : `预计 ${estimated} 积分，以实际生成计费为准`}
          </p>
          {changed && <p className="assistant-task-error">节点或参考素材已变化，点击下方按钮根据当前画布重新规划。</p>}
          <Button type="primary" block size="small" loading={submitting}
            disabled={disabled || loadingCanvas || (!changed && (missing || active))}
            onClick={() => changed ? onReplan(task.nodeIds) : void generate()}>
            {changed ? '重新规划' : `开始生成${task.nodeIds.length > 1 ? `（${task.nodeIds.length} 个）` : ''}`}
          </Button>
        </>
      )}
      {task.submitted && !submitting && !task.error && (
        <p className="assistant-muted">{active ? '任务已提交，生成进度会同步到画布' : `已完成 ${completed}/${targets.length} 个节点`}</p>
      )}
      {task.error && <p className="assistant-task-error">{task.error}。请检查画布后重新向助手发出指令。</p>}
    </div>
  );
}

export function CanvasAssistantPanel({ projectId, open, onClose }: {
  projectId: string; open: boolean; onClose: () => void;
}) {
  const userId = useAuthStore(s => s.user?.id);
  const storageKey = `libtv:assistant:v1:${userId}:${projectId}`;
  const [messages, setMessages] = useState<AssistantMessage[]>(() => readConversation(storageKey));
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [selectedModel, setSelectedModel] = useState('');
  const [priceState, setPriceState] = useState<{ channel: string; prices: PricingListResponse } | null>(null);
  const modelStore = useModelStore();
  const nodes = useCanvasStore(s => s.nodes);
  const selectedIds = useCanvasStore(s => s.selectedNodeIds);
  const isLoading = useCanvasStore(s => s.isLoading);
  const { fitView } = useReactFlow();
  const scrollRef = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController | null>(null);
  const sendLock = useRef(false);
  const textModels = modelStore.llmModels.filter(m => m.Usage.includes('text'));
  const model = textModels.find(m => m.ID === selectedModel) || chooseAssistantModel(textModels, 'text');
  const prices = priceState?.channel === modelStore.channel ? priceState.prices : null;
  const guidance = getCanvasGuidance(nodes, selectedIds);

  useEffect(() => {
    if (open) void useModelStore.getState().loadModels();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void pricingApi.list(modelStore.channel).then(prices => {
      if (active) setPriceState({ channel: modelStore.channel, prices });
    }).catch(() => { /* Unknown quotes are shown explicitly in the task card. */ });
    return () => { active = false; };
  }, [open, modelStore.channel]);

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(messages.slice(-40))); }
    catch { /* Private mode or a full disk must not block canvas work. */ }
  }, [messages, storageKey]);

  useEffect(() => {
    if (open && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, busy, open]);

  useEffect(() => () => request.current?.abort(), []);

  const send = async (value: string, selectedForTurn?: string[]) => {
    const content = value.trim();
    if (!content || sendLock.current || isLoading || !model) return;
    const store = useCanvasStore.getState();
    if (store.projectId !== projectId) return;
    const controller = new AbortController();
    request.current = controller;
    sendLock.current = true;
    setBusy(true);
    setInput('');
    const userMessage: AssistantMessage = { id: newId('chat'), role: 'user', content };
    setMessages(previous => [...previous, userMessage].slice(-40));
    const basis = canvasBasis(store.nodes, store.edges);
    const snapshot = buildAssistantSnapshot(store.nodes, store.edges, selectedForTurn ?? store.selectedNodeIds);
    try {
      const response = await chatWithCanvasAssistant(projectId, {
        message: content, model: model.ID, snapshot,
        history: messages.filter(m => !m.error).slice(-12).map(m => ({
          role: m.role, content: (m.content + (m.result ? `\n操作结果：${m.result}` : '')).slice(0, 1500),
        })),
      }, controller.signal);
      if (controller.signal.aborted || useCanvasStore.getState().projectId !== projectId) return;
      const plan = normalizeAssistantPlan(response?.plan);
      const hasActions = plan.createNodes?.length || plan.updateNodes?.length ||
        plan.connections?.length || plan.generateNodeIds?.length;
      let result = '';
      let task: AssistantTask | undefined;
      let references: AssistantNodeReference[] = referencedNodes([plan.message, ...plan.nextSteps].join('\n'),
        store.nodes);
      if (hasActions) {
        const current = useCanvasStore.getState();
        if (canvasBasis(current.nodes, current.edges) !== basis) {
          result = '画布内容在等待期间发生了变化，本次操作未执行。请重新发送指令。';
        } else {
          const applied = applyAssistantPlan(projectId, plan);
          references = referencedNodes(plan.message, store.nodes, [...references, ...applied.references]);
          result = applied.summary;
          task = applied.task;
          if (applied.changed) {
            // Capture a project-bound payload before awaiting network I/O.
            try {
              await persistCanvasBeforeRun(projectId);
              result += '。已保存，可在画布中一次撤销。';
            } catch {
              result += '。节点已添加，但自动保存失败，请点击顶栏保存。';
            }
          }
          if (applied.affectedIds.length && useCanvasStore.getState().projectId === projectId) {
            void fitView({ nodes: applied.affectedIds.map(id => ({ id })), padding: 0.25, duration: 350, maxZoom: 0.9 });
          }
        }
      }
      if (controller.signal.aborted) return;
      setMessages(previous => [...previous, {
        id: newId('chat'), role: 'assistant', content: plan.message,
        nextSteps: plan.nextSteps || [], result, task, references,
      } as AssistantMessage].slice(-40));
    } catch (error) {
      if (!controller.signal.aborted) {
        const detail = error instanceof Error ? error.message : '助手暂时无法回复，请重试';
        setMessages(previous => [...previous, {
          id: newId('chat'), role: 'assistant', content: detail, error: true,
        } as AssistantMessage].slice(-40));
      }
    } finally {
      if (!controller.signal.aborted) {
        setBusy(false);
        sendLock.current = false;
        request.current = null;
      }
      void refreshCredits();
    }
  };

  return (
    <aside id="canvas-creation-assistant" className="assistant-panel" hidden={!open} aria-label="画布创作助手">
      <header className="assistant-header">
        <div className="assistant-logo"><BulbOutlined /></div>
        <div className="assistant-heading"><strong>蛙导 · 创作助手</strong><span>一起把想法变成画面</span></div>
        <Tooltip title="清空本机对话，不影响画布">
          <Button type="text" size="small" icon={<DeleteOutlined />} aria-label="清空助手对话"
            disabled={busy || !messages.length} onClick={() => setMessages([])} />
        </Tooltip>
        <Button type="text" size="small" icon={<CloseOutlined />} aria-label="收起创作助手" onClick={onClose} />
      </header>
      <section className="assistant-guidance" aria-label="当前创作建议">
        <div className="assistant-guidance-label"><span /> 创作建议 · 随画布更新</div>
        <strong>{guidance.title}</strong>
        <p>{guidance.description}</p>
        <div className="assistant-guidance-actions">
          {guidance.actions.map(action => (
            <button type="button" key={action.label} disabled={busy || !model || isLoading}
              onClick={() => void send(action.prompt)}>
              {action.label}<ArrowRightOutlined />
            </button>
          ))}
        </div>
      </section>
      <div className="assistant-conversation" ref={scrollRef} aria-live="polite" aria-busy={busy}>
        {!messages.length && (
          <div className="assistant-welcome">
            <div className="assistant-welcome-mark"><BulbOutlined /></div>
            <h2>从这一步，继续创作</h2>
            <p>告诉我你想做什么。我会结合画布里的内容，帮你规划下一步，也能直接创建和连接节点。</p>
            <div className="assistant-examples">
              {EXAMPLES.map(example => (
                <button key={example.title} type="button" disabled={busy || !model || isLoading}
                  onClick={() => void send(example.title)}>
                  <span><strong>{example.title}</strong><small>{example.detail}</small></span><ArrowRightOutlined />
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((entry, index) => (
          <article key={entry.id} className={`assistant-message assistant-message-${entry.role}${entry.error ? ' assistant-message-error' : ''}`}>
            <div className="assistant-message-author">{entry.role === 'user' ? '你' : <><BulbOutlined /> 创作助手</>}</div>
            <div className="assistant-content"><AssistantContent content={entry.content} references={entry.references} /></div>
            {entry.references?.length > 0 && <div className="assistant-node-references">
              <span>涉及节点</span>
              {entry.references.map(ref => <AssistantNodeLink key={ref.id} reference={ref} />)}
            </div>}
            {entry.result && <div className="assistant-result"><CheckCircleOutlined /> <span>{entry.result}</span></div>}
            {entry.task && (
              <GenerationCard task={entry.task} prices={prices} projectId={projectId} disabled={busy || isLoading}
                onTaskChange={task => setMessages(previous => previous.map(m => m.id === entry.id ? { ...m, task } : m))}
                onReplan={nodeIds => {
                  const current = useCanvasStore.getState();
                  const existing = current.nodes.filter(node => nodeIds.includes(node.id));
                  const names = existing.map(node => `「${node.data.label || '未命名节点'}」`).join('、');
                  void send(`请根据当前画布重新规划${names ? `${names}的` : '之前的'}生成任务。检查最新提示词、模型、连线和参考素材，复用已有节点，不要重复创建；按输入已准备好的阶段给出新的生成任务，缺少素材时说明先补什么。`, existing.map(node => node.id));
                }} />
            )}
            {entry.nextSteps?.length > 0 && index === messages.length - 1 && (
              <div className="assistant-next-steps">
                {entry.nextSteps.map((step, stepIndex) => (
                  <button key={`${stepIndex}-${step}`} type="button" disabled={busy || !model || isLoading} onClick={() => void send(step)}>
                    <ArrowRightOutlined /><span>{nodeReferenceLabel(step, nodes, entry.references)}</span>
                  </button>
                ))}
              </div>
            )}
          </article>
        ))}
        {busy && <div className="assistant-thinking"><LoadingOutlined /> 正在理解画布并规划操作…</div>}
      </div>
      <footer className="assistant-composer">
        <div className="assistant-context">
          <span>{nodes.length} 个节点 · {selectedIds.length ? `已选中 ${selectedIds.length} 个` : '结合当前画布'}</span>
          {selectedIds.length > 0 && (
            <span className="assistant-context-label" title={nodes.filter(n => selectedIds.includes(n.id)).map(n => n.data.label).join('、')}>
              {nodes.filter(n => selectedIds.includes(n.id)).slice(0, 2).map(n => n.data.label).join('、')}
              {selectedIds.length > 2 ? '…' : ''}
            </span>
          )}
        </div>
        <Input.TextArea value={input} maxLength={4000} autoSize={{ minRows: 3, maxRows: 7 }}
          placeholder={selectedIds.length ? '想对选中的内容做什么？' : '描述想法，或问问接下来该做什么…'}
          aria-label="给创作助手的指令" disabled={busy || isLoading}
          onChange={event => setInput(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void send(input);
            }
          }} />
        <div className="assistant-composer-actions">
          <Select size="small" variant="borderless" aria-label="助手文本模型"
            value={model?.ID} loading={modelStore.isLoading} disabled={busy}
            placeholder="选择文本模型" onChange={setSelectedModel}
            options={textModels.map(m => ({ value: m.ID, label: m.Name }))} />
          <Button type="primary" icon={<SendOutlined />} aria-label="发送给创作助手" loading={busy}
            disabled={!input.trim() || !model || isLoading} onClick={() => void send(input)} />
        </div>
        <div className="assistant-composer-hint">
          <span>对话免费 · 生成按所选模型计费</span>
          <span>Shift + Enter 换行</span>
        </div>
        {!modelStore.isLoading && !textModels.length && (
          <div className="assistant-task-error">暂无可用文本模型。
            <button type="button" onClick={() => void modelStore.loadModels()}>重新加载</button>
          </div>
        )}
      </footer>
    </aside>
  );
}
