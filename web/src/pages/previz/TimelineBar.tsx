import { useEffect, useRef } from 'react';
import { Slider, InputNumber } from 'antd';
import { PlayCircleOutlined, PauseCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { usePrevizStore } from './previzStore';

// 底部时间轴播放条 + 走位关键帧轨道
export function TimelineBar() {
  const playing = usePrevizStore((s) => s.playing);
  const currentTime = usePrevizStore((s) => s.currentTime);
  const duration = usePrevizStore((s) => s.duration);
  const setPlaying = usePrevizStore((s) => s.setPlaying);
  const setCurrentTime = usePrevizStore((s) => s.setCurrentTime);
  const setDuration = usePrevizStore((s) => s.setDuration);
  const characters = usePrevizStore((s) => s.characters);
  const selectedId = usePrevizStore((s) => s.selectedId);
  const updatePathPoint = usePrevizStore((s) => s.updatePathPoint);

  // 选中的角色（选中骨骼/物体时为 null）
  const selectedChar = characters.find((c) => c.id === selectedId) ?? null;

  const laneRef = useRef<HTMLDivElement>(null);
  // 正在拖的关键帧 id：路径点按 t 重排后索引会变，必须按 id 跟踪
  const dragIdRef = useRef<string | null>(null);

  // 播放循环：rAF 驱动播放头前进，到末尾停下
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const store = usePrevizStore.getState();
      const next = store.currentTime + dt;
      if (next >= store.duration) {
        // 停在末尾
        store.setCurrentTime(store.duration);
        store.setPlaying(false);
        return;
      }
      store.setCurrentTime(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  // 把横向像素位置换算成时间（轨道盒已按 Slider 轨道内缩 7px，二者对齐）
  const timeAt = (clientX: number): number => {
    const lane = laneRef.current;
    if (!lane) return 0;
    const rect = lane.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(ratio * duration * 100) / 100;
  };

  // 拖动关键帧：改时刻（路径点会自动按新时刻重排）
  const dragTo = (clientX: number) => {
    const id = dragIdRef.current;
    if (!id || !selectedChar) return;
    const idx = selectedChar.path.findIndex((p) => p.id === id);
    if (idx < 0) return;
    const t = timeAt(clientX);
    updatePathPoint(selectedChar.id, idx, { t });
    setCurrentTime(t);
  };

  const endDrag = () => {
    dragIdRef.current = null;
  };

  return (
    <div className="bg-white border-t border-gray-200 flex flex-col px-3 py-1.5 gap-1 shrink-0">
      {/* 播放控制行 */}
      <div className="h-8 flex items-center gap-3">
        {/* 回开头 */}
        <button
          className="text-gray-500 hover:text-blue-600 transition-colors cursor-pointer"
          title="回到开头"
          onClick={() => setCurrentTime(0)}
        >
          <ReloadOutlined className="text-sm" />
        </button>

        {/* 播放/暂停 */}
        <button
          className="text-gray-600 hover:text-blue-600 transition-colors cursor-pointer"
          title={playing ? '暂停' : '播放'}
          onClick={() => setPlaying(!playing)}
        >
          {playing ? (
            <PauseCircleOutlined className="text-xl" />
          ) : (
            <PlayCircleOutlined className="text-xl" />
          )}
        </button>

        {/* 进度条 + 走位关键帧轨道（关键帧叠在同一盒子里，保证像素级对齐） */}
        <div className="flex-1 relative h-8 flex items-center min-w-0">
          <Slider
            className="!w-full !m-0"
            min={0}
            max={duration}
            step={0.01}
            value={currentTime}
            tooltip={{ formatter: (v) => `${(v ?? 0).toFixed(2)}s` }}
            onChange={(v) => setCurrentTime(v)}
          />
          <div
            ref={laneRef}
            className="absolute left-[7px] right-[7px] bottom-0 h-3 cursor-ew-resize select-none"
            onPointerMove={(e) => dragTo(e.clientX)}
            onPointerUp={endDrag}
            onPointerLeave={endDrag}
          >
            {/* 播放头竖线（与进度条同步） */}
            <div
              className="absolute top-0 bottom-0 w-[2px] -translate-x-1/2 bg-blue-400/60 pointer-events-none"
              style={{ left: `${Math.min(100, (currentTime / Math.max(0.001, duration)) * 100)}%` }}
            />
            {selectedChar && selectedChar.path.length > 0 ? (
              selectedChar.path.map((p, i) => (
                <button
                  key={p.id ?? `${p.t}-${i}`}
                  className="absolute top-1/2 w-3 h-3 -translate-y-1/2 -translate-x-1/2 rounded-full bg-amber-400 border-2 border-white shadow cursor-ew-resize hover:bg-amber-500 hover:scale-125 transition-transform"
                  style={{ left: `${Math.min(100, (p.t / Math.max(0.001, duration)) * 100)}%` }}
                  title={`走位关键帧 ${i + 1} · ${p.t.toFixed(2)}s —— 左右拖动改时刻`}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    if (!selectedChar) return;
                    // 老场景的路径点没有 id：先补一个，后续拖动才有稳定身份
                    if (p.id) {
                      dragIdRef.current = p.id;
                    } else {
                      const id = `pp-legacy-${selectedChar.id}-${i}-${Date.now().toString(36)}`;
                      updatePathPoint(selectedChar.id, i, { id });
                      dragIdRef.current = id;
                    }
                    setCurrentTime(p.t);
                    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                  }}
                />
              ))
            ) : (
              <span className="absolute inset-0 flex items-center text-[10px] text-gray-200 pl-1">
                （暂无关键帧）
              </span>
            )}
          </div>
        </div>

        {/* 当前时间 */}
        <span className="text-xs text-gray-500 font-mono tabular-nums w-24 text-right shrink-0">
          {currentTime.toFixed(2)}s / {duration}s
        </span>

        {/* 场景时长 */}
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[11px] text-gray-400">时长</span>
          <InputNumber
            size="small"
            min={1}
            max={600}
            value={duration}
            onChange={(v) => {
              if (typeof v === 'number') setDuration(v);
            }}
            className="!w-16"
          />
          <span className="text-[11px] text-gray-400">s</span>
        </div>
      </div>

      {/* 关键帧提示行：固定占位，避免选中/取消角色时时间轴高度跳变 */}
      <div className="flex items-center gap-3 h-4">
        <span className="text-[10px] text-gray-400 w-[46px] shrink-0 text-right">走位关键帧</span>
        <span className="text-[10px] text-amber-600">
          {selectedChar && selectedChar.path.length > 0
            ? `${selectedChar.path.length} 个（左右拖动改时刻，时刻=角色到达该点的时刻）`
            : selectedChar
              ? '暂无（左侧「绘制轨迹」或「+ 路径点」添加）'
              : '选中角色后在此显示走位关键帧'}
        </span>
      </div>
    </div>
  );
}