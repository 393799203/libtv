import { memo } from 'react';
import { PromptCompose } from '@/components/PromptCompose';
import type { TextNodeData } from '@/types/canvas';

interface TextNodeEditorProps {
  data: TextNodeData;
  onUpdate: (data: Partial<TextNodeData>) => void;
}

export const TextNodeEditor = memo<TextNodeEditorProps>(function TextNodeEditor({
  data,
  onUpdate,
}) {
  return (
    <PromptCompose
      value={data.content}
      onChange={(value) => onUpdate({ content: value })}
      placeholder="写下你想讲的故事、场景或角色设定。例如：一个来自未来的机器人，在城市屋顶看星星。"
      maxLength={2000}
    />
  );
});