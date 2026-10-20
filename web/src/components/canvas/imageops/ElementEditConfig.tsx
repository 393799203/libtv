import { useCanvasStore } from '@/stores/canvasStore';
import { ops, useOpsState } from './opsStore';
import { BarButton, BarDivider, ConfigLabel, ConfigValue, MiniSegmented, MiniSlider } from './atoms';
import { OPS } from './tokens';

/**
 * 元素编辑的配置条内容。
 *
 * 这里只放"怎么选、选了哪几处"——**提示词输入框不在这里**：它浮在选区旁边的图上
 * （ElementEditOverlay 的 ElementPromptBox），因为提示词是"就这一块要改成什么"，
 * 贴着选区写最不容易搞错对象。生成按钮也在那个小框里，用户视线不用来回跳。
 */
export function ElementEditConfig() {
  const { element, busy } = useOpsState();
  const projectId = useCanvasStore((s) => s.projectId);
  const count = element.regions.length;

  return (
    <>
      <ConfigLabel>工具</ConfigLabel>
      <MiniSegmented<'box' | 'point'>
        value={element.tool}
        onChange={(v) => ops.elementPatch({ tool: v })}
        options={[
          { value: 'box', label: '框选', title: '按住拖动，框出要修改的范围（可框多处）' },
          { value: 'point', label: '点选', title: '在要改的元素上点一下，按笔刷大小圈出它' },
        ]}
      />

      {element.tool === 'point' && (
        <>
          <BarDivider />
          <ConfigLabel>笔刷</ConfigLabel>
          {/* 上限 240 ≈ 图宽的四分之三：再大不如直接用框选 */}
          <MiniSlider value={element.brush} min={20} max={240} step={4} onChange={(v) => ops.elementPatch({ brush: v })} />
          <ConfigValue>{element.brush}px</ConfigValue>
        </>
      )}

      <BarDivider />
      {count === 0 ? (
        <span className="whitespace-nowrap text-[11.5px]" style={{ color: OPS.faint }}>
          框选要改的地方；点选会自动认出是什么并框住它（通常 2~10s）
        </span>
      ) : (
        <span className="whitespace-nowrap text-[11.5px]" style={{ color: OPS.faint }}>
          已选 {count} 处
        </span>
      )}

      <BarDivider />
      <BarButton onClick={() => ops.elementUndo()} disabled={count === 0 || busy} title="撤销最后一个选区">
        撤销一处
      </BarButton>
      <BarButton onClick={() => ops.elementClearRegions()} disabled={count === 0 || busy} title="清空所有选区（提示词保留）">
        清空
      </BarButton>

      {/* 没有项目上下文时提交会失败，提前把原因说清楚（生成按钮在选区旁的输入框里） */}
      {!projectId && (
        <span className="whitespace-nowrap text-[11.5px]" style={{ color: OPS.warn }}>
          当前不在项目画布中，无法提交
        </span>
      )}
    </>
  );
}