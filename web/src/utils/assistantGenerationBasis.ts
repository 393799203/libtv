import type { LibTVEdge, LibTVNode } from '../types/canvas';

// Only fields which affect a generation request belong here. In particular,
// media dimensions, thumbnails, editor flags and execution state are not inputs.
const INPUT_FIELDS: Record<string, readonly string[]> = {
  text: ['prompt', 'content', 'model', 'modelProvider'],
  script: ['prompt', 'scriptContent', 'model', 'modelProvider', 'mentions'],
  image: ['prompt', 'negativePrompt', 'model', 'modelProvider', 'resolution', 'aspectRatio',
    'quality', 'count', 'mentions', 'viewKind', 'elementEdit', 'assetType'],
  video: ['prompt', 'model', 'modelProvider', 'duration', 'fps', 'resolution', 'aspectRatio',
    'videoMode', 'generateAudio', 'mentions', 'referenceImages', 'mode', 'reshoot'],
  audio: ['prompt', 'text', 'model', 'modelProvider', 'voice', 'speed', 'style', 'tone', 'mode', 'mentions'],
};

/** Sort object keys recursively; preserve array order (reference image order
 * determines first/last frame semantics). JSONB may reorder objects on save. */
function canonical(value: unknown): unknown {
  if (value === undefined || value === null || value === '') return undefined;
  if (Array.isArray(value)) {
    const items = value.map(item => canonical(item) ?? null);
    return items.length ? items : undefined;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonical(item)] as const).filter(([, item]) => item !== undefined);
    return entries.length ? Object.fromEntries(entries) : undefined;
  }
  return value;
}

function mentionsOf(node: LibTVNode) {
  return (Array.isArray(node.data.mentions) ? node.data.mentions : [])
    .map(m => ({ id: m.id, nodeId: m.nodeId, nodeType: m.nodeType }));
}

function outputOf(node: LibTVNode): Record<string, unknown> {
  const d = node.data;
  switch (node.type) {
    case 'text': return { content: d.content };
    case 'script': return { scriptContent: d.scriptContent, shots: d.shots,
      characters: d.characters, scenes: d.scenes, props: d.props };
    case 'image': return { imageUrl: d.imageUrl, styleId: d.styleId, assetType: d.assetType };
    case 'video': case 'audio': return { videoUrl: d.videoUrl, audioUrl: d.audioUrl };
    case 'previz': return { videoUrl: d.videoUrl, stillUrl: d.stillUrl, scene: d.scene };
    case 'enhance': return { videoUrl: d.videoUrl };
    default: return {};
  }
}

function nodeInput(node: LibTVNode, target: boolean): Record<string, unknown> {
  if (!target) return outputOf(node);
  const d = node.data;
  const input = Object.fromEntries((INPUT_FIELDS[node.type] || []).map(key => [key, d[key]]));
  input.modelProvider = d.modelProvider || 'wasu';
  if ('mentions' in input) input.mentions = mentionsOf(node);
  if (node.type === 'video') {
    // Cached filmstrips and probed duration are UI metadata; the selected range
    // and actual source/clip are the inputs for this one-shot editing operation.
    const state = d.reshoot as Record<string, unknown> | undefined;
    input.reshoot = state ? { sourceNodeId: state.sourceNodeId, sourceUrl: state.sourceUrl,
      start: state.start, end: state.end, clipUrl: state.clipUrl } : undefined;
    input.generateAudio = d.generateAudio ?? true;
  }
  // Keep existing outputs as a guard: generating this node elsewhere must not
  // silently make an old, unsubmitted card generate (and charge) again.
  return { input, output: outputOf(node) };
}

function dependenciesOf(node: LibTVNode): string[] {
  const refs = mentionsOf(node).map(m => m.nodeId);
  if (node.type === 'script') {
    for (const key of ['characters', 'scenes', 'props']) {
      const items = node.data[key];
      if (Array.isArray(items)) {
        for (const item of items) if (typeof item.nodeId === 'string') refs.push(item.nodeId);
      }
    }
  }
  if (typeof node.data.sourceNodeId === 'string') refs.push(node.data.sourceNodeId);
  const reshoot = node.data.reshoot as { sourceNodeId?: string } | undefined;
  if (typeof reshoot?.sourceNodeId === 'string') refs.push(reshoot.sourceNodeId);
  return refs.filter(Boolean);
}

/** A persistence-stable signature of the selected requests and their inputs. */
export function generationBasis(ids: string[], nodes: LibTVNode[], edges: LibTVEdge[]): string {
  const targets = new Set(ids);
  const scope = new Set(ids);
  const byId = new Map(nodes.map(node => [node.id, node]));
  const queue = [...scope];
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    const node = byId.get(id);
    const refs = [...edges.filter(e => e.target === id).map(e => e.source),
      ...(node ? dependenciesOf(node) : [])];
    for (const ref of refs) if (!scope.has(ref)) { scope.add(ref); queue.push(ref); }
  }
  return JSON.stringify(canonical({
    version: 2,
    targets: [...targets].sort(),
    nodes: [...scope].sort().map(id => {
      const node = byId.get(id);
      return node ? { id, type: node.type, data: nodeInput(node, targets.has(id)) } : { id, missing: true };
    }),
    // Edge array order is significant: the executor reads upstream in that order.
    edges: edges.filter(e => scope.has(e.target)).map(e => ({ source: e.source, target: e.target })),
  }));
}

/** Compare legacy cards by projecting their captured data through the same
 * semantic signature. Never replace an unreadable/unknown basis with live data. */
export function generationBasisMatches(basis: string, ids: string[], nodes: LibTVNode[], edges: LibTVEdge[]): boolean {
  const current = generationBasis(ids, nodes, edges);
  if (basis === current) return true;
  try {
    const saved = JSON.parse(basis);
    if (!saved || 'version' in saved || !Array.isArray(saved.nodes) || !Array.isArray(saved.edges)) return false;
    if (!saved.nodes.every(n => n && typeof n.id === 'string' && typeof n.type === 'string' &&
      n.data && typeof n.data === 'object' && !Array.isArray(n.data))) return false;
    if (!saved.edges.every(e => e && typeof e.source === 'string' && typeof e.target === 'string')) return false;
    if (!ids.every(id => saved.nodes.some(n => n.id === id))) return false;
    return generationBasis(ids, saved.nodes, saved.edges) === current;
  } catch {
    return false;
  }
}
