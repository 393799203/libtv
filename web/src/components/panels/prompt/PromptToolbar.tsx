import { memo, useState } from 'react';
import {
  CloseOutlined,
  LinkOutlined,
  BarChartOutlined,
  RobotOutlined,
  VideoCameraOutlined,
  ThunderboltOutlined,
  CloudOutlined,
  AudioOutlined,
  SoundOutlined,
} from '@ant-design/icons';
import type { ModelOption, ResolutionOption } from '@/types/prompt';
import type { NodeType } from '@/types/canvas';
import { RESOLUTION_OPTIONS, QUALITY_OPTIONS, ASPECT_RATIO_ROWS } from '@/configs/promptConfig';

// 模型图标映射（匹配截图中的图标风格）
const MODEL_ICON_MAP: Record<string, React.ReactNode> = {
  link: <LinkOutlined style={{ fontSize: 16 }} />,
  close: <CloseOutlined style={{ fontSize: 16 }} />,
  'bar-chart': <BarChartOutlined style={{ fontSize: 16 }} />,
  robot: <RobotOutlined style={{ fontSize: 16 }} />,
  'video-camera': <VideoCameraOutlined style={{ fontSize: 16 }} />,
  thunderbolt: <ThunderboltOutlined style={{ fontSize: 16 }} />,
  cloud: <CloudOutlined style={{ fontSize: 16 }} />,
  audio: <AudioOutlined style={{ fontSize: 16 }} />,
  sound: <SoundOutlined style={{ fontSize: 16 }} />,
};

interface PromptToolbarProps {
  models: ModelOption[];
  selectedModel: string;
  onModelChange: (model: string) => void;
  selectedResolution: ResolutionOption;
  onResolutionChange: (res: ResolutionOption) => void;
  selectedAspectRatio: string;
  onAspectRatioChange: (ratio: string) => void;
  isGenerating?: boolean;
  onGenerate?: () => void;
  nodeType?: NodeType;
  cameraMode?: 'normal' | 'camera' | 'panorama';
  onCameraModeChange?: (mode: 'normal' | 'camera' | 'panorama') => void;
  // 音频节点专属：音色和语速
  selectedVoice?: string;
  onVoiceChange?: (voice: string) => void;
  selectedSpeed?: number;
  onSpeedChange?: (speed: number) => void;
}

// ==================== 模型选择器（截图2）====================

const ModelSelector = memo(function ModelSelector({
  models,
  value,
  onChange,
}: {
  models: ModelOption[];
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const currentModel = models.find((m) => m.value === value);

  return (
    <div className="relative">
      {/* 触发按钮：✕ Lib Navo 2 ^ */}
      <button
        className="flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-gray-100/80 transition-colors cursor-pointer"
        onClick={() => setOpen(!open)}
      >
        <span className="text-gray-600">
          {currentModel ? MODEL_ICON_MAP[currentModel.icon || ''] || <CloseOutlined style={{ fontSize: 14 }} /> : <CloseOutlined style={{ fontSize: 14 }} />}
        </span>
        <span className="text-[13px] font-medium text-gray-800">{currentModel?.label || '选择模型'}</span>
        <span className="text-[10px] text-gray-400 ml-0.5">^</span>
      </button>

      {/* 下拉面板：截图2 样式 */}
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 mb-2 w-[288px] bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden z-30">
            {models.map((model) => (
              <button
                key={model.value}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                  value === model.value ? 'bg-gray-100' : 'hover:bg-gray-50'
                }`}
                onClick={() => {
                  onChange(model.value);
                  setOpen(false);
                }}
              >
                {/* 左侧图标 */}
                <span className="text-gray-600 w-6 flex-shrink-0 flex justify-center">
                  {MODEL_ICON_MAP[model.icon || ''] || <RobotOutlined style={{ fontSize: 17 }} />}
                </span>

                {/* 中间：名称 + 描述 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[14px] font-medium text-gray-800">{model.label}</span>
                    {model.tag && (
                      <span
                        className="px-1.5 py-0.5 rounded text-[10px] font-medium leading-none"
                        style={{
                          backgroundColor: `${model.tagColor || '#f59e0b'}15`,
                          color: model.tagColor || '#f59e0b',
                        }}
                      >
                        {model.tag}
                      </span>
                    )}
                  </div>
                  {model.description && (
                    <div className="text-[12px] text-gray-400 mt-0.5 leading-tight">
                      {model.description}
                    </div>
                  )}
                </div>

                {/* 右侧耗时 */}
                {model.duration !== undefined && (
                  <span className="text-[13px] text-gray-400 flex-shrink-0">{model.duration}s</span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
});

// ==================== 分辨率+比例选择器（截图3 样式）====================

// 比例图标：根据宽高比绘制精确的矩形示意
function RatioIcon({ value, active }: { value: string; active: boolean }) {
  if (value === 'free') {
    return (
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
        <rect x="3" y="3" width="14" height="14" rx="1.5"
          stroke={active ? '#374151' : '#D1D5DB'} strokeWidth="1.5" strokeDasharray="3 2" fill="none" />
      </svg>
    );
  }

  const [w, h] = value.split(':').map(Number);
  const ratio = w / h;
  const size = 18;
  let iw, ih;
  if (ratio >= 1) {
    iw = size;
    ih = size / ratio;
  } else {
    ih = size;
    iw = size * ratio;
  }
  const ox = (size - iw) / 2;
  const oy = (size - ih) / 2;

  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
      <rect x={ox + 1} y={oy + 1} width={iw - 2} height={ih - 2}
        rx={Math.min(iw, ih) * 0.15}
        stroke={active ? '#374151' : '#9CA3AF'} strokeWidth={active ? 1.8 : 1.3}
        fill={active ? '#F3F4F6' : 'white'} />
    </svg>
  );
}

const AspectRatioSelector = memo(function AspectRatioSelector({
  resolution,
  aspectRatio,
  onResolutionChange,
  onAspectRatioChange,
}: {
  resolution: ResolutionOption;
  aspectRatio: string;
  onResolutionChange: (r: ResolutionOption) => void;
  onAspectRatioChange: (r: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [quality, setQuality] = useState<string>('标准画质');

  return (
    <div className="relative">
      {/* 触发按钮 */}
      <button
        className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-gray-100/80 transition-colors cursor-pointer"
        onClick={() => setOpen(!open)}
      >
        <span className="text-[13px]">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="1" y="3" width="12" height="8" rx="1.2" stroke="#6B7280" strokeWidth="1.2" fill="none" />
          </svg>
        </span>
        <span className="text-[13px] font-medium text-gray-800">{aspectRatio}</span>
        <span className="text-gray-300 text-[13px]">·</span>
        <span className="text-[13px] text-gray-500">{quality}</span>
        <span className="text-gray-300 text-[13px]">·</span>
        <span className="text-[13px] text-gray-500">{resolution}</span>
        <span className="text-[10px] text-gray-400 ml-0.5">^</span>
      </button>

      {/* 弹出面板 */}
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 mb-2 w-[340px] bg-white rounded-2xl shadow-xl border border-gray-200 p-5 z-30">
            {/* 画质 */}
            <div className="mb-4">
              <div className="text-[13px] font-medium text-gray-700 mb-2.5">画质</div>
              <div className="flex gap-2">
                {QUALITY_OPTIONS.map((q) => (
                  <button
                    key={q}
                    className={`flex-1 max-w-[90px] py-[6px] rounded-lg text-[12px] font-medium transition-all ${
                      quality === q
                        ? 'bg-white text-gray-800 border border-gray-900 shadow-sm'
                        : 'bg-gray-50 text-gray-500 hover:bg-gray-100 border border-transparent'
                    }`}
                    onClick={() => setQuality(q)}
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>

            {/* 清晰度 */}
            <div className="mb-4">
              <div className="text-[13px] font-medium text-gray-700 mb-2.5">清晰度</div>
              <div className="flex gap-2">
                {RESOLUTION_OPTIONS.map((res) => (
                  <button
                    key={res}
                    className={`flex-1 max-w-[90px] py-[6px] rounded-lg text-[12px] font-medium transition-all ${
                      resolution === res
                        ? 'bg-white text-gray-800 border border-gray-900 shadow-sm'
                        : 'bg-gray-50 text-gray-500 hover:bg-gray-100 border border-transparent'
                    }`}
                    onClick={() => onResolutionChange(res)}
                  >
                    {res}
                  </button>
                ))}
              </div>
            </div>

            {/* 比例网格 */}
            <div>
              <div className="text-[13px] font-medium text-gray-700 mb-2.5">比例</div>
              <div className="space-y-2">
                {ASPECT_RATIO_ROWS.map((row, rowIndex) => (
                  <div key={rowIndex} className="flex gap-2">
                    {row.map((item) => {
                      // 占位：空值渲染为透明占位元素
                      if (!item.value) {
                        return <div key="placeholder" className="flex-1 max-w-[60px]" />;
                      }
                      const isActive = aspectRatio === item.value;
                      return (
                        <button
                          key={item.value}
                          className={`flex-1 max-w-[60px] rounded-xl transition-all flex flex-col items-center justify-center gap-1 ${
                            isActive
                              ? 'border-[1.5px] border-gray-800 bg-gray-50 shadow-sm'
                              : 'border border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                          }`}
                          style={{ minHeight: 52 }}
                          onClick={() => onAspectRatioChange(item.value)}
                        >
                          <RatioIcon value={item.value} active={isActive} />
                          <span
                            className={`text-[11px] leading-none ${
                              isActive ? 'font-semibold text-gray-800' : 'text-gray-500'
                            }`}
                          >
                            {item.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
});

// ==================== 主工具栏（截图1 底部）====================

export const PromptToolbar = memo<PromptToolbarProps>(function PromptToolbar({
  models,
  selectedModel,
  onModelChange,
  selectedResolution,
  onResolutionChange,
  selectedAspectRatio,
  onAspectRatioChange,
  isGenerating = false,
  onGenerate,
  nodeType = 'image',
  cameraMode = 'normal',
  onCameraModeChange,
  selectedVoice = 'default',
  onVoiceChange,
  selectedSpeed = 1.0,
  onSpeedChange,
}) {
  const isVideo = nodeType === 'video';
  const isAudio = nodeType === 'audio';
  const unit = isVideo ? '个' : '张';

  const [countOpen, setCountOpen] = useState(false);
  const [count, setCount] = useState(1);
  const countOptions = [1, 2, 4];

  // 音色选项
  const VOICE_OPTIONS = [
    { value: 'default', label: '默认音色' },
    { value: 'male-young', label: '青年男声' },
    { value: 'female-young', label: '青年女声' },
    { value: 'male-mature', label: '成熟男声' },
    { value: 'female-mature', label: '成熟女声' },
    { value: 'child', label: '童声' },
  ];

  // 语速选项
  const SPEED_OPTIONS = [
    { value: 0.5, label: '0.5x 慢速' },
    { value: 0.75, label: '0.75x' },
    { value: 1.0, label: '1.0x 正常' },
    { value: 1.25, label: '1.25x' },
    { value: 1.5, label: '1.5x 快速' },
    { value: 2.0, label: '2.0x' },
  ];

  // 音色选择器状态
  const [voiceOpen, setVoiceOpen] = useState(false);
  // 语速选择器状态
  const [speedOpen, setSpeedOpen] = useState(false);

  return (
    <div className="flex items-center gap-0.5 pt-2.5 mt-0.5 border-t border-gray-100">
      {/* 模型选择器 */}
      <ModelSelector
        models={models}
        value={selectedModel}
        onChange={onModelChange}
      />

      {/* 分隔 */}
      <span className="w-px h-4 bg-gray-200 mx-0.5" />

      {/* 音色选择器（仅音频节点） */}
      {isAudio && (
        <div className="relative">
          <button
            onClick={() => setVoiceOpen(!voiceOpen)}
            className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-gray-100/80 transition-colors cursor-pointer text-[13px]"
          >
            <SoundOutlined className="text-gray-500 text-xs" />
            <span className="text-gray-800 font-medium">
              {VOICE_OPTIONS.find((v) => v.value === selectedVoice)?.label || '音色'}
            </span>
            <span className="text-[10px] text-gray-400">^</span>
          </button>
          {voiceOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setVoiceOpen(false)} />
              <div className="absolute bottom-full left-0 mb-2 w-[140px] bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden z-30">
                {VOICE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    className={`w-full px-3 py-1.5 text-left text-[13px] transition-colors ${
                      selectedVoice === opt.value ? 'bg-gray-100 font-medium' : 'hover:bg-gray-50'
                    }`}
                    onClick={() => { onVoiceChange?.(opt.value); setVoiceOpen(false); }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* 语速选择器（仅音频节点） */}
      {isAudio && (
        <div className="relative">
          <button
            onClick={() => setSpeedOpen(!speedOpen)}
            className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-gray-100/80 transition-colors cursor-pointer text-[13px]"
          >
            <span className="text-gray-600">{selectedSpeed}x</span>
            <span className="text-[10px] text-gray-400">^</span>
          </button>
          {speedOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setSpeedOpen(false)} />
              <div className="absolute bottom-full left-0 mb-2 w-[120px] bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden z-30">
                {SPEED_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    className={`w-full px-3 py-1.5 text-left text-[13px] transition-colors ${
                      selectedSpeed === opt.value ? 'bg-gray-100 font-medium' : 'hover:bg-gray-50'
                    }`}
                    onClick={() => { onSpeedChange?.(opt.value); setSpeedOpen(false); }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* 分辨率/比例（仅图片/视频节点，非文本和音频） */}
      {nodeType !== 'text' && !isAudio && (
        <AspectRatioSelector
          resolution={selectedResolution}
          aspectRatio={selectedAspectRatio}
          onResolutionChange={onResolutionChange}
          onAspectRatioChange={onAspectRatioChange}
        />
      )}

      {/* 分隔（仅图片/视频节点） */}
      {nodeType !== 'text' && !isAudio && (
        <span className="w-px h-4 bg-gray-200 mx-0.5" />
      )}

      {/* 摄像机（仅图片节点） */}
      {nodeType === 'image' && (
        <button
          onClick={() => onCameraModeChange?.(cameraMode === 'camera' ? 'normal' : 'camera')}
          className={`flex items-center gap-1 px-2 py-1 rounded-lg transition-colors cursor-pointer text-[13px] ${
            cameraMode === 'camera' ? 'bg-gray-200 text-gray-900 font-medium' : 'text-gray-600 hover:bg-gray-100/80'
          }`}
        >
          <span>📷</span>
          <span>摄像机</span>
        </button>
      )}

      {/* 全景（仅图片节点） */}
      {nodeType === 'image' && (
        <button
          onClick={() => onCameraModeChange?.(cameraMode === 'panorama' ? 'normal' : 'panorama')}
          className={`flex items-center gap-1 px-2 py-1 rounded-lg transition-colors cursor-pointer text-[13px] ${
            cameraMode === 'panorama' ? 'bg-blue-100 text-blue-700 font-medium border border-blue-300' : 'text-gray-600 hover:bg-gray-100/80'
          }`}
        >
          <span>🖼</span>
          <span>全景</span>
        </button>
      )}

      {/* 右侧区域 */}
      <div className="flex items-center gap-0.5 ml-auto">
        {/* 生成数量（仅图片/视频节点） */}
        {!isAudio && nodeType !== 'text' && (
        <div className="relative">
          <button
            onClick={() => setCountOpen(!countOpen)}
            className="flex items-center gap-0.5 px-2 py-1 rounded-lg hover:bg-gray-100/80 transition-colors cursor-pointer text-[13px] text-gray-600 mr-1"
          >
            <span>{count}{unit}</span>
          </button>
          {countOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setCountOpen(false)} />
              <div className="absolute bottom-full left-0 mb-2 w-[72px] bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden z-30">
                {countOptions.map((opt) => (
                  <button
                    key={opt}
                    className={`w-full px-3 py-1.5 text-left text-[13px] transition-colors ${
                      count === opt ? 'bg-gray-100 font-medium' : 'hover:bg-gray-50'
                    }`}
                    onClick={() => { setCount(opt); setCountOpen(false); }}
                  >
                    {opt}{unit}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        )}

        {/* 发送按钮 */}
        <button
          className="w-8 h-8 rounded-xl bg-gradient-to-br from-gray-800 to-gray-950 text-white flex items-center justify-center hover:from-gray-700 hover:to-gray-900 active:scale-95 transition-all duration-150 flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
          onClick={onGenerate}
          disabled={isGenerating}
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12.5 12.5L3.5 3.5M3.5 3.5H10.5M3.5 3.5V10.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>
    </div>
  );
});
