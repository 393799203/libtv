import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAssistantSnapshot, canvasBasis, generationBasis, generationBasisMatches, validateAssistantPlan, estimateGeneration, normalizeAssistantPlan } from '../src/utils/assistantPlan.ts';
import { getCanvasGuidance } from '../src/utils/canvasGuidance.ts';
import { nodeDisplayName, nodeReferencePlugin, nodeReferenceLabel } from '../src/utils/assistantReferences.ts';
import { createNode } from '../src/utils/nodeFactory.ts';
import { useCanvasStore } from '../src/stores/canvasStore.ts';
import { useModelStore } from '../src/stores/modelStore.ts';
import { applyAssistantPlan, checkAssistantGeneration, submitAssistantGeneration } from '../src/utils/assistantCanvas.ts';
import { workflowApi } from '../src/services/workflowApi.ts';
import { canvasApi } from '../src/services/canvasApi.ts';
import { useExecutionStore } from '../src/stores/executionStore.ts';
import { assistantApi } from '../src/services/assistantApi.ts';
import { useAssistantStore } from '../src/stores/assistantStore.ts';
import type { AssistantPlan } from '../src/types/assistant.ts';
import type { ModelConfig } from '../src/services/modelApi.ts';

const emptyPlan = (): AssistantPlan => ({
  message: '准备创建', nextSteps: [], createNodes: [], updateNodes: [], connections: [], generateNodeIds: [],
});
const model: ModelConfig = {
  ID: 'test', Name: '测试模型', ModelID: 'test', Provider: 'wasu',
  Usage: ['text', 'script', 'image', 'video', 'audio'], MaxTokens: 8192, Temperature: 0.3, Description: '', Default: true,
};

test('a reply with null commands remains a readable reply and never runs a tool', async () => {
  const store = useCanvasStore.getState();
  store.setProjectId('assistant-null-commands-test');
  store.loadCanvas({ nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } });
  useAssistantStore.setState({ messages: [], sending: false, bridge: null });
  const chat = assistantApi.chat;
  assistantApi.chat = async () => ({
    reply: '我没太听懂，可以告诉我你想做什么？', commands: null, needConfirm: false, logId: 0, rejected: 0,
  });
  try {
    await useAssistantStore.getState().send('帮我想一想');
    const reply = useAssistantStore.getState().messages.at(-1);
    assert.equal(reply.content, '我没太听懂，可以告诉我你想做什么？');
    assert.ok(!reply.error);
    assert.equal(useCanvasStore.getState().nodes.length, 0);
  } finally {
    assistantApi.chat = chat;
  }
});

test('semantic basis ignores position, selection and progress but tracks prompts and references', () => {
  const a = createNode('image', { x: 0, y: 0 }, { data: { prompt: '狐狸' } });
  const b = { ...a, position: { x: 80, y: 120 }, selected: true, data: { ...a.data, progressMessage: '10秒' } };
  assert.equal(canvasBasis([a], []), canvasBasis([b], []));
  assert.notEqual(canvasBasis([a], []), canvasBasis([{ ...b, data: { ...b.data, prompt: '兔子' } }], []));
});

test('assistant references use names for raw IDs, code, temporary aliases and duplicate labels', () => {
  const first=createNode('image',{x:0,y:0},{data:{label:'首帧图'}});
  const second=createNode('image',{x:500,y:0},{data:{label:'首帧图'}});
  assert.equal(nodeDisplayName(first,[first,second]),'首帧图（1）');
  assert.equal(nodeDisplayName(second,[first,second]),'首帧图（2）');
  const refs=[{id:first.id,label:'首帧图',alias:'new:frame'}];
  const tree={type:'root',children:[{type:'paragraph',children:[
    {type:'text',value:`使用 ${first.id} 和 new:frame`},{type:'inlineCode',value:first.id},
  ]}]};
  nodeReferencePlugin(refs)()(tree);
  const children=tree.children[0].children;
  assert.equal(children.filter(n=>n.type==='link').length,3);
  assert.ok(JSON.stringify(tree).includes(`#canvas-node=${first.id}`));
  assert.equal(nodeReferenceLabel(`继续处理 ${first.id}`,[first,second]),'继续处理 首帧图（1）');
  assert.equal(nodeReferenceLabel(`[首帧](#canvas-node=${first.id})`,[first]),'首帧图');
  const separate={type:'root',children:[{type:'text',value:`${first.id}-other`}]};
  nodeReferencePlugin(refs)()(separate);
  assert.equal(separate.children[0].type,'text','never link a partial ID');
});

test('canvas suggestions follow story, storyboard, image and running states', () => {
  const story = createNode('text', { x: 0, y: 0 }, { data: { content: '狐狸下山' } });
  assert.match(getCanvasGuidance([story], [story.id]).title, /拆成分镜/);
  const script = createNode('script', { x: 0, y: 0 }, { data: { shots: [{ id: 'shot1' }] } });
  assert.equal(getCanvasGuidance([script], [script.id]).actions[0].label, '给分镜补首帧');
  const image = createNode('image', { x: 0, y: 0 }, { data: { imageUrl: 'a.png' } });
  assert.equal(getCanvasGuidance([image], [image.id]).actions[0].label, '用这张图做视频');
  image.data.status = 'running';
  assert.match(getCanvasGuidance([image], [image.id]).title, /正在生成/);
});

test('null canvas plan lists normalize to an empty, readable reply', () => {
  const plan = normalizeAssistantPlan({
    message: '先想清楚故事', createNodes: null, updateNodes: null,
    connections: null, generateNodeIds: null, nextSteps: null,
  });
  assert.deepEqual(plan.generateNodeIds, []);
  assert.deepEqual(plan.nextSteps, []);
  assert.throws(() => normalizeAssistantPlan(null), /回复不完整/);
});

test('snapshot prioritizes selected nodes and strips media URLs', () => {
  const nodes = Array.from({ length: 180 }, (_, i) => createNode('image', { x: i, y: 0 }, {
    data: { label: `图${i}`, imageUrl: `https://example.test/${i}.png` },
  }));
  const snapshot = buildAssistantSnapshot(nodes, [], [nodes[179].id]);
  assert.equal(snapshot.nodes[0].id, nodes[179].id);
  assert.equal(snapshot.totalNodes, 180);
  assert.equal(snapshot.nodes.length, 160);
  assert.equal(snapshot.nodes[0].data.hasImage, true);
  assert.ok(!JSON.stringify(snapshot).includes('https://'));
});

test('plan rejects cycles, missing IDs and dependent generation stages', () => {
  const a = createNode('text', { x: 0, y: 0 });
  const b = createNode('script', { x: 600, y: 0 });
  const edges = [{ id: 'edge', source: a.id, target: b.id }];
  assert.throws(() => validateAssistantPlan({ ...emptyPlan(), connections: [{ source: b.id, target: a.id }] }, [a, b], edges), /循环/);
  assert.throws(() => validateAssistantPlan({ ...emptyPlan(), generateNodeIds: ['missing'] }, [a, b], edges), /无效/);
  assert.throws(() => validateAssistantPlan({ ...emptyPlan(), generateNodeIds: [a.id, b.id] }, [a, b], edges), /上游/);
});

test('a whole assistant edit is one undo step and creates real upstream mentions', () => {
  const story = createNode('text', { x: 0, y: 0 }, { data: { content: '小狐狸下山', label: '旧故事名' } });
  const store = useCanvasStore.getState();
  store.setProjectId('assistant-transaction-test');
  store.loadCanvas({ nodes: [story], edges: [], viewport: { x: 0, y: 0, zoom: 1 } });
  useModelStore.setState({ llmModels: [model], imageModels: [model], videoModels: [model], channel: 'wasu' });
  const plan = {
    ...emptyPlan(),
    createNodes: [{ id: 'new:script', type: 'script' as const, label: '分镜', prompt: '拆成三个镜头' }],
    updateNodes: [{ nodeId: story.id, label: '狐狸故事' }],
    connections: [{ source: story.id, target: 'new:script' }],
    generateNodeIds: ['new:script'],
  };
  const applied = applyAssistantPlan('assistant-transaction-test', plan);
  const live = useCanvasStore.getState();
  const script = live.nodes.find(n => n.type === 'script');
  assert.equal(live.nodes.length, 2);
  assert.equal(script.data.model, 'test');
  assert.equal(script.data.mentions[0].nodeId, story.id);
  assert.ok(script.data.prompt.includes(`[[m:${story.id}]]`));
  assert.equal(checkAssistantGeneration('assistant-transaction-test', applied.task).length, 1);
  live.undo();
  assert.equal(useCanvasStore.getState().nodes.length, 1);
  assert.equal(useCanvasStore.getState().edges.length, 0);
  assert.equal(useCanvasStore.getState().nodes[0].data.label, '旧故事名');
  assert.throws(() => checkAssistantGeneration('assistant-transaction-test', applied.task), /变化/);
});

test('audio references never insert marker text into speech', () => {
  const story = createNode('text', { x: 0, y: 0 }, { data: { content: '你好，世界' } });
  const store = useCanvasStore.getState();
  store.setProjectId('assistant-audio-test');
  store.loadCanvas({ nodes: [story], edges: [], viewport: { x: 0, y: 0, zoom: 1 } });
  useModelStore.setState({ audioModels: [model] });
  applyAssistantPlan('assistant-audio-test', {
    ...emptyPlan(),
    createNodes: [{ id: 'new:audio', type: 'audio', label: '旁白', prompt: '你好，世界' }],
    connections: [{ source: story.id, target: 'new:audio' }],
  });
  assert.equal(useCanvasStore.getState().nodes.find(n => n.type === 'audio').data.prompt, '你好，世界');
});

test('generating an existing script repairs legacy edges without mention markers', () => {
  const story = createNode('text', { x: 0, y: 0 }, { data: { content: '小狐狸下山' } });
  const script = createNode('script', { x: 600, y: 0 }, {
    data: { prompt: '拆成三个分镜', model: 'test', modelProvider: 'wasu' },
  });
  const store = useCanvasStore.getState();
  store.setProjectId('assistant-legacy-reference-test');
  store.loadCanvas({
    nodes: [story, script], edges: [{ id: 'legacy-edge', source: story.id, target: script.id }],
    viewport: { x: 0, y: 0, zoom: 1 },
  });
  const result = applyAssistantPlan('assistant-legacy-reference-test', {
    ...emptyPlan(), generateNodeIds: [script.id],
  });
  const updated = useCanvasStore.getState().nodes.find(n => n.id === script.id);
  assert.equal(updated.data.mentions[0].nodeId, story.id);
  assert.ok(updated.data.prompt.includes(`[[m:${story.id}]]`));
  assert.equal(result.changed, true);
  assert.equal(checkAssistantGeneration('assistant-legacy-reference-test', result.task).length, 1);
});

test('generation basis tracks upstream media and quotes unknown costs honestly', () => {
  const source = createNode('image', { x: 0, y: 0 }, { data: { imageUrl: 'a.png' } });
  const target = createNode('video', { x: 600, y: 0 }, { data: { model: 'test', duration: 5 } });
  const edges = [{ id: 'edge', source: source.id, target: target.id }];
  const basis = generationBasis([target.id], [source, target], edges);
  assert.notEqual(basis, generationBasis([target.id], [{ ...source, data: { ...source.data, imageUrl: 'b.png' } }, target], edges));
  assert.equal(estimateGeneration([target], null), null);
  assert.equal(estimateGeneration([target], { nodes: [{
    node_type: 'video', node_name: '视频', billing_type: 'per_second',
    models: [{ model_id: 'test', model_name: '测试模型', price: 2 }],
  }] }), 10);
});

test('unsubmitted cards survive JSONB field ordering, reload and harmless metadata', () => {
  const source = createNode('image', { x: 0, y: 0 }, { data: {
    label: '参考图', imageUrl: 'same-reference.png', prompt: '最初的提示词',
  } });
  const target = createNode('video', { x: 600, y: 0 }, { data: {
    label: '视频', prompt: '狐狸向前走', model: 'test', modelProvider: 'wasu',
    mentions: [{ id: source.id, nodeId: source.id, nodeType: 'image', label: '参考图' }],
  } });
  const edges = [{ id: 'edge', source: source.id, target: target.id }];
  const nodes = [source, target];
  const basis = generationBasis([target.id], nodes, edges);
  // The shape and serialization used by cards released before this fix.
  const legacy = canvasBasis(nodes, edges);
  const reorderKeys = value => Array.isArray(value) ? value.map(reorderKeys)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().reverse().map(key => [key, reorderKeys(value[key])])) : value;
  const restored = reorderKeys(JSON.parse(JSON.stringify(nodes))).reverse().map(n => ({
    ...n, selected: false, position: { x: 999, y: 500 }, measured: { width: 640, height: 360 },
    data: { ...n.data, label: '重新命名也不改变请求', isEditing: false, stale: false,
      width: 1920, height: 1080, videoWidth: 1920, videoHeight: 1080,
      thumbUrl: 'same-reference.thumb.webp', progressMessage: '已运行10秒',
      error: null, uploadProgress: 100, durationSeconds: 5 },
  }));
  assert.equal(generationBasis([target.id], restored, edges), basis);
  assert.ok(generationBasisMatches(legacy, [target.id], restored, edges), 'legacy cards must be usable after reload');
  const sourcePromptChanged = restored.map(n => n.id === source.id ? {
    ...n, data: { ...n.data, prompt: '改了上游提示词但尚未生成' },
  } : n);
  assert.equal(generationBasis([target.id], sourcePromptChanged, edges), basis,
    'an existing reference image is identified by its output, not its future generation parameters');
  const emptyLists = restored.map(n => n.id === target.id ? {
    ...n, data: { ...n.data, referenceImages: [] },
  } : n);
  assert.equal(generationBasis([target.id], emptyLists, edges), basis);
  const newOutput = restored.map(n => n.id === target.id ? { ...n, data: { ...n.data, videoUrl: 'new-result.mp4' } } : n);
  assert.ok(!generationBasisMatches(legacy, [target.id], newOutput, edges), 'manual generation must invalidate the old task');
  for (const [field, value] of [['prompt', '另一段描述'], ['model', 'different-model'], ['duration', 10],
    ['generateAudio', false], ['resolution', '1080p'], ['videoMode', 'first-last-frame']]) {
    const changed = restored.map(n => n.id === target.id ? { ...n, data: { ...n.data, [field]: value } } : n);
    assert.ok(!generationBasisMatches(legacy, [target.id], changed, edges), `real parameter ${field} must invalidate`);
  }
  assert.ok(!generationBasisMatches(legacy, [target.id], restored.filter(n => n.id !== source.id), edges));
  assert.ok(!generationBasisMatches(legacy, [target.id], restored, []));
  assert.ok(!generationBasisMatches('broken', [target.id], restored, edges));
  assert.ok(!generationBasisMatches('{"version":999}', [target.id], restored, edges));
});

test('the ordering of reference inputs still affects first/last-frame requests', () => {
  const first = createNode('image', { x: 0, y: 0 }, { data: { imageUrl: 'first.png' } });
  const last = createNode('image', { x: 0, y: 400 }, { data: { imageUrl: 'last.png' } });
  const target = createNode('video', { x: 600, y: 0 }, { data: { videoMode: 'first-last-frame' } });
  const nodes = [first, last, target];
  const edges = [
    { id: 'first', source: first.id, target: target.id },
    { id: 'last', source: last.id, target: target.id },
  ];
  assert.notEqual(generationBasis([target.id], nodes, edges), generationBasis([target.id], nodes, [...edges].reverse()));
});

test('generation preflight accepts legacy cards after restoring a canvas but blocks active work', () => {
  const source = createNode('text', { x: 0, y: 0 }, { data: { content: '狐狸下山' } });
  const target = createNode('image', { x: 500, y: 0 }, { data: {
    model: 'test', modelProvider: 'wasu', prompt: '狐狸走在山路上',
  } });
  const nodes = [source, target];
  const edges = [{ id: 'edge', source: source.id, target: target.id }];
  const task = { nodeIds: [target.id], basis: canvasBasis(nodes, edges), submitted: false };
  const restored = JSON.parse(JSON.stringify(nodes)).map(n => ({
    ...n, data: Object.fromEntries(Object.entries({ ...n.data, stale: false, width: 1024 }).reverse()),
  }));
  const store = useCanvasStore.getState();
  store.setProjectId('assistant-restored-task');
  store.loadCanvas({ nodes: restored, edges, viewport: { x: 0, y: 0, zoom: 1 } });
  useModelStore.setState({ imageModels: [model], channel: 'wasu' });
  useExecutionStore.setState({ activeStreams: [] });
  assert.equal(checkAssistantGeneration('assistant-restored-task', task).length, 1);
  store.updateNodeStatus(target.id, 'running');
  assert.throws(() => checkAssistantGeneration('assistant-restored-task', task), /正在生成/);
  store.updateNodeStatus(target.id, 'idle');
  useExecutionStore.setState({ activeStreams: [{ projectId: 'assistant-restored-task', executionId: 987, nodeId: target.id }] });
  assert.throws(() => checkAssistantGeneration('assistant-restored-task', task), /正在生成/);
  useExecutionStore.setState({ activeStreams: [] });
});

test('a partial submission reports accepted IDs and leaves unsubmitted nodes idle', async () => {
  const nodes = Array.from({ length: 3 }, (_, i) => createNode('image', { x: i * 400, y: 0 }, {
    data: { model: 'test', modelProvider: 'wasu', label: `图${i}`, prompt: `狐狸镜头${i}` },
  }));
  const store = useCanvasStore.getState();
  store.setProjectId('assistant-partial-test');
  store.loadCanvas({ nodes, edges: [], viewport: { x: 0, y: 0, zoom: 1 } });
  useExecutionStore.setState({ activeStreams: [] });
  const save = canvasApi.saveCanvas;
  const execute = workflowApi.execute;
  const accepted: string[] = [];
  let calls = 0;
  canvasApi.saveCanvas = async () => {};
  workflowApi.execute = async () => {
    calls++;
    if (calls === 2) throw new Error('模拟网络失败');
    return { executionId: 123 };
  };
  try {
    await assert.rejects(submitAssistantGeneration('assistant-partial-test', {
      nodeIds: nodes.map(n => n.id), basis: generationBasis(nodes.map(n => n.id), nodes, []), submitted: false,
    }, id => accepted.push(id)), /模拟网络失败/);
    assert.deepEqual(accepted, [nodes[0].id]);
    assert.equal(useExecutionStore.getState().activeStreams.length, 1);
    assert.equal(useCanvasStore.getState().nodes[1].data.status, 'failed');
    assert.equal(useCanvasStore.getState().nodes[2].data.status, 'idle');
  } finally {
    canvasApi.saveCanvas = save;
    workflowApi.execute = execute;
  }
});

test('a late global reply cannot mutate a newly opened project', async () => {
  const store = useCanvasStore.getState();
  store.setProjectId('global-source-project');
  store.loadCanvas({ nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } });
  useAssistantStore.setState({
    messages: [], sending: false,
    bridge: { centerFlowPosition: () => ({ x: 0, y: 0 }), focusNode: () => true },
  });
  const chat = assistantApi.chat;
  let resolveReply;
  assistantApi.chat = () => new Promise(resolve => { resolveReply = resolve; });
  try {
    const pending = useAssistantStore.getState().send('新建图片节点');
    store.setProjectId('global-next-project');
    store.loadCanvas({ nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } });
    resolveReply({
      reply: '准备新建', commands: [{ command: 'create_node', args: { nodeType: 'image' } }],
      needConfirm: false, logId: 0, rejected: 0,
    });
    await pending;
    assert.equal(useCanvasStore.getState().nodes.length, 0);
    assert.match(useAssistantStore.getState().messages.at(-1).note, /页面已切换/);
  } finally {
    assistantApi.chat = chat;
  }
});
