import { memo } from 'react';
import { Button, Select } from 'antd';
import { PlayCircleOutlined, AudioOutlined, FileTextOutlined } from '@ant-design/icons';

const { Option } = Select;

interface PromptComposeProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  models?: { label: string; value: string }[];
  selectedModel?: string;
  onModelChange?: (model: string) => void;
  onGenerate?: () => void;
  isGenerating?: boolean;
}

export const PromptCompose = memo<PromptComposeProps>(function PromptCompose({
  value = '',
  onChange,
  placeholder = '写下你想讲的故事、场景或角色设定。例如：一个来自未来的机器人，在城市屋顶看星星。',
  maxLength = 2000,
  models = [{ label: 'GVLM 3.1', value: 'gvlm-3.1' }],
  selectedModel = 'gvlm-3.1',
  onModelChange,
  onGenerate,
  isGenerating = false,
}) {
  return (
    <div className="bg-white rounded-xl shadow-lg p-3 w-[500px]">
      <textarea
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        className="w-full text-sm text-gray-700 placeholder:text-gray-400 border-0 outline-none resize-none bg-transparent min-h-[60px]"
        maxLength={maxLength}
      />

      <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100">
        <Select
          value={selectedModel}
          onChange={onModelChange}
          className="w-auto min-w-[120px]"
          variant="borderless"
          suffixIcon={null}
          size="small"
        >
          {models.map((model) => (
            <Option key={model.value} value={model.value}>
              <div className="flex items-center gap-1">
                <AudioOutlined className="text-xs" />
                <span className="font-medium text-gray-700 text-xs">{model.label}</span>
              </div>
            </Option>
          ))}
        </Select>

        <div className="flex items-center gap-2">
          <Button
            type="text"
            icon={<FileTextOutlined />}
            className="text-gray-600 hover:text-gray-800"
            size="small"
          />
          <Button
            type="primary"
            shape="circle"
            icon={<PlayCircleOutlined />}
            onClick={onGenerate}
            loading={isGenerating}
            className="!w-9 !h-9 !rounded-full !bg-gradient-to-br !from-gray-800 !to-gray-600 !border-0 shadow hover:!shadow-md"
          />
        </div>
      </div>
    </div>
  );
});