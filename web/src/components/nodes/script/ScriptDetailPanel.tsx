import { memo, useCallback, useState, useRef } from 'react';
import { Drawer, Button } from 'antd';
import { PlusOutlined, RightOutlined, LoadingOutlined } from '@ant-design/icons';
import type { ScriptNodeData, ScriptShot } from '@/types/canvas';
import { ShotHeader } from './ShotHeader';
import { ShotTable } from './ShotTable';

interface ScriptDetailPanelProps {
  open: boolean;
  data: ScriptNodeData;
  /** 轮询进度 */
  progress?: number;
  /** 进度文案 */
  progressMessage?: string;
  onClose: () => void;
  onUpdate: (data: Partial<ScriptNodeData>) => void;
}

/** 骨架屏行 — 纯展示组件，无需 memo */
function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 border-b border-gray-100 animate-pulse">
      <div className="w-8 h-4 bg-gray-200 rounded" />
      <div className="w-10 h-4 bg-gray-200 rounded" />
      <div className="flex-1 h-4 bg-gray-200 rounded" />
      <div className="w-14 h-4 bg-gray-200 rounded" />
      <div className="w-16 h-4 bg-gray-200 rounded" />
      <div className="w-20 h-4 bg-gray-200 rounded" />
      <div className="w-16 h-4 bg-gray-200 rounded" />
      <div className="w-12 h-4 bg-gray-200 rounded" />
      <div className="w-20 h-4 bg-gray-200 rounded" />
    </div>
  );
}

/** 生成中骨架屏 */
const GeneratingSkeleton = memo(function GeneratingSkeleton({
  progress = 0,
  message,
}: {
  progress?: number;
  message?: string;
}) {
  const rows = 6;

  return (
    <div className="flex flex-col h-full">
      {/* 进度条 */}
      <div className="px-4 py-3 border-b border-gray-100 bg-amber-50/50 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-amber-700">正在生成分镜数据...</span>
          <span className="text-xs text-amber-600">{progress}%</span>
        </div>
        <div className="w-full h-1.5 bg-amber-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-amber-500 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>
        {message && (
          <span className="text-[10px] text-amber-500">{message}</span>
        )}
      </div>

      {/* 表头骨架 */}
      <div className="flex items-center gap-3 px-3 py-2 bg-gray-50 border-b border-gray-200 text-[10px] text-gray-400 font-medium">
        <span className="w-8 text-center">序号</span>
        <span className="w-10 text-center">时长</span>
        <span className="flex-1">画面提示词</span>
        <span className="w-14">镜别</span>
        <span className="w-16">拍摄角度</span>
        <span className="w-20">对白/旁白</span>
        <span className="w-16">音效</span>
        <span className="w-12">运镜</span>
        <span className="w-20">基调提示方式</span>
      </div>

      {/* 行骨架 */}
      <div className="flex-1 overflow-y-auto">
        {Array.from({ length: rows }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>

      {/* 底部提示 */}
      <div className="px-4 py-2 border-t border-gray-100 text-center">
        <LoadingOutlined className="text-amber-500 mr-1 animate-spin" />
        <span className="text-[10px] text-gray-400">生成完成后将自动显示分镜列表</span>
      </div>
    </div>
  );
});

export const ScriptDetailPanel = memo<ScriptDetailPanelProps>(
  function ScriptDetailPanel({
    open,
    data,
    progress,
    progressMessage,
    onClose,
    onUpdate,
  }) {
    const [nextLoading, setNextLoading] = useState(false);

    // 用 ref 存储 data/onUpdate 的最新值，让回调保持稳定引用
    const dataRef = useRef(data);
    dataRef.current = data;
    const onUpdateRef = useRef(onUpdate);
    onUpdateRef.current = onUpdate;

    // 是否正在生成中 — 纯计算，不需要稳定
    const isGenerating = data.status === 'running' || data.status === 'pending';

    // 所有回调都是稳定引用（依赖为空数组），内部通过 ref 读最新值
    const handleAddShot = useCallback(() => {
      const currentData = dataRef.current;
      const newShot: ScriptShot = {
        id: `shot-${Date.now()}`,
        shotNumber: currentData.shots.length + 1,
        duration: 5,
        visualPrompt: '',
        shotSize: '中景',
        cameraAngle: '',
        dialogue: '',
        soundEffect: '',
        cameraMovement: '',
        toneHint: '',
      };
      onUpdateRef.current({ shots: [...currentData.shots, newShot] });
    }, []);

    const handleShotsChange = useCallback(
      (shots: ScriptShot[]) => {
        onUpdateRef.current({ shots });
      },
      []
    );

    const handleExport = useCallback(() => {
      console.log('导出脚本:', dataRef.current);
    }, []);

    const handleNextStep = useCallback(async () => {
      setNextLoading(true);
      try {
        const step = dataRef.current.currentStep;
        const nextStep = step === 1 ? 2 : step === 2 ? 3 : 3;
        onUpdateRef.current({ currentStep: nextStep });
      } finally {
        setNextLoading(false);
      }
    }, []);

    // nextStepLabel 是纯计算派生值
    const nextStepLabel =
      data.currentStep === 1
        ? '下一个：准备资产'
        : data.currentStep === 2
          ? '下一个：合成提示词'
          : null;

    return (
      <Drawer
        title={<ShotHeader data={data} onExport={handleExport} />}
        open={open}
        onClose={onClose}
        styles={{
          body: { padding: 0, display: 'flex', flexDirection: 'column' },
          mask: { backgroundColor: 'rgba(0,0,0,0.3)' },
          wrapper: { width: '90vw', maxWidth: '90vw' },
        }}
      >
        {/* 生成中 → 显示骨架屏 */}
        {isGenerating ? (
          <GeneratingSkeleton
            progress={progress}
            message={progressMessage}
          />
        ) : (
          <>
            {/* 分镜表格 */}
            <div className="flex-1 overflow-hidden">
              <ShotTable
                shots={data.shots}
                onChange={handleShotsChange}
                readOnly={false}
              />
            </div>

            {/* 底部操作栏 */}
            <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
              <Button
                type="dashed"
                icon={<PlusOutlined />}
                onClick={handleAddShot}
                size="small"
              >
                添加镜头
              </Button>

              {nextStepLabel && (
                <Button
                  type="primary"
                  onClick={handleNextStep}
                  loading={nextLoading}
                  icon={<RightOutlined />}
                  size="small"
                >
                  {nextStepLabel}
                </Button>
              )}
            </div>
          </>
        )}
      </Drawer>
    );
  }
);
