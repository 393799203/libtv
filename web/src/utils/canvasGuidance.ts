import type { LibTVNode } from '../types/canvas';

export interface CanvasGuidance {
  title: string;
  description: string;
  actions: { label: string; prompt: string }[];
}

/** Local suggestions follow canvas state without sending requests on selection. */
export function getCanvasGuidance(nodes: LibTVNode[], selectedIds: string[]): CanvasGuidance {
  const selected = new Set(selectedIds);
  const targets = nodes.filter(n => n.type !== 'group' && (selected.has(n.id) || selected.has(n.parentId)));
  if (!targets.length) {
    return nodes.length ? {
      title: '选中内容，接着往下创作',
      description: '选中故事、分镜或图片，我会给出对应的下一步，也可以帮你梳理整个项目。',
      actions: [{ label: '看看项目下一步', prompt: '结合当前画布的内容、连线和生成状态，告诉我接下来最值得做的一步。只给建议，不修改节点或生成。' }],
    } : {
      title: '从一个想法开始',
      description: '先聊清楚你想做的作品，再一起搭建故事、分镜和画面。',
      actions: [
        { label: '我下一步该做什么？', prompt: '我下一步该做什么？请先帮我明确创作方向，不要创建节点或生成。' },
        { label: '聊聊我的想法', prompt: '我想开始创作一个短片。先问我一个最关键的问题，帮我确定方向，暂时不要创建节点或生成。' },
      ],
    };
  }
  if (targets.some(n => n.data.status === 'running' || n.data.status === 'pending')) {
    return {
      title: '正在生成，可以先准备后续',
      description: '当前任务会继续运行。我们可以趁这段时间想好后面的镜头和素材。',
      actions: [{ label: '规划后续步骤', prompt: '结合选中节点的输入和正在生成的内容，建议生成完成后该做什么。只给建议，不重复生成。' }],
    };
  }
  if (targets.some(n => n.data.status === 'failed')) {
    return {
      title: '先解决当前的生成问题',
      description: '我可以结合节点报错和输入，帮你找出缺少的素材或需要调整的参数。',
      actions: [{ label: '帮我看看失败原因', prompt: '检查选中节点的错误和输入，解释失败原因并给出可操作的修复建议。先不要修改或重新生成。' }],
    };
  }
  if (targets.length > 1) {
    return {
      title: `一起处理选中的 ${targets.length} 个节点`,
      description: '可以把这些内容串成创作流程，或先检查它们之间的输入关系。',
      actions: [
        { label: '串成创作流程', prompt: '根据当前选中节点的内容，建立合理的连线和输入引用，复用已有节点，不重复创建、不发起生成。' },
        { label: '检查输入关系', prompt: '检查选中节点的连线、引用和素材是否准备完整，告诉我下一步该补什么。只给建议，不修改或生成。' },
      ],
    };
  }
  const node = targets[0];
  const d = node.data;
  const name = String(d.label || '当前节点');
  if (node.type === 'text') {
    return d.content ? {
      title: '故事有了，接下来拆成分镜',
      description: `已选中「${name}」。可以把故事拆成镜头，再逐镜准备画面。`,
      actions: [{ label: '根据故事创建分镜', prompt: '根据选中的故事文本创建分镜节点，连接并引用这段故事，填写具体的拆分要求。先创建节点，不发起生成。' }],
    } : {
      title: '先把故事方向确定下来',
      description: `已选中「${name}」。写清主角、目标和冲突，会更容易推进后面的创作。`,
      actions: [{ label: '帮我完善故事方向', prompt: '帮我完善选中文本节点的故事方向。结合已有提示词，缺少信息时先问我一个关键问题，不要发起生成。' }],
    };
  }
  if (node.type === 'script') {
    const shots = Array.isArray(d.shots) ? d.shots : [];
    const ready = shots.length > 0 && shots.every(shot => nodes.some(n =>
      n.type === 'image' && n.data.scriptNodeId === node.id && n.data.shotId === shot.id && n.data.imageUrl));
    return shots.length ? {
      title: ready ? '镜头画面已准备好，可以做视频了' : '接着给分镜准备画面',
      description: `「${name}」有 ${shots.length} 个镜头。${ready ? '可以继续填写动作和运镜。' : '先把首帧和角色参考素材准备好。'}`,
      actions: ready
        ? [{ label: '创建视频镜头', prompt: '根据选中的分镜和已生成的镜头图片，创建对应视频节点并引用正确的画面，填写动作与运镜提示词。先创建节点，不生成。' }]
        : [
          { label: '给分镜补首帧', prompt: '根据选中分镜中尚未准备画面的镜头创建首帧图片节点，保留镜头归属并引用已准备好的角色、场景素材。先创建节点，不生成，超过12个则分批处理。' },
          { label: '检查角色和场景素材', prompt: '检查选中分镜的角色、场景和道具素材是否准备完整，告诉我先补什么。只给建议，不修改或生成。' },
        ],
    } : {
      title: '先把故事拆成镜头',
      description: `「${name}」还没有分镜内容，可以先检查故事输入并准备拆分。`,
      actions: [{ label: '准备生成分镜', prompt: '检查选中分镜节点的故事输入，补齐拆分要求和输入引用；输入已准备好时展示分镜生成任务，缺少故事时先说明该补什么。' }],
    };
  }
  if (node.type === 'image') {
    return d.imageUrl ? {
      title: '让这张画面动起来',
      description: `「${name}」已有图片，可以接着设计动作和运镜，做成视频镜头。`,
      actions: [{ label: '用这张图做视频', prompt: '用选中的图片作为参考，创建视频节点并建立引用，写出合适的动作与运镜提示词，准备生成任务。' }],
    } : {
      title: d.prompt ? '把这幅画面生成出来' : '先写清楚想要的画面',
      description: `已选中「${name}」。${d.prompt ? '可以沿用当前提示词和参考素材。' : '我可以结合故事和上游素材，帮你完善画面描述。'}`,
      actions: d.prompt
        ? [{ label: '准备生成图片', prompt: '使用选中图片节点现有的提示词和参考素材，准备生成任务，不新建重复节点。' }]
        : [{ label: '帮我写画面提示词', prompt: '结合选中图片节点及其上游内容，完善画面提示词；缺少主题时先问我一个关键问题，不要发起生成。' }],
    };
  }
  return {
    title: `继续完善「${name}」`,
    description: '我会结合这个节点的输入和当前进度，帮你判断接下来该做什么。',
    actions: [{ label: '帮我看看下一步', prompt: '结合选中节点的内容、输入和状态，建议接下来的一步。只给建议，不修改节点或生成。' }],
  };
}
