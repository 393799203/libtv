import { message } from '@/utils/antdApp';
import { imageOpsApi } from '@/services/imageOpsApi';
import { useCanvasStore } from '@/stores/canvasStore';
import { commitDerivedNodes, createReferenceImageNode, createSplitNodes } from '@/utils/imageOpsNodes';
import { buildUpscalePrompt, VIEW_PRESETS } from '@/utils/imageViewPrompts';
import { startNodeExecutions } from '@/utils/runNodes';
import { ops, useOpsState } from './opsStore';
import type { LibTVEdge, LibTVNode } from '@/types/canvas';
import { BarButton, BarDivider, ConfigLabel, ConfigSelect, ConfigValue, GridGlyph } from './atoms';
import { cellBoxes, effectiveCuts, tileSizes } from './geometry';
import { OPS } from './tokens';

/** 宫格下拉只提供这三档（不要一堆选项，用户要的就是这三种） */
const OFFERED: [number, number][] = [
  [2, 2],
  [3, 3],
  [4, 4],
];

/** 有名字的宫格（视图模板产出的图就是这些形状） */
const NAMED: Record<string, string> = {
  '1x3': '角色三视图',
  '1x4': '角色四视图',
  '2x2': '四宫格',
  '2x3': '道具六视图',
  '3x3': '九宫格',
  '4x4': '十六宫格',
};

function gridOption(rows: number, cols: number) {
  const name = NAMED[`${rows}x${cols}`];
  return {
    value: `${rows}x${cols}`,
    label: (
      <span className="flex items-center gap-1.5">
        <GridGlyph rows={rows} cols={cols} />
        <span>
          {rows} × {cols}
          {name ? `（${name}）` : ''}
        </span>
      </span>
    ),
  };
}

function failText(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return '操作失败，请重试';
}

/**
 * 宫格切分的配置条内容。分割线与格子选择都在节点图片上（SplitOverlay），这里放
 * 宫格档位、选中数量、以及两个动作：
 * - **生成高清图**：把选中的格子裁出来（本机、免费、秒出），再为每格提交一次
 *   **4K 模型重生成**（以该格为参考图，扣积分）——裁切免费、补细节靠模型；
 * - 切分：只裁不放大（要原尺寸单图时用）。
 *
 * 为什么高清走模型而不是本机放大：本机只能 lanczos 插值把像素撑大，**补不了细节**
 * （仓库里唯一开通的"清晰化"渠道 enhance.yaml/ffmpeg 档自身也写明"不补帧、不额外扣积分"；
 * 真正的超分渠道「腾讯云 MPS」目前是注释骨架、实现未注册）。所以"高清"这条明确标成
 * 模型任务 + 扣积分，不拿插值冒充。
 *
 * 不选任何格子 = 作用于全部格子，所以不存在"必须先选"的门槛。
 */
export function SplitConfig({
  nodeId,
  imageUrl,
  width,
  height,
}: {
  nodeId: string;
  imageUrl: string;
  width?: number;
  height?: number;
}) {
  const { split, busy } = useOpsState();
  const projectId = useCanvasStore((s) => s.projectId);
  const sourceNode = useCanvasStore((s) => s.nodes.find((n) => n.id === nodeId));

  const seen = split.cutsX.length > 0 || split.cutsY.length > 0;
  const cutsX = effectiveCuts(split.cutsX, split.cols);
  const cutsY = effectiveCuts(split.cutsY, split.rows);
  const boxes = cellBoxes(cutsX, cutsY);
  const rows = cutsY.length + 1;
  const cols = cutsX.length + 1;
  const sizes = tileSizes(boxes, width, height, split.trimPx);
  // 说明性文案一律进 hover，不写在横条中间（用户要求）
  const sizeHint = sizes
    ? `每格 ${sizes.minW === sizes.maxW ? sizes.minW : `${sizes.minW}~${sizes.maxW}`}×${
        sizes.minH === sizes.maxH ? sizes.minH : `${sizes.minH}~${sizes.maxH}`
      }px`
    : '';
  const gridHint = [sizeHint, seen ? '已手动调线' : ''].filter(Boolean).join(' · ');
  const tooSmall = sizes ? Math.min(sizes.minW, sizes.minH) < 300 : false;

  // 没选就作用于全部格子
  const targets = split.selected.length > 0 ? split.selected : boxes.map((b) => b.index);
  const allSelected = split.selected.length === boxes.length && boxes.length > 0;

  const grid = `${split.rows}x${split.cols}`;
  const offered = OFFERED.map(([r, c]) => gridOption(r, c));
  // 当前宫格不在三档里时（例如"角色三视图"产出的 1×3 图）把它保留成一项，
  // 否则下拉没有对应项、用户也没法继续按原样切。
  const gridOptions = OFFERED.some(([r, c]) => r === split.rows && c === split.cols)
    ? offered
    : [...offered, gridOption(split.rows, split.cols)];

  const changeGrid = (key: string) => {
    const [r, c] = key.split('x').map(Number);
    const preset = VIEW_PRESETS.find((p) => p.rows === r && p.cols === c);
    ops.splitPreset(preset?.kind ?? 'free', r, c);
  };

  /** 只裁：本机 ffmpeg，免费，秒出 */
  const runSplit = async () => {
    if (!sourceNode) {
      message.error('找不到源节点');
      return;
    }
    ops.busy(true);
    try {
      const res = await imageOpsApi.split({
        imageUrl,
        rows,
        cols,
        trimPx: split.trimPx,
        ...(seen ? { cutsX, cutsY } : {}),
        cells: targets,
        projectId: projectId || undefined,
      });
      const tiles = res.tiles || [];
      if (tiles.length === 0) {
        message.error('没有切出任何图，请检查宫格设置');
        return;
      }
      const { nodes, edges } = createSplitNodes(sourceNode, tiles, rows, cols);
      commitDerivedNodes(nodes, edges);
      message.success(`已切出 ${tiles.length} 张，按 ${rows}×${cols} 摆在右侧（一次 Ctrl+Z 可整体撤销）`);
      ops.close();
    } catch (e) {
      message.error(failText(e));
    } finally {
      ops.busy(false);
    }
  };

  /**
   * 生成高清图：两段。
   * 1) 本机裁出选中的格子（免费、立刻可见）；
   * 2) 每格建一个"以该格为参考"的 4K 重生成节点并提交执行（**扣积分**）。
   * 中间产物也留在画布上：用户能同时拿到"原尺寸单图"和"高清版"，出图前也有东西可看。
   */
  const runHd = async () => {
    if (!sourceNode || !projectId) {
      message.error('当前不在项目画布中，无法生成');
      return;
    }
    ops.busy(true);
    try {
      const res = await imageOpsApi.split({
        imageUrl,
        rows,
        cols,
        trimPx: split.trimPx,
        ...(seen ? { cutsX, cutsY } : {}),
        cells: targets,
        projectId,
      });
      const tiles = res.tiles || [];
      if (tiles.length === 0) {
        message.error('没有切出任何图，请检查宫格设置');
        return;
      }

      const crops = createSplitNodes(sourceNode, tiles, rows, cols);
      commitDerivedNodes(crops.nodes, crops.edges);

      // 高清节点参考的是"裁出来的那一格"，所以 mention 指向裁切节点、边也连到它
      const hdNodes: LibTVNode[] = [];
      const hdEdges: LibTVEdge[] = [];
      for (const crop of crops.nodes) {
        const { node, edge } = createReferenceImageNode(crop, {
          promptTemplate: buildUpscalePrompt('{{REF}}'),
          label: `${crop.data.label || '图片'} 高清`,
          resolution: '4K',
          aspectRatio: (sourceNode.data as { aspectRatio?: string }).aspectRatio || '1:1',
        });
        hdNodes.push(node);
        hdEdges.push(edge);
      }
      commitDerivedNodes(hdNodes, hdEdges);

      for (const node of hdNodes) {
        // 新建的节点必须先落库：后端执行计划是在已保存的画布里找 startNodeId 的，
        // 漏了这一步就会报 build execution plan failed: node not found in canvas
        await startNodeExecutions(projectId, hdNodes.map((n) => n.id));
      }
      message.success(
        `已裁出 ${tiles.length} 格，并提交 ${hdNodes.length} 个 4K 高清任务（扣 ${hdNodes.length} 次积分）· 出图后新节点自动更新`,
      );
      ops.close();
    } catch (e) {
      message.error(failText(e));
    } finally {
      ops.busy(false);
    }
  };

  return (
    <>
      <ConfigLabel>宫格</ConfigLabel>
      <ConfigSelect value={grid} onChange={changeGrid} options={gridOptions} width={176} ariaLabel="宫格行列" />

      <BarDivider />
      <ConfigValue>{split.selected.length > 0 ? `已选 ${split.selected.length} 格` : '全部'}</ConfigValue>
      <BarButton
        onClick={() => ops.splitToggleAll(boxes.length)}
        title={allSelected ? '取消全选（不选 = 作用于全部格子）' : '选中全部格子'}
      >
        {allSelected ? '取消全选' : '全选'}
      </BarButton>

      <BarButton
        primary
        onClick={runHd}
        disabled={busy}
        title={`裁出选中的 ${targets.length} 格（本机免费），再用模型重生成 4K 高清版：会扣 ${targets.length} 次积分，画面可能有细微变化（不是逐像素保真的超分）${gridHint ? ` · ${gridHint}` : ''}`}
      >
        {busy ? '处理中…' : `生成高清图${targets.length > 1 ? ` ${targets.length} 格` : ''}`}
      </BarButton>
      <BarButton
        onClick={runSplit}
        disabled={busy || tooSmall}
        title={tooSmall ? '最窄的一格不足 300px，上游会拒收；用「生成高清图」重生成后再用' : `只裁不放大（本机免费），切出 ${targets.length} 张原尺寸单图${gridHint ? ` · ${gridHint}` : ''}`}
      >
        切分 {targets.length} 格
      </BarButton>
    </>
  );
}
