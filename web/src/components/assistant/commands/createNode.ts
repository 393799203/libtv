import { createNode } from '@/utils/nodeFactory';
import { useCanvasStore } from '@/stores/canvasStore';
import { ASSISTANT_NODE_TYPES } from '@/services/assistantApi';
import type { NodeType } from '@/types/canvas';
import { argString, type CommandContext, type CommandHandler } from './types';

/**
 * create_node：在画布上新建一个节点。
 *
 * 为什么值得单独写一个文件（而不是内联进注册表）：
 * 「新节点放在哪」这件事有讲究——放在视口正中外加避让已有节点，
 * 否则用户连说两次「新建文本节点」，第二个就完全盖在第一个上面，看起来像没生效。
 */

/** 节点类型的中文名，用于把结果说成人话（而不是「已创建 text 节点」） */
const NODE_LABELS: Record<string, string> = {
  text: '文本',
  image: '图片',
  video: '视频',
  audio: '音频',
  script: '分镜剧本',
  previz: '白模漫剧',
  enhance: '增强',
};

/** prompt 只对这几类有意义（previz/enhance 的数据结构里没有 prompt 字段） */
const PROMPT_CAPABLE: NodeType[] = ['text', 'image', 'video', 'audio', 'script'];

/** 落点避让的步长与判定半径：与节点默认宽度（约 300+）相比取小值，
 *  保证「稍微错开」就够用，连建多个节点不会跑出视野 */
const AVOID_STEP = 48;
const AVOID_RADIUS = 40;
const AVOID_TRIES = 12;

/**
 * 选一个不压住已有节点的落点。
 *
 * 拿不到画布桥时**直接报错**而不是退回 (0,0)：
 * 助手在非画布页（首页、项目列表）也会被叫出来，那时没有坐标系统可言；
 * 悄悄把节点丢到原点的话，用户切到画布只会在角落里发现一个莫名其妙的节点。
 */
function pickPosition(ctx: CommandContext, occupied: { x: number; y: number }[]) {
  const center = ctx.bridge?.centerFlowPosition() ?? null;
  if (!center) {
    throw new Error('先打开一个项目，我才能帮你在画布上放节点');
  }

  let pos = { ...center };
  for (let i = 0; i < AVOID_TRIES; i++) {
    const clash = occupied.some(
      (p) => Math.abs(p.x - pos.x) < AVOID_RADIUS && Math.abs(p.y - pos.y) < AVOID_RADIUS
    );
    if (!clash) return pos;
    pos = { x: pos.x + AVOID_STEP, y: pos.y + AVOID_STEP };
  }
  return pos;
}

export const createNodeCommand: CommandHandler = (args, ctx) => {
  const canvas = useCanvasStore.getState();

  // projectId / isLoading 两处都会让 addNode 静默不干活（见 canvasStore.addNode 的早退），
  // 所以必须先拦下来——否则就是「助手说建好了，画布上什么都没有」
  if (!canvas.projectId) {
    throw new Error('先打开一个项目，我才能帮你在画布上放节点');
  }
  if (canvas.isLoading) {
    throw new Error('画布还在加载，稍等一下再让我建');
  }

  const rawType = argString(args, 'nodeType');
  if (!ASSISTANT_NODE_TYPES.includes(rawType as NodeType)) {
    throw new Error(`我暂时还不能创建「${rawType || '这种'}」节点`);
  }
  const nodeType = rawType as NodeType;

  const label = argString(args, 'label');
  const prompt = argString(args, 'prompt');

  const data: Record<string, unknown> = {};
  if (label) data.label = label;
  if (prompt && PROMPT_CAPABLE.includes(nodeType)) data.prompt = prompt;

  const position = pickPosition(ctx, canvas.nodes.map((n) => n.position));
  const node = createNode(nodeType, position, { data: data as never });

  canvas.addNode(node);
  // addNode 本身不选中；选中后会顺带弹出提示词面板，用户接着就能直接生成
  canvas.onNodesChange([{ type: 'select', id: node.id, selected: true }]);
  ctx.bridge?.focusNode(node.id);

  // 回读确认：addNode 在极端情况下仍可能什么都没做，
  // 与其告诉用户「建好了」而画布没变，不如如实报错
  const landed = useCanvasStore.getState().nodes.some((n) => n.id === node.id);
  if (!landed) {
    throw new Error('节点没能加到画布上，再试一次看看');
  }

  return { note: `已新建「${label || NODE_LABELS[nodeType] || nodeType}」节点`, mutated: true };
};
