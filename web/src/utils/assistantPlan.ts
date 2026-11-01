import type { AssistantPlan, AssistantSnapshot } from '../types/assistant';
import type { LibTVEdge, LibTVNode } from '../types/canvas';
import type { ModelConfig } from '../services/modelApi';
import type { PricingListResponse } from '../services/pricingApi';
import { nodeRegistry } from '../plugins/registry';
import type { NodeType } from '../types/canvas';
export { generationBasis, generationBasisMatches } from './assistantGenerationBasis';

export const ASSISTANT_NODE_TYPES = ['text', 'script', 'image', 'video', 'audio'] as const;

// Validation for the richer project canvas plan, independent of the global panel.
const isSupported = (type: string) => (ASSISTANT_NODE_TYPES as readonly string[]).includes(type);
const busy = (node: LibTVNode) => node.data.status === 'running' || node.data.status === 'pending';
const text = (value: unknown, limit: number) => typeof value === 'string' ? value.slice(0, limit) : '';

/** Null lists are an empty plan, not a reason to crash a conversation. */
export function normalizeAssistantPlan(value: AssistantPlan | null | undefined): AssistantPlan {
  if (!value || typeof value.message !== 'string' || !value.message.trim()) {
    throw new Error('助手回复不完整，请换个说法再试一次');
  }
  const plan = { ...value };
  for (const key of ['createNodes', 'updateNodes', 'connections', 'generateNodeIds', 'nextSteps'] as const) {
    if (plan[key] == null) Object.assign(plan, { [key]: [] });
    else if (!Array.isArray(plan[key])) throw new Error('助手操作计划格式不完整，请重试');
  }
  return plan;
}

/** An exact semantic snapshot: viewport, layout, selection and progress do not invalidate a plan. */
export function canvasBasis(nodes: LibTVNode[], edges: LibTVEdge[]): string {
  return JSON.stringify({
    nodes: nodes.map(n => {
      const { progressMessage: _progress, isEditing: _editing, ...data } = n.data;
      void _progress;
      void _editing;
      return { id: n.id, type: n.type, data };
    }),
    edges: edges.map(e => ({ source: e.source, target: e.target })),
  });
}

export function buildAssistantSnapshot(
  nodes: LibTVNode[], edges: LibTVEdge[], selectedNodeIds: string[],
): AssistantSnapshot {
  const selected = new Set(selectedNodeIds);
  const nearby = new Set(selectedNodeIds);
  for (const edge of edges) {
    if (selected.has(edge.source) || selected.has(edge.target)) {
      nearby.add(edge.source);
      nearby.add(edge.target);
    }
  }
  // Stable priority preserves selected content in large projects.
  const ordered = [...nodes].sort((a, b) =>
    Number(selected.has(b.id)) - Number(selected.has(a.id)) ||
    Number(nearby.has(b.id)) - Number(nearby.has(a.id)));
  const context: AssistantSnapshot['nodes'] = [];
  let bytes = 0;
  for (const n of ordered) {
    if (context.length >= 160) break;
    const d = n.data;
    const data: Record<string, unknown> = {
      label: text(d.label, 80), prompt: text(d.prompt, 1800),
      status: d.status, error: text(d.error, 240),
      content: text(d.content, 3200), scriptContent: text(d.scriptContent, 3600),
      text: text(d.text, 1600),
      hasOutput: !!(d.imageUrl || d.videoUrl || d.audioUrl || d.content || d.scriptContent),
      hasImage: !!d.imageUrl, hasVideo: !!d.videoUrl, hasAudio: !!d.audioUrl,
      scriptNodeId: d.scriptNodeId, shotId: d.shotId, refIndex: d.refIndex,
    };
    if (n.type === 'script') {
      for (const key of ['characters', 'scenes', 'props']) {
        const assets = d[key];
        data[key] = Array.isArray(assets) ? assets.slice(0, 16).map(a => ({
          name: text(a.name, 80), description: text(a.description, 200), nodeId: a.nodeId,
        })) : [];
      }
      const shots = Array.isArray(d.shots) ? d.shots : [];
      data.shots = shots.slice(0, 24).map(s => ({
        id: s.id, shotNumber: s.shotNumber, duration: s.duration,
        visual: text(s.visual, 400), shotSize: text(s.shotSize, 60),
        cameraMovement: text(s.cameraMovement, 120), lightingAtmosphere: text(s.lightingAtmosphere, 120),
        toneHint: text(s.toneHint, 120), storyboardPrompt: text(s.storyboardPrompt, 400),
      }));
      data.totalShots = shots.length;
    }
    const item = { id: n.id, type: n.type, data };
    if (new TextEncoder().encode(JSON.stringify(item)).length > 45000 && Array.isArray(data.shots)) {
      data.shots = data.shots.slice(0, 10);
    }
    const size = new TextEncoder().encode(JSON.stringify(item)).length;
    if (bytes + size > 96000) continue;
    bytes += size;
    context.push(item);
  }
  const included = new Set(context.map(n => n.id));
  return {
    nodes: context,
    connections: edges.filter(e => included.has(e.source) && included.has(e.target))
      .slice(0, 640).map(e => ({ source: e.source, target: e.target })),
    selectedNodeIds: selectedNodeIds.filter(id => included.has(id)),
    totalNodes: nodes.length,
  };
}

/** Validate again against the live canvas before a single mutation is allowed. */
export function validateAssistantPlan(plan: AssistantPlan, nodes: LibTVNode[], edges: LibTVEdge[]): void {
  if (!plan || typeof plan.message !== 'string' || !plan.message.trim() ||
    ![plan.createNodes, plan.updateNodes, plan.connections, plan.generateNodeIds, plan.nextSteps].every(Array.isArray)) {
    throw new Error('助手返回的操作计划不完整，请重试');
  }
  if (plan.createNodes.length > 12 || plan.updateNodes.length > 12 ||
      plan.connections.length > 36 || plan.generateNodeIds.length > 8) {
    throw new Error('本次操作过多，请分阶段执行');
  }
  const byId = new Map(nodes.map(n => [n.id, n]));
  const types = new Map(nodes.map(n => [n.id, n.type]));
  for (const n of plan.createNodes) {
    if (!n.id?.startsWith('new:') || types.has(n.id) || !isSupported(n.type) || !n.label?.trim()) {
      throw new Error('助手计划包含无效的新节点');
    }
    if (n.content && n.type !== 'text') throw new Error('不能直接写入生成产物');
    if (n.scriptNodeId || n.shotId || n.refIndex) {
      const script = byId.get(n.scriptNodeId);
      const shots = script?.data.shots;
      if (script?.type !== 'script' || n.type !== 'image' || ![1, 2].includes(n.refIndex) ||
          !Array.isArray(shots) || !shots.some(s => s.id === n.shotId)) {
        throw new Error('分镜归属已变化，请重新规划');
      }
    }
    types.set(n.id, n.type);
  }
  const updated = new Set<string>();
  for (const update of plan.updateNodes) {
    const node = byId.get(update.nodeId);
    if (!node || !isSupported(node.type) || busy(node) || updated.has(node.id) ||
        (update.label === undefined && update.prompt === undefined)) {
      throw new Error('要修改的节点不存在、重复或正在生成，请重新规划');
    }
    updated.add(node.id);
  }
  const allEdges = edges.map(e => ({ source: e.source, target: e.target }));
  for (const edge of plan.connections) {
    if (!isSupported(types.get(edge.source)) || !isSupported(types.get(edge.target)) ||
        edge.source === edge.target || (byId.has(edge.target) && busy(byId.get(edge.target)))) {
      throw new Error('连线的节点无效或正在生成');
    }
    if (!nodeRegistry.validateConnection(types.get(edge.source) as NodeType, types.get(edge.target) as NodeType)) {
      throw new Error('这两种节点不能建立输入关系');
    }
    const seen = new Set<string>();
    const queue = [edge.target];
    while (queue.length) {
      const id = queue.shift();
      if (id === edge.source) throw new Error('本次连接会形成循环');
      if (seen.has(id)) continue;
      seen.add(id);
      for (const e of allEdges) if (e.source === id) queue.push(e.target);
    }
    allEdges.push(edge);
  }
  const runIds = new Set(plan.generateNodeIds);
  if (runIds.size !== plan.generateNodeIds.length) throw new Error('生成任务包含重复节点');
  for (const id of runIds) {
    if (!isSupported(types.get(id)) || (byId.has(id) && busy(byId.get(id)))) {
      throw new Error('要生成的节点无效或已经在运行');
    }
  }
  for (const edge of allEdges) {
    if (runIds.has(edge.source) && runIds.has(edge.target)) {
      throw new Error('请先生成上游节点，再继续下一阶段');
    }
  }
}

export function chooseAssistantModel(models: ModelConfig[], type: string): ModelConfig | undefined {
  const available = models.filter(m => m.Usage.includes(type));
  return available.find(m => m.Default) || available[0];
}

/** Null means unknown, and is deliberately different from a configured free price. */
export function estimateGeneration(
  nodes: LibTVNode[], prices: PricingListResponse | null,
): number | null {
  if (!prices) return null;
  let total = 0;
  for (const node of nodes) {
    const group = prices.nodes.find(p => p.node_type === node.type);
    const model = node.data.model as string;
    if (!group || !model) return null;
    const resolution = node.data.resolution as string;
    const options = group.models.filter(m => m.model_id === model);
    const item = options.find(m => m.resolution === resolution) || options.find(m => !m.resolution);
    if (!item || !Number.isFinite(item.price)) return null;
    if (group.billing_type === 'per_second') {
      // Reference-video billing depends on probed media duration; do not invent an estimate.
      if (item.ref_video_billing && node.data.videoMode === 'video-ref') return null;
      total += Math.ceil(item.price * Number(node.data.duration || 5));
    } else if (group.billing_type === 'per_call') total += Math.round(item.price);
    else if (group.billing_type === 'per_char' && node.type === 'audio') {
      const spokenText = String(node.data.prompt || node.data.text || '').trim();
      if (!spokenText) return null;
      total += Math.ceil(item.price * Array.from(spokenText).length / 100);
    }
    else return null;
  }
  return total;
}
