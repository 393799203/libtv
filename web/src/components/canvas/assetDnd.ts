import type { UserAsset } from '@/services/assetApi';

/** 资产拖拽用的 dataTransfer 类型（仅用于标准 HTML5 拖放的兼容路径） */
export const ASSET_DND_TYPE = 'application/x-libtv-asset';

/** 一次资产放置请求：资产 + 松手时的屏幕坐标 */
export interface AssetDropRequest {
  asset: UserAsset;
  x: number;
  y: number;
}

type DropHandler = (req: AssetDropRequest) => void;

/**
 * 资产拖拽的"落点投递"通道。
 *
 * 为什么不用 HTML5 拖放（draggable + dragover/drop）：实际测试中它在本项目里
 * 拖出来松手毫无反应（元素拖拽的启动/放置受浏览器与内部事件处理影响，难以自证）。
 * 改成指针拖拽（pointerdown/move/up）后，落点判定完全由我们自己的代码决定，
 * 不依赖浏览器是否认为"这是一次可放置的拖拽"。
 *
 * 面板负责发起拖拽并在松手时投递坐标，画布负责判断坐标是否落在自己区域内并建节点 ——
 * 两边只通过这个模块通信，不互相侵入。
 */
let dropHandler: DropHandler | null = null;

export function setAssetDropHandler(fn: DropHandler | null): void {
  dropHandler = fn;
}

export function emitAssetDrop(req: AssetDropRequest): void {
  dropHandler?.(req);
}

/** 拖拽中的资产（画布可用来做落点区域的视觉反馈） */
let draggingAsset: UserAsset | null = null;

export function setDraggingAsset(asset: UserAsset | null): void {
  draggingAsset = asset;
}

export function getDraggingAsset(): UserAsset | null {
  return draggingAsset;
}