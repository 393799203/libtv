import { useViewport } from '@xyflow/react';
import { useEffect, useRef, useState } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import { getOpsState, ops, useOpsState } from './opsStore';
import { cellBoxes, clampCut, effectiveCuts, trimBands } from './geometry';
import { OPS, screenPx } from './tokens';

/**
 * 宫格切分覆盖层：**直接画在节点图片上**，不弹窗。
 *
 * 为什么这样更好：
 * - 用户看的始终是真实图片本身（原图像素、真实构图），对齐白边时不用在"小预览"和"实际图"之间来回换算；
 * - 拖分割线的落点就是最终切点，不存在"预览对了切出来偏了"；
 * - 画布平移缩放都在眼前，可以边切边看相邻节点。
 *
 * 三个实现要点：
 * 1. 覆盖层用 `aspect-ratio` 撑成与图片完全等大的盒子（图片是 w-full 且保持比例），
 *    内部一律用百分比定位 —— 与画布 zoom、缩略图尺寸都无关。
 * 2. 线宽/把手/字号都过 screenPx()，缩放画布时这些装饰保持屏幕尺寸恒定。
 * 3. 拖动期间把 move/up 挂在 window 上：细线只有 16px 宽，指针一偏出就会中断拖动。
 */
export function SplitOverlay({
  nodeId,
  imageWidth,
  imageHeight,
}: {
  nodeId: string;
  imageWidth?: number;
  imageHeight?: number;
}) {
  const { mode, targetId, split } = useOpsState();
  const { zoom } = useViewport();
  const boxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ axis: 'x' | 'y'; index: number } | null>(null);
  const [dragging, setDragging] = useState<{ axis: 'x' | 'y'; index: number } | null>(null);
  const [hoverCell, setHoverCell] = useState<number | null>(null);

  const active = mode === 'split' && targetId === nodeId;

  useEffect(() => {
    if (!active) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      const host = boxRef.current;
      if (!d || !host) return;
      const r = host.getBoundingClientRect();
      const total = d.axis === 'x' ? r.width : r.height;
      if (total <= 0) return;
      const start = d.axis === 'x' ? r.left : r.top;
      const raw = ((d.axis === 'x' ? e.clientX : e.clientY) - start) / total;

      const st = getOpsState();
      const cur =
        d.axis === 'x'
          ? effectiveCuts(st.split.cutsX, st.split.cols)
          : effectiveCuts(st.split.cutsY, st.split.rows);
      const next = cur.slice();
      next[d.index] = clampCut(cur, d.index, raw);
      ops.splitCuts(d.axis, next);
    };
    const onUp = () => {
      dragRef.current = null;
      setDragging(null);
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

  if (!active) return null;

  const seen = split.cutsX.length > 0 || split.cutsY.length > 0;
  const cutsX = effectiveCuts(split.cutsX, split.cols);
  const cutsY = effectiveCuts(split.cutsY, split.rows);
  const boxes = cellBoxes(cutsX, cutsY);

  const hasDims = Boolean(imageWidth && imageHeight);
  const bandV = hasDims ? trimBands(cutsX, imageWidth!, split.trimPx) : [];
  const bandH = hasDims ? trimBands(cutsY, imageHeight!, split.trimPx) : [];

  const lineHit = screenPx(16, zoom);
  const knobW = screenPx(20, zoom);
  const knobH = screenPx(10, zoom);
  const showSize = boxes.length <= 4 && hasDims;

  const startDrag = (axis: 'x' | 'y', index: number) => {
    dragRef.current = { axis, index };
    setDragging({ axis, index });
  };

  return (
    <div
      ref={boxRef}
      data-image-split-overlay
      className="nodrag pointer-events-none absolute left-0 top-0 w-full"
      style={{
        aspectRatio: hasDims ? `${imageWidth} / ${imageHeight}` : undefined,
        inset: hasDims ? undefined : 0,
        // 必须高于节点内 loading/error 占位层的 z-10：图还没加载完或加载失败时，
        // 那两层会盖住整个图片区，分割线就点不到了
        zIndex: 20,
        boxShadow: `inset 0 0 0 ${screenPx(1, zoom)}px rgba(255,255,255,0.35)`,
        borderRadius: 2,
      }}
    >
      {/* 会被内缩吃掉的白边区域：暗色蒙版比虚线直观（暗 = 不要这段） */}
      {bandV.map((b, i) => (
        <div
          key={`bv${i}`}
          className="absolute top-0 h-full"
          style={{
            left: `${(b.from / imageWidth!) * 100}%`,
            width: `${((b.to - b.from) / imageWidth!) * 100}%`,
            background: OPS.scrim,
          }}
        />
      ))}
      {bandH.map((b, i) => (
        <div
          key={`bh${i}`}
          className="absolute left-0 w-full"
          style={{
            top: `${(b.from / imageHeight!) * 100}%`,
            height: `${((b.to - b.from) / imageHeight!) * 100}%`,
            background: OPS.scrim,
          }}
        />
      ))}

      {/* 可点选的宫格区域：切分/生成高清只作用于被选中的格子（不选=全部）。
          这一层在分割线**下面**，所以线还是照样能抓（线上有更大的 zIndex 与 16px 命中带）。 */}
      {boxes.map((b) => {
        const selected = split.selected.includes(b.index);
        const hovered = hoverCell === b.index;
        return (
          <div
            key={`cell${b.index}`}
            data-split-cell={b.index}
            className="nodrag absolute"
            style={{
              left: `${b.x * 100}%`,
              top: `${b.y * 100}%`,
              width: `${b.w * 100}%`,
              height: `${b.h * 100}%`,
              zIndex: 10,
              pointerEvents: 'auto',
              touchAction: 'none',
              cursor: 'pointer',
              background: selected ? OPS.accentSoft : hovered ? 'rgba(255,255,255,0.08)' : 'transparent',
              boxShadow: `inset 0 0 0 ${screenPx(selected ? 2 : 1, zoom)}px ${
                selected ? OPS.accent : OPS.keptEdge
              }`,
              borderRadius: screenPx(2, zoom),
            }}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              // 按住 ⌘/Ctrl/Shift 追加或取消，否则只留这一格 —— 与画布上多选节点的习惯一致
              ops.splitSelect(b.index, e.metaKey || e.ctrlKey || e.shiftKey);
            }}
            onPointerEnter={() => setHoverCell(b.index)}
            onPointerLeave={() => setHoverCell((h) => (h === b.index ? null : h))}
            title={
              selected
                ? `第 ${b.index + 1} 格（已选中，按住 ⌘/Ctrl 再点可取消）`
                : `点一下选中第 ${b.index + 1} 格；按住 ⌘/Ctrl 可多选`
            }
          />
        );
      })}

      {/* 格号：让用户一眼对上"切出来第几张"（后端返回顺序与这里一致，行优先） */}
      {boxes.map((b) => {
        const selected = split.selected.includes(b.index);
        // 每格的实际像素尺寸；拿不到原图尺寸时保持 null —— 宁可只显示格号，
        // 也绝不显示 NaN×NaN（实测 data.width 缺失的节点会算出 NaN）
        const cellW = hasDims ? Math.round(b.w * imageWidth!) - split.trimPx * 2 : null;
        const cellH = hasDims ? Math.round(b.h * imageHeight!) - split.trimPx * 2 : null;
        const sizeText = cellW !== null && cellH !== null ? `${cellW}×${cellH}` : '';
        const tooSmall = cellW !== null && cellH !== null && (cellW < 300 || cellH < 300);
        return (
          <div
            key={`badge${b.index}`}
            className="absolute flex items-center justify-center font-semibold"
            style={{
              left: `${b.x * 100}%`,
              top: `${b.y * 100}%`,
              marginLeft: screenPx(4, zoom),
              marginTop: screenPx(4, zoom),
              height: screenPx(17, zoom),
              minWidth: screenPx(17, zoom),
              padding: `0 ${screenPx(5, zoom)}px`,
              borderRadius: screenPx(5, zoom),
              // 选中 > 过小告警 > 普通：选中态最需要一眼看到
              background: selected ? OPS.accent : tooSmall ? OPS.warn : OPS.badge,
              color: selected ? OPS.accentText : tooSmall ? '#422006' : '#fff',
              fontSize: screenPx(9.5, zoom),
              lineHeight: 1,
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
            }}
            title={tooSmall ? `第 ${b.index + 1} 格短边不足 300px，上游可能拒收（用「生成高清图」重新生成 4K 版）` : undefined}
          >
            {showSize || selected ? (sizeText ? `${b.index + 1} · ${sizeText}` : `${b.index + 1}`) : b.index + 1}
          </div>
        );
      })}

      {/* 竖向分割线 */}
      {cutsX.map((ratio, i) => {
        const on = dragging?.axis === 'x' && dragging.index === i;
        return (
          <div
            key={`cx${i}`}
            className="nodrag pointer-events-auto absolute top-0 h-full"
            style={{
              left: `${ratio * 100}%`,
              width: lineHit,
              marginLeft: -lineHit / 2,
              cursor: 'col-resize',
              touchAction: 'none',
              zIndex: 30,
            }}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              startDrag('x', i);
            }}
            title={`拖动调整这条竖分割线（当前 ${Math.round(ratio * 100)}%）`}
          >
            {/* 白色描边 + 亮蓝主线：压在亮图暗图上都看得清 */}
            <div
              className="absolute top-0 h-full"
              style={{
                left: '50%',
                width: screenPx(4, zoom),
                marginLeft: -screenPx(2, zoom),
                background: OPS.lineHalo,
                borderRadius: 2,
              }}
            />
            <div
              className="absolute top-0 h-full"
              style={{
                left: '50%',
                width: screenPx(2, zoom),
                marginLeft: -screenPx(1, zoom),
                background: on ? OPS.lineOnImageActive : OPS.lineOnImage,
                borderRadius: 1,
              }}
            />
            {/* 中段把手 = "这条能拖"的视觉承诺 */}
            <div
              className="absolute left-1/2 top-1/2 flex items-center justify-center"
              style={{
                width: knobW,
                height: knobH,
                marginLeft: -knobW / 2,
                marginTop: -knobH / 2,
                background: '#fff',
                border: `${screenPx(1, zoom)}px solid ${on ? OPS.accent : 'rgba(15,23,42,0.55)'}`,
                borderRadius: knobH / 2,
                boxShadow: '0 1px 3px rgba(15,23,42,0.25)',
              }}
            >
              <span
                style={{
                  width: screenPx(9, zoom),
                  height: screenPx(2, zoom),
                  background: `repeating-linear-gradient(to right, ${on ? OPS.accentText : 'rgba(15,23,42,0.55)'} 0 ${screenPx(1.2, zoom)}px, transparent ${screenPx(1.2, zoom)}px ${screenPx(3.2, zoom)}px)`,
                }}
              />
            </div>
            {on && (
              <div
                className="absolute left-1/2 font-semibold"
                style={{
                  top: screenPx(6, zoom),
                  transform: 'translateX(-50%)',
                  background: OPS.accent,
                  color: OPS.accentText,
                  borderRadius: screenPx(4, zoom),
                  padding: `${screenPx(1, zoom)}px ${screenPx(5, zoom)}px`,
                  fontSize: screenPx(10, zoom),
                  whiteSpace: 'nowrap',
                }}
              >
                {Math.round(ratio * 100)}%
              </div>
            )}
          </div>
        );
      })}

      {/* 横向分割线 */}
      {cutsY.map((ratio, i) => {
        const on = dragging?.axis === 'y' && dragging.index === i;
        return (
          <div
            key={`cy${i}`}
            className="nodrag pointer-events-auto absolute left-0 w-full"
            style={{
              top: `${ratio * 100}%`,
              height: lineHit,
              marginTop: -lineHit / 2,
              cursor: 'row-resize',
              touchAction: 'none',
              zIndex: 25,
            }}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              startDrag('y', i);
            }}
            title={`拖动调整这条横分割线（当前 ${Math.round(ratio * 100)}%）`}
          >
            <div
              className="absolute left-0 w-full"
              style={{
                top: '50%',
                height: screenPx(4, zoom),
                marginTop: -screenPx(2, zoom),
                background: OPS.lineHalo,
                borderRadius: 2,
              }}
            />
            <div
              className="absolute left-0 w-full"
              style={{
                top: '50%',
                height: screenPx(2, zoom),
                marginTop: -screenPx(1, zoom),
                background: on ? OPS.lineOnImageActive : OPS.lineOnImage,
                borderRadius: 1,
              }}
            />
            <div
              className="absolute left-1/2 top-1/2 flex items-center justify-center"
              style={{
                width: knobH,
                height: knobW / 2,
                marginLeft: -knobH / 2,
                marginTop: -knobW / 4,
                background: '#fff',
                border: `${screenPx(1, zoom)}px solid ${on ? OPS.accent : 'rgba(15,23,42,0.55)'}`,
                borderRadius: knobH / 2,
                boxShadow: '0 1px 3px rgba(15,23,42,0.25)',
              }}
            >
              <span
                style={{
                  width: screenPx(9, zoom),
                  height: screenPx(2, zoom),
                  background: `repeating-linear-gradient(to right, ${on ? OPS.accentText : 'rgba(15,23,42,0.55)'} 0 ${screenPx(1.2, zoom)}px, transparent ${screenPx(1.2, zoom)}px ${screenPx(3.2, zoom)}px)`,
                }}
              />
            </div>
            {on && (
              <div
                className="absolute left-1/2 font-semibold"
                style={{
                  top: screenPx(6, zoom),
                  transform: 'translateX(-50%)',
                  background: OPS.accent,
                  color: OPS.accentText,
                  borderRadius: screenPx(4, zoom),
                  padding: `${screenPx(1, zoom)}px ${screenPx(5, zoom)}px`,
                  fontSize: screenPx(10, zoom),
                  whiteSpace: 'nowrap',
                }}
              >
                {Math.round(ratio * 100)}%
              </div>
            )}
          </div>
        );
      })}

      {/* 右下角提示：拖过线才出现的"手动调整"状态，避免用户以为还是等分 */}
      {seen && (
        <div
          className="absolute bottom-0 right-0 font-medium text-white"
          style={{
            margin: screenPx(5, zoom),
            padding: `${screenPx(2, zoom)}px ${screenPx(6, zoom)}px`,
            background: 'rgba(15,23,42,0.62)',
            borderRadius: screenPx(5, zoom),
            fontSize: screenPx(9.5, zoom),
            whiteSpace: 'nowrap',
          }}
        >
          分割线已手动调整
        </div>
      )}
    </div>
  );
}