import type { OpsMode } from './imageops/opsStore';

/**
 * 节点工具条的**纯规则**：按类型取素材、通用动作的可用性、横条显示配置还是动作。
 *
 * 为什么单独一个文件：`react-refresh/only-export-components` 要求组件文件只导出组件，
 * 而这些规则需要在"组件之外"被跑（断言脚本会直接调它们）。顺带一个好处：
 * "谁能复制、谁能下载"只有这一个出处，不会和文案/交互走偏。
 */


export interface NodeLite {
  label?: string;
  imageUrl?: string;
  videoUrl?: string;
  audioUrl?: string;
  stillUrl?: string;
  width?: number;
  height?: number;
  assetType?: 'character' | 'scene' | 'prop';
  viewKind?: string;
}

/**
 * 各类节点的素材信息：地址在哪、算图片还是视频（决定资产库类型/历史弹窗类型）、叫什么。
 *
 * 为什么要这张表：动作组是**所有节点共用**的，但"下载什么""能不能存进资产库"按类型不同 ——
 * 资产库只收 image/video（`UserAssetType`），生成历史弹窗也只认 image/video；
 * 音频节点能下载但没有这两项，别硬凑一个 grey 按钮。
 */
export function mediaInfoOf(nodeType: string, data: NodeLite | undefined) {
  switch (nodeType) {
    case 'image':
      return { kind: 'image' as const, assetType: 'image' as const, name: '图片', url: data?.imageUrl };
    case 'video':
      return { kind: 'video' as const, assetType: 'video' as const, name: '视频', url: data?.videoUrl };
    // 音频：能下载，但资产库/生成历史都不支持音频，所以不给那两个按钮
    case 'audio':
      return { kind: 'audio' as const, assetType: undefined, name: '音频', url: data?.audioUrl };
    // 白片节点：导出过视频就是视频；只有静帧时按图片算（下载/存库/历史都跟着变）
    case 'previz':
      return data?.videoUrl
        ? { kind: 'video' as const, assetType: 'video' as const, name: '白片', url: data.videoUrl }
        : { kind: 'image' as const, assetType: 'image' as const, name: '静帧', url: data?.stillUrl };
    case 'enhance':
      return { kind: 'video' as const, assetType: 'video' as const, name: '视频', url: data?.videoUrl };
    default:
      return { kind: 'image' as const, assetType: undefined, name: '节点', url: undefined };
  }
}

/**
 * 统一动作组里每个图标的可用性。
 *
 * 用户要的是"统一的模式"：**每个节点看到同一套图标、同一顺序**，不适用的**置灰**而不是消失 ——
 * 布局不用记两套，哪些能做也能一眼看出（悬停还有置灰原因）。
 * 唯一出处放在这里，是因为可用性判断分散在 JSX 里最容易和文案/交互走偏。
 */
export function actionAvailability(mediaInfo: ReturnType<typeof mediaInfoOf>, isGroup: boolean) {
  const hasUrl = !!mediaInfo.url;
  // 个人资产库只收图片/视频，生成历史弹窗也只认图片/视频（音频能下载但没有这两项）
  const isAsset = !!mediaInfo.assetType;
  const groupOnly = isGroup
    ? '组合是容器：复制出来是空框、删掉会带走成员归属，请先「取消组合」'
    : undefined;
  return {
    copy: { disabled: isGroup, hint: groupOnly },
    delete: { disabled: isGroup, hint: groupOnly },
    download: {
      disabled: !hasUrl,
      hint: hasUrl ? undefined : '这个节点还没有可下载的素材',
    },
    save: {
      disabled: !hasUrl || !isAsset,
      hint: isAsset
        ? hasUrl
          ? undefined
          : '这个节点还没有可保存的素材'
        : '个人资产库只支持图片和视频',
    },
    history: {
      disabled: !hasUrl || !isAsset,
      hint: isAsset ? (hasUrl ? undefined : '这个节点还没有生成记录') : '生成历史只支持图片和视频',
    },
  };
}

/**
 * 横条该显示"配置"还是"动作"（导出成纯函数是为了能脱离浏览器直接断言：
 * 这里的边界条件最多 —— 唯一选中、配置钉在别的节点上、配置就钉在自己身上）。
 */
export function toolbarVisibility(opts: {
  isImage: boolean;
  nodeId: string;
  isSoleSelection: boolean;
  mode: OpsMode;
  modeNodeId: string | null;
}): { showConfig: boolean; showActions: boolean } {
  const showConfig = opts.isImage && !!opts.mode && opts.modeNodeId === opts.nodeId;
  return { showConfig, showActions: opts.isSoleSelection && !showConfig };
}

/**
 * 视频类节点（视频 / 白片 / 清晰化）是否给「截取画面」工具。
 *
 * 判据是**素材本身是不是视频**、且确实有视频地址：白片节点可能只有静帧（kind=image）——
 * 那时没有"帧"可截，给了按钮只会报错。音频/图片同理不给。
 */
export function showsFrameTool(mediaInfo: ReturnType<typeof mediaInfoOf>): boolean {
  return mediaInfo.kind === 'video' && !!mediaInfo.url;
}
