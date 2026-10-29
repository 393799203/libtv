import { useCanvasStore } from '@/stores/canvasStore';
import { NODE_TYPE_CONFIG } from '@/types/canvas';
import { argString, type CommandHandler } from './types';

/**
 * update_node：修改已有节点的参数。
 *
 * 这里刻意做**按类型白名单**：字段名是照着 types/canvas.ts 的实际定义写的，不是凭想象。
 * 例如 previz / enhance 的数据结构里根本没有 prompt 字段，
 * 若不做这一层，用户说「把白模节点的提示词改成 X」会得到一句「改好了」，
 * 而实际上那个字段写进去也没人读——比直接说「这类节点改不了」糟糕得多。
 */
const EDITABLE_FIELDS: Record<string, string[]> = {
  text: ['label', 'prompt', 'content', 'model'],
  image: ['label', 'prompt', 'model'],
  video: ['label', 'prompt', 'model'],
  audio: ['label', 'prompt', 'model'],
  script: ['label', 'prompt', 'model'],
  previz: ['label'],
  enhance: ['label'],
  group: ['label'],
};

const FIELD_LABELS: Record<string, string> = {
  label: '标题',
  prompt: '提示词',
  content: '内容',
  model: '模型',
};

/** 参与更新的字段顺序（固定，让提示与结果稳定可预期） */
const FIELDS = ['label', 'prompt', 'content', 'model'];

export const updateNodeCommand: CommandHandler = (args) => {
  const canvas = useCanvasStore.getState();

  if (!canvas.projectId) {
    throw new Error('先打开一个项目，我才能改画布上的东西');
  }

  const nodeId = argString(args, 'nodeId');
  const node = canvas.nodes.find((n) => n.id === nodeId);
  if (!node) {
    throw new Error(`画布上找不到 ${nodeId}，确认一下是哪个节点？`);
  }

  const allowed = EDITABLE_FIELDS[node.type] ?? ['label'];
  const patch: Record<string, unknown> = {};
  const applied: { key: string; label: string }[] = [];
  const ignored: string[] = [];

  for (const key of FIELDS) {
    const value = argString(args, key);
    if (!value) continue;
    if (!allowed.includes(key)) {
      ignored.push(FIELD_LABELS[key]);
      continue;
    }
    patch[key] = value;
    applied.push({ key, label: FIELD_LABELS[key] });
  }

  const typeName = NODE_TYPE_CONFIG[node.type]?.label ?? node.type;

  if (applied.length === 0) {
    if (ignored.length > 0) {
      throw new Error(`${typeName}节点没有${ignored.join('、')}可以改`);
    }
    throw new Error('没说要改什么，你想改哪个字段？');
  }

  canvas.updateNodeData(nodeId, patch as never);

  // 回读确认：updateNodeData 在 projectId/isLoading 异常时也是静默早退的，
  // 不确认就回「改好了」属于欺骗用户
  const after = useCanvasStore.getState().nodes.find((n) => n.id === nodeId)?.data as
    | Record<string, unknown>
    | undefined;
  const missed = applied.filter((a) => after?.[a.key] !== patch[a.key]);
  if (missed.length === applied.length) {
    throw new Error('改动没生效，再试一次看看');
  }

  const name = (node.data as { label?: string })?.label;
  let note = `已更新${name ? `「${name}」` : `一个${typeName}节点`}的${applied
    .map((a) => a.label)
    .join('、')}`;
  if (ignored.length > 0) {
    note += `（${typeName}节点没有${ignored.join('、')}，已跳过）`;
  }

  return { note, mutated: true };
};
