import { memo } from 'react';
import { CheckCircleOutlined, LoadingOutlined, ClockCircleOutlined } from '@ant-design/icons';
import type { ScriptNodeData } from '@/types/canvas';

interface ScriptStepsProps {
  currentStep: ScriptNodeData['currentStep'];
}

const STEPS = [
  { key: 1 as const, label: '确认镜头', icon: CheckCircleOutlined },
  { key: 2 as const, label: '准备资产', icon: LoadingOutlined },
  { key: 3 as const, label: '合成提示词', icon: ClockCircleOutlined },
] as const;

export const ScriptSteps = memo<ScriptStepsProps>(function ScriptSteps({ currentStep }) {
  return (
    <div className="flex items-center justify-center gap-3 px-2 py-1">
      {STEPS.map((step, idx) => {
        const isActive = step.key === currentStep;
        const isDone = step.key < currentStep;
        const Icon = step.icon;

        return (
          <div key={step.key} className="flex items-center gap-2">
            {/* 步骤圆圈 */}
            <div className="flex flex-col items-center gap-1">
              <div
                className={`
                  w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium border transition-colors
                  ${isDone
                    ? 'bg-green-500 text-white border-green-500'
                    : isActive
                      ? 'bg-gray-800 text-white border-gray-800'
                      : 'bg-white text-gray-400 border-gray-300'
                  }
                `}
              >
                {isDone ? (
                  <CheckCircleOutlined className="text-sm" />
                ) : isActive ? (
                  <span>{step.key}</span>
                ) : (
                  <span>{step.key}</span>
                )}
              </div>
              <span
                className={`text-[10px] whitespace-nowrap ${
                  isActive ? 'text-gray-800 font-medium' : 'text-gray-400'
                }`}
              >
                {step.label}
              </span>
            </div>

            {/* 连接线 */}
            {idx < STEPS.length - 1 && (
              <div
                className={`w-8 h-px ${
                  step.key < currentStep ? 'bg-green-400' : 'bg-gray-200'
                }`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
});
