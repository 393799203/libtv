import { useStore } from '@xyflow/react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { message } from '@/utils/antdApp';
import { uploadImage } from '@/services/uploadApi';
import { imageOpsApi } from '@/services/imageOpsApi';
import { useCanvasStore } from '@/stores/canvasStore';
import { startNodeExecutions } from '@/utils/runNodes';
import type { ImageNodeData } from '@/types/canvas';
import { getOpsState, ops, useOpsState, type ElementRegion } from './opsStore';
import { PROMPT_BOX_WIDTH, moveDestinationRect, promptBoxPlacement } from './geometry';
import { renderElementMaskBlob } from './mask';
import { OPS, screenPx } from './tokens';
import { BarButton } from './atoms';

/**
 * 元素编辑覆盖层：**直接在节点图上圈选区**，不弹窗。
 *
 * 交互（用户视角）：
 *   1. 选中工具后整张图先被一层半透明黑遮住（"现在是在图上操作，不是在画布上"）；
 *   2. 框选拖出一个矩形，或点选在某处点一下：点选会**先给一个笔刷大小的圈**（立刻可见），
 *      同时后台请视觉模型认一下"那是什么"，回来后把这个圈换成物体的真实外接框、并把名字显示出来
 *      （见 recognizePointRegion：名字会写进改图指令，补上"这个"的指代）；
 *   3. 选区上方浮出一个小输入框，写一句"这里要改成什么"，点生成；
 *   4. 后端按选区蒙版把结果贴回原图 —— 选区外的像素一点没变。
 *
 * 为什么遮罩与选区画在 canvas 上而不是叠 div：
 * 遮罩要"整张暗、选区透"，用 div 就得给每个选区挖洞（clip-path/mask 兼容性与
 * 缩放下的接缝都难保证）；canvas 一次 destination-out 就干净了，且行宽/描边
 * 都能按 zoom 反向缩放（见 screenPx），与切分覆盖层同一套视觉规则。
 *
 * 选区一律存 0~1 相对坐标（见 opsStore.ElementRegion），所以画布缩放、节点大小、
 * DPR 都不影响；导出蒙版时按**原图尺寸**还原（见 mask.ts）。
 */

/** 遮罩浓度：够暗能看出"在操作中"，又看得清图上的细节（选什么元素全靠它） */
const DIM_ALPHA = 0.58;



/**
 * 把遮罩与选区画到 canvas 上。
 *
 * 坐标单位是**屏幕像素**（不是节点内 CSS 像素）：canvas 的 CSS 尺寸是节点内的尺寸
 * （节点固定 320px 宽），而它的位图按屏幕尺寸分配 —— 于是位图与屏幕 1:1，
 * 任何缩放级别都清晰、也不浪费内存。所以这里的 viewW/viewH 用 getBoundingClientRect 的
 * 屏幕值，缩小/放大都不会让描边和读数跟着变粗变细。
 */
function drawScene(
  canvas: HTMLCanvasElement,
  viewW: number,
  viewH: number,
  regions: ElementRegion[],
  preview: ElementRegion | null,
  zoom: number,
  /** 移动模式的落点框（虚线画出来 + 一条箭头指向它）：用户得看见"要搬到哪" */
  moveDest?: ElementRegion | null,
) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(viewW * dpr));
  const h = Math.max(1, Math.round(viewH * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.scale(dpr, dpr);

  // 1) 整张图压暗
  ctx.fillStyle = `rgba(0, 0, 0, ${DIM_ALPHA})`;
  ctx.fillRect(0, 0, viewW, viewH);

  const path = (r: ElementRegion) => {
    const x = r.x * viewW;
    const y = r.y * viewH;
    const rw = r.w * viewW;
    const rh = r.h * viewH;
    ctx.beginPath();
    if (r.tool === 'point') ctx.ellipse(x + rw / 2, y + rh / 2, Math.abs(rw) / 2, Math.abs(rh) / 2, 0, 0, Math.PI * 2);
    else ctx.rect(x, y, rw, rh);
  };

  // 2) 选区挖洞（透出原图，让用户看清自己圈的是哪块）
  ctx.globalCompositeOperation = 'destination-out';
  for (const r of regions) {
    path(r);
    ctx.fill();
  }
  if (preview) {
    path(preview);
    ctx.fill();
  }

  // 3) 选区描边 + 淡染（挖洞后选区与周围照片亮度接近，需要一条边把范围说清楚）
  ctx.globalCompositeOperation = 'source-over';
  const line = screenPx(1.5, zoom);
  for (const r of [...regions, ...(preview ? [preview] : [])]) {
    const rw = r.w * viewW;
    const rh = r.h * viewH;
    path(r);
    ctx.fillStyle = 'rgba(246, 246, 247, 0.12)';
    ctx.fill();
    ctx.lineWidth = line;
    ctx.strokeStyle = r === preview ? OPS.accent : 'rgba(246, 246, 247, 0.9)';
    // 正在拖的框用虚线：一眼分清"已落定的选区"和"手上这个"
    ctx.setLineDash(r === preview ? [screenPx(6, zoom), screenPx(4, zoom)] : []);
    // 描边要压在任意底色的照片上都看得清：先描一圈暗色再描白线
    ctx.save();
    ctx.lineWidth = line * 2.5;
    ctx.strokeStyle = OPS.lineHalo;
    ctx.stroke();
    ctx.restore();
    ctx.stroke();
    ctx.setLineDash([]);
    // 选区尺寸读数（框选时给，点选是个圆没必要）
    if (r.tool === 'box' && rw > 40 && rh > 20) {
      ctx.font = `${screenPx(11, zoom)}px system-ui, sans-serif`;
      ctx.fillStyle = OPS.ink;
      ctx.strokeStyle = OPS.lineHalo;
      ctx.lineWidth = screenPx(3, zoom);
      const label = `${Math.round(r.w * 100)}% × ${Math.round(r.h * 100)}%`;
      const lx = r.x * viewW + screenPx(4, zoom);
      const ly = r.y * viewH + screenPx(14, zoom);
      ctx.strokeText(label, lx, ly);
      ctx.fillText(label, lx, ly);
    }
  }

  // 4) 移动落点：虚线框 + 从源框中心指向落点的箭头。
  // 虚线与实线区分开：实线是"要改哪里"，虚线是"要搬到哪里"。
  if (moveDest) {
    const dx = moveDest.x * viewW;
    const dy = moveDest.y * viewH;
    const dw = moveDest.w * viewW;
    const dh = moveDest.h * viewH;
    ctx.save();
    ctx.lineWidth = screenPx(1.5, zoom);
    ctx.setLineDash([screenPx(6, zoom), screenPx(4, zoom)]);
    ctx.strokeStyle = OPS.accent;
    ctx.fillStyle = 'rgba(56, 189, 248, 0.10)';
    ctx.fillRect(dx, dy, dw, dh);
    ctx.save();
    ctx.lineWidth = screenPx(1.5, zoom) * 2.5;
    ctx.strokeStyle = OPS.lineHalo;
    ctx.strokeRect(dx, dy, dw, dh);
    ctx.restore();
    ctx.strokeRect(dx, dy, dw, dh);
    ctx.setLineDash([]);

    // 箭头：源框中心 → 落点中心
    const src = regions[0];
    if (src) {
      const sx = (src.x + src.w / 2) * viewW;
      const sy = (src.y + src.h / 2) * viewH;
      const tx = dx + dw / 2;
      const ty = dy + dh / 2;
      ctx.lineWidth = screenPx(2, zoom);
      ctx.strokeStyle = OPS.accent;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      const angle = Math.atan2(ty - sy, tx - sx);
      const head = screenPx(9, zoom);
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx - head * Math.cos(angle - Math.PI / 6), ty - head * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(tx - head * Math.cos(angle + Math.PI / 6), ty - head * Math.sin(angle + Math.PI / 6));
      ctx.closePath();
      ctx.fillStyle = OPS.accent;
      ctx.fill();

      ctx.font = `${screenPx(11, zoom)}px system-ui, sans-serif`;
      ctx.fillStyle = OPS.ink;
      ctx.strokeStyle = OPS.lineHalo;
      ctx.lineWidth = screenPx(3, zoom);
      const text = '移到这';
      ctx.strokeText(text, tx + screenPx(6, zoom), ty + screenPx(4, zoom));
      ctx.fillText(text, tx + screenPx(6, zoom), ty + screenPx(4, zoom));
    }
    ctx.restore();
  }
}

/** 屏幕坐标 → 图片相对坐标（0~1），越界夹回边界 */
function clampPoint(clientX: number, clientY: number, rect: DOMRect) {
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
}

/** 把拖出来的两个角点整理成一个正经矩形（允许反向拖） */
function rectOf(a: { x: number; y: number }, b: { x: number; y: number }): ElementRegion {
  return {
    tool: 'box',
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

/**
 * 提交一次元素编辑：导出蒙版 → 上传 → 把一次性指令写进节点 → 落库 → 执行。
 *
 * 为什么走"节点执行"而不是新增一个图片处理接口：
 * 只有走执行的路径才有计费/退费/渠道路由/生成历史/落库一整套（见后端 executor.go），
 * 自己撸一条会把这些逐个漏掉；而"只改选区"由后端在生成之后按蒙版贴回原图保证。
 */
/**
 * recognizePointRegion 点选后请视觉模型认一下"那是什么"，并把笔刷圈换成物体的真实外接框。
 *
 * 为什么必须异步、为什么失败要静默：识别是一次真实的视觉模型调用（电信渠道实测约 16s、
 * 华数约 5s）。卡住交互等结果不可接受 —— 所以先让用户看到自己的圈、能接着写提示词，
 * 结果回来再替换成物体的框；失败（网络/超时/模型没认出东西）就保持用户自己的圈，
 * 不弹错（这只是"更准一点"的加分项，不该拦住生成）。
 */
/**
 * recognizeFailureHint 把识别失败翻译成一句用户看得懂的话。
 *
 * 原则：永远给一句 —— 识别是"辅助"，它失败不该打断用户，但**沉默**会让用户以为功能坏了。
 * 后端 5xx 的 msg 里带着退费说明（很长），这里只挑状态码给结论，细节留在日志里。
 */
function recognizeFailureHint(e: unknown): string {
  const resp = (e as { response?: { status?: number; data?: { msg?: string } } })?.response;
  const msg = resp?.data?.msg;
  if (resp?.status === 402) return msg ?? '积分不足，这次没识别（未扣费）';
  if (resp?.status === 429) return msg ?? '识别太频繁了，稍等一下再点';
  if (!resp) return '识别超时或网络不通，已退回你圈的这块';
  if (resp.status === 502) return '识别没成功（图片读取或模型异常），已退回你圈的这块';
  return '识别没成功，已退回你圈的这块';
}

async function recognizePointRegion(params: {
  nodeId: string;
  imageUrl?: string;
  projectId?: string | null;
  index: number;
  spot: ElementRegion;
  x: number;
  y: number;
  /** 笔刷圈的相对半径（0~1，相对图宽）：告诉模型要认的是这一片里最显眼的东西 */
  radius?: number;
}): Promise<void> {
  const { nodeId, imageUrl, projectId, index, spot, x, y, radius } = params;
  if (!imageUrl) return;
  // 只在"还是这个节点、还开着元素编辑"时把结果写回去（识别期间用户可能已经关掉/换图）
  const stillValid = () => {
    const s = getOpsState();
    return s.mode === 'element' && s.targetId === nodeId;
  };
  ops.elementPatch({ recognizing: true, recognizeHint: undefined, recognizeCharged: undefined });
  try {
    const res = await imageOpsApi.recognizeObject({
      imageUrl,
      x,
      y,
      radius,
      projectId: projectId ?? undefined,
      // 节点号一起带上：对账页会按「项目 + 节点」把节点名解析出来，
      // 否则后台只能看到一行 "ai.recognize"，不知道是哪张图上的操作
      nodeId: nodeId || undefined,
    });
    if (!stillValid()) return;
    // 下标校验：识别期间用户可能撤销过选区，那样 index 已经不是刚才那一处了
    const cur = getOpsState().element.regions[index];
    const sameSpot =
      cur &&
      Math.abs(cur.x - spot.x) < 1e-6 &&
      Math.abs(cur.y - spot.y) < 1e-6 &&
      Math.abs(cur.w - spot.w) < 1e-6 &&
      Math.abs(cur.h - spot.h) < 1e-6;
    if (!sameSpot) return;
    const label = res.label?.trim() || undefined;
    if (res.charged) {
      // 让用户看得见这一步是收费的（后端在价格管理页可调，前端不写死）
      ops.elementPatch({ recognizeCharged: res.charged });
    }
    // 多层级候选（点鼻子 → 鼻子/人脸/人物）：带上让用户自己选改哪一层。
    // 只有一个候选时不显示选择行，行为与以前完全一致。
    const candidates = (res.candidates || []).filter((c) => c?.box && c.label);
    if (res.box) {
      // 换成物体的真实外接框（后端已做过外扩与合理性检查）
      ops.elementReplaceRegion(index, {
        tool: 'box',
        x: res.box.x,
        y: res.box.y,
        w: res.box.w,
        h: res.box.h,
        label,
        candidates: candidates.length > 1 ? candidates : undefined,
        candidateIndex: 0,
      });
    } else if (label) {
      // 只认出了名字、没给出可用的框：几何不动（还是用户画的圈），只把名字挂到那处选区上 ——
      // 图上要跟着出现标签，改图指令里也要点名
      ops.elementReplaceRegion(index, { ...spot, label });
      ops.elementPatch({ target: label });
    } else {
      // 模型说这处没有明确物体（点到背景/空白区域了）：保留用户的圈，并说清"只能靠你自己写清楚"
      ops.elementPatch({ target: undefined, recognizeHint: '没认出这里是什么，用你圈的这块（提示词里写清是什么更准）' });
    }
  } catch (e) {
    // 降级：识别不出来就用用户自己圈的，不弹错。失败不扣费（上游报错后端会自动退还；
    // 余额不足/被限流时根本没调上游，也就没扣）。
    // **但必须说一句**：之前只有 402/429 才提示，其它失败全静默 —— 用户连续点了三次、
    // 画面上什么都没发生、也没有任何说明（线上反馈"还没有提示"），根本无从判断。
    if (stillValid()) {
      ops.elementPatch({ recognizeHint: recognizeFailureHint(e) });
    }
  } finally {
    if (stillValid()) ops.elementPatch({ recognizing: false });
  }
}

async function submitElementEdit(params: {
  nodeId: string;
  imageUrl: string;
  width?: number;
  height?: number;
  regions: ElementRegion[];
  prompt: string;
  /** 点选识别出的物体名（可为空）：写进改图指令，补上"这个"的指代 */
  target?: string;
  /**
   * 移动模式的落点（相对 0~1 的中心点）。有它就写进指令，后端会把"源区域 + 落点"一起裁给模型。
   */
  moveTo?: { x: number; y: number };
  /** 节点上图片盒的宽高比（量出来的），只在"原图尺寸怎么都拿不到"时用来兜底蒙版比例 */
  boxAspect?: number;
}): Promise<void> {
  const { nodeId, imageUrl, regions, prompt } = params;
  const store = useCanvasStore.getState();
  const projectId = store.projectId;
  if (!projectId) {
    message.error('当前不在项目画布中，无法生成');
    return;
  }
  if (regions.length === 0) {
    message.error('先在图上框选或点选要修改的地方');
    return;
  }
  // 纯移动（标了落点、什么都没写）也算完整要求："把它搬到这里" —— 指令由后端生成。
  // 没有落点又没写要求才拦：空提示词让模型自由发挥 = 白扣一次积分。
  if (!prompt.trim() && !params.moveTo) {
    message.error('写一句要改成什么，例如「把外套换成红色」；或者按「移动」标记要搬到哪里');
    return;
  }
  // 正在生成中还点生成 = 又提交一次同样的活：白扣一次积分，而且两次结果会互相覆盖。
  // 节点上的"生成中"读的就是 data.status，这里按它拦一道。
  const running = store.nodes.find((n) => n.id === nodeId)?.data as { status?: string } | undefined;
  if (running?.status === 'running') {
    message.warning('这个节点正在生成中，等这一次结束再改');
    return;
  }

  // 蒙版按**原图**尺寸渲染：画布缩放/节点显示大小都不影响精度。
  // 尺寸优先取节点上记的（生成时后端回写的真实值），其次实测原图。
  const size = await resolveImageSize(imageUrl, params.width, params.height, params.boxAspect);

  ops.busy(true);
  const msgKey = `element-edit-${nodeId}`;
  message.loading({ content: '正在提交元素编辑…', key: msgKey, duration: 0 });
  // 指令是否已经写进节点：决定出错时要不要清、要不要把节点标成失败
  let instructionWritten = false;
  let cancelWatch: (() => void) | null = null;
  try {
    // 移动模式：落点也要标进蒙版（目的见 renderElementMaskBlob 的注释）。
    // 落点框 = 第一处选区平移到落点后的位置，尺寸与源一致。
    const moveDest = params.moveTo ? moveDestinationRect(regions[0], params.moveTo) : undefined;
    const blob = await renderElementMaskBlob(regions, size.width, size.height, moveDest ? [moveDest] : []);
    const maskFile = new File([blob], 'element-mask.png', { type: 'image/png' });
    const uploaded = await uploadImage(maskFile, projectId);

    // 一次性指令写进节点 data（后端 executor.go 的 elementEdit 分支读它）：
    // baseUrl = 生成前的原图（既是参考图也是贴回底板），maskUrl = 选区蒙版。
    // 注意这里**不动 data.prompt**：节点自己那份提示词要留着，元素编辑那句话只属于这一次。
    store.updateNodeData(nodeId, {
      elementEdit: {
        baseUrl: imageUrl,
        maskUrl: uploaded.url,
        // 只把用户那句话存进指令：「改哪里、别动别处」由后端补（见 elementCompositor.promptFor）——
        // 后端这次可能把"选区+周边"裁出来当参考图，那样"画面下方左侧"这种全图方位描述就错了，
        // 而且只有后端知道裁没裁、选区落在参考图里的哪个位置。
        prompt: prompt.trim(),
        // 点选识别出的物体名（可为空）：后端把它写进改图指令（"把「自动售货机」去掉"）
        target: params.target,
        // 移动落点（可为空=原地改）：后端据此把源与落点一起裁进参考图，
        // 并生成"搬到哪、原位置补全"的指令
        moveTo: params.moveTo ? { x: params.moveTo.x, y: params.moveTo.y } : undefined,
      },
      // 这里**不写** status：生成中是过渡态，不该跟着指令一起进撤销历史。
      // 紧接着的 startNodeExecutions → markNodesRunning 会用 transient 写把它标成生成中。
    } as Partial<ImageNodeData>);
    instructionWritten = true;

    // 落库 + 标记生成中 + 调 execute + 注册 SSE 订阅：走「正常生成」那条完整流程，
    // 不自己拼（漏掉 SSE 订阅的后果是节点永远停在"生成中"）。
    // 顺序很关键：指令已经写进 store，落库发生在 startNodeExecutions 内部的第一步。
    cancelWatch = watchElementEditRun(nodeId, msgKey);
    await startNodeExecutions(projectId, [nodeId]);
    message.success({ content: '已提交：只重画选区内的内容（选区外保持原样）', key: msgKey });
    ops.close();
  } catch (e) {
    // 自己先收掉监听：这一跑已经失败，别再让它在后面补一条"生成失败"的通知
    cancelWatch?.();
    message.destroy(msgKey);
    if (instructionWritten) {
      // 已经告诉过节点"生成中"、也写了指令，但执行没提交出去：
      // 撤掉指令（别让它影响下一次生成）并把节点标失败（否则永远转圈）
      store.updateNodeData(nodeId, { elementEdit: undefined } as Partial<ImageNodeData>);
      useCanvasStore.getState().updateNodeStatus(nodeId, 'failed');
    }
    message.error(e instanceof Error && e.message ? e.message : '提交失败，请重试');
  } finally {
    ops.busy(false);
  }
}

/**
 * 原图尺寸：优先用节点上记的（后端生成时会回写真实尺寸），缺失就实测原图。
 *
 * 只读 naturalWidth/naturalHeight，**不读像素**，所以不受 CDN 的 CORS 限制
 * （mask.ts 里那段注释说的就是"读像素"才会被污染）。
 */
async function resolveImageSize(
  imageUrl: string,
  width?: number,
  height?: number,
  boxAspect?: number,
): Promise<{ width: number; height: number }> {
  if (width && height && width > 0 && height > 0) return { width, height };
  try {
    const img = new Image();
    img.src = imageUrl;
    await img.decode();
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      return { width: img.naturalWidth, height: img.naturalHeight };
    }
  } catch {
    // 量不到就走下面的兜底
  }
  // 兜底：按节点上图片盒的比例造一块 2048 宽的蒙版。后端会把蒙版按**范围**对齐到原图
  // （见 service.maskSampler 的按像素缩放采样），所以只有比例一致时选区形状才不走样 ——
  // 拿节点盒的比例是最接近的近似；连它都没有才退回 16:9。
  const aspect = boxAspect && boxAspect > 0 ? boxAspect : 16 / 9;
  return { width: 2048, height: Math.max(1, Math.round(2048 / aspect)) };
}

/** 生成状态收口：成功后清掉一次性指令（与后端 mergeNodeOutputData 的 clearFields 一致）。
 *  返回取消函数：提交自己失败时调用，避免再补一条误导性的"生成失败"。 */
const elementWatchers = new Map<string, () => void>();

function watchElementEditRun(nodeId: string, msgKey: string): () => void {
  elementWatchers.get(nodeId)?.();
  const unsubscribe = useCanvasStore.subscribe((state, prevState) => {
    const node = state.nodes.find((n) => n.id === nodeId);
    const prevNode = prevState.nodes.find((n) => n.id === nodeId);
    if (!node || node === prevNode) return;
    const status = (node.data as { status?: string })?.status;
    if (status === (prevNode?.data as { status?: string })?.status) return;
    if (status === 'success') {
      cancel();
      message.destroy(msgKey);
      // 指令是"这一次"的：本地这份也要清掉，否则画布任何一次自动存盘都会把它又写回后端，
      // 用户下次直接点生成就变成"又按旧蒙版合成一遍"。
      // 用 updateNodeMeta（不进历史、不置 dirty）：这次清除不是用户的一次操作，
      // 不该占一格 ⌘Z；后端在同一时刻也已经把指令删了，两边状态一致。
      useCanvasStore.getState().updateNodeMeta(nodeId, { elementEdit: undefined } as Partial<ImageNodeData>);
      message.success('已按选区重新生成（选区外保持原图，Ctrl+Z 可撤销）');
    } else if (status === 'failed') {
      cancel();
      message.destroy(msgKey);
      // 失败保留 elementEdit：重试还要用同一份蒙版（删了就变成整图重画）
      message.error('生成失败，可重新点生成再试（节点右上角有失败原因）');
    }
  });
  const cancel = () => {
    clearTimeout(timer);
    unsubscribe();
    elementWatchers.delete(nodeId);
  };
  // 超时保护 5 分钟：与执行侧的上限对齐，超时只停止监听，不改节点状态
  const timer: ReturnType<typeof setTimeout> = setTimeout(cancel, 300000);
  elementWatchers.set(nodeId, cancel);
  return cancel;
}

/** 浮在图上的提示词输入框：选区一出现就浮到**选区侧面**（见下方定位规则） */
function ElementPromptBox({
  nodeId,
  imageUrl,
  width,
  height,
  host,
}: {
  nodeId: string;
  imageUrl: string;
  width?: number;
  height?: number;
  /** 挂载点：节点元素 + 图片盒在节点内的偏移（portal 到节点上，见 ElementEditOverlay 的说明） */
  host: { el: HTMLElement; x: number; y: number; w: number; h: number };
}) {
  const { element, busy } = useOpsState();
  // 多层级候选挂在**最后一处带候选的选区**上（就是用户刚点的那一处）：
  // 在组件内自己算，而不是从上层传进来 —— 覆盖层只管画图，输入框自己知道自己要显示什么
  let candIndex = -1;
  for (let i = element.regions.length - 1; i >= 0; i--) {
    if ((element.regions[i].candidates?.length ?? 0) > 1) {
      candIndex = i;
      break;
    }
  }
  const candRegion = candIndex >= 0 ? element.regions[candIndex] : undefined;
  // 只取 zoom 这个原始值：useViewport() 每次平移都会换对象引用，
  // 会让每个图片节点实例都跟着重渲染（工具条里也是这么做的）
  const zoom = useStore((s) => s.transform[2]);
  // 图片盒的比例（量出来的）：只在拿不到原图尺寸时给蒙版兜底用
  const boxAspect = host.h > 0 ? host.w / host.h : undefined;

  /**
   * 定位：挂在**图片下方**（节点底部外侧）、水平居中 —— 用户要求"避免遮住图片"。
   *
   * 这次能放到下面，是因为工具打开时节点自己的提示词框已经收起（promptPanelRule），
   * 下方不再有第二个框要抢位置；以前放下面会正好压住那个框（详见 geometry.promptBoxPlacement）。
   */
  const { anchorX, anchorY } = promptBoxPlacement(host, zoom);

  return createPortal(
    <div
      data-element-prompt-box
      className="nodrag absolute"
      style={{
        // 定位锚点：节点内坐标（不受画布 zoom 影响的那套）。
        // 外层只负责定位+反向缩放，真正的尺寸与位移交给内层 —— 百分比位移必须在
        // 缩放之后的坐标系里算（内层的 translate 会被外层 scale(1/zoom) 抵消），
        // 否则"垂直居中"在非 100% 缩放下会偏掉。
        left: anchorX,
        top: anchorY,
        transform: `scale(${1 / zoom})`,
        // 锚点是"图片下边缘的中点"：以内层框的**顶部中点**对齐它，再往下让开一个间距
        transformOrigin: 'center top',
        zIndex: 30,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div
        className="rounded-lg border p-2"
        style={{
          width: PROMPT_BOX_WIDTH,
          // 水平居中到锚点（图片中心），纵向从锚点往下让开一个间距（锚点已经含了间距）
          transform: 'translate(-50%, 0)',
          background: OPS.surface,
          borderColor: OPS.surfaceBorder,
          boxShadow: '0 10px 30px -10px rgba(0,0,0,0.7), 0 1px 3px rgba(0,0,0,0.5)',
        }}
      >
        <textarea
          // 单行起步：元素编辑的提示词本来就是一句话
          value={element.prompt}
          onChange={(e) => {
            ops.elementPrompt(e.target.value);
            ops.elementClearRecognizeHint();
          }}
          rows={1}
          placeholder={
            element.moveMode
              ? element.target
                ? `可以留空（移动不用写）；也可以顺带要求，例：把「${element.target}」放大一点`
                : '可以留空（移动不用写）；也可以顺带要求，例：换成红色'
              : element.target
                ? `要对「${element.target}」做什么？例：去掉它 / 换成黑色的`
                : '要改这一处什么？例：把这个人手里的箱子去掉'
          }
          className="w-full resize-none rounded-md px-2 py-1 text-[12px] outline-none"
          style={{ background: 'rgba(255,255,255,0.06)', color: OPS.ink, border: `1px solid ${OPS.hairline}` }}
          onKeyDown={(e) => {
            // Enter 直接提交（就是一句话的输入），Shift+Enter 换行
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (!busy) void submitElementEdit({ nodeId, imageUrl, width, height, boxAspect, regions: element.regions, prompt: element.prompt, target: element.target, moveTo: element.moveTo });
            }
            e.stopPropagation();
          }}
        />
        {!element.recognizing && !element.target && element.recognizeHint && (
          <div className="mb-1 text-[11px]" style={{ color: OPS.faint }}>
            {element.recognizeHint}
          </div>
        )}
        {(element.recognizing || element.target) && (
          <div className="mb-1 flex items-center gap-1.5 text-[11px]" style={{ color: element.target ? OPS.accent : OPS.muted }}>
            {element.recognizing ? (
              <span>识别中…（通常 2~10s，可以先写提示词）</span>
            ) : (
              <>
                <span
                  className="rounded px-1 py-px"
                  style={{ background: 'rgba(255,255,255,0.08)', border: `1px solid ${OPS.hairline}` }}
                >
                  已识别：{element.target}
                </span>
                {element.recognizeCharged ? (
                  <span style={{ color: OPS.faint }}>· 识别扣 {element.recognizeCharged} 积分</span>
                ) : (
                  <span style={{ color: OPS.faint }}>生成时会点名它</span>
                )}
              </>
            )}
          </div>
        )}
        {/* 识别出来的层级：点"鼻子"时可能想改的是"人脸" —— 让用户自己选，别替他决定。
            选中某一层会同时把那处选区换成该层的外接框（名字与框必须一致）。 */}
        {candRegion && candIndex >= 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <span className="text-[11px]" style={{ color: OPS.faint }}>
              改哪一层：
            </span>
            {candRegion.candidates!.map((c, ci) => {
              const on = (candRegion.candidateIndex ?? 0) === ci;
              return (
                <button
                  key={`cand-${ci}`}
                  type="button"
                  data-element-candidate={ci}
                  className="rounded px-1.5 py-px text-[11px] transition-colors"
                  style={{
                    background: on ? OPS.accent : 'rgba(255,255,255,0.06)',
                    color: on ? '#0b0b0c' : OPS.ink,
                    border: `1px solid ${on ? OPS.accent : OPS.hairline}`,
                  }}
                  title={`把这处选区换成「${c.label}」的范围`}
                  onClick={() => ops.elementSelectCandidate(candIndex, ci)}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        )}
        {/* 移动模式：打开后下一次点图标记"搬到哪"（不再是加选区） */}
        {element.moveMode && (
          <div className="mt-1.5 text-[11px]" style={{ color: OPS.accent }} data-element-move-hint>
            {element.moveTo ? '已标记落点，可以生成（再点一下可改落点）' : '在图上点一下，标记要把它移到哪里'}
          </div>
        )}
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="text-[11px]" style={{ color: OPS.muted }}>
            {element.regions.length} 处选区 · {element.moveMode ? '原位置补背景、其余不变' : '只改选区内'}
          </span>
          <div className="flex items-center gap-1.5">
            <BarButton
              disabled={busy || element.regions.length === 0}
              title={
                element.regions.length === 0
                  ? '先在图上框选或点选要搬动的东西'
                  : '把选区里的东西移到你指定的位置（打开后在图上点落点）'
              }
              onClick={() => ops.elementToggleMoveMode()}
            >
              {element.moveMode ? '取消移动' : '移动'}
            </BarButton>
          <BarButton
            primary
            disabled={busy || element.regions.length === 0 || (!element.prompt.trim() && !element.moveTo)}
            title={
              element.moveTo
                ? '把选区里的东西搬到标记的位置：原位置补背景、其余不变 · 扣积分'
                : '按选区蒙版重画：选区外的像素保持原图不变 · 扣积分'
            }
            onClick={() => void submitElementEdit({ nodeId, imageUrl, width, height, boxAspect, regions: element.regions, prompt: element.prompt, target: element.target, moveTo: element.moveTo })}
          >
              {busy ? '提交中…' : '生成'}
            </BarButton>
          </div>
        </div>
      </div>
    </div>,
    host.el,
  );
}

export function ElementEditOverlay({
  nodeId,
  imageUrl,
  imageWidth,
  imageHeight,
}: {
  nodeId: string;
  imageUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
}) {
  const { mode, targetId, element } = useOpsState();
  // 同上：只要 zoom 的值，不要视口对象
  const zoom = useStore((s) => s.transform[2]);
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const [preview, setPreview] = useState<ElementRegion | null>(null);
  /** 点选时的笔刷预览圆心（节点内坐标，CSS px）：让"点一下会圈多大"看得见 */
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  // 用于重绘的"盒子尺寸"：getBoundingClientRect 只在需要时量一次
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  /**
   * 提示词输入框的挂载点。**必须 portal 到节点元素上**：
   * 图片容器是 `overflow-hidden` 的（圆角要裁），输入框留在里面时，选区靠近图片边缘
   * 就会被裁掉一半；而节点元素本身不裁，工具条也是挂在那上面（bottom-full）才活下来的。
   * x/y/w/h 都是"节点内坐标"（getBoundingClientRect 的屏幕值除以 zoom），
   * 后面乘比例、再反向缩放，屏幕尺寸才恒定。
   */
  const [host, setHost] = useState<{ el: HTMLElement; x: number; y: number; w: number; h: number } | null>(null);

  const active = mode === 'element' && targetId === nodeId;

  // 盒子尺寸变化（节点被缩放/画布 zoom 变化都会改）：重绘要靠它换算行宽与读数位置
  useEffect(() => {
    if (!active) return;
    const hostEl0 = boxRef.current;
    if (!hostEl0) return;
    const measure = () => {
      const r = hostEl0.getBoundingClientRect();
      setBox((prev) => (Math.abs(prev.w - r.width) < 0.5 && Math.abs(prev.h - r.height) < 0.5 ? prev : { w: r.width, h: r.height }));
      const nodeEl = hostEl0.closest('.react-flow__node') as HTMLElement | null;
      if (nodeEl) {
        const nr = nodeEl.getBoundingClientRect();
        const z = zoom || 1;
        setHost({
          el: nodeEl,
          x: (r.left - nr.left) / z,
          y: (r.top - nr.top) / z,
          w: r.width / z,
          h: r.height / z,
        });
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(hostEl0);
    return () => ro.disconnect();
    // zoom 变化要重测：屏幕值除以 zoom 才是节点内坐标
  }, [active, zoom]);

  // 移动模式：把第一处选区平移到落点，得到"要搬到哪"的框（绘制 + 蒙版都用它）
  const moveDest = element.moveMode ? moveDestinationRect(element.regions[0], element.moveTo) : undefined;

  // 拖动期间挂 window：指针划出节点边界也不能断框
  useEffect(() => {
    if (!active) return;
    const onMove = (e: PointerEvent) => {
      const start = dragStartRef.current;
      const host = boxRef.current;
      if (!start || !host) return;
      const r = host.getBoundingClientRect();
      setPreview(rectOf(start, clampPoint(e.clientX, e.clientY, r)));
    };
    const onUp = (e: PointerEvent) => {
      const start = dragStartRef.current;
      const host = boxRef.current;
      dragStartRef.current = null;
      setPreview(null);
      if (!start || !host) return;
      const r = host.getBoundingClientRect();
      const rect = rectOf(start, clampPoint(e.clientX, e.clientY, r));
      // 太小的框当作误触（点一下就当框选会留下一个几像素的选区，反而要用户再去撤）
      if (rect.w * r.width < 6 || rect.h * r.height < 6) return;
      ops.elementAdd(rect);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [active]);

  // 重绘：选区/预览/盒子尺寸/缩放任一变化都要重画（一次全画，选区数量是个位数）
  useEffect(() => {
    if (!active) return;
    const cv = canvasRef.current;
    if (!cv || box.w <= 0 || box.h <= 0) return;
    drawScene(cv, box.w, box.h, element.regions, preview, zoom, moveDest);
  }, [active, box.w, box.h, element.regions, preview, zoom, moveDest]);

  if (!active) return null;

  const hasDims = Boolean(imageWidth && imageHeight);
  const last = element.regions[element.regions.length - 1];
  const brushLocal = screenPx(element.brush, zoom);

  return (
    <div
      ref={boxRef}
      data-image-element-overlay
      className="nodrag absolute left-0 top-0 w-full"
      style={{
        aspectRatio: hasDims ? `${imageWidth} / ${imageHeight}` : undefined,
        inset: hasDims ? undefined : 0,
        // 盖过节点内 loading/error 占位层的 z-10（与切分/涂抹覆盖层同一层级规则）
        zIndex: 21,
        cursor: 'crosshair',
        touchAction: 'none',
        borderRadius: 2,
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const host = boxRef.current;
        if (!host) return;
        const r = host.getBoundingClientRect();
        const p = clampPoint(e.clientX, e.clientY, r);

        // 移动模式：这一下点的是"落点"，不是新选区。
        // 用户操作顺序是"先圈/点选要搬的东西 → 按『移动』→ 在图上点落点"，
        // 所以这里不该再追加选区（否则每标一次落点就多一处要改的地方）。
        if (element.moveMode) {
          ops.elementSetMoveTo(p);
          return;
        }

        if (element.tool === 'point') {
          // 点选：以点击处为中心画一个**笔刷大小**的圆（"就是这个元素"）。
          // 笔刷是屏幕像素，这里换算成节点内像素（brushLocal）再除以盒子尺寸 ——
          // 分母也必须用节点内尺寸：屏幕值除以 zoom 才是节点内尺寸，
          // 两边混用会让选区大小随画布缩放漂移（放大后会圈出一个大得多的区域）。
          const localW = r.width / (zoom || 1);
          const localH = r.height / (zoom || 1);
          const index = element.regions.length; // 即将追加的那一处的下标，识别回来后按它替换
          const spot: ElementRegion = {
            tool: 'point',
            x: p.x - brushLocal / 2 / localW,
            y: p.y - brushLocal / 2 / localH,
            w: brushLocal / localW,
            h: brushLocal / localH,
          };
          ops.elementAdd(spot);
          // 立刻给圈（上面的 elementAdd），识别是异步的：回来后换成真实外接框。
          // p 已经是**归一化 0~1**（见 clampPoint），直接当点选坐标用 ——
          // 别再除以 r.width：那会把每个点都算成图左上角（线上实测点=(0.000,0.003)，
          // 模型在左上角什么也看不到，回一句"无"）。
          void recognizePointRegion({
            nodeId,
            imageUrl,
            index,
            spot,
            x: p.x,
            y: p.y,
            // 笔刷圈在图上的相对半径：让模型知道"用户指的是这一片里最显眼的东西"，
            // 点得偏一点（点到物体边上/背景）也能认出目标
            radius: spot.w / 2,
            projectId: useCanvasStore.getState().projectId,
          });
          return;
        }
        dragStartRef.current = p;
        setPreview(rectOf(p, p));
      }}
      onPointerMove={(e) => {
        if (element.tool !== 'point') return;
        const host = boxRef.current;
        if (!host) return;
        const r = host.getBoundingClientRect();
        const z = zoom || 1;
        setCursor({ x: (e.clientX - r.left) / z, y: (e.clientY - r.top) / z });
      }}
      onPointerLeave={() => setCursor(null)}
    >
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />

      {/*
        识别出的物体名：直接标在它自己的框上（用户要求"识别出的物品可以直接标在图片上"）。
        为什么锚在框内左上角而不是框上方：节点图片容器是 overflow-hidden 的，
        贴着图上边缘的框，标签放上方会被裁掉；放框内永远看得见（切分格号也是这么锚的）。
        尺寸全过 screenPx(…, zoom)：缩放画布时标签保持屏幕尺寸恒定，不会跟着糊成一片。
      */}
      {element.regions.map((r, i) =>
        r.label ? (
          <div
            key={`element-tag-${i}`}
            data-element-region-tag
            className="pointer-events-none absolute flex items-center"
            style={{
              left: `${r.x * 100}%`,
              top: `${r.y * 100}%`,
              marginLeft: screenPx(3, zoom),
              marginTop: screenPx(3, zoom),
              height: screenPx(16, zoom),
              maxWidth: `${Math.max(r.w, 0.12) * 100}%`,
              padding: `0 ${screenPx(5, zoom)}px`,
              borderRadius: screenPx(4, zoom),
              background: 'rgba(10,12,16,0.82)',
              color: OPS.ink,
              border: `${screenPx(1, zoom)}px solid ${OPS.hairline}`,
              fontSize: screenPx(9.5, zoom),
              lineHeight: 1,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              zIndex: 22,
            }}
          >
            {r.label}
          </div>
        ) : null,
      )}

      {/* 点选的笔刷预览圈：只有真的有鼠标位置时才画（否则会在左上角留一个圈） */}
      {element.tool === 'point' && cursor && (
        <div
          data-element-brush-ring
          className="pointer-events-none absolute rounded-full"
          style={{
            left: cursor.x - brushLocal / 2,
            top: cursor.y - brushLocal / 2,
            width: brushLocal,
            height: brushLocal,
            border: `${screenPx(1.5, zoom)}px solid ${OPS.accent}`,
            boxShadow: `0 0 0 ${screenPx(1.5, zoom)}px ${OPS.lineHalo}`,
          }}
        />
      )}

      {element.regions.length > 0 && imageUrl && host && last && (
        <ElementPromptBox
          nodeId={nodeId}
          imageUrl={imageUrl}
          width={imageWidth}
          height={imageHeight}
          host={host}
        />
      )}
    </div>
  );
}