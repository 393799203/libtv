import { memo, useState, useRef, useCallback, useMemo, useEffect } from 'react';
import type { NodeProps, Node } from '@xyflow/react';
import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  UploadOutlined,
  AudioOutlined,
} from '@ant-design/icons';
import { BaseNode } from './BaseNode';
import type { AudioNodeData } from '@/types/canvas';
import { useCanvasStore } from '@/stores/canvasStore';
import { uploadAudio } from '@/services/uploadApi';

type AudioNodeType = Node<AudioNodeData, 'audio'>;

// 从音频文件 URL 中提取真实波形数据
async function extractWaveformFromAudio(
  audioUrl: string,
  barCount: number = 60,
): Promise<number[]> {
  const response = await fetch(audioUrl);
  const arrayBuffer = await response.arrayBuffer();
  const audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  // 取左声道数据
  const rawData = audioBuffer.getChannelData(0);
  const samplesPerBar = Math.floor(rawData.length / barCount);
  const bars: number[] = [];

  for (let i = 0; i < barCount; i++) {
    let sum = 0;
    for (let j = 0; j < samplesPerBar; j++) {
      sum += Math.abs(rawData[i * samplesPerBar + j]);
    }
    const avg = sum / samplesPerBar;
    // 放大幅度，让波形更饱满明显
    bars.push(Math.max(0.06, Math.min(1, avg * 6)));
  }

  audioContext.close();
  return bars;
}

// 格式化时间 mm:ss
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// 波形可视化组件（从真实音频提取波形）
const WaveformVisualizer = memo(function WaveformVisualizer({
  audioUrl,
  currentTime,
  duration,
  onSeek,
}: {
  audioUrl: string;
  currentTime: number;
  duration: number;
  onSeek: (ratio: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [waveformBars, setWaveformBars] = useState<number[] | null>(null);
  const [loading, setLoading] = useState(true);
  const progressRatio = duration > 0 ? currentTime / duration : 0;

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const ratio = Math.max(0, Math.min(1, x / rect.width));
      onSeek(ratio);
    },
    [onSeek]
  );

  // 音频 URL 变化时重新提取波形
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setWaveformBars(null);
    extractWaveformFromAudio(audioUrl, 60).then((bars) => {
      if (!cancelled) {
        setWaveformBars(bars);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [audioUrl]);

  // 加载中：显示骨架屏
  if (loading || !waveformBars) {
    return (
      <div className="w-full h-20 flex items-center justify-center gap-[3px]">
        {Array.from({ length: 60 }).map((_, i) => (
          <div
            key={i}
            className="w-[3px] rounded-full bg-gray-200 animate-pulse"
            style={{
              height: `${8 + Math.random() * 32}px`,
              animationDelay: `${i * 30}ms`,
              animationDuration: '1s',
            }}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full h-20 cursor-pointer select-none"
      onClick={handleClick}
    >
      {/* 波形柱状图 */}
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex items-center justify-center gap-[3px]">
        {waveformBars.map((height: number, i: number) => {
          const barProgress = i / waveformBars.length;
          const isPlayed = barProgress <= progressRatio;
          return (
            <div
              key={i}
              className={`w-[3px] rounded-full transition-colors ${
                isPlayed ? 'bg-gray-800' : 'bg-gray-300'
              }`}
              style={{ height: `${height * 48}px` }}
            />
          );
        })}
      </div>

      {/* 红色进度线 */}
      {duration > 0 && (
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-red-500 pointer-events-none"
          style={{ left: `${progressRatio * 100}%` }}
        />
      )}
    </div>
  );
});

export const AudioNode = memo<NodeProps<AudioNodeType>>(function AudioNode({ id, data, selected }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const projectId = useCanvasStore((s) => s.projectId);

  // 播放状态
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(data.duration || 0);
  // 上传状态
  const [uploading, setUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');

  // 音频时长（优先使用已加载的 duration）
  const displayDuration = duration > 0 ? duration : (data.duration || 0);

  // 同步外部 audioUrl 变化时重置播放状态
  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    if (!data.audioUrl) {
      setDuration(0);
    }
  }, [data.audioUrl]);

  // ====== 上传逻辑 ======
  const handleUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setUploading(true);
      setUploadPercent(0);
      setErrorMsg('');

      try {
        const url = await uploadAudio(file, (pct) => setUploadPercent(pct), projectId || undefined);
        // 从文件名提取名称（去掉扩展名）
        const name = file.name.replace(/\.[^.]+$/, '');
        useCanvasStore.getState().updateNodeData(id, {
          audioUrl: url,
          audioName: name || '上传音频',
        } as Partial<AudioNodeData>);
      } catch (err) {
        const message = err instanceof Error ? err.message : '音频上传失败';
        console.error('音频上传失败:', err);
        setErrorMsg(message);
      } finally {
        setUploading(false);
        setUploadPercent(0);
      }

      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [id, projectId]
  );

  // ====== 播放控制 ======
  const handlePlayPause = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const audio = audioRef.current;
      if (!audio || !data.audioUrl) return;

      if (isPlaying) {
        audio.pause();
        setIsPlaying(false);
      } else {
        audio.play().catch(() => {});
        setIsPlaying(true);
      }
    },
    [isPlaying, data.audioUrl]
  );

  const handleTimeUpdate = useCallback(() => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  }, []);

  const handleLoadedMetadata = useCallback(() => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
      useCanvasStore.getState().updateNodeData(id, {
        duration: Math.round(audioRef.current.duration),
      } as Partial<AudioNodeData>);
    }
  }, [id]);

  const handleEnded = useCallback(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
    }
  }, []);

  const handleSeek = useCallback((ratio: number) => {
    const audio = audioRef.current;
    if (!audio || !data.audioUrl) return;
    audio.currentTime = ratio * audio.duration;
    setCurrentTime(audio.currentTime);
  }, [data.audioUrl]);

  // ====== 头部右侧：上传按钮 ======
  const headerRight = useMemo(() => {
    if (data.audioUrl) {
      return (
        <button
          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-[11px] text-white transition-colors cursor-pointer"
          onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
          title="重新上传音频"
        >
          <UploadOutlined className="text-[10px]" />
          重传
        </button>
      );
    }
    return (
      <button
        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[12px] text-white transition-colors cursor-pointer flex-shrink-0 ${
          uploading ? 'bg-emerald-300 cursor-wait' : 'bg-emerald-500 hover:bg-emerald-600'
        }`}
        onClick={(e) => { e.stopPropagation(); if (!uploading) fileInputRef.current?.click(); }}
      >
        <UploadOutlined className="text-[11px]" />
        {uploading ? `${uploadPercent}%` : '上传'}
      </button>
    );
  }, [data.audioUrl, uploading, uploadPercent]);

  // 显示在头部的标签：有音频名称用音频名称 + 音色，否则用默认
  // headerLabel 可用于后续自定义头部显示
  void data.audioName;

  return (
    <>
      <BaseNode
        id={id}
        data={data}
        selected={selected}
        headerRight={headerRight}
        noContentPadding
      >
        <div className="w-full">
          {data.audioUrl ? (
            /* 有音频：显示波形播放器 */
            <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
              {/* 波形区域 */}
              <div className="relative px-2 pt-2 pb-1">
                {/* 波形 */}
                <WaveformVisualizer
                  audioUrl={data.audioUrl}
                  currentTime={currentTime}
                  duration={displayDuration}
                  onSeek={handleSeek}
                />
              </div>

              {/* 底部控制栏：时间 + 播放按钮 */}
              <div className="flex items-center justify-between px-2 pb-2 pt-1">
                <span className="text-xs text-gray-500 font-mono tabular-nums">
                  {formatTime(currentTime)} / {formatTime(displayDuration)}
                </span>
                <button
                  className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                    isPlaying
                      ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                  onClick={handlePlayPause}
                  title={isPlaying ? '暂停' : '播放'}
                >
                  {isPlaying ? (
                    <PauseCircleOutlined className="text-sm" />
                  ) : (
                    <PlayCircleOutlined className="text-sm" />
                  )}
                </button>
                <span className="w-16" /> {/* 占位保持居中 */}
              </div>
            </div>
          ) : uploading ? (
            /* 上传中状态 */
            <div className="flex flex-col items-center justify-center py-6 bg-gray-50 rounded-xl border border-dashed border-gray-300">
              <div className="w-7 h-7 border-2 border-emerald-200 border-t-emerald-500 rounded-full animate-spin mb-2" />
              <span className="text-xs text-gray-500">上传中 {uploadPercent}%</span>
              <div className="w-32 h-1.5 bg-gray-200 rounded-full overflow-hidden mt-2">
                <div
                  className="h-full rounded-full transition-all duration-200 bg-emerald-500"
                  style={{ width: `${uploadPercent}%` }}
                />
              </div>
            </div>
          ) : errorMsg ? (
            /* 错误状态 */
            <div className="flex flex-col items-center justify-center py-6 bg-red-50 rounded-xl border border-dashed border-red-200">
              <span className="text-xs text-red-500 text-center px-4 leading-relaxed">{errorMsg}</span>
              <button
                className="mt-2 px-3 py-1 text-[11px] bg-red-50 text-red-500 rounded hover:bg-red-100 transition-colors cursor-pointer"
                onClick={(e) => { e.stopPropagation(); setErrorMsg(''); fileInputRef.current?.click(); }}
              >
                重新上传
              </button>
            </div>
          ) : (
            /* 空状态：按配置高度撑开 + 背景图标 */
            <div className="w-full h-full min-h-[120px] rounded-lg bg-gray-50 flex flex-col items-center justify-center">
              <AudioOutlined className="text-4xl text-gray-300" />
            </div>
          )
        }
        </div>
      </BaseNode>

      {/* 隐藏的 audio 元素用于实际播放 */}
      {data.audioUrl && (
        <audio
          ref={audioRef}
          src={data.audioUrl}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onEnded={handleEnded}
          preload="metadata"
          className="hidden"
        />
      )}

      {/* 隐藏的文件 input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={handleUpload}
      />
    </>
  );
});
