import type { NodeType, LibTVNodeData, LibTVNode } from '@/types/canvas';
import type { XYPosition } from '@xyflow/react';

// 各类型节点的默认尺寸
const DEFAULT_STYLE: Record<NodeType, React.CSSProperties> = {
  text: { width: 320, height: 300, minWidth: 320, minHeight: 200 },
  image: { width: 320, minWidth: 320, minHeight: 190 },
  video: { width: 480 },
  audio: { width: 320 },
  script: { width: 320, minWidth: 320 },
  previz: { width: 480, minWidth: 480 },  // 与视频节点同宽（同为媒体类节点）
  enhance: { width: 480, minWidth: 480 }, // 与视频节点同宽（同为媒体类节点）
  group: { width: 420, height: 320 },     // 组合容器只是占位默认值：成组时按成员包围盒覆盖
};

/**
 * 节点 id 生成器 —— 所有「新造一个节点」的路径都走 createNode，由它调用这里。
 *
 * 只做一件事：**给出一个唯一 id**。格式统一为 `<类型首字母>-` + 12 位随机串（t/i/v/a/s/p/e），
 * 不带时间/序号等结构。前缀只是给人看的提示，**没有任何代码读它**：节点种类看
 * `node.type` / `data.type`，语义（风格图、资产归属、分镜槽位…）看 data 字段，
 * 见 types/canvas.ts 的 BaseNodeFields 注释。
 *
 * 历史教训（为什么不再往 id 里塞信息）：默认 id 曾是 `${type}-${Date.now()}`，
 * **同一毫秒内建两个同类型节点会撞成同一个 id、两个节点被合并成一个**
 * （「图生图」场景 image→image 实测暴露，剧本→分镜因类型不同一直没被发现）；
 * 后来叠了会话短标识 + 自增序号勉强躲开，但那套结构再没人用得着。
 * 现在唯一性只靠随机量：12 位 base36 ≈ 62 bit 熵，同毫秒爆发、多标签页并发都不会撞。
 *
 * 老画布里的历史 id（`shot-image-shot-1-script-…`、`角色-南方-script-…`、`style-…`）原样保留：
 * 改 id 会切断 provider_tasks.node_id / charge_key 的历史扣费与对账关联。它们里面的语义
 * 已由 scripts/migrate-node-semantics.mjs 一次性搬到 data 上，运行期代码一律不解析 id
 * （后端同规则：只看 data.styleId / data.assetType）。
 */
const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** 12 位随机串（拒绝采样消掉取模偏置，保证每位均匀） */
function randomSuffix(len = 12): string {
  let out = '';
  const buf = new Uint8Array(16);
  while (out.length < len) {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(buf);
    else for (let i = 0; i < buf.length; i += 1) buf[i] = Math.floor(Math.random() * 256);
    for (const b of buf) {
      if (b >= 252) continue; // 252 = 36×7，丢弃溢出的字节
      out += ID_ALPHABET[b % ID_ALPHABET.length];
      if (out.length === len) break;
    }
  }
  return out;
}

export function newId(prefix: string): string {
  return `${prefix}-${randomSuffix()}`;
}

/**
 * 节点 id：`<类型首字母>-` + 12 位随机串 —— t/i/v/a/s/p/e/g
 * （text/image/video/audio/script/previz/enhance/group）。
 *
 * 首字母只是给人一眼看出节点种类的提示，**不是语义来源**：代码要判断类型就读
 * `node.type` / `data.type`，不得依赖这个前缀（改名/改名类型的代码都不得靠它）。
 * 真语义（风格图、资产归属、分镜槽位…）一律在 data 字段上。
 */
export function newNodeId(nodeType: NodeType): string {
  return newId(nodeType.charAt(0));
}

/**
 * 统一创建节点工厂 — 所有节点只走这一套逻辑
 *
 * id 不接受覆盖：节点 id 只能由 newNodeId() 产出，这样「线上新建的节点 id 一定同格式」
 * 是可保证的（过去留过 id 覆盖口，等于允许各处自己拼 id）。
 * @param nodeType 节点类型
 * @param position 画布位置
 * @param overrides 可选覆盖（data / style）
 */
export function createNode(
  nodeType: NodeType,
  position: XYPosition,
  overrides?: {
    data?: Partial<LibTVNodeData>;
    style?: React.CSSProperties;
  },
): LibTVNode {
  return {
    id: newNodeId(nodeType),
    type: nodeType,
    position,
    data: {
      ...createDefaultNodeData(nodeType),
      ...overrides?.data,
    } as LibTVNodeData,
    style: {
      ...DEFAULT_STYLE[nodeType],
      ...overrides?.style,
    },
  };
}

// 创建节点默认数据
export function createDefaultNodeData(nodeType: NodeType): LibTVNodeData {
  const baseData = {
    status: 'idle' as const,
    error: undefined,
  };

  switch (nodeType) {
    case 'text':
      return {
        ...baseData,
        type: 'text',
        // 默认名就叫「文本」：这是文本节点，不该顶着「剧本」这种内容名 ——
        // 剧本是这类节点可能承载的内容之一，名字该由用户自己起。
        label: '文本',
        content: '',
        prompt: '',
        model: '',
      };
    case 'image':
      return {
        ...baseData,
        type: 'image',
        label: '图片',
        prompt: '',
        negativePrompt: '',
        model: '',
        resolution: '2K',
        aspectRatio: '16:9',
        quality: '标准画质',
        // width和height不设置默认值，让系统从resolution和aspectRatio计算
        imageUrl: undefined,
      };
    case 'video':
      return {
        ...baseData,
        type: 'video',
        label: '视频',
        prompt: '',
        model: '',
        duration: 5,
        fps: 24,
        resolution: '720p',
        aspectRatio: '16:9',
        videoUrl: undefined,
        generateAudio: true,  // 默认开启声音生成
      };
    case 'audio':
      return {
        ...baseData,
        type: 'audio',
        label: '音频',
        prompt: '',
        text: '',
        voice: 'Cherry',
        speed: 1.0,
        model: '',
        duration: 0,
        audioUrl: undefined,
      };
    case 'script':
      return {
        ...baseData,
        type: 'script',
        label: '分镜',
        prompt: '',
        model: '',
        scriptContent: '',
        shots: [],
        characters: [],
        scenes: [],
        props: [],
        currentStep: 1,
        author: undefined,
        createdAt: new Date().toISOString(),
      };
    case 'previz':
      return {
        ...baseData,
        type: 'previz',
        label: '白模预演',
        scene: undefined,
        videoUrl: undefined,
        stillUrl: undefined,
      };
    case 'enhance':
      return {
        ...baseData,
        type: 'enhance',
        label: '清晰化',
        provider: 'ffmpeg',     // 默认本机档；云端档接入后这里可改为跟随后端默认渠道
        mode: 'hd',             // 默认档位（与 enhance.yaml 里标了 default 的档位一致）            // 默认「增强」：去块+降噪+锐化，并把短边不足 720p 的放大到 720p
        targetShortSide: 720,
        videoUrl: undefined,
        sourceUrl: undefined,
      };
    case 'group':
      // 组合容器：没有任何生成语义，只有一个名字（成员关系记在成员节点自己的 parentId 上）。
      // 真实的宽高在成组时按成员包围盒算好覆盖掉这里的默认值。
      return {
        ...baseData,
        type: 'group',
        label: '组合',
      };
  }
}
