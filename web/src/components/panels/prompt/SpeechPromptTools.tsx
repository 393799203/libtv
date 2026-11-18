import { useState, type RefObject } from 'react';
import { Button, InputNumber, Popover } from 'antd';
import { EnterOutlined, PauseOutlined, SoundOutlined } from '@ant-design/icons';
import { MINIMAX_INTERJECTIONS } from '@/configs/audioModels';
import type { PromptEditorHandle } from './PromptEditor';

export function SpeechPromptTools({ editor }: { editor: RefObject<PromptEditorHandle | null> }) {
  const [pauseOpen, setPauseOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [seconds, setSeconds] = useState<number | null>(0.5);
  const prepare = () => editor.current?.rememberSelection();
  const insertPause = (duration: number) => {
    if (!Number.isFinite(duration) || duration < 0.01 || duration > 99.99) return;
    const value = String(Math.round(duration * 100) / 100);
    editor.current?.insertTagAtCursor(
      `<span class="libtv-audio-tag libtv-audio-pause" contenteditable="false" data-value="${value}"><span class="libtv-audio-tag-icon">停顿 ${value} 秒</span></span>`, `<#${value}#>`);
    setPauseOpen(false);
  };
  const controlClass = 'inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2 text-xs text-[var(--dv-text-2)] hover:bg-[var(--dv-surface-3)] focus-visible:outline-2 focus-visible:outline-cyan-400 cursor-pointer';
  return (
    <div role="toolbar" aria-label="配音文本工具" className="flex flex-wrap items-center gap-1 border-b border-[var(--dv-border-1)] px-1 pb-1.5 mb-1">
      <button type="button" className={controlClass} onMouseDown={event => { event.preventDefault(); prepare(); }}
        onClick={() => editor.current?.insertTextAtCursor('\n\n')}>
        <EnterOutlined aria-hidden />分段
      </button>
      <Popover trigger="click" open={pauseOpen} onOpenChange={value => { if (value) prepare(); setPauseOpen(value); }}
        content={<div className="w-56">
          <div className="flex gap-1 mb-3">
            {[0.3, 0.5, 1, 2].map(value => <Button key={value} size="small" onClick={() => insertPause(value)}>{value} 秒</Button>)}
          </div>
          <label htmlFor="speech-pause-seconds" className="block text-xs mb-2">停顿时长（秒）</label>
          <div className="flex items-center gap-2">
            <InputNumber id="speech-pause-seconds" aria-label="停顿时长（秒）" min={0.01} max={99.99} step={0.1} precision={2}
              value={seconds} onChange={value => setSeconds(value)} />
            <Button size="small" type="primary" disabled={seconds === null} onClick={() => seconds !== null && insertPause(seconds)}>插入停顿</Button>
          </div>
        </div>}>
        <button type="button" className={controlClass} aria-expanded={pauseOpen} onMouseDown={event => { event.preventDefault(); prepare(); }}>
          <PauseOutlined aria-hidden />停顿
        </button>
      </Popover>
      <Popover trigger="click" open={actionsOpen} onOpenChange={value => { if (value) prepare(); setActionsOpen(value); }}
        content={<div className="grid grid-cols-3 gap-1 w-60" role="group" aria-label="语气动作">
          {MINIMAX_INTERJECTIONS.map(option => <button key={option.value} type="button" title={`(${option.value})`}
            className={controlClass} onClick={() => {
              editor.current?.insertTagAtCursor(
                `<span class="libtv-audio-tag libtv-audio-tone" contenteditable="false" data-value="${option.value}"><span class="libtv-audio-tag-icon">${option.label}</span></span>`, `(${option.value})`);
              setActionsOpen(false);
            }}>{option.label}</button>)}
        </div>}>
        <button type="button" className={controlClass} aria-expanded={actionsOpen} onMouseDown={event => { event.preventDefault(); prepare(); }}>
          <SoundOutlined aria-hidden />语气动作
        </button>
      </Popover>
    </div>
  );
}
