import { memo, useCallback } from 'react';
import {
  PictureOutlined,
  VideoCameraOutlined,
  FileTextOutlined,
  CodeOutlined,
} from '@ant-design/icons';
import type { UpstreamInput } from '@/types/prompt';

interface PromptUpstreamBarProps {
  inputs: UpstreamInput[];
  onInsertMention: (input: UpstreamInput) => void;
}

const NODE_TYPE_ICON: Record<UpstreamInput['nodeType'], React.ReactNode> = {
  image: <PictureOutlined className="text-blue-500" />,
  video: <VideoCameraOutlined className="text-red-500" />,
  text: <FileTextOutlined className="text-purple-500" />,
  script: <CodeOutlined className="text-amber-500" />,
};

// 圈数字符映射（用于角标）
const CIRCLED_NUMBERS = ['\u2460', '\u2461', '\u2462', '\u2463', '\u2464', '\u2465'];

export const PromptUpstreamBar = memo<PromptUpstreamBarProps>(function PromptUpstreamBar({
  inputs,
  onInsertMention,
}) {
  if (inputs.length === 0) return null;

  return (
    <div className="flex items-center gap-2 pb-3">
      {/* 上游输入缩略图列表 */}
      {inputs.map((input, index) => (
        <button
          key={input.nodeId}
          className="relative group cursor-pointer"
          onClick={() => onInsertMention(input)}
        >
          {/* 缩略图 */}
          {input.thumbnail ? (
            <div className="relative w-[52px] h-[52px] rounded-lg overflow-hidden bg-gray-100 border border-gray-200">
              <img
                src={input.thumbnail}
                alt={input.label}
                className="w-full h-full object-cover"
              />
              {/* 序号角标：右上角圆形数字 */}
              {index > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-gray-700/80 backdrop-blur-sm text-white text-[10px] rounded-full flex items-center justify-center font-medium shadow-sm">
                  {index + 1}
                </span>
              )}
            </div>
          ) : (
            <div className="w-[52px] h-[52px] rounded-lg bg-gray-50 border border-dashed border-gray-250 flex flex-col items-center justify-center gap-0.5">
              {NODE_TYPE_ICON[input.nodeType]}
              <span className="text-[9px] text-gray-400 leading-none">{input.label}</span>
            </div>
          )}
        </button>
      ))}
    </div>
  );
});
