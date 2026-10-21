import { useStore } from '@xyflow/react';
import { memo, useCallback, useEffect, useState } from 'react';
import {
  CameraOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  AudioOutlined,
  FolderAddOutlined,
  HistoryOutlined,
  LoadingOutlined,
  PictureOutlined,
  ScissorOutlined,
  ThunderboltOutlined,
  UngroupOutlined,
} from '@ant-design/icons';
import { useCanvasStore } from '@/stores/canvasStore';
import { imageOpsApi } from '@/services/imageOpsApi';
import {
  commitDerivedNodes,
  createDemuxNodes,
  createReshootVideoNode,
  demuxFillPatch,
} from '@/utils/imageOpsNodes';
import {
  applyRangeToPrompt,
  clampRange,
  initialReshootState,
  probeVideoDuration,
} from '@/utils/reshootPrompt';
import { defaultViewKindForAsset, VIEW_PRESETS } from '@/utils/imageViewPrompts';
import { message } from '@/utils/antdApp';
import { ops, useOpsState, type OpsMode } from './imageops/opsStore';
import { BarDivider, BAR_SURFACE, CloseConfigButton, IconActionButton, ToolButton } from './imageops/atoms';
import { SplitConfig } from './imageops/SplitConfig';
import { ElementEditConfig } from './imageops/ElementEditConfig';
import { QualityConfig } from './imageops/QualityConfig';
import { ViewConfig } from './imageops/ViewConfig';
import { Z } from '@/utils/zLayers';
import {
  actionAvailability,
  mediaInfoOf,
  showsFrameTool,
  toolbarVisibility,
  type NodeLite,
} from './nodeToolbarRules';
import { useMediaNodeActions } from './useMediaNodeActions';
import { copyNodeToClipboard, deleteNodesByIds } from './nodeActions';
import { useNodeActionStore } from './nodeActionStore';

/**
 * 节点工具条 —— **所有节点类型通用**（用户要求"每个节点都用工具栏这种形式"）。
 *
 * 定位方式：横条长在节点自己的 DOM 里（`absolute bottom-full`，父级是 `.react-flow__node`），
 * 因此它处在画布视口 transform 之内 —— 平移/缩放画布时由浏览器保证与节点**同帧**移动，
 * 不需要任何测量。挂载点必须是 BaseNode 的**兄弟**（见各节点组件）：节点内容区是
 * overflow-hidden 的，放里面会被裁掉。
 *
 * 一个横条两种状态，**位置、高度、底色、圆角完全一致**：
 * - 动作条：类型相关的工具（只有图片节点有）+ 分隔线 + 节点级动作图标；
 * - 配置条：点某个图片工具后，配置**原地替换**动作条内容，最前面是 X。
 *
 * 出现/消失跟"唯一选中"走，不做 hover 唤出 —— 同一件事只有一套状态，用户不用学两种
 * 唤出方式，也不会"鼠标一抖工具栏就没了"。**例外**：图片工具的配置条钉在正在编辑的
 * 那个节点上（中途点到别处也不会跑掉），此时别的节点的动作条照常出现。
 *
 * 尺寸用 `scale(1/zoom)` 抵消画布缩放，屏幕尺寸恒定；`marginBottom` 也除 zoom，
 * 否则"贴节点 8px"会跟着变成 8×zoom。
 *
 * **不做水平夹取**：横条永远以节点中心对齐。贴到画布边缘时被 `.react-flow` 的 overflow
 * 裁掉，是可接受的代价（试过夹取，实际是条会提前离开边缘、规则还不可预期）。
 */

const BAR_HEIGHT = 36;
const BAR_MARGIN = 8;

/** 图片节点特有的四个图片工具（其它节点类型没有这些工具，只显示动作组） */
const IMAGE_TOOLS: { mode: Exclude<OpsMode, null>; label: string; icon: React.ReactNode; hint: string }[] = [
  { mode: 'split', label: '切分宫格', icon: <ScissorOutlined />, hint: '把九宫格/四宫格图切成单张，分割线直接在图上拖' },
  { mode: 'quality', label: '画质提升', icon: <ThunderboltOutlined />, hint: '尺寸放大（本机免费）/ 4K 重生成' },
  // 原来这里是「标记擦除」（涂抹后模糊/打码），已换成元素编辑：涂抹只能把一块区域糊掉，
  // 用户真正需要的是"把这里换成别的" —— 圈出选区 + 一句提示词，只重画选区内
  { mode: 'element', label: '元素编辑', icon: <EditOutlined />, hint: '圈出要改的地方（框选/点选）+ 一句提示词，只重画选区内，选区外保持原图' },
  { mode: 'view', label: '生成视图', icon: <PictureOutlined />, hint: '以本图为参考生成三视图/四视图/六视图（扣积分）' },
];
export const NodeToolbar = memo(function NodeToolbar({ nodeId }: { nodeId: string }) {
  const { mode, targetId: modeNodeId } = useOpsState();

  /**
   * 只订阅"是不是唯一选中了我"，输出是布尔：选中别的节点时本实例不重渲染。
   * 挂在节点里意味着每个节点一个实例（一个画布几十个），所以选择器必须窄。
   */
  const isSoleSelection = useCanvasStore((s) => s.selectedNodeIds.length === 1 && s.selectedNodeIds[0] === nodeId);
  const node = useCanvasStore((s) => s.nodes.find((n) => n.id === nodeId));
  const nodeType = (node?.type as string) ?? '';
  const data = node?.data as unknown as NodeLite | undefined;
  const mediaInfo = mediaInfoOf(nodeType, data);
  const isGroup = nodeType === 'group';
  const isImage = nodeType === 'image';

  /**
   * 配置条钉在**正在编辑的节点**上（中途点到别处也不会跑掉）；动作条跟"唯一选中"走。
   * 两者可以同时出现在不同节点上：A 的图片配置开着，点到 B → B 的动作条出现、A 的配置不动。
   */
  const { showConfig, showActions } = toolbarVisibility({
    isImage,
    nodeId,
    isSoleSelection,
    mode,
    modeNodeId,
  });

  /**
   * 节点级动作（原来在右键菜单里）：复制/删除/下载/存资产/看历史。
   * 这些 hook **必须**在早退之前调用：节点一被取消选中就少调几个 hook，React 会直接报错。
   */
  const media = useMediaNodeActions({
    url: mediaInfo.url,
    name: data?.label,
    mediaType: mediaInfo.kind,
    assetType: mediaInfo.assetType,
  });
  const openHistory = useNodeActionStore((s) => s.openHistory);

  const nodeLabel = data?.label || mediaInfo.name;
  const copyThis = () => {
    if (node) copyNodeToClipboard(node, nodeLabel);
  };
  const deleteThis = () => deleteNodesByIds([nodeId]);
  /** 组合是容器：不能复制也不能直接删（会带走成员归属），唯一动作是解散 */
  const ungroupThis = () => {
    if (useCanvasStore.getState().ungroupNode(nodeId)) {
      message.success('已取消组合，成员保持选中');
    }
  };
  const showHistory = () => {
    if (!mediaInfo.url || !mediaInfo.assetType) return;
    openHistory({ nodeId, nodeType: mediaInfo.assetType, currentUrl: mediaInfo.url });
  };

  /**
   * 视频截帧（首帧/尾帧/当前帧）：**打开「截取画面」弹窗**，在大画面里截。
   *
   * 这里只负责"打开"：弹窗本体由 Canvas 渲染（和生成历史弹窗同一个套路），
   * 因为工具条会随节点取消选中而卸载 —— 取帧要下载视频 + ffmpeg，得几秒，
   * 不能用户点一下别处就把这次操作连弹窗一起弄没了。
   */
  const openFrameCapture = useNodeActionStore((s) => s.openFrameCapture);

  /**
   * 「片段重拍」：新建一个视频节点（引用这条视频 + 提示词里带区间 00:00 - 00:05）。
   *
   * 节奏刻意是这个顺序：**先建节点**（同步、立刻可见），**再去读时长**（异步、几十 KB 的
   * 元数据请求）。反过来做的话，用户点完要盯着画布等一两秒才看到东西，像是没反应。
   * 时长读到后把区间夹进真实范围；读不到就明说读不到，绝不按 5 秒硬猜
   * —— 猜错的区间条会让用户以为自己选的是 10 秒，实际提示词里写着别的。
   */
  const startReshoot = useCallback(async () => {
    const store = useCanvasStore.getState();
    const source = store.nodes.find((n) => n.id === nodeId);
    const url = (source?.data as { videoUrl?: string } | undefined)?.videoUrl;
    if (!source || !url) return;

    const initial = initialReshootState(source.id, url, null);
    const { node, edge } = createReshootVideoNode(source, initial);
    commitDerivedNodes([node], [edge]);
    // 设为唯一选中：提示词框立刻出现在节点下方，用户直接接着写
    const now = useCanvasStore.getState();
    now.onNodesChange([
      ...now.selectedNodeIds
        .filter((sid) => sid !== node.id)
        .map((sid) => ({ type: 'select' as const, id: sid, selected: false })),
      { type: 'select' as const, id: node.id, selected: true },
    ]);
    message.success('已新增重拍节点：拖动下方片段条选区间，提示词会自动跟着改');

    const duration = await probeVideoDuration(url);
    if (!duration) {
      message.warning('没读到这条视频的时长，片段条暂时拖不动；区间可以先在提示词里手写');
      return;
    }
    const clamped = clampRange(initial.start, initial.end, duration);
    const fresh = useCanvasStore.getState().nodes.find((n) => n.id === node.id);
    if (!fresh) return; // 用户已经把节点删了
    const prompt = applyRangeToPrompt((fresh.data as { prompt?: string }).prompt || '', clamped.start, clamped.end);
    useCanvasStore.getState().updateNodeData(node.id, {
      reshoot: { ...initial, start: clamped.start, end: clamped.end, durationSeconds: duration },
      prompt,
    } as never);
    if (clamped.end !== initial.end) {
      message.info(`这条视频只有 ${Math.round(duration)} 秒，区间已收窄到 00:00 - ${String(clamped.end).padStart(2, '0')}`);
    }
  }, [nodeId]);
  /**
   * 「音视频分离」：把这条视频拆成无声视频 + 音频两个节点（自动打成一个组合）。
   *
   * **先建节点、再干活**：分离要服务端下载整条源片（冷启动 30 秒级），如果等结果回来才建节点，
   * 用户点下去只看到按钮转圈、画布上什么都没有。所以先用占位节点（status: running +
   * "音视频分离中…"）把两个节点和组合摆出来，服务端返回后再把地址填进去。
   * 失败就把占位收回（removeNodes 连组合一起删）：画布上不留两个空转圈的节点和重复的组合作业。
   *
   * 和截帧一样，`demuxing` 放在外层：横条可能因为点到别处而消失，但这次操作不能丢。
   */
  const [demuxing, setDemuxing] = useState(false);
  const startDemux = useCallback(async () => {
    const store = useCanvasStore.getState();
    const source = store.nodes.find((n) => n.id === nodeId);
    const url = (source?.data as { videoUrl?: string } | undefined)?.videoUrl;
    if (!source) return;
    if (!url) {
      message.warning('这条视频还没有出片（没有可分离的文件），等生成完成再试');
      return;
    }

    // ① 立刻把占位节点摆出来：两个节点 + 一个组合，节点上写着"分离中"
    const { nodes, edges } = createDemuxNodes(source, null);
    commitDerivedNodes(nodes, edges);
    const silentId = nodes.find((n) => n.type !== 'group')?.id;
    const audioId = nodes.find((n) => n.type === 'audio')?.id;
    // 选中**无声视频**（不是组合）：用户接下来多半从画面继续加工，音频节点就在它下面
    if (silentId) {
      const now = useCanvasStore.getState();
      now.onNodesChange([
        ...now.selectedNodeIds
          .filter((sid) => sid !== silentId)
          .map((sid) => ({ type: 'select' as const, id: sid, selected: false })),
        { type: 'select' as const, id: silentId, selected: true },
      ]);
    }

    // ② 干活
    setDemuxing(true);
    try {
      const res = await imageOpsApi.videoDemux({
        videoUrl: url,
        projectId: store.projectId || undefined,
      });
      if (!res?.silentVideoUrl || !res?.audioUrl) {
        throw new Error('服务端没有返回完整的两份产物');
      }
      // ③ 填进占位节点（updateNodeData 会同时把 status 从 running 收回 idle）
      const patch = demuxFillPatch(res);
      const after = useCanvasStore.getState();
      if (silentId) after.updateNodeData(silentId, patch.video);
      if (audioId) after.updateNodeData(audioId, patch.audio);
      message.success('已分离：无声视频 + 音频，已打成一个组合放在右侧');
    } catch (err) {
      // 失败：把占位收回，画布保持原样（否则留下一组空节点，用户还得自己删）
      const stale = useCanvasStore.getState();
      stale.removeNodes(nodes.map((n) => n.id));
      // 选中退回源节点，用户的注意力留在原地、可以再点一次
      stale.onNodesChange([
        { type: 'select' as const, id: nodeId, selected: true },
      ]);
      message.error(err instanceof Error ? err.message : '音视频分离失败，请稍后重试');
    } finally {
      setDemuxing(false);
    }
  }, [nodeId]);

  // Esc 关闭 + 点画布空白关闭（只对图片工具的配置条有意义）
  useEffect(() => {
    if (!mode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') ops.close();
    };
    const onPaneDown = (e: Event) => {
      const t = e.target as HTMLElement | null;
      // 注意：React Flow 里每个节点都是 .react-flow__pane 的后代，
      // 用 closest 会把"点节点/点图片"也当成点空白。只认 pane 元素本身。
      if (t?.classList?.contains('react-flow__pane')) ops.close();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPaneDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPaneDown, true);
    };
  }, [mode]);

  // 所有 hook 都在早退之前，顺序稳定
  if (!node || (!showConfig && !showActions)) return null;

  /** 选中工具：切分按"这张图是什么视图生成的"预选宫格 */
  const select = (next: Exclude<OpsMode, null>) => {
    if (next === 'split') {
      const fromNode = VIEW_PRESETS.find((p) => p.kind === data?.viewKind);
      const fallback = defaultViewKindForAsset(data?.assetType);
      const preset = fromNode || VIEW_PRESETS.find((p) => p.kind === fallback) || VIEW_PRESETS[0];
      ops.open(nodeId, 'split', { kind: preset.kind, rows: preset.rows, cols: preset.cols });
      return;
    }
    ops.open(nodeId, next);
  };

  return (
    <ToolbarBar
      nodeId={nodeId}
      data={data}
      mediaInfo={mediaInfo}
      media={media}
      isImage={isImage}
      isGroup={isGroup}
      showConfig={showConfig}
      mode={mode}
      modeNodeId={modeNodeId}
      onCopy={copyThis}
      onDelete={deleteThis}
      onUngroup={ungroupThis}
      onShowHistory={showHistory}
      onOpenFrameCapture={() => openFrameCapture(nodeId)}
      onReshoot={startReshoot}
      onDemux={startDemux}
      demuxing={demuxing}
      onSelect={select}
    />
  );
});

/**
 * 横条本体。
 *
 * 单独拆一个内层组件是为了**订阅范围**：画布上每个节点都挂了一个 NodeToolbar，
 * 若在外层订阅 viewport.zoom，那么每次滚轮缩放都会把**所有**节点（含几十个根本没显示的）
 * 重渲染一遍。拆开后只有真正显示出来的横条才订阅，隐藏的那些连订阅都没有。
 */
const ToolbarBar = memo(function ToolbarBar({
  nodeId,
  data,
  mediaInfo,
  media,
  isImage,
  isGroup,
  showConfig,
  mode,
  modeNodeId,
  onCopy,
  onDelete,
  onUngroup,
  onShowHistory,
  onOpenFrameCapture,
  onReshoot,
  onDemux,
  demuxing,
  onSelect,
}: {
  nodeId: string;
  data: NodeLite | undefined;
  mediaInfo: ReturnType<typeof mediaInfoOf>;
  media: ReturnType<typeof useMediaNodeActions>;
  isImage: boolean;
  isGroup: boolean;
  showConfig: boolean;
  mode: OpsMode;
  modeNodeId: string | null;
  onCopy: () => void;
  onDelete: () => void;
  onUngroup: () => void;
  onShowHistory: () => void;
  /** 打开「截取画面」弹窗（首帧/尾帧/拖到某一帧再截，都在弹窗里做） */
  onOpenFrameCapture: () => void;
  onReshoot: () => void;
  /** 音视频分离：拆成无声视频 + 音频两个节点 */
  onDemux: () => void;
  demuxing: boolean;
  onSelect: (mode: Exclude<OpsMode, null>) => void;
}) {
  // 只取原始值：useViewport() 每次平移都会换对象引用，会让每个实例都重渲染
  const zoom = useStore((s) => s.transform[2]);
  const activeTool = IMAGE_TOOLS.find((t) => t.mode === mode);
  /** 图片工具只在"确实有图"时才给：没图时切分/画质/元素编辑都没有意义 */
  const showImageTools = isImage && !!data?.imageUrl;
  /** 视频类节点（视频/白片/清晰化）：有视频地址就给「截取画面」——它就是这个类型的工具 */
  const showFrameTool = showsFrameTool(mediaInfo);

  /** 通用动作的可用性（统一图标 + 不适用置灰），唯一出处见 actionAvailability */
  const avail = actionAvailability(mediaInfo, isGroup);

  return (
    <div
      data-node-toolbar
      data-image-node-toolbar={isImage ? '' : undefined}
      data-ops-state={showConfig ? 'config' : 'actions'}
      // nodrag：横条在节点 DOM 里，不标记的话按住它会拖动这个节点
      // w-max：绝对定位元素的宽度按"收缩适应"算，会被包含块（节点 320px）压短；
      //        画质提升那排是 antd Select（可收缩），于是整条被压到很窄 + 出现水平滚动条，
      //        后面的按钮/状态就被滚没了。写死 max-content 后宽度只由内容决定。
      className="nodrag absolute bottom-full left-1/2 flex w-max items-center gap-1 overflow-x-auto overflow-y-hidden rounded-xl border px-1.5"
      style={{
        zIndex: Z.canvasFloat,
        marginBottom: BAR_MARGIN / zoom,
        height: BAR_HEIGHT,
        transform: `translateX(-50%) scale(${1 / zoom})`,
        transformOrigin: 'bottom center',
        ...BAR_SURFACE,
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {showConfig && mode && activeTool ? (
        <>
          <CloseConfigButton toolName={activeTool.label} onClick={() => ops.close()} />
          <BarDivider />
          {mode === 'split' && (
            <SplitConfig nodeId={nodeId} imageUrl={data?.imageUrl} width={data?.width} height={data?.height} />
          )}
          {mode === 'element' && <ElementEditConfig />}
          {mode === 'quality' && (
            <QualityConfig nodeId={nodeId} imageUrl={data?.imageUrl} width={data?.width} height={data?.height} />
          )}
          {mode === 'view' && <ViewConfig nodeId={nodeId} />}
        </>
      ) : (
        <>
          {showImageTools && (
            <>
              {IMAGE_TOOLS.slice(0, 3).map((t) => (
                <ToolButton
                  key={t.mode}
                  icon={t.icon}
                  label={t.label}
                  hint={t.hint}
                  active={mode === t.mode && modeNodeId === nodeId}
                  onClick={() => onSelect(t.mode)}
                />
              ))}
              <BarDivider />
              {IMAGE_TOOLS.slice(3).map((t) => (
                <ToolButton
                  key={t.mode}
                  icon={t.icon}
                  label={t.label}
                  hint={t.hint}
                  active={mode === t.mode && modeNodeId === nodeId}
                  onClick={() => onSelect(t.mode)}
                />
              ))}
            </>
          )}
          {showFrameTool && (
            <ToolButton
              icon={<CameraOutlined />}
              label="截取画面"
              hint="打开大画面取帧：首帧/尾帧/拖到某一帧再截当前帧，可逐帧微调（本机 ffmpeg，不扣积分）"
              active={false}
              disabled={false}
              onClick={onOpenFrameCapture}
            />
          )}
          {showFrameTool && (
            <ToolButton
              icon={<ScissorOutlined />}
              label="片段重拍"
              hint="新建一个视频节点：引用这条视频并带上你选的区间（把@视频 中 00:00 - 00:05），后面的重拍要求你自己写"
              active={false}
              disabled={false}
              onClick={onReshoot}
            />
          )}
          {showFrameTool && (
            <ToolButton
              icon={demuxing ? <LoadingOutlined /> : <AudioOutlined />}
              label={demuxing ? '分离中…' : '音视频分离'}
              hint="把这条视频拆成两份产物：无声视频（画面不动，只去掉音轨）+ 音频，各建一个节点放在右侧（本机 ffmpeg，不扣积分）"
              active={false}
              disabled={demuxing}
              onClick={onDemux}
            />
          )}
          {isGroup && (
            <>
              {/* 组合这个类型自己的"工具"就是解散：它没有图片工具，但同一套动作组照旧跟在后面 */}
              <IconActionButton icon={<UngroupOutlined />} label="取消组合" onClick={onUngroup} />
            </>
          )}
          {(showImageTools || showFrameTool || isGroup) && (
            /* 分隔线之后是"节点级动作"（原右键菜单那些项），纯图标 */
            <BarDivider />
          )}
          {/* 通用动作：**每个节点类型都是这 5 个、这个顺序**，不适用的置灰（见 actionAvailability） */}
          <IconActionButton
            icon={<CopyOutlined />}
            label="复制节点"
            hint={avail.copy.hint}
            disabled={avail.copy.disabled}
            onClick={onCopy}
          />
          <IconActionButton
            icon={<DeleteOutlined />}
            label="删除节点"
            hint={avail.delete.hint}
            disabled={avail.delete.disabled}
            danger
            onClick={onDelete}
          />
          <IconActionButton
            icon={<DownloadOutlined />}
            label={media.downloading ? '下载中…' : `下载${mediaInfo.name}`}
            hint={avail.download.hint}
            disabled={media.downloading || avail.download.disabled}
            onClick={() => void media.download()}
          />
          <IconActionButton
            icon={<FolderAddOutlined />}
            label={media.saving ? '保存中…' : '存到个人资产库'}
            hint={avail.save.hint}
            disabled={media.saving || avail.save.disabled}
            onClick={() => void media.saveToLibrary()}
          />
          <IconActionButton
            icon={<HistoryOutlined />}
            label="查看生成历史"
            hint={avail.history.hint}
            disabled={avail.history.disabled}
            onClick={onShowHistory}
          />
        </>
      )}
    </div>
  );
});
