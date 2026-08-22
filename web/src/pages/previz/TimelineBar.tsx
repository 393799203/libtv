import { useEffect } from 'react';
import { Slider, InputNumber } from 'antd';
import { PlayCircleOutlined, PauseCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { usePrevizStore } from './previzStore';

// 底部时间轴播放条（P3 会重做完整时间轴，这里只做基础播放控制）
export function TimelineBar() {
  const playing = usePrevizStore((s) => s.playing);
  const currentTime = usePrevizStore((s) => s.currentTime);
  const duration = usePrevizStore((s) => s.duration);
  const setPlaying = usePrevizStore((s) => s.setPlaying);
  const setCurrentTime = usePrevizStore((s) => s.setCurrentTime);
  const setDuration = usePrevizStore((s) => s.setDuration);

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

  return (
    <div className="h-12 bg-white border-t border-gray-200 flex items-center px-3 gap-3 shrink-0">
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

      {/* 进度条 */}
      <Slider
        className="flex-1"
        min={0}
        max={duration}
        step={0.01}
        value={currentTime}
        tooltip={{ formatter: (v) => `${(v ?? 0).toFixed(2)}s` }}
        onChange={(v) => setCurrentTime(v)}
      />

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
  );
}
