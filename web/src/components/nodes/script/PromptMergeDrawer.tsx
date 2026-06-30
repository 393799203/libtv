import { memo, useState, useCallback, useEffect, useMemo } from 'react';
import { Drawer, Button, message, Input, Select } from 'antd';
import { ReloadOutlined, CopyOutlined } from '@ant-design/icons';
import type { ScriptShot, ScriptNodeData } from '@/types/canvas';
import { useCanvasStore } from '@/stores/canvasStore';
import { useModels } from '@/hooks/useModels';
import { generatePrompt } from '@/services/promptApi';
import { canvasApi } from '@/services/canvasApi';
import { PromptReferenceTags } from './PromptReferenceTags';

interface PromptMergeDrawerProps {
  open: boolean;
  scriptNodeId: string;
  shot: ScriptShot | null; // 单个镜头数据
  scriptData: ScriptNodeData; // 完整的脚本节点数据（包含角色、场景、道具列表）
  onClose: () => void;
  onUpdate: (shot: ScriptShot) => void; // 更新镜头数据
}

/**
 * 提示词生成侧屏（单镜头）
 * - 一次调用同时生成画面提示词和运动提示词
 * - 使用 @ 符号引用准备好的资产（角色、场景、道具）
 * - 实时显示最终提示词（画面 + 运动）
 */
export const PromptMergeDrawer = memo<PromptMergeDrawerProps>(
  function PromptMergeDrawer({
    open,
    scriptNodeId,
    shot,
    scriptData,
    onClose,
    onUpdate,
  }) {
    const [generating, setGenerating] = useState(false);
    const [storyboardPrompt, setStoryboardPrompt] = useState(''); // 生成的画面提示词
    const [motionPrompt, setMotionPrompt] = useState(''); // 生成的运动提示词
    const [selectedModel, setSelectedModel] = useState(''); // 选择的文本模型

    // 获取画布状态和模型列表（只在需要时获取，避免不必要的订阅）
    const projectId = useCanvasStore((s) => s.projectId);
    const textModels = useModels('text');

    // 实时计算最终提示词（画面 + 运动提示词拼接）
    const finalPrompt = useMemo(() => {
      if (!storyboardPrompt.trim()) return '';
      return motionPrompt.trim()
        ? `画面提示词：${storyboardPrompt.trim()}\n视频运动提示词：${motionPrompt.trim()}`
        : `画面提示词：${storyboardPrompt.trim()}`;
    }, [storyboardPrompt, motionPrompt]);

    // 缓存资产引用数据（避免每次生成时重新 map）
    const assetReferences = useMemo(() => {
      if (!scriptData) return null;
      return {
        characters: scriptData.characters.map(c => ({
          name: c.name,
          description: c.description,
          imageUrl: c.imageUrl || '',
        })),
        scenes: scriptData.scenes.map(s => ({
          name: s.name,
          description: s.description,
          imageUrl: s.imageUrl || '',
        })),
        props: scriptData.props.map(p => ({
          name: p.name,
          description: p.description,
          imageUrl: p.imageUrl || '',
        })),
      };
    }, [scriptData]);

    // 默认选择第一个模型（只在模型列表变化时运行一次）
    useEffect(() => {
      if (textModels.length > 0 && selectedModel === '') {
        const defaultModel = textModels.find(m => m.isDefault === true);
        setSelectedModel(defaultModel ? defaultModel.value : textModels[0].value);
      }
    }, [textModels]); // ✅ 移除 selectedModel 依赖，避免不必要的重新运行

    // 初始化：从镜头数据加载已有的提示词
    useEffect(() => {
      if (shot) {
        setStoryboardPrompt(shot.storyboardPrompt || '');
        setMotionPrompt(shot.motionPrompt || '');
      }
    }, [shot]);

    // 关闭时重置状态
    useEffect(() => {
      if (!open) {
        setGenerating(false);
      }
    }, [open]);

    // AI生成提示词（画面 + 运动一起生成）
    const handleGenerate = useCallback(async () => {
      if (!shot) {
        message.warning('镜头数据不存在');
        return;
      }

      if (!selectedModel) {
        message.warning('请先选择文本模型');
        return;
      }

      if (!assetReferences) {
        message.warning('资产数据不存在');
        return;
      }

      setGenerating(true);

      try {
        // 构建请求参数
        const request = {
          model: selectedModel,
          shotId: shot.id,
          shotData: {
            visualPrompt: shot.visualPrompt,
            shotSize: shot.shotSize,
            cameraAngle: shot.cameraAngle,
            dialogue: shot.dialogue,
            soundEffect: shot.soundEffect,
            cameraMovement: shot.cameraMovement,
            toneHint: shot.toneHint,
          },
          characters: assetReferences.characters,
          scenes: assetReferences.scenes,
          props: assetReferences.props,
        };

        // 调用后端 API 生成提示词（api 实例会自动注入 token）
        const result = await generatePrompt(request);

        // 更新状态
        setStoryboardPrompt(result.storyboardPrompt);
        setMotionPrompt(result.motionPrompt);

        // 自动保存（更新镜头数据）
        const updatedShot = {
          ...shot,
          storyboardPrompt: result.storyboardPrompt,
          motionPrompt: result.motionPrompt,
          finalPrompt: result.motionPrompt.trim()
            ? `画面提示词：${result.storyboardPrompt.trim()}\n视频运动提示词：${result.motionPrompt.trim()}`
            : `画面提示词：${result.storyboardPrompt.trim()}`,
        };

        onUpdate(updatedShot);

        // ✅ 立即持久化到后端（避免刷新丢失）
        try {
          const currentStore = useCanvasStore.getState();
          const viewport = currentStore._cache.get(projectId)?.savedViewport || { x: 0, y: 0, zoom: 1 };
          await canvasApi.saveCanvas(projectId, {
            nodes: currentStore.nodes,
            edges: currentStore.edges,
            viewport,
          });
          message.success('提示词生成并保存成功');
        } catch (saveError) {
          console.error('保存画布失败:', saveError);
          message.warning('提示词已生成但保存失败，请手动保存画布');
        }

        // ✅ 不自动关闭，让用户可以查看和修改生成的提示词
      } catch (error) {
        console.error('生成提示词失败:', error);
        message.error(error instanceof Error ? error.message : '生成提示词失败');
      } finally {
        setGenerating(false);
      }
    }, [shot, selectedModel, assetReferences, onUpdate, projectId]); // ✅ 移除 token 依赖

    // Input onChange 处理器优化（避免每次输入创建新函数）
    const handleStoryboardChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setStoryboardPrompt(e.target.value);
    }, []);

    // 复制最终提示词
    const handleCopyFinalPrompt = useCallback(() => {
      if (!finalPrompt.trim()) {
        message.warning('最终提示词为空，无法复制');
        return;
      }

      navigator.clipboard.writeText(finalPrompt).then(() => {
        message.success('已复制到剪贴板');
      }).catch(() => {
        // fallback: 使用 document.execCommand
        const textarea = document.createElement('textarea');
        textarea.value = finalPrompt;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        message.success('已复制到剪贴板');
      });
    }, [finalPrompt]);

    const handleMotionChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setMotionPrompt(e.target.value);
    }, []);

    // 自动保存提示词（失去焦点时保存）
    const handleAutoSave = useCallback(async () => {
      if (!shot) return;

      try {
        // 更新镜头数据
        const updatedShot = {
          ...shot,
          storyboardPrompt: storyboardPrompt.trim(),
          motionPrompt: motionPrompt.trim(),
          finalPrompt: motionPrompt.trim()
            ? `画面提示词：${storyboardPrompt.trim()}\n视频运动提示词：${motionPrompt.trim()}`
            : `画面提示词：${storyboardPrompt.trim()}`,
        };

        onUpdate(updatedShot);

        // 持久化到后端
        const currentStore = useCanvasStore.getState();
        const viewport = currentStore._cache.get(projectId)?.savedViewport || { x: 0, y: 0, zoom: 1 };
        await canvasApi.saveCanvas(projectId, {
          nodes: currentStore.nodes,
          edges: currentStore.edges,
          viewport,
        });

        message.success('已自动保存', 1); // 1秒后自动消失
      } catch (error) {
        console.error('自动保存失败:', error);
        message.error('保存失败，请重试');
      }
    }, [shot, storyboardPrompt, motionPrompt, projectId, onUpdate]);

    return (
      <Drawer
        title={`镜头 ${shot?.shotNumber || ''} - 提示词生成`}
        placement="right"
        open={open}
        onClose={onClose}
        width={700}
        destroyOnClose
        styles={{
          body: {
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
          },
        }}
      >
        {/* 模型选择 */}
        <div>
          <div className="text-sm font-medium text-gray-700 mb-2">文本模型</div>
          <Select
            value={selectedModel}
            onChange={setSelectedModel}
            options={textModels}
            placeholder="选择文本模型"
            className="w-full"
          />
        </div>

        {/* 画面提示词 */}
        <div>
          <div className="text-sm font-medium text-gray-700 mb-2">画面提示词</div>
          {/* 识别到的 @ 引用标签 */}
          {storyboardPrompt.trim() && (
            <div className="mb-2">
              <PromptReferenceTags prompt={storyboardPrompt} scriptData={scriptData} />
            </div>
          )}
          <Input.TextArea
            value={storyboardPrompt}
            onChange={handleStoryboardChange}
            onBlur={handleAutoSave}
            placeholder="点击AI生成按钮或手动输入画面提示词，可使用 @ 引用资产（如 @角色-南方）"
            rows={6}
            className="text-sm"
          />
        </div>

        {/* 运动提示词 */}
        <div>
          <div className="text-sm font-medium text-gray-700 mb-2">运动提示词</div>
          <Input.TextArea
            value={motionPrompt}
            onChange={handleMotionChange}
            onBlur={handleAutoSave}
            placeholder="点击AI生成按钮或手动输入运动提示词"
            rows={5}
            className="text-sm"
          />
        </div>

        {/* 最终提示词 */}
        <div>
          <div className="text-sm font-medium text-gray-700 mb-2 flex items-center justify-between">
            <span>最终提示词</span>
            {finalPrompt.trim() && (
              <Button
                type="text"
                size="small"
                icon={<CopyOutlined />}
                onClick={handleCopyFinalPrompt}
                className="text-blue-600 hover:text-blue-800"
              >
                复制
              </Button>
            )}
          </div>
          <Input.TextArea
            value={finalPrompt}
            placeholder="画面提示词 + 运动提示词自动合成"
            rows={8}
            className="text-sm"
            disabled
          />
        </div>

        {/* 底部按钮区域 */}
        <div className="pt-4 border-t border-gray-200">
          <Button
            type="primary"
            size="large"
            block
            onClick={handleGenerate}
            disabled={!shot || !selectedModel}
            loading={generating}
            icon={<ReloadOutlined />}
          >
            {generating ? '生成中...' : storyboardPrompt ? '重新生成提示词' : '生成提示词'}
          </Button>
          <div className="text-xs text-gray-500 mt-2 text-center">
            输入框失去焦点会自动保存
          </div>
        </div>
      </Drawer>
    );
  }
);