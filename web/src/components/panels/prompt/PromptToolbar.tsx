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
  UpOutlined,
} from '@ant-design/icons';
import type { ModelOption, ResolutionOption } from '@/types/prompt';
import { RESOLUTION_OPTIONS, ASPECT_RATIO_ROWS } from '@/configs/promptConfig';

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

// ==================== 分辨率+比例选择器（截图3）====================

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

  return (
    <div className="relative">
      {/* 触发按钮：📱 9:16 · 1K ^ */}
      <button
        className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-gray-100/80 transition-colors cursor-pointer"
        onClick={() => setOpen(!open)}
      >
        <span className="text-[13px]">📱</span>
        <span className="text-[13px] font-medium text-gray-800">{aspectRatio}</span>
        <span className="text-gray-300 text-[13px]">·</span>
        <span className="text-[13px] text-gray-500">{resolution}</span>
        <span className="text-[10px] text-gray-400 ml-0.5">^</span>
      </button>

      {/* 弹出面板：截图3 样式 */}
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full left-0 mb-2 w-[320px] bg-white rounded-xl shadow-xl border border-gray-200 p-4 z-30">
            {/* 分辨率行 */}
            <div className="mb-4">
              <div className="text-[13px] font-medium text-gray-700 mb-2.5">分辨率</div>
              <div className="flex gap-2">
                {RESOLUTION_OPTIONS.map((res) => (
                  <button
                    key={res}
                    className={`flex-1 py-1.5 rounded-lg text-[14px] font-medium transition-all ${
                      resolution === res
                        ? 'bg-gray-900 text-white'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
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
                    {row.map((item) => (
                      <button
                        key={item.value}
                        className={`flex-1 py-2 rounded-lg transition-colors flex flex-col items-center justify-center gap-1.5 ${
                          aspectRatio === item.value
                            ? 'border-2 border-gray-900 bg-gray-50'
                            : 'border border-gray-200 bg-white hover:bg-gray-50'
                        }`}
                        onClick={() => onAspectRatioChange(item.value)}
                      >
                        {/* 比例示意矩形图标 */}
                        <div
                          className={`w-5 h-5 border rounded-sm ${
                            aspectRatio === item.value ? 'border-gray-700' : 'border-gray-300'
                          } ${item.value === 'free' ? 'border-dashed !border-gray-300' : ''}`}
                          style={
                            item.value !== 'free'
                              ? {
                                  aspectRatio: item.value.replace(':', '/'),
                                  maxWidth: 18,
                                  maxHeight: 18,
                                }
                              : undefined
                          }
                        />
                        <span
                          className={`text-[11px] leading-none ${
                            aspectRatio === item.value ? 'font-semibold text-gray-800' : 'text-gray-500'
                          }`}
                        >
                          {item.label}
                        </span>
                      </button>
                    ))}
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
}) {
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

      {/* 分辨率/比例 */}
      <AspectRatioSelector
        resolution={selectedResolution}
        aspectRatio={selectedAspectRatio}
        onResolutionChange={onResolutionChange}
        onAspectRatioChange={onAspectRatioChange}
      />

      {/* 分隔 */}
      <span className="w-px h-4 bg-gray-200 mx-0.5" />

      {/* 摄像机 */}
      <button className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-gray-100/80 transition-colors cursor-pointer text-[13px] text-gray-600">
        <span>📷</span>
        <span>摄像机</span>
      </button>

      {/* 全景 */}
      <button className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-gray-100/80 transition-colors cursor-pointer text-[13px] text-gray-600">
        <span>🖼</span>
        <span>全景</span>
      </button>

      {/* 右侧区域 */}
      <div className="flex items-center gap-0.5 ml-auto">
        {/* 生成数量 */}
        <button className="flex items-center gap-0.5 px-2 py-1 rounded-lg hover:bg-gray-100/80 transition-colors cursor-pointer text-[13px] text-gray-600 mr-1">
          <span>2张</span>
          <span className="text-[10px] text-gray-400">▾</span>
        </button>

        {/* 发送按钮 */}
        <button
          className="w-8 h-8 rounded-lg bg-gray-900 text-white flex items-center justify-center hover:bg-gray-800 active:bg-gray-950 transition-colors flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={onGenerate}
          disabled={isGenerating}
        >
          <UpOutlined style={{ fontSize: 13 }} />
        </button>
      </div>
    </div>
  );
});
