import { useCallback, useEffect, useRef, useState } from 'react';
import { clampRange, formatTimecode, reshootRangeText, snapSeconds } from '@/utils/reshootPrompt';
import { readPlayheadSeconds, seekPlayhead } from '@/components/canvas/videoPlayhead';

/**
 * 视频节点的「片段选择条」——按剪映（CapCut）那种片段选择的手感做：
 *
 *   ┌──────────────────────────────────────────────┐
 *   │▓▓▓▓▓▓│█████████████████│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓│   ← 缩略图条（整条源视频）
 *   └──────┴─────────────────┴──────────────────────┘
 *          ▲ 白色粗把手          ▲ 选中的一段带白边
 *
 * 几条刻意的设计：
 *  1. **缩略图条是真的**：由后端一次 ffmpeg tile 出整条视频的 N 张缩略拼图（filmstripUrl），
 *     不是拿一张封面重复贴 —— 拖的时候要对得上"这一段画的是什么"。
 *     为什么不让前端自己抽帧：线上视频跨域且**不回 CORS 头**，画进 canvas 会污染画布，
 *     toDataURL 直接抛 SecurityError（截帧那次已经踩过）。
 *  2. 选中段外用暗罩压下去、选中段带白边 + 白色粗把手 —— 亮=选中，全站操作层都是这套
 *     （用户明确说过"高亮的青色系我不喜欢"，所以这里不用任何色相）。
 *  3. **对齐整秒**：提示词里写的是 `mm:ss`，条上的数字和提示词里的数字永远一致。
 *  4. 拖动中只做临时预览（onDrag 走 transient，不进撤销历史），松手才提交（onCommit）一次，
 *     否则拖一次会灌进几十条历史。
 *  4b. **整段可平移**：按住选中段拖动 = 整段挪、时长不变（剪映里就是抓住这一段拖），
 *      两头都不许越过片头片尾；左右方向键也能逐秒平移。
 *  5. 时长读不到时不假装知道：把手置灰并写明原因，绝不按 5 秒硬猜（那会和真实视频对不上）。
 */
export function VideoSegmentBar({
  start,
  end,
  duration,
  filmstripUrl,
  onDrag,
  onCommit,
  warning,
  hint,
  extra,
  busy,
  playerNodeId,
}: {
  /** 已提交的区间（秒，整秒） */
  start: number;
  end: number;
  /** 源视频总时长（秒）；undefined = 还没探到 */
  duration?: number;
  /** 整条源视频的缩略拼图（后端一次 tile 出来的 webp） */
  filmstripUrl?: string;
  /** 拖动中：只预览，不进历史 */
  onDrag: (start: number, end: number) => void;
  /** 松手：提交进历史 */
  onCommit: (start: number, end: number) => void;
  /** 生成前就该让用户看见的告警（例如 fast 模型的参考视频时长上限） */
  warning?: string | null;
  /** 左下角说明文案 */
  hint?: string;
  /** 右下角附加操作（例如"看原片"） */
  extra?: React.ReactNode;
  /** 正在按这个区间裁剪片段：条上显示状态，把手暂时别动 */
  busy?: boolean;
  /**
   * 要驱动的播放器所在节点 id（片段重拍节点把自己的 id 传进来）。
   *
   * 传了它之后：拖把手 / 拖整段 / 按在条上擦洗 / 方向键调区间，都会让**视频跳到那一刻**；
   * 条上还会跟着画一条播放进度线。进度是直接读播放器 DOM 的（见 canvas/videoPlayhead.ts），
   * 不走 store —— timeupdate 每秒好几次，同步进 store 会让整条工具条跟着重渲染。
   */
  playerNodeId?: string;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  // 'seek' = 按在条上擦洗播放进度（不动区间）
  const [dragging, setDragging] = useState<'start' | 'end' | 'band' | 'seek' | null>(null);
  const [live, setLive] = useState<{ start: number; end: number } | null>(null);
  // pointermove 的回调里要拿到"当前这一刻"的值去提交，用 ref 避开闭包快照
  const liveRef = useRef<{ start: number; end: number } | null>(null);
  // 整段拖动：按下时记下"抓的是段内哪个位置"和"这段多长"，之后长度一动不动
  const bandRef = useRef<{ offset: number; length: number } | null>(null);

  const ready = typeof duration === 'number' && Number.isFinite(duration) && duration > 0;
  const view = live ?? { start, end };
  const span = ready ? (duration as number) : Math.max(end, 1);
  const interactive = ready && !busy;

  /**
   * 条 → 播放器：跳到指定秒。
   * 只在这一条自己身上用，不往上抛（父组件不需要知道"跳了多少"，它只知道区间）。
   */
  const seek = useCallback(
    (sec: number) => {
      if (!playerNodeId) return;
      seekPlayhead(playerNodeId, sec);
    },
    [playerNodeId]
  );

  /**
   * 播放器 → 条：把当前播放进度画在缩略图条上。
   *
   * 用 120ms 定时读 DOM 而不是订阅 timeupdate：这条线只需要"看起来跟着走"，
   * 而 setState 只发生在**片段条自己**身上（不是整条节点），120ms 一次完全够用、也不卡。
   * 播放停了也不停轮询：用户可能用播放器自己的进度条拖动，那条线同样要跟上。
   */
  const [playhead, setPlayhead] = useState<number | null>(null);
  useEffect(() => {
    if (!playerNodeId) return;
    const id = window.setInterval(() => {
      const t = readPlayheadSeconds(playerNodeId);
      setPlayhead((prev) => (t === null || (prev !== null && Math.abs(prev - t) < 0.05) ? prev : t));
    }, 120);
    return () => window.clearInterval(id);
  }, [playerNodeId]);

  const secondsAt = useCallback(
    (clientX: number): number | null => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0) return null;
      const ratio = (clientX - rect.left) / rect.width;
      return snapSeconds(Math.min(Math.max(ratio, 0), 1) * span);
    },
    [span]
  );

  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      const sec = secondsAt(e.clientX);
      if (sec === null) return;
      // 按在条上（选中段以外）= 像播放器进度条那样擦洗：只跳播放进度，不动区间
      if (dragging === 'seek') {
        seek(sec);
        return;
      }
      let next: { start: number; end: number };
      if (dragging === 'band') {
        // 整段平移：**时长固定**，只有起点在动；两头都不许越过片头/片尾
        const g = bandRef.current;
        if (!g) return;
        const max = Math.max((ready ? (duration as number) : span) - g.length, 0);
        let ns = snapSeconds(sec - g.offset);
        if (ns < 0) ns = 0;
        if (ns > max) ns = max;
        next = { start: ns, end: ns + g.length };
      } else if (dragging === 'start') {
        next = clampRange(sec, view.end, ready ? (duration as number) : undefined);
      } else {
        next = clampRange(view.start, sec, ready ? (duration as number) : undefined);
      }
      liveRef.current = next;
      setLive(next);
      onDrag(next.start, next.end);
      // 条驱动播放器：拖哪一头就跳到哪一头（拖整段 = 跳到新的起点），
      // 让"我正在选的这一段"眼睛立刻能看到，不用再自己去进度条上找位置。
      seek(dragging === 'end' ? next.end : next.start);
    };
    const up = () => {
      const done = liveRef.current;
      setDragging(null);
      setLive(null);
      liveRef.current = null;
      bandRef.current = null;
      if (done) onCommit(done.start, done.end);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [dragging, duration, onCommit, onDrag, ready, secondsAt, seek, view.end, view.start]);

  /** 键盘也能调：一次一秒，正好是提示词里的最小刻度 */
  const nudge = (which: 'start' | 'end', delta: number) => {
    const next =
      which === 'start'
        ? clampRange(view.start + delta, view.end, ready ? (duration as number) : undefined)
        : clampRange(view.start, view.end + delta, ready ? (duration as number) : undefined);
    onCommit(next.start, next.end);
    seek(which === 'end' ? next.end : next.start);
  };

  const pct = (sec: number) => `${Math.min(Math.max(sec / span, 0), 1) * 100}%`;

  return (
    <div
      // nodrag/nowheel：条上的拖动只调区间，不能把节点或画布一起拖走（React Flow 的约定类名）
      className="nodrag nowheel w-full select-none px-3 pt-2 pb-2.5 border-t border-white/10"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className="mb-1.5 flex items-center justify-between text-[11px] leading-none">
        <span className="text-white/85 font-medium tabular-nums">
          片段 {reshootRangeText(view.start, view.end)}
        </span>
        <span className="text-white/40 tabular-nums">
          {ready ? `共 ${formatTimecode(duration as number)}` : '读取时长中…'}
        </span>
      </div>

      {/* 缩略图条：高一点的条 + 暗罩 + 白边选中段 + 白色粗把手（剪映那种手感） */}
      <div
        ref={trackRef}
        // 不裁剪：把手要上下各探出 4px（探出的那截压在节点底色上，才不会和选中段的白边框糊在一起）。
        // 圆角裁剪交给下面的底图那一层自己做。
        //
        // 按在条上任意位置 = 像进度条那样擦洗：把手和选中段有自己的 handler 并 stopPropagation，
        // 所以按在它们身上不会走到这里；擦洗只跳播放进度，不动区间。
        onPointerDown={(e) => {
          if (!interactive) return;
          e.preventDefault();
          const sec = secondsAt(e.clientX);
          if (sec === null) return;
          seek(sec);
          setDragging('seek');
        }}
        className="relative h-9 w-full rounded-[5px]"
        style={{ background: '#101114' }}
      >
        {/*
          底图单独一层：只有它需要"没就绪就置灰"。
          之前 opacity 加在整条上，把手跟着一起变暗 —— 缩略图一上来（亮帧）白把手就糊没了，
          用户看到的就是"缩略图加载出来后，两个把手不见了"。把手现在永远满不透明度。
        */}
        <div
          className="absolute inset-0 overflow-hidden rounded-[5px]"
          style={{
            background: filmstripUrl
              ? `url(${filmstripUrl}) center/100% 100% no-repeat`
              : 'rgba(255,255,255,0.10)',
            opacity: ready ? 1 : 0.55,
            zIndex: 0,
          }}
        />
        {/* 未选中的左右两段压暗（剪映就是靠这层暗罩突出选中段的）。用 50% 而不是 60%：
            暗罩太重时白把手会被"糊"进去，线上反馈就是"把手像是被黑色遮罩盖住了" */}
        <div className="absolute inset-y-0 left-0 bg-black/50" style={{ width: pct(view.start), zIndex: 1 }} />
        <div
          className="absolute inset-y-0 right-0 bg-black/50"
          style={{ width: `calc(100% - ${pct(view.end)})`, zIndex: 1 }}
        />

        {/*
          选中的一段：白边 + 一圈内描边，压在缩略图上仍然看得清。
          它**本身就是拖拽把手**（剪映里也是抓住这一段整体挪）：按住拖动 = 整段平移、时长不变。
          两个白把手是兄弟节点、层级更高，所以按在把手上走的是"改起点/终点"，不会串。
        */}
        <div
          role="slider"
          tabIndex={interactive ? 0 : -1}
          aria-label="片段区间（整体平移，时长不变）"
          aria-valuemin={0}
          aria-valuemax={Math.max(Math.round(span - (view.end - view.start)), 0)}
          aria-valuenow={view.start}
          aria-valuetext={reshootRangeText(view.start, view.end)}
          aria-disabled={!interactive}
          title={
            busy
              ? '正在按这个区间裁剪…'
              : ready
                ? '按住拖动 = 整段平移（时长不变）；也可以用左右方向键逐秒挪'
                : '还不知道这条视频多长，暂时不能拖'
          }
          className="absolute inset-y-0 rounded-[3px] border border-white/45"
          style={{
            left: pct(view.start),
            width: `calc(${pct(view.end)} - ${pct(view.start)})`,
            boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.35)',
            zIndex: 2,
            cursor: !interactive ? 'default' : dragging === 'band' ? 'grabbing' : 'grab',
          }}
          onPointerDown={(e) => {
            if (!interactive) return;
            e.preventDefault();
            e.stopPropagation();
            const sec = secondsAt(e.clientX);
            if (sec === null) return;
            bandRef.current = { offset: sec - view.start, length: view.end - view.start };
            setLive({ start: view.start, end: view.end });
            liveRef.current = { start: view.start, end: view.end };
            setDragging('band');
          }}
          onKeyDown={(e) => {
            if (!interactive) return;
            const len = view.end - view.start;
            const max = Math.max(span - len, 0);
            if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
              e.preventDefault();
              e.stopPropagation();
              const ns = Math.min(Math.max(view.start + (e.key === 'ArrowLeft' ? -1 : 1), 0), max);
              onCommit(ns, ns + len);
            }
          }}
        />

        {/*
          播放进度线：让"条"和"画面"对得上（读的是播放器真实进度）。
          形状刻意和把手区分开：把手是 6px 粗、上下探出条外；这条是 1.5px 细线 + 顶端一个小圆点。
        */}
        {ready && playhead !== null && (
          <div
            className="pointer-events-none absolute inset-y-0"
            style={{
              left: pct(Math.min(playhead, span)),
              width: 1.5,
              background: '#ffffff',
              opacity: 0.92,
              boxShadow: '0 0 0 1px rgba(0,0,0,0.5)',
              zIndex: 3,
            }}
          >
            <span
              className="absolute left-1/2 top-0 h-1.5 w-1.5 -translate-x-1/2 rounded-full"
              style={{ background: '#ffffff', boxShadow: '0 0 0 1px rgba(0,0,0,0.6)' }}
            />
          </div>
        )}

        {(['start', 'end'] as const).map((which) => (
          <div
            key={which}
            role="slider"
            tabIndex={interactive ? 0 : -1}
            aria-label={which === 'start' ? '片段起点' : '片段终点'}
            aria-valuemin={0}
            aria-valuemax={Math.round(span)}
            aria-valuenow={which === 'start' ? view.start : view.end}
            aria-valuetext={formatTimecode(which === 'start' ? view.start : view.end)}
            aria-disabled={!interactive}
            title={
              busy
                ? '正在按这个区间裁剪…'
                : ready
                  ? `拖动调整${which === 'start' ? '起点' : '终点'}（可用左右方向键逐秒微调）`
                  : '还不知道这条视频多长，暂时不能拖'
            }
            /*
              把手做成"细白条 + 居中跨在分界线上 + 上下各探出 4px"：
                · 细（6px）：之前是 14px 的白块，压在选中段自己的白色边框上，两块白糊成一片，
                  所以怎么加亮都"不明显"、还显得笨重（线上反馈两次）。
                · 居中跨线：条的一半在选中段里、一半在暗罩上，一眼就能看出这是"可以抓的那根"。
                · 上下探出：露在缩略图条外面的那一小截压在节点底色上，
                  不再和噪杂的缩略图抢注意力 —— 这是剪辑软件里把手最好认的地方。
              热区仍然 18px 宽（看不到但抓得到），所以"看着细、抓起来不费劲"。
            */
            className="absolute flex items-center justify-center"
            style={{
              left: `calc(${pct(which === 'start' ? view.start : view.end)} - 9px)`,
              width: 18,
              top: -4,
              bottom: -4,
              cursor: !interactive ? 'default' : dragging === which ? 'grabbing' : 'ew-resize',
              pointerEvents: interactive ? 'auto' : 'none',
              zIndex: 3,
            }}
            onPointerDown={(e) => {
              if (!interactive) return;
              e.preventDefault();
              e.stopPropagation();
              setDragging(which);
              const next = { start: view.start, end: view.end };
              liveRef.current = next;
              setLive(next);
            }}
            onKeyDown={(e) => {
              if (!interactive) return;
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault();
                e.stopPropagation();
                nudge(which, e.key === 'ArrowLeft' ? -1 : 1);
              }
            }}
          >
            {/* 细白条：纯白填充 + 近黑描边 —— 亮帧上有暗边、暗帧上有白身，两种画面上都看得见 */}
            <span
              style={{
                width: 6,
                height: '100%',
                borderRadius: 3,
                background: '#ffffff',
                boxShadow: dragging === which
                  ? '0 0 0 1px rgba(0,0,0,0.75), 0 0 0 4px rgba(255,255,255,0.45)'
                  : '0 0 0 1px rgba(0,0,0,0.65), 0 1px 3px rgba(0,0,0,0.55)',
              }}
            />
            {/* 抓握纹：1.5px 的深色短线，够看出"能抓"就行，不喧宾夺主 */}
            <span
              className="absolute"
              style={{
                width: 1.5,
                height: '38%',
                borderRadius: 1,
                background: 'rgba(0,0,0,0.6)',
              }}
            />
                    </div>
        ))}
      </div>

      <div className="mt-1.5 flex items-start justify-between gap-2 text-[10px] leading-tight">
        <span className="text-white/35">{busy ? '正在按这个区间裁剪…' : ready ? hint : '读取时长中…'}</span>
        <span className="flex shrink-0 items-center gap-2">
          {warning && <span className="text-amber-400/90">{warning}</span>}
          {extra}
        </span>
      </div>
    </div>
  );
}