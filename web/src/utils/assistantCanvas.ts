import { useCanvasStore } from '@/stores/canvasStore';
import { useModelStore } from '@/stores/modelStore';
import { useExecutionStore } from '@/stores/executionStore';
import { createNode } from '@/utils/nodeFactory';
import { absolutePositionOf, nodeSizeOf } from '@/utils/canvasGroups';
import { chooseAssistantModel, generationBasis, generationBasisMatches, validateAssistantPlan } from '@/utils/assistantPlan';
import { persistCanvasBeforeRun } from '@/utils/persistCanvas';
import { workflowApi } from '@/services/workflowApi';
import type { AssistantPlan, AssistantTask, AssistantNodeReference } from '@/types/assistant';
import type { LibTVNode, LibTVEdge, LibTVNodeData } from '@/types/canvas';
import type { MentionMarker } from '@/types/prompt';

/** Apply one project plan using a single undoable canvas transaction. */
export function applyAssistantPlan(projectId: string, plan: AssistantPlan): {
  affectedIds: string[]; task?: AssistantTask; summary: string; changed: boolean; references: AssistantNodeReference[];
} {
  const store = useCanvasStore.getState();
  if (store.projectId !== projectId || store.isLoading) throw new Error('画布已切换或尚未加载');
  validateAssistantPlan(plan, store.nodes, store.edges);
  const models = useModelStore.getState();
  const created: LibTVNode[] = [];
  const resolved = new Map(store.nodes.map(n => [n.id, n.id]));
  const byId = new Map(store.nodes.map(n => [n.id, n]));
  const bounds = store.nodes.filter(n => n.type !== 'group').map(n => ({
    node: n, pos: absolutePositionOf(n, byId), size: nodeSizeOf(n),
  }));
  const right = bounds.length ? Math.max(...bounds.map(b => b.pos.x + b.size.w / 2)) + 380 : 0;
  const top = bounds.length ? Math.min(...bounds.map(b => b.pos.y)) : 0;
  // Reserve IDs first so edges can refer forward to later nodes in the response.
  for (const [index, spec] of plan.createNodes.entries()) {
    const available = spec.type === 'image' ? models.imageModels
      : spec.type === 'video' ? models.videoModels : spec.type === 'audio' ? models.audioModels : models.llmModels;
    const model = chooseAssistantModel(available, spec.type);
    const node = createNode(spec.type, { x: right, y: top + index * 440 }, {
      data: {
        label: spec.label, prompt: spec.prompt || '',
        ...(spec.type === 'text' ? { content: spec.content || '' } : {}),
        model: model?.ID || '', modelProvider: models.channel,
        ...(spec.scriptNodeId ? { scriptNodeId: spec.scriptNodeId, shotId: spec.shotId, refIndex: spec.refIndex } : {}),
        ...(spec.type === 'video' && model?.Resolutions?.length ? { resolution: model.Resolutions[0] } : {}),
        ...(spec.type === 'video' && model?.DurationRange?.length ? {
          duration: Math.max(model.DurationRange[0], Math.min(5, model.DurationRange[1])),
        } : {}),
      } as Partial<LibTVNodeData>,
    });
    resolved.set(spec.id, node.id);
    created.push(node);
  }
  // Lay out new dependency columns; independent nodes remain vertically spaced.
  const levels = new Map(plan.createNodes.map(n => [n.id, 0]));
  for (let pass = 0; pass < plan.createNodes.length; pass++) {
    for (const edge of plan.connections) {
      if (levels.has(edge.source) && levels.has(edge.target)) {
        levels.set(edge.target, Math.max(levels.get(edge.target), levels.get(edge.source) + 1));
      }
    }
  }
  const rows = new Map<number, number>();
  plan.createNodes.forEach((spec, index) => {
    const level = levels.get(spec.id);
    const row = rows.get(level) || 0;
    created[index].position = { x: right + level * 620, y: top + row * 440 };
    rows.set(level, row + 1);
  });
  const updates = new Map<string, Partial<LibTVNodeData>>();
  for (const update of plan.updateNodes) {
    updates.set(update.nodeId, {
      ...(update.label !== undefined ? { label: update.label } : {}),
      ...(update.prompt !== undefined ? { prompt: update.prompt } : {}),
    } as Partial<LibTVNodeData>);
  }
  const allNodes = [...store.nodes, ...created];
  const edges: LibTVEdge[] = [];
  for (const edge of plan.connections) {
    const source = resolved.get(edge.source);
    const target = resolved.get(edge.target);
    if (![...store.edges, ...edges].some(e => e.source === source && e.target === target)) {
      edges.push({ id: `e-${source}-${target}`, source, target, type: 'dataFlow', animated: true });
    }
  }
  // A data-flow edge alone is insufficient for script/image executors. Install
  // real mention markers as well, using current node IDs rather than model text.
  const referenceTargets = new Set([
    ...plan.connections.map(e => resolved.get(e.target)),
    ...plan.updateNodes.map(u => u.nodeId),
    ...plan.generateNodeIds.map(id => resolved.get(id)),
  ]);
  for (const targetId of referenceTargets) {
    const target = allNodes.find(n => n.id === targetId);
    const patch = updates.get(targetId) || {};
    let prompt = String(patch.prompt ?? target.data.prompt ?? '');
    const mentions: MentionMarker[] = [...(target.data.mentions || [])];
    const sources = [...store.edges, ...edges].filter(e => e.target === targetId)
      .map(e => allNodes.find(n => n.id === e.source)).filter(Boolean);
    if (target.type === 'text' || target.type === 'audio') continue;
    for (const source of sources) {
      if (!['text', 'script', 'image', 'video', 'audio'].includes(source.type)) continue;
      let mention = mentions.find(m => m.nodeId === source.id);
      if (!mention) {
        mention = { id: source.id, nodeId: source.id, nodeType: source.type as MentionMarker['nodeType'], label: String(source.data.label) };
        mentions.push(mention);
      }
      const marker = `[[m:${mention.id}]]`;
      if (!prompt.includes(marker)) prompt += `${prompt ? '\n' : ''}${marker}`;
    }
    const data = { ...patch, prompt, mentions } as Partial<LibTVNodeData>;
    if (target.type === 'video' && sources.some(n => n.type === 'image') && !target.data.videoMode) {
      Object.assign(data, { videoMode: 'universal-ref' });
    }
    const newNode = created.find(n => n.id === targetId);
    if (newNode) newNode.data = { ...newNode.data, ...data } as LibTVNodeData;
    else if (Object.keys(patch).length || prompt !== target.data.prompt ||
      JSON.stringify(mentions) !== JSON.stringify(target.data.mentions || []) ||
      ('videoMode' in data && data.videoMode !== target.data.videoMode)) {
      updates.set(targetId, data);
    }
  }
  const changed = !!(created.length || edges.length || updates.size);
  store.applyAssistantTransaction(projectId, created, edges, [...updates].map(([nodeId, data]) => ({ nodeId, data })));
  const live = useCanvasStore.getState();
  const nodeIds = plan.generateNodeIds.map(id => resolved.get(id));
  const affectedIds = [...new Set([...created.map(n => n.id), ...updates.keys(), ...nodeIds])];
  const summary = [
    created.length ? `已创建 ${created.length} 个节点` : '',
    plan.updateNodes.length ? `已修改 ${plan.updateNodes.length} 个节点` : '',
    edges.length ? `已建立 ${edges.length} 条连线` : '',
    updates.size > plan.updateNodes.length ? `已关联 ${updates.size - plan.updateNodes.length} 个节点的输入` : '',
  ].filter(Boolean).join('，');
  return {
    affectedIds, summary, changed,
    references: affectedIds.map(id => ({
      id, label: String(live.nodes.find(n => n.id === id)?.data.label || '节点'),
      alias: [...resolved].find(([key, value]) => key.startsWith('new:') && value === id)?.[0],
    })),
    task: nodeIds.length ? { nodeIds, basis: generationBasis(nodeIds, live.nodes, live.edges), submitted: false } : undefined,
  };
}

export function checkAssistantGeneration(projectId: string, task: AssistantTask): LibTVNode[] {
  const store = useCanvasStore.getState();
  if (store.projectId !== projectId || store.isLoading) throw new Error('画布已切换或尚未加载');
  if (!generationBasisMatches(task.basis, task.nodeIds, store.nodes, store.edges)) {
    throw new Error('任务中的节点或参考素材已变化，请重新告诉助手要生成什么');
  }
  const models = useModelStore.getState();
  return task.nodeIds.map(id => {
    const node = store.nodes.find(n => n.id === id);
    if (!node) throw new Error('任务节点已被删除或撤销，请重新规划');
    if (['running', 'pending'].includes(node.data.status) ||
        useExecutionStore.getState().activeStreams.some(s => s.projectId === projectId && s.nodeId === id)) {
      throw new Error(`「${node.data.label}」正在生成，请等待完成`);
    }
    const available = node.type === 'image' ? models.imageModels
      : node.type === 'video' ? models.videoModels : node.type === 'audio' ? models.audioModels : models.llmModels;
    if (!available.some(m => m.ID === node.data.model && m.Usage.includes(node.type)) ||
        (node.data.modelProvider || 'wasu') !== models.channel) {
      throw new Error(`请先为「${node.data.label}」选择当前渠道可用的模型`);
    }
    const prompt = String(node.data.prompt || '').replace(/\[\[m:[^\]]+\]\]/g, '').trim();
    if (!prompt) throw new Error(`请先为「${node.data.label}」补充生成提示词`);
    const refs = new Set([
      ...store.edges.filter(e => e.target === id).map(e => e.source),
      ...(node.data.mentions || []).map(m => m.nodeId),
    ]);
    for (const ref of refs) {
      const source = store.nodes.find(n => n.id === ref);
      if (!source) throw new Error('引用素材已不存在，请重新规划');
      const d = source.data;
      const ready = source.type === 'image' ? !!d.imageUrl
        : source.type === 'video' ? !!d.videoUrl : source.type === 'audio' ? !!d.audioUrl
        : source.type === 'text' ? !!d.content
        : source.type === 'script' ? !!d.scriptContent || (Array.isArray(d.shots) && d.shots.length > 0) : false;
      if (!ready || ['running', 'pending'].includes(d.status)) {
        throw new Error(`请先完成上游「${d.label}」，再生成「${node.data.label}」`);
      }
    }
    return node;
  });
}

/** Submit one at a time and report each accepted ID, so a partial failure cannot
 * accidentally resubmit the already charged nodes on a retry. SSE owns completion. */
export async function submitAssistantGeneration(
  projectId: string, task: AssistantTask, onSubmitted: (id: string) => void,
): Promise<void> {
  checkAssistantGeneration(projectId, task);
  const initial = useCanvasStore.getState();
  const expectedInputs = new Map(task.nodeIds.map(id => [
    id, generationBasis([id], initial.nodes, initial.edges),
  ]));
  await persistCanvasBeforeRun(projectId);
  // Saving can take time: check again before the first request.
  checkAssistantGeneration(projectId, task);
  for (const nodeId of task.nodeIds) {
    const store = useCanvasStore.getState();
    if (store.projectId !== projectId) throw new Error('项目已切换，尚未提交的任务已停止');
    checkAssistantGeneration(projectId, {
      nodeIds: [nodeId], basis: expectedInputs.get(nodeId), submitted: false,
    });
    store.updateNodeData(nodeId, { status: 'pending', error: undefined }, { transient: true });
    try {
      const resp = await workflowApi.execute(projectId, nodeId);
      if (resp?.executionId == null) throw new Error('生成任务未被接受');
      useExecutionStore.getState().addActiveStream({ projectId, executionId: resp.executionId, nodeId });
      onSubmitted(nodeId);
    } catch (error) {
      // Do not pretend that a timed-out submission is definitely uncharged.
      // Preserve the accepted IDs and require a fresh task after checking status.
      if (useCanvasStore.getState().projectId === projectId) {
        useCanvasStore.getState().updateNodeData(nodeId, {
          status: 'failed', error: '任务提交未确认，请检查节点状态后重新规划',
        }, { transient: true });
      }
      throw error;
    }
  }
}
