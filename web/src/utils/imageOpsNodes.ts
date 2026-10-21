import { createNode, DEFAULT_STYLE } from './nodeFactory';
import { buildGroupFromSelection } from './canvasGroups';
import { useCanvasStore } from '@/stores/canvasStore';
import type {
  AudioNodeData,
  ImageNodeData,
  LibTVEdge,
  LibTVNode,
  NodeType,
  VideoNodeData,
  VideoReshootState,
} from '@/types/canvas';
import { reshootNodeData } from './reshootPrompt';
import { frameLabel, uniqueFrameLabel } from './frameCapture';
import type { MentionMarker } from '@/types/prompt';
import type { OpsTile } from '@/services/imageOpsApi';

/**
 * 画布上的"图片派生"：切分出来的多张图、以及以某张图为参考新生成一张图。
 *
 * 两条必须守住的约定（都是踩过才知道的）：
 * 1. **一次 addNodesAndEdges = 一条历史**（canvasStore 里一个 set 调一次 saveHistory）。
 *    所以切 16 格必须**一次**把 16 个节点 + 边交进去，用户按一次 ⌘Z 才能整体回退，
 *    而不是撤 16 次（canvasStore 里"文本→分镜要占 3 条历史"那段注释就是为这个痛点写的）。
 * 2. **参考图必须同时有 mentions 和边**：后端执行器按 `[[m:<mention.id>]]` 占位符过滤 mentions
 *    （executor.go 里 marker 用的是 mention.id 而不是 nodeId），再去**执行上下文**里按 nodeId
 *    取参考图——没有边，上游节点就不在上下文里，参考图会被静默丢掉，等于图生图失效。
 */

/** 多格派生（切宫格）时每个新节点的横向间距（这一路的产物固定是 320 宽的图片节点） */
const DERIVED_GAP_X = 360;
const DERIVED_ROW_H = 300;

/** 音视频分离时，音频节点摆在无声视频下方多少像素（视频节点本身就高，留够间距） */
const DEMUX_ROW_H = 340;

/**
 * 单个派生节点时，叠在源节点宽度之后的横向留白（和 utils/enhanceNode.ts 的 80 保持一致）。
 *
 * 为什么不再用固定的 DERIVED_GAP_X：那个 360 是按"源节点宽 320"算的，
 * 而视频/白模/增强节点都是 **480** 宽 —— 「片段重拍」出来的视频节点因此和源节点**重叠 120px**
 * （线上反馈："新节点的位置最好再往右一点，要不然和当前节点重叠"）。
 * 现在按源节点真实宽度算，谁宽谁窄都不会叠。
 */
const DERIVED_GAP_PADDING = 80;

/** 源节点实际占多宽：先用节点自己的尺寸（用户拉过就以拉过的为准），再用类型默认值，最后兜底 320 */
function nodeWidth(node: LibTVNode): number {
  const n = node as { width?: unknown; style?: { width?: unknown } };
  const own = n.width ?? n.style?.width;
  const parsed = typeof own === 'number' ? own : typeof own === 'string' ? parseFloat(own) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  const fallback = DEFAULT_STYLE[node.type as NodeType]?.width;
  return typeof fallback === 'number' ? fallback : 320;
}

/** 新节点摆在源节点右侧、且**一定不重叠**的横坐标 */
function derivedX(source: LibTVNode): number {
  return absolutePosition(source).x + nodeWidth(source) + DERIVED_GAP_PADDING;
}

/**
 * 取节点绝对坐标：在组合里时 position 是相对组合的，直接拿来定位会把新节点画错地方。
 * 只向上累加 parentId 链的坐标，不做组合边框修正（新节点一律放组合外，不需要贴合）。
 */
function absolutePosition(node: LibTVNode): { x: number; y: number } {
  const nodes = useCanvasStore.getState().nodes;
  let x = node.position.x;
  let y = node.position.y;
  let parentId = (node as { parentId?: string }).parentId;
  const guard = new Set<string>();
  while (parentId && !guard.has(parentId)) {
    guard.add(parentId);
    const parent = nodes.find((n) => n.id === parentId);
    if (!parent) break;
    x += parent.position.x;
    y += parent.position.y;
    parentId = (parent as { parentId?: string }).parentId;
  }
  return { x, y };
}

/** 源节点是否已带有资产生命周期标记（切分产物要继承，便于资产/分镜体系继续认它） */
/**
 * 派生节点要继承的"归属"字段。
 *
 * 刻意只声明这两项、而不是整个 Partial<ImageNodeData>：那样会连 `type: 'image'` 一起带进来，
 * 贴到视频/音频节点的数据上就会撞类型（派生不出非图片节点）。归属项对所有类型都成立。
 */
type InheritedAssetFields = {
  assetType?: ImageNodeData['assetType'];
  scriptNodeId?: ImageNodeData['scriptNodeId'];
};

function inheritedAssetFields(source: LibTVNode): InheritedAssetFields {
  const d = source.data as ImageNodeData;
  const inherited: InheritedAssetFields = {};
  if (d.assetType) inherited.assetType = d.assetType;
  if (d.scriptNodeId) inherited.scriptNodeId = d.scriptNodeId;
  return inherited;
}

/**
 * 切分产物 → 一批图片节点。
 *
 * 排布刻意**照抄宫格的行列**：2×3 六视图切出来的 6 张，在画布上也按 2 行 3 列摆，
 * 用户一眼能对上"哪张是哪格"。整体放在源节点右侧，避免盖住源图。
 */
export function createSplitNodes(
  source: LibTVNode,
  tiles: OpsTile[],
  rows: number,
  cols: number,
  /** 标签后缀：高清版传"高清"，让画布上一眼分得清哪张是放大过的 */
  labelSuffix = '',
): { nodes: LibTVNode[]; edges: LibTVEdge[] } {
  const origin = absolutePosition(source);
  const baseX = origin.x + 360;
  const baseY = origin.y;

  const nodes = tiles.map((tile, i) => {
    // 有格号就按格号摆：只切了部分格子时，新节点会落在与原图一致的位置上
    // （选右上角那格 → 新节点就在右上角），而不是挤成一排
    const r = tile.cell_row ?? Math.floor(i / cols);
    const c = tile.cell_col ?? i % cols;
    return createNode(
      'image',
      { x: baseX + c * DERIVED_GAP_X, y: baseY + r * DERIVED_ROW_H },
      {
        data: {
          ...inheritedAssetFields(source),
          label: `${source.data.label || '图片'}-${(tile.cell_index ?? i) + 1}${labelSuffix}`,
          prompt: (source.data as ImageNodeData).prompt || '',
          model: (source.data as ImageNodeData).model || '',
          resolution: (source.data as ImageNodeData).resolution || '2K',
          imageUrl: tile.url,
          thumbUrl: tile.thumb_url || undefined,
          width: tile.width,
          height: tile.height,
          status: 'idle',
          derivedFrom: { nodeId: source.id, index: (tile.cell_index ?? i) + 1 },
        } as Partial<ImageNodeData>,
      },
    );
  });

  // 切分产物之间没有数据流依赖（各自都是独立素材），所以不建边
  void rows;
  return { nodes, edges: [] };
}

/**
 * 视频截帧产物 → 一个图片节点（摆在视频节点右侧，与切分产物同一套排布约定）。
 *
 * 为什么做成图片节点而不是"直接下载"：首/尾帧最常见的用途就是接着做图生视频，
 * 落地成节点才能直接连线；要下载的话它的工具条上本来就有下载。
 *
 * implicitRef 不设：截出来的帧是**独立素材**（画面），不是"以视频为参考去生成"，
 * 所以不建边、不占 mentions —— 建了反而会让后端把视频当成参考图塞进生成上下文。
 */
export function createVideoFrameNode(
  source: LibTVNode,
  tile: OpsTile,
  mode: 'first' | 'last' | 'at',
  opts?: { time?: number },
): LibTVNode {
  const origin = absolutePosition(source);
  // 名字：首帧/尾帧用固定词，at（指定时刻）带时间码，重名自动加序号 ——
  // 弹窗里可以连着截好几张，都叫「当前帧」的话画布上分不清谁是谁。
  // opts.time 只用于命名，取哪一帧由后端按 mode 决定。
  const label = uniqueFrameLabel(
    frameLabel(source.data.label || '视频', mode, opts?.time ?? 0),
    useCanvasStore.getState().nodes.map((n) => n.data.label || ''),
  );
  return createNode(
    'image',
    { x: derivedX(source), y: origin.y },
    {
      data: {
        ...inheritedAssetFields(source),
        label,
        imageUrl: tile.url,
        thumbUrl: tile.thumb_url || undefined,
        width: tile.width,
        height: tile.height,
        status: 'idle',
      } as Partial<ImageNodeData>,
    },
  );
}

/**
 * 「音视频分离」→ 两个新节点：**无声视频**（源节点右侧）+ **音频**（无声视频下方）。
 *
 * 为什么产出两个节点、而不是就地改造源节点：
 * 源片往往是用户的素材或上一轮产物，分离是"多要两份东西"，不是"把原来的改掉"——
 * 和「片段重拍」「截取画面」一样，派生出去、源节点不动，用户不满意直接删掉新节点即可。
 *
 * 为什么不连边：这两个是**素材**，不是"参考上游"。连了边会让源视频自动变成它们的上游参考，
 * 于是用户在无声视频节点里随手生成一版，就会把整条源视频当 reference_video 送上去
 * （撞参考视频时长限制，还按参考时长计费）。要用哪份素材，用户在提示词里 @ 一下更明确。
 *
 * **自动打成一个组合**：这两份东西本来就是一体（同一个源、同一条时间轴），散在画布上既占地方
 * 又容易只拖走一个。组合只是容器 —— 拖框两个一起走、删框两个一起删，想分开随时「取消组合」。
 * 组合框的尺寸先按节点默认尺寸估算，等 React Flow 量出真实尺寸后由 store 的 normalizeGroups
 * 自动贴合（store 里对 dimensions 回显专门做了这一手），所以这里不用猜节点渲染高度。
 *
 * ⚠️ `demux` 传 **null** 就是"占位"用法：先把两个节点建出来给用户看见（`status: 'running'` +
 * progressMessage，节点上显示"音视频分离中…"），等服务端返回了再用 demuxFillPatch 填进去。
 * 分离要下载整条源片（冷启动 30 秒级），先建节点再干活，用户至少知道点下去有反应。
 */
export type DemuxPayload = {
  silentVideoUrl: string;
  audioUrl: string;
  duration?: number;
  width?: number;
  height?: number;
};

/** 分离过程中节点上显示的话（占位态与填充态共用一处，免得两处文案飘） */
export const DEMUX_BUSY_TEXT = '音视频分离中…';

/**
 * 分离成功后要写回两个节点的字段。占位节点是 createDemuxNodes(source, null) 建的，
 * 拿这份补丁 updateNodeData 一下就从"分离中"变成真正的产物。
 */
export function demuxFillPatch(demux: DemuxPayload): {
  video: Partial<VideoNodeData>;
  audio: Partial<AudioNodeData>;
} {
  return {
    video: {
      videoUrl: demux.silentVideoUrl,
      videoWidth: demux.width,
      videoHeight: demux.height,
      status: 'idle',
      progressMessage: undefined,
    },
    audio: {
      audioUrl: demux.audioUrl,
      duration: demux.duration,
      status: 'idle',
      progressMessage: undefined,
    },
  };
}

export function createDemuxNodes(
  source: LibTVNode,
  demux: DemuxPayload | null,
): { nodes: LibTVNode[]; edges: LibTVEdge[] } {
  const origin = absolutePosition(source);
  const src = source.data as VideoNodeData;
  const base = src.label || '视频';
  const x = derivedX(source);

  const silentData: Partial<VideoNodeData> = {
    ...inheritedAssetFields(source),
    label: `${base}·无声`,
    prompt: '',
    // 占位态（demux === null）先不给地址：节点上显示"分离中"，拿到结果再补
    videoUrl: demux?.silentVideoUrl,
    videoWidth: demux?.width,
    videoHeight: demux?.height,
    model: src.model || '',
    duration: src.duration,
    fps: src.fps,
    resolution: src.resolution,
    aspectRatio: src.aspectRatio,
    // 这个节点的定义就是"没有声音的版本"：再生成时不要自作主张把音轨加回来
    generateAudio: false,
    status: demux ? 'idle' : 'running',
    progressMessage: demux ? undefined : DEMUX_BUSY_TEXT,
    derivedFrom: { nodeId: source.id, index: 0 },
  };
  const silent = createNode('video', { x, y: origin.y }, { data: silentData });

  const audioData: Partial<AudioNodeData> = {
    ...inheritedAssetFields(source),
    label: `${base}·音频`,
    audioUrl: demux?.audioUrl,
    audioName: `${base}·音频`,
    // 音频和源片等长（分离不改变时间轴）；占位时先按源片时长显示，结果回来再改准
    duration: demux?.duration ?? src.duration ?? 0,
    status: demux ? 'idle' : 'running',
    progressMessage: demux ? undefined : DEMUX_BUSY_TEXT,
    derivedFrom: { nodeId: source.id, index: 1 },
  };
  const audio = createNode('audio', { x, y: origin.y + DEMUX_ROW_H }, { data: audioData });

  // 打组合：组合节点必须排在成员**前面**（React Flow 按数组顺序建父子索引，
  // 父节点排在子节点后面时子节点算不出绝对坐标，表现是"拖框只有框动、成员不动"）。
  const built = buildGroupFromSelection([silent, audio], [silent, audio]);
  if (!built) return { nodes: [silent, audio], edges: [] };

  built.group.data = { ...built.group.data, label: `${base}·分离` };
  // 组合本身不选中：调用方选中无声视频节点，用户多半从画面接着加工
  built.group.selected = false;

  return { nodes: [built.group, ...built.members], edges: [] };
}

/**
 * 「片段重拍」→ 一个新的视频节点：引用源视频 + 提示词里带区间，摆在源节点右侧。
 *
 * 为什么引用用**真实 mention + 边**，而不是只写死一句话：
 * 后端按 prompt 里的 `[[m:<mention.id>]]` 占位符过滤 mentions，再按 nodeId 从执行上下文
 * 取上游素材 —— 没有边，源视频就不在上下文里，引用会被静默丢掉（同文件头第 1 条坑）。
 * 所以三样必须同时给：占位符写进 prompt、mentions 带上、边建好。
 *
 * videoMode 给 'video-ref'（视频参考）而不是默认的文生视频：这条节点要的是"照着这段视频重拍"。
 */
export function createReshootVideoNode(
  source: LibTVNode,
  range: { start: number; end: number; durationSeconds?: number },
): { node: LibTVNode; edge: LibTVEdge; mention: MentionMarker } {
  const origin = absolutePosition(source);
  const src = source.data as VideoNodeData;

  // mention.id 只需在 prompt 内唯一：用源节点 id 派生，同一画布多次重拍不会撞车
  const mention: MentionMarker = {
    id: `mk-${source.id}-${Math.random().toString(36).slice(2, 7)}`,
    nodeId: source.id,
    label: src.label || '视频',
    nodeType: 'video',
  };

  const state: VideoReshootState = {
    sourceNodeId: source.id,
    sourceUrl: src.videoUrl,
    start: range.start,
    end: range.end,
    ...(typeof range.durationSeconds === 'number' && range.durationSeconds > 0
      ? { durationSeconds: range.durationSeconds }
      : {}),
  };

  const node = createNode('video', { x: derivedX(source), y: origin.y }, {
    data: {
      ...inheritedAssetFields(source),
      ...reshootNodeData(src.label, `[[m:${mention.id}]]`, state, src),
      mentions: [mention],
      derivedFrom: { nodeId: source.id, index: 0 },
    } as Partial<VideoNodeData>,
  });

  const edge: LibTVEdge = {
    id: `e-${source.id}-${node.id}`,
    source: source.id,
    target: node.id,
    type: 'dataFlow',
  };

  return { node, edge, mention };
}

/**
 * 以某张图为参考，新建一个待生成的图片节点（用于"生成三视图"和"4K 重生成"）。
 *
 * 返回的 prompt 里已经内嵌 `[[m:<mention.id>]]` 占位符——PromptEditor 会把它渲染成 @标签，
 * 后端也靠它把 mentions 与 prompt 对齐，缺了占位符引用会被丢掉。
 */
export function createReferenceImageNode(
  source: LibTVNode,
  opts: {
    promptTemplate: string;
    label: string;
    resolution?: string;
    aspectRatio?: string;
    /** 视图模板类型：写在节点上，切分宫格时据此自动预选行列 */
    viewKind?: string;
  },
): { node: LibTVNode; edge: LibTVEdge; mention: MentionMarker } {
  const origin = absolutePosition(source);

  // mention.id 需要在 prompt 内唯一即可，用源节点 id 派生，避免同一画布多次生成时撞车
  const mention: MentionMarker = {
    id: `mk-${source.id}-${Math.random().toString(36).slice(2, 7)}`,
    nodeId: source.id,
    label: source.data.label || '参考图',
    nodeType: 'image',
  };

  const prompt = opts.promptTemplate.replace('{{REF}}', `[[m:${mention.id}]]`);

  const node = createNode(
    'image',
    { x: origin.x + 360, y: origin.y },
    {
      data: {
        label: opts.label,
        prompt,
        mentions: [mention],
        model: (source.data as ImageNodeData).model || '',
        resolution: opts.resolution || '4K',
        aspectRatio: opts.aspectRatio || '1:1',
        quality: (source.data as ImageNodeData).quality || '高画质',
        ...(opts.viewKind ? { viewKind: opts.viewKind } : {}),
        status: 'idle',
        derivedFrom: { nodeId: source.id, index: 0 },
      } as Partial<ImageNodeData>,
    },
  );

  const edge: LibTVEdge = {
    id: `e-${source.id}-${node.id}`,
    source: source.id,
    target: node.id,
    type: 'dataFlow',
  };

  return { node, edge, mention };
}

/** 把派生节点与边一次性写进画布（= 一条历史，一次 ⌘Z 全撤） */
export function commitDerivedNodes(nodes: LibTVNode[], edges: LibTVEdge[]): void {
  if (nodes.length === 0 && edges.length === 0) return;
  useCanvasStore.getState().addNodesAndEdges(nodes, edges);
}

/** 替换某个节点的图片（走 store，所以 ⌘Z 能撤销） */
export function replaceNodeImage(
  nodeId: string,
  tile: { url: string; thumb_url?: string; width: number; height: number },
): void {
  useCanvasStore.getState().updateNodeData(nodeId, {
    imageUrl: tile.url,
    thumbUrl: tile.thumb_url || undefined,
    width: tile.width,
    height: tile.height,
  } as Partial<ImageNodeData>);
}