import { useState } from 'react';
import { message } from '@/utils/antdApp';
import { imageOpsApi } from '@/services/imageOpsApi';
import { useCanvasStore } from '@/stores/canvasStore';
import { commitDerivedNodes, createReferenceImageNode, createSplitNodes, replaceNodeImage } from '@/utils/imageOpsNodes';
import { buildUpscalePrompt } from '@/utils/imageViewPrompts';
import { startNodeExecutions } from '@/utils/runNodes';
import { ops, useOpsState } from './opsStore';
import { BarButton, BarDivider, ConfigLabel, ConfigSelect, MiniSegmented } from './atoms';
import { OPS } from './tokens';

function failText(e: unknown): string {
  if (e instanceof Error) return e.message || '操作失败，请重试';
  return '操作失败，请重试';
}

/**
 * 画质提升的配置条内容。两条路的代价完全不同，所以用分段切换，只显示当前这条的参数：
 * - 尺寸放大：本机 ffmpeg，免费、只改像素尺寸（主要修"素材太小被上游拒收"）；
 * - 4K 重生成：走上游、扣积分，画面会有细微变化。
 */
export function QualityConfig({
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
  const { busy } = useOpsState();
  const projectId = useCanvasStore((s) => s.projectId);
  const sourceNode = useCanvasStore((s) => s.nodes.find((n) => n.id === nodeId));
  const [path, setPath] = useState<'scale' | 'regen'>('scale');
  const [targetShort, setTargetShort] = useState('1080');
  const [output, setOutput] = useState<'new' | 'replace'>('new');

  const shortSide = width && height ? Math.min(width, height) : 0;

  const doScale = async () => {
    if (!sourceNode) {
      message.error('找不到源节点');
      return;
    }
    ops.busy(true);
    try {
      const res = await imageOpsApi.scale({ imageUrl, targetShort: Number(targetShort), projectId: projectId || undefined });
      if (!res.tile) {
        message.error('放大失败：没有返回结果');
        return;
      }
      if (res.tile.skipped) {
        message.info(`原图短边已经是 ${shortSide}px，不小于目标 ${targetShort}px，无需放大`);
        return;
      }
      if (output === 'replace') {
        replaceNodeImage(nodeId, res.tile);
        message.success(`已放大到短边 ${targetShort}px 并替换当前图片（Ctrl+Z 可撤销）`);
      } else {
        const { nodes, edges } = createSplitNodes(sourceNode, [res.tile], 1, 1);
        commitDerivedNodes(nodes, edges);
        message.success(`已放大到短边 ${targetShort}px，新节点放在右侧（原图保留）`);
      }
      ops.close();
    } catch (e) {
      message.error(failText(e));
    } finally {
      ops.busy(false);
    }
  };

  const doRegenerate = async () => {
    if (!sourceNode || !projectId) {
      message.error('当前不在项目画布中，无法生成');
      return;
    }
    ops.busy(true);
    try {
      const { node, edge } = createReferenceImageNode(sourceNode, {
        promptTemplate: buildUpscalePrompt('{{REF}}'),
        label: `${sourceNode.data.label || '图片'}-4K`,
        resolution: '4K',
        aspectRatio: (sourceNode.data as { aspectRatio?: string }).aspectRatio || '16:9',
      });
      commitDerivedNodes([node], [edge]);
      // 新建的节点必须先落库：后端执行计划是在已保存的画布里找 startNodeId 的，
      // 漏了这一步就会报 build execution plan failed: node not found in canvas
      await startNodeExecutions(projectId, [node.id]);
      message.success('已按原图参考开始 4K 重生成，出图后新节点自动更新（原图保留，画面可能有细微变化）');
      ops.close();
    } catch (e) {
      message.error(failText(e));
    } finally {
      ops.busy(false);
    }
  };

  return (
    <>
      <MiniSegmented<'scale' | 'regen'>
        value={path}
        onChange={setPath}
        options={[
          { value: 'scale', label: '尺寸放大', title: '本机处理，不扣积分，只改像素尺寸' },
          { value: 'regen', label: '4K 重生成', title: '走上游模型，扣积分，画面可能有细微变化' },
        ]}
      />

      {path === 'scale' ? (
        <>
          <BarDivider />
          <ConfigLabel>目标短边</ConfigLabel>
          <ConfigSelect
            value={targetShort}
            onChange={setTargetShort}
            options={[
              { value: '720', label: '720 px' },
              { value: '1080', label: '1080 px' },
              { value: '1440', label: '1440 px' },
              { value: '2048', label: '2048 px' },
            ]}
            width={96}
            ariaLabel="目标短边"
          />
          <ConfigLabel>输出</ConfigLabel>
          <ConfigSelect<'new' | 'replace'>
            value={output}
            onChange={setOutput}
            options={[
              { value: 'new', label: '新增节点' },
              { value: 'replace', label: '替换当前' },
            ]}
            width={104}
            ariaLabel="输出方式"
          />
          <BarButton
            primary
            onClick={doScale}
            disabled={busy}
            title={`放大到短边 ${targetShort}px：本机处理、不扣积分，只改像素尺寸不补细节${
              shortSide ? ` · 当前短边 ${shortSide}px` : ''
            }`}
          >
            {busy ? '处理中…' : '放大'}
          </BarButton>
        </>
      ) : (
        <>
          <BarButton
            primary
            onClick={doRegenerate}
            disabled={busy}
            title="以本图为参考重新生成 4K：保持构图/人物/配色并补细节 · 扣积分"
          >
            {busy ? '处理中…' : '开始重生成'}
          </BarButton>
        </>
      )}
    </>
  );
}