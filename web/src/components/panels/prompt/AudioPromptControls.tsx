import { memo, useState } from 'react';

// 停顿时间选项
const PAUSE_OPTIONS = [
  { value: 0.25, label: '0.25s' },
  { value: 0.5, label: '0.5s' },
  { value: 1.0, label: '1.0s' },
  { value: 1.5, label: '1.5s' },
];

// 语气词选项
const TONE_OPTIONS = [
  { value: 'laugh', label: '笑声' },
  { value: 'giggle', label: '轻笑' },
  { value: 'cough', label: '咳嗽' },
  { value: 'clear-throat', label: '清嗓子' },
  { value: 'breathe', label: '正常换气' },
  { value: 'pant', label: '喘气' },
];

export interface AudioTagInsert {
  /** 纯文本值（用于 value 存储） */
  text: string;
  /** 插入到编辑器的 HTML */
  html: string;
}

interface AudioPromptControlsProps {
  onInsertTag: (tag: AudioTagInsert) => void;
}

export const AudioPromptControls = memo<AudioPromptControlsProps>(function AudioPromptControls({
  onInsertTag,
}) {
  const [pauseOpen, setPauseOpen] = useState(false);
  const [toneOpen, setToneOpen] = useState(false);

  const handlePauseSelect = (value: number) => {
    onInsertTag({
      text: `<#${value}#>`,
      html: `<span class="libtv-audio-tag libtv-audio-pause" contenteditable="false" data-tag-type="pause" data-value="${value}"><span class="libtv-audio-tag-icon">&lt;#${value}#&gt;</span></span>`,
    });
    setPauseOpen(false);
  };

  const handleToneSelect = (_value: string, label: string) => {
    onInsertTag({
      text: `(${label})`,
      html: `<span class="libtv-audio-tag libtv-audio-tone" contenteditable="false" data-tag-type="tone" data-label="${label}"><span class="libtv-audio-tag-icon">(${label})</span></span>`,
    });
    setToneOpen(false);
  };

  return (
    <div className="flex items-center gap-1.5 px-2 py-1">
      {/* 停顿按钮 */}
      <div className="relative">
        <button
          onClick={() => { setPauseOpen(!pauseOpen); setToneOpen(false); }}
          className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md border border-gray-200 text-[11px] text-gray-500 hover:bg-gray-50 hover:border-gray-300 transition-colors cursor-pointer"
        >
          <span className="font-mono text-[10px] text-cyan-500">&lt;#&gt;</span>
          <span>停顿</span>
        </button>

        {pauseOpen && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setPauseOpen(false)} />
            <div className="absolute top-full left-0 mt-0.5 w-[120px] bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden z-30 py-0.5">
              {PAUSE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className="w-full px-3 py-1.5 text-left text-[12px] hover:bg-gray-50 transition-colors text-cyan-600 font-medium"
                  onClick={() => handlePauseSelect(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* 语气词按钮 */}
      <div className="relative">
        <button
          onClick={() => { setToneOpen(!toneOpen); setPauseOpen(false); }}
          className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-md border border-gray-200 text-[11px] text-gray-500 hover:bg-gray-50 hover:border-gray-300 transition-colors cursor-pointer"
        >
          <span className="font-mono text-[10px] text-orange-500">()</span>
          <span>语气词</span>
        </button>

        {toneOpen && (
          <>
            <div className="fixed inset-0 z-20" onClick={() => setToneOpen(false)} />
            <div className="absolute top-full left-0 mt-0.5 w-[110px] bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden z-30 py-0.5">
              {TONE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className="w-full px-3 py-1.5 text-left text-[12px] hover:bg-gray-50 transition-colors text-gray-700"
                  onClick={() => handleToneSelect(opt.value, opt.label)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
});
