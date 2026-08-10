import { memo, useMemo, useEffect } from 'react';
import type { VideoMode } from '@/types/canvas';

// ==================== 模式定义 ====================

export const VIDEO_MODES: Array<{
  value: VideoMode;
  label: string;
  /** 该模式需要的图片数量范围 [min, max]，0 表示不需要图片 */
  imageRange: [number, number];
  /** 该模式需要的视频数量范围 [min, max]，0 表示不需要视频 */
  videoRange: [number, number];
}> = [
  { value: 'text-to-video', label: '文生视频', imageRange: [0, 0], videoRange: [0, 0] },
  { value: 'video-ref', label: '视频参考', imageRange: [0, 0], videoRange: [1, 1] },
  { value: 'first-last-frame', label: '首尾帧', imageRange: [2, 2], videoRange: [0, 0] },
  { value: 'universal-ref', label: '全能参考', imageRange: [0, 5], videoRange: [0, 5] },
];

/** 判断某模式在当前图片/视频数量下是否可用 */
function isModeAvailable(
  imageCount: number,
  videoCount: number,
  mode: typeof VIDEO_MODES[number],
): boolean {
  // 全能参考：图片+视频总数 1-5
  if (mode.value === 'universal-ref') {
    const total = imageCount + videoCount;
    return total >= 1 && total <= 5;
  }
  const [imgMin, imgMax] = mode.imageRange;
  const [vidMin, vidMax] = mode.videoRange;
  const imgOk = imageCount >= imgMin && imageCount <= imgMax;
  const vidOk = videoCount >= vidMin && videoCount <= vidMax;
  return imgOk && vidOk;
}

/** 当前模式不可用时自动切换到第一个可用模式 */
function getAutoMode(currentMode: VideoMode, imageCount: number, videoCount: number): VideoMode {
  const current = VIDEO_MODES.find((m) => m.value === currentMode);
  if (current && isModeAvailable(imageCount, videoCount, current)) {
    return currentMode;
  }
  return VIDEO_MODES.find((m) => isModeAvailable(imageCount, videoCount, m))?.value ?? 'text-to-video';
}

/** 生成模式不可用时的 tooltip 提示 */
function getModeTooltip(mode: typeof VIDEO_MODES[number], imageCount: number, videoCount: number): string | undefined {
  if (isModeAvailable(imageCount, videoCount, mode)) return undefined;
  if (mode.value === 'universal-ref') {
    return `需 1-5 个资源（图片或视频，当前 ${imageCount + videoCount} 个）`;
  }
  const parts: string[] = [];
  if (mode.imageRange[0] > 0) {
    parts.push(mode.imageRange[0] === mode.imageRange[1]
      ? `${mode.imageRange[0]} 张图片`
      : `${mode.imageRange[0]}-${mode.imageRange[1]} 张图片`);
  }
  if (mode.videoRange[0] > 0) {
    parts.push(mode.videoRange[0] === mode.videoRange[1]
      ? `${mode.videoRange[0]} 个视频`
      : `${mode.videoRange[0]}-${mode.videoRange[1]} 个视频`);
  }
  const need = parts.length > 0 ? `需 ${parts.join(' + ')}` : '无上游资源时可用';
  return `${need}（当前 ${imageCount} 图 + ${videoCount} 视频）`;
}

// ==================== 模式选择器（顶部 Tab 栏）====================

interface VideoModeSelectorProps {
  value: VideoMode;
  onChange: (mode: VideoMode) => void;
  /** 上游已连接的图片节点数量 */
  imageCount: number;
  /** 上游已连接的视频节点数量 */
  videoCount: number;
}

export const VideoModeSelector = memo<VideoModeSelectorProps>(function VideoModeSelector({
  value,
  onChange,
  imageCount,
  videoCount,
}) {
  // 当图片/视频数量变化导致当前模式不可用时，自动切换到合适的模式
  const effectiveMode = useMemo(
    () => getAutoMode(value, imageCount, videoCount),
    [value, imageCount, videoCount],
  );

  useEffect(() => {
    if (effectiveMode !== value) {
      onChange(effectiveMode);
    }
  }, [effectiveMode, value, onChange]);

  return (
    <div className="flex items-center gap-0.5 pb-3">
      <div className="flex items-center gap-0.5 rounded-lg bg-gray-100/80 p-[3px]">
        {VIDEO_MODES.map((mode) => {
          const available = isModeAvailable(imageCount, videoCount, mode);
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
              title={getModeTooltip(mode, imageCount, videoCount)}
            >
              {mode.label}
            </button>
          );
        })}
      </div>
    </div>
  );
});
