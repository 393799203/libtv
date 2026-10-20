import { useState } from 'react';
import { message } from '@/utils/antdApp';
import { useCanvasStore } from '@/stores/canvasStore';
import { commitDerivedNodes, createReferenceImageNode } from '@/utils/imageOpsNodes';
import { VIEW_PRESETS, buildViewPrompt, defaultViewKindForAsset } from '@/utils/imageViewPrompts';
import { SHEET_RATIOS, defaultSheetRatio, sheetCellHint } from '@/utils/sheetLayout';
import { startNodeExecutions } from '@/utils/runNodes';
import { ops, useOpsState } from './opsStore';
import { BarButton, BarDivider, ConfigLabel, ConfigSelect, GridGlyph } from './atoms';
import { OPS } from './tokens';

/** 画幅选项：只写比例值本身，形状解释放 hover（横条中间不放说明性文案） */
const RATIO_OPTIONS = SHEET_RATIOS.map((r) => ({ value: r, label: r }));

const VIEW_OPTIONS = VIEW_PRESETS.map((p) => ({
  value: p.kind,
  label: (
    <span className="flex items-center gap-1.5">
      <GridGlyph rows={p.rows} cols={p.cols} />
      <span>{p.label}</span>
      <span className="text-[11px]" style={{ color: OPS.faint }}>
        {p.rows} × {p.cols}
      </span>
    </span>
  ),
}));

/**
 * 生成视图的配置条内容：以当前这张图为参考生成三/四/六视图。
 * 生成后直接点「切分宫格」即可拆成单张 —— 生成时会把视图类型写进节点数据（data.viewKind），
 * 切分时据此自动预选宫格。
 */
export function ViewConfig({ nodeId }: { nodeId: string }) {
  const { busy } = useOpsState();
  const projectId = useCanvasStore((s) => s.projectId);
  const sourceNode = useCanvasStore((s) => s.nodes.find((n) => n.id === nodeId));

  // 优先沿用这张图已有的视图类型（同一资产重生成时保持一致）；
  // 没有就用资产类型决定：场景 → 场景四视图、道具 → 道具六视图、其余 → 角色三视图
  const defaultKind =
    VIEW_PRESETS.find((p) => p.kind === (sourceNode?.data as { viewKind?: string } | undefined)?.viewKind)?.kind ??
    defaultViewKindForAsset((sourceNode?.data as { assetType?: string } | undefined)?.assetType);
  const [kind, setKind] = useState<string>(defaultKind);
  const presetOf = (k: string) => VIEW_PRESETS.find((p) => p.kind === k);
  // 默认沿用既有行为：横排 1×N 用 16:9（每格竖长条，贴近站姿剪影），网格 2×N 用 1:1（方形最中性）
  const [ratio, setRatio] = useState<string>(() => defaultSheetRatio(presetOf(defaultKind)?.rows ?? 1));

  const generate = async () => {
    if (!sourceNode || !projectId) {
      message.error('无法生成：缺少节点或项目上下文');
      return;
    }
    ops.busy(true);
    try {
      const preset = presetOf(kind);
      const { node, edge } = createReferenceImageNode(sourceNode, {
        promptTemplate: buildViewPrompt(kind as (typeof VIEW_PRESETS)[number]['kind'], '{{REF}}'),
        label: `${sourceNode.data.label || '图片'}·${preset?.label || '视图'}`,
        resolution: '4K',
        // 画幅由用户选（沿用旧默认：横排 16:9 / 网格 1:1）。
        // 宫格等比等分，所以每格比例 == 整图比例，2×2 + 16:9 时每格就是 16:9。
        aspectRatio: ratio,
        viewKind: kind,
      });
      commitDerivedNodes([node], [edge]);
      // 新建的节点必须先落库：后端执行计划是在已保存的画布里找 startNodeId 的，
      // 漏了这一步就会报 build execution plan failed: node not found in canvas
      await startNodeExecutions(projectId, [node.id]);
      message.success(`已开始生成${preset?.label || '视图'}。出图后选中它点「切分宫格」，会按 ${preset?.rows}×${preset?.cols} 自动预选`);
      ops.close();
    } catch (e) {
      message.error(e instanceof Error && e.message ? e.message : '生成失败，请重试');
    } finally {
      ops.busy(false);
    }
  };

  return (
    <>
      <ConfigLabel>视图</ConfigLabel>
      <ConfigSelect value={kind} onChange={setKind} options={VIEW_OPTIONS} width={168} ariaLabel="视图类型" />

      <ConfigLabel>画幅</ConfigLabel>
      <ConfigSelect
        value={ratio}
        onChange={setRatio}
        options={RATIO_OPTIONS}
        width={92}
        ariaLabel="画幅"
        title={`整图画幅。宫格是等比等分，每格比例与整图相同；当前${sheetCellHint(ratio, '4K', presetOf(kind)?.rows ?? 1, presetOf(kind)?.cols ?? 1)}`}
      />

      <BarDivider />

      <BarButton
        primary
        onClick={generate}
        disabled={busy}
        title={`以本图为参考生成多视图，保持角色/场景一致 · 扣积分；${sheetCellHint(
          ratio,
          '4K',
          presetOf(kind)?.rows ?? 1,
          presetOf(kind)?.cols ?? 1,
        )}；一致性由上游模型决定：只给一张正面参考时，侧/背面可能变脸，不满意可以再生成一次`}
      >
        {busy ? '提交中…' : '生成'}
      </BarButton>
    </>
  );
}