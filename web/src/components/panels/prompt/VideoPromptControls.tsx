import { memo, useMemo, useEffect } from 'react';
import type { VideoMode } from '@/types/canvas';

// ==================== 模式定义 ====================

export const VIDEO_MODES: Array<{
  value: VideoMode;
  label: string;
  /** 该模式需要的图片数量范围 [min, max]，0 表示不需要图片 */
  imageRange: [number, number];
}> = [
  { value: 'text-to-video', label: '文生视频', imageRange: [0, 0] },
  { value: 'video-ref', label: '视频参考', imageRange: [1, 1] },
  { value: 'first-last-frame', label: '首尾帧', imageRange: [2, 2] },
  { value: 'universal-ref', label: '全能参考', imageRange: [1, 5] },
];

/** 判断某模式在当前图片数量下是否可用 */
function isModeAvailable(imageCount: number, imageRange: [number, number]): boolean {
  const [min, max] = imageRange;
  return imageCount >= min && (max === 0 ? imageCount === 0 : imageCount <= max);
}

/** 当前模式不可用时自动切换到第一个可用模式 */
function getAutoMode(currentMode: VideoMode, imageCount: number): VideoMode {
  if (isModeAvailable(imageCount, VIDEO_MODES.find((m) => m.value === currentMode)!.imageRange)) {
    return currentMode;
  }
  return VIDEO_MODES.find((m) => isModeAvailable(imageCount, m.imageRange))?.value ?? 'text-to-video';
}

// ==================== 模式选择器（顶部 Tab 栏）====================

interface VideoModeSelectorProps {
  value: VideoMode;
  onChange: (mode: VideoMode) => void;
  /** 上游已连接的图片节点数量 */
  imageCount: number;
}

export const VideoModeSelector = memo<VideoModeSelectorProps>(function VideoModeSelector({
  value,
  onChange,
  imageCount,
}) {
  // 当图片数量变化导致当前模式不可用时，自动切换到合适的模式
  const effectiveMode = useMemo(() => getAutoMode(value, imageCount), [value, imageCount]);

  useEffect(() => {
    if (effectiveMode !== value) {
      onChange(effectiveMode);
    }
  }, [effectiveMode, value, onChange]);

  return (
    <div className="flex items-center gap-0.5 pb-3">
      <div className="flex items-center gap-0.5 rounded-lg bg-gray-100/80 p-[3px]">
        {VIDEO_MODES.map((mode) => {
          const available = isModeAvailable(imageCount, mode.imageRange);
          const active = effectiveMode === mode.value;

          return (
            <button
              key={mode.value}
              onClick={() => available && onChange(mode.value)}
              className={`px-2.5 py-1 rounded-md text-[12px] font-medium transition-all ${
                active
                  ? 'bg-white text-gray-900 shadow-sm'
                  : available
                    ? 'text-gray-500 hover:text-gray-700 cursor-pointer'
                    : 'text-gray-300 cursor-not-allowed'
              }`}
              title={
                !available
                  ? `需要 ${mode.imageRange[1] > 0 ? `${mode.imageRange[0]}~${mode.imageRange[1]} 张` : '不需要'}图片`
                  : undefined
              }
            >
              {mode.label}
            </button>
          );
        })}
      </div>
    </div>
  );
});
