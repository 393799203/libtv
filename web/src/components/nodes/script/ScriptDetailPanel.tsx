import { memo, useCallback, useState, useRef } from 'react';
import { Drawer, Button } from 'antd';
import { LoadingOutlined, MergeCellsOutlined } from '@ant-design/icons';
import type { ScriptNodeData, ScriptShot } from '@/types/canvas';
import { ShotHeader } from './ShotHeader';
import { ShotTable } from './ShotTable';
import { AssetPreparationPanel } from './AssetPreparationPanel';
import { PromptMergeDrawer } from './PromptMergeDrawer';

interface ScriptDetailPanelProps {
  open: boolean;
  scriptNodeId: string;
  data: ScriptNodeData;
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
  message,
}: {
  message?: string;
}) {
  const rows = 6;

  return (
    <div className="flex flex-col h-full">
      {/* 进度提示 */}
      <div className="px-4 py-3 border-b border-gray-100 bg-amber-50/50">
        <span className="text-xs font-medium text-amber-700">
          {message || '正在生成分镜数据...'}
        </span>
      </div>

      {/* 表头骨架 */}
      <div className="flex items-center gap-3 px-3 py-2 bg-gray-50 border-b border-gray-200 text-[10px] text-gray-400 font-medium">
        <span className="w-8 text-center">序号</span>
        <span className="w-10 text-center">时长</span>
        <span className="flex-1">画面提示词</span>
        <span className="w-14">镜别</span>
        <span className="w-16">角度</span>
        <span className="w-32">对白/旁白</span>
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
    scriptNodeId,
    data,
    onClose,
    onUpdate,
  }) {
    const [nextLoading, setNextLoading] = useState(false);
    const [prevLoading, setPrevLoading] = useState(false);
    const [mergeDrawerOpen, setMergeDrawerOpen] = useState(false); // 合成提示词侧屏
    const [selectedShotId, setSelectedShotId] = useState<string | null>(null); // 当前选中的镜头ID

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

    // 处理最终提示词按钮点击
    const handleMergePrompt = useCallback((shotId: string) => {
      setSelectedShotId(shotId);
      setMergeDrawerOpen(true);
    }, []);

    // 更新单个镜头数据
    const handleShotUpdate = useCallback((updatedShot: ScriptShot) => {
      const currentData = dataRef.current;
      const updatedShots = currentData.shots.map((shot) =>
        shot.id === updatedShot.id ? updatedShot : shot
      );
      onUpdateRef.current({ shots: updatedShots });
    }, []);

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

    const handlePrevStep = useCallback(async () => {
      setPrevLoading(true);
      try {
        const step = dataRef.current.currentStep;
        const prevStep = step === 3 ? 2 : step === 2 ? 1 : 1;
        onUpdateRef.current({ currentStep: prevStep });
      } finally {
        setPrevLoading(false);
      }
    }, []);

    // nextStepLabel 是纯计算派生值
    const nextStepLabel =
      data.currentStep === 1
        ? '下一个：准备资产'
        : data.currentStep === 2
          ? '下一个：合成提示词'
          : null;

    // prevStepLabel：步骤 2 和 3 时显示
    const prevStepLabel =
      data.currentStep === 2
        ? '上一步：分镜'
        : data.currentStep === 3
          ? '上一步：准备资产'
          : null;

    // 只有第一个阶段（分镜表格）才显示"添加镜头"按钮
    const showAddShot = data.currentStep === 1;

    // 只有最后一个阶段（合成提示词）才显示"导出"按钮
    const showExport = data.currentStep === 3;

    return (
      <>
        <Drawer
          title={
            <ShotHeader
              data={data}
              onExport={showExport ? handleExport : undefined}
              onAddShot={showAddShot ? handleAddShot : undefined}
              nextStepLabel={nextStepLabel}
              onNextStep={nextStepLabel ? handleNextStep : undefined}
              nextLoading={nextLoading}
              prevStepLabel={prevStepLabel}
              onPrevStep={prevStepLabel ? handlePrevStep : undefined}
              prevLoading={prevLoading}
              showMissingAssetsWarning={data.currentStep === 2}
            />
          }
          open={open}
          onClose={onClose}
          styles={{
            body: {
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              // 显式声明高度，让 flex-1 / min-h-0 在子节点里能正确计算
              height: '100%',
              minHeight: 0,
            },
            mask: { backgroundColor: 'rgba(0,0,0,0.3)' },
            wrapper: { width: '90vw', maxWidth: '90vw' },
          }}
        >
          {/* 生成中 → 显示骨架屏 */}
          {isGenerating ? (
            <GeneratingSkeleton
              message={data.progressMessage as string | undefined}
            />
          ) : data.currentStep === 2 ? (
            // Step 2：准备资产
            <AssetPreparationPanel
              scriptNodeId={scriptNodeId}
              data={{
                characters: (data.characters as ScriptNodeData['characters']) || [],
                scenes: (data.scenes as ScriptNodeData['scenes']) || [],
                props: (data.props as ScriptNodeData['props']) || [],
              }}
              onUpdate={(updates) => {
                onUpdateRef.current(updates);
              }}
            />
          ) : data.currentStep === 3 ? (
            // Step 3：合成提示词阶段
            <>
              {/* 提示文字 */}
              <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                <span className="text-xs text-gray-500">
                  分镜表格（只读） - 点击每行的"最终提示词"按钮合成单个镜头的提示词
                </span>
              </div>
              {/* 只读分镜表格（带合成按钮） */}
              <div className="flex-1 min-h-0 overflow-auto">
                <ShotTable
                  shots={data.shots}
                  readOnly={true}
                  onMergePrompt={handleMergePrompt}
                />
              </div>
            </>
          ) : (
            // Step 1：分镜表格（可编辑）
            <div className="flex-1 min-h-0 overflow-auto">
              <ShotTable
                shots={data.shots}
                onChange={handleShotsChange}
                readOnly={false}
              />
            </div>
          )}

          {/* 合成提示词侧屏 - 嵌套在主 Drawer 内部，这样能推开主 Drawer */}
          <PromptMergeDrawer
            open={mergeDrawerOpen}
            scriptNodeId={scriptNodeId}
            shot={selectedShotId ? data.shots.find(s => s.id === selectedShotId) || null : null}
            scriptData={data}
            onClose={() => {
              setMergeDrawerOpen(false);
              // ✅ 不清空 selectedShotId，保持镜头选择，下次打开能正确加载提示词
            }}
            onUpdate={handleShotUpdate}
          />
        </Drawer>
      </>
    );
  }
);
