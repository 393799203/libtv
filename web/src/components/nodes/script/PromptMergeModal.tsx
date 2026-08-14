import { memo, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Modal, Button, message, Select } from 'antd';
import { ReloadOutlined, CopyOutlined, PictureOutlined, VideoCameraOutlined } from '@ant-design/icons';
import type { ScriptShot, ScriptNodeData } from '@/types/canvas';
import { useCanvasStore } from '@/stores/canvasStore';
import { useModels } from '@/hooks/useModels';
import { generatePrompt } from '@/services/promptApi';
import { canvasApi } from '@/services/canvasApi';
import { PromptReferenceTags } from './PromptReferenceTags';
import {
  createShotImageNode,
  createShotVideoNode,
  persistShotCanvas,
  findShotImageNode,
  findShotVideoNode,
  generateShotImageNodeId,
} from '@/utils/shotNodeSync';

interface PromptMergeModalProps {
  open: boolean;
  scriptNodeId: string;
  shot: ScriptShot | null; // 单个镜头数据
  scriptData: ScriptNodeData; // 完整的脚本节点数据（包含角色、场景、道具列表）
  onClose: () => void;
  onUpdate: (shot: ScriptShot) => void; // 更新镜头数据
}

/**
 * 提示词生成弹窗（单镜头）
 * - 一次调用同时生成画面提示词和运动提示词
 * - 使用 @ 符号引用准备好的资产（角色、场景、道具）
 * - 实时显示最终提示词（画面 + 运动）
 */
export const PromptMergeModal = memo<PromptMergeModalProps>(
  function PromptMergeModal({
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
    const [contentReady, setContentReady] = useState(false); // ✅ 动画性能优化：延迟渲染重型组件
    const [imageGenerating, setImageGenerating] = useState(false); // 分镜图片节点生成中
    const [videoGenerating, setVideoGenerating] = useState(false); // 分镜视频节点生成中

    // ✅ 性能优化：缓存 scriptData 的资产数组，避免每次渲染都重新计算
    const charactersRef = useRef(scriptData.characters);
    const scenesRef = useRef(scriptData.scenes);
    const propsRef = useRef(scriptData.props);

    // ✅ 保存setTimeout timer的引用，用于清理内存泄漏
    const saveTimerRef = useRef<number | null>(null);

    // 只在资产数组真正变化时更新 ref
    if (scriptData.characters !== charactersRef.current) {
      charactersRef.current = scriptData.characters;
    }
    if (scriptData.scenes !== scenesRef.current) {
      scenesRef.current = scriptData.scenes;
    }
    if (scriptData.props !== propsRef.current) {
      propsRef.current = scriptData.props;
    }

    // 获取画布状态和模型列表（只在需要时获取，避免不必要的订阅）
    const projectId = useCanvasStore((s) => s.projectId);
    // ✅ 响应式判断：画布上是否已存在该镜头的图片节点（已存在则隐藏"生成提示词图片"按钮）
    const shotImageNodeId = shot ? generateShotImageNodeId(shot.id, scriptNodeId) : '';
    const imageNodeExists = useCanvasStore((s) => s.nodes.some((n) => n.id === shotImageNodeId));
    const textModels = useModels('text');
    const imageModels = useModels('image');
    const videoModels = useModels('video');

    // 默认图片/视频模型 ID（用于创建分镜节点时写入 data.model）
    const defaultImageModelId = useMemo(() => {
      const m = imageModels.find(m => m.isDefault) || imageModels[0];
      return m?.modelId || '';
    }, [imageModels]);
    const defaultVideoModelId = useMemo(() => {
      const m = videoModels.find(m => m.isDefault) || videoModels[0];
      return m?.modelId || '';
    }, [videoModels]);

    // 实时计算最终提示词（画面 + 运动提示词拼接）
    const finalPrompt = useMemo(() => {
      if (!storyboardPrompt.trim()) return '';
      return motionPrompt.trim()
        ? `画面提示词：${storyboardPrompt.trim()}\n视频运动提示词：${motionPrompt.trim()}`
        : `画面提示词：${storyboardPrompt.trim()}`;
    }, [storyboardPrompt, motionPrompt]);

    // 缓存资产引用数据（避免每次生成时重新 map）
    // ✅ 通过 nodeId 从画布节点获取最新图片
    const assetReferences = useMemo(() => {
      const store = useCanvasStore.getState();

      return {
        characters: charactersRef.current.map(c => {
          const node = c.nodeId ? store.nodes.find(n => n.id === c.nodeId) : null;
          const imageUrl = (node?.data?.imageUrl as string) || '';
          return {
            name: c.name,
            description: c.description,
            imageUrl,
          };
        }),
        scenes: scenesRef.current.map(s => {
          const node = s.nodeId ? store.nodes.find(n => n.id === s.nodeId) : null;
          const imageUrl = (node?.data?.imageUrl as string) || '';
          return {
            name: s.name,
            description: s.description,
            imageUrl,
          };
        }),
        props: propsRef.current.map(p => {
          const node = p.nodeId ? store.nodes.find(n => n.id === p.nodeId) : null;
          const imageUrl = (node?.data?.imageUrl as string) || '';
          return {
            name: p.name,
            description: p.description,
            imageUrl,
          };
        }),
      };
    }, [charactersRef.current, scenesRef.current, propsRef.current]); // 依赖资产数组变化

    // 默认选择第一个模型（只在模型列表变化时运行一次）
    useEffect(() => {
      if (textModels.length > 0 && selectedModel === '') {
        const defaultModel = textModels.find(m => m.isDefault === true);
        setSelectedModel(defaultModel ? defaultModel.value : textModels[0].value);
      }
    }, [textModels]); // ✅ 移除 selectedModel 依赖，避免不必要的重新运行

    // ✅ 性能优化：只在镜头 ID 变化时才初始化提示词，避免每次渲染都触发
    // 使用 shot?.id 而不是整个 shot 对象作为依赖
    useEffect(() => {
      if (shot) {
        setStoryboardPrompt(shot.storyboardPrompt || '');
        setMotionPrompt(shot.motionPrompt || '');
      }
    }, [shot?.id]); // 只依赖 shot.id，避免对象引用变化触发

    // 关闭时重置状态
    useEffect(() => {
      if (!open) {
        setGenerating(false);
        setImageGenerating(false);
        setVideoGenerating(false);
        setContentReady(false); // ✅ 关闭时重置内容渲染标记

        // ✅ 修复内存泄漏：关闭Drawer时清理未完成的保存timer
        if (saveTimerRef.current) {
          clearTimeout(saveTimerRef.current);
          saveTimerRef.current = null;
        }
      }
    }, [open]);

    // ✅ 动画性能优化：弹窗打开后延迟 150ms 再渲染重型组件
    // 让弹窗打开动画先完成，避免动画卡顿
    useEffect(() => {
      if (open) {
        const timer = setTimeout(() => {
          setContentReady(true);
        }, 150); // 弹窗动画完成后再渲染内容
        return () => clearTimeout(timer);
      }
    }, [open]);

    // AI生成提示词（画面 + 运动一起生成）
    // ✅ 性能优化：缓存生成函数依赖，避免每次渲染都创建新函数
    // 使用 ref 来获取最新的 generating 状态，避免依赖循环
    const generatingRef = useRef(generating);
    generatingRef.current = generating;

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

      // ✅ 如果已经在生成中，防止重复点击
      if (generatingRef.current) {
        message.warning('正在生成中，请稍候');
        return;
      }

      setGenerating(true);

      try {
        // 构建请求参数
        const request = {
          model: selectedModel,
          shotId: shot.id,
          shotData: {
            visual: shot.visual,
            shotSize: shot.shotSize,
            cameraMovement: shot.cameraMovement, // 运镜方式（含角度）
            dialogue: shot.dialogue,
            soundEffect: shot.soundEffect,
            lightingAtmosphere: shot.lightingAtmosphere, // 光影氛围
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

        // ✅ 性能优化：延迟保存，避免阻塞 UI，给用户响应时间
        // 用户可以立即看到生成的提示词，保存操作在后台执行
        message.success('提示词生成成功');

        // ✅ 修复内存泄漏：清理之前的timer，避免堆积
        if (saveTimerRef.current) {
          clearTimeout(saveTimerRef.current);
        }

        // 延迟 500ms 后保存，让用户先看到结果
        saveTimerRef.current = setTimeout(async () => {
          try {
            const currentStore = useCanvasStore.getState();
            const viewport = currentStore._cache.get(projectId)?.savedViewport || { x: 0, y: 0, zoom: 1 };
            await canvasApi.saveCanvas(projectId, {
              nodes: currentStore.nodes,
              edges: currentStore.edges,
              viewport,
            });
            message.success('已自动保存', 1);
          } catch (saveError) {
            console.error('保存画布失败:', saveError);
            message.warning('保存失败，请手动保存画布');
          }
          saveTimerRef.current = null; // ✅ 执行完后清空引用
        }, 500);

        // ✅ 不自动关闭，让用户可以查看和修改生成的提示词
      } catch (error) {
        console.error('生成提示词失败:', error);
        // HTTP 错误已由 api.ts 拦截器统一 message.error()，此处仅兜底非 HTTP 错误
        if (!(error instanceof Error) || !error.message) {
          message.error('生成提示词失败');
        }
      } finally {
        setGenerating(false);
      }
    }, [shot?.id, selectedModel, assetReferences, onUpdate, projectId]); // ✅ 使用 shot?.id 而不是 shot 对象，移除 generating 依赖

    // Input onChange 处理器优化（避免每次输入创建新函数）
    const handleStoryboardChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setStoryboardPrompt(e.target.value);
    }, []);

    // 复制最终提示词（增强错误处理）
    const handleCopyFinalPrompt = useCallback(async () => {
      if (!finalPrompt.trim()) {
        message.warning('最终提示词为空，无法复制');
        return;
      }

      // Step 1: 安全上下文校验
      const isSecureContext = window.isSecureContext || location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';

      // Step 2: 尝试 Clipboard API（现代浏览器）
      if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
          await navigator.clipboard.writeText(finalPrompt);
          message.success('已复制到剪贴板');
          console.log('[复制成功] Clipboard API');
          return; // 成功则直接返回
        } catch (err) {
          console.error('[Clipboard API 失败]', {
            error: err,
            name: err instanceof Error ? err.name : 'Unknown',
            message: err instanceof Error ? err.message : 'Unknown error',
            isSecureContext,
            hasFocus: document.hasFocus(),
            clipboardAvailable: !!navigator.clipboard,
          });

          // SecurityError 或其他错误，继续尝试 fallback
          if (err instanceof Error && err.name === 'SecurityError') {
            console.warn('[安全限制] Clipboard API 被阻止，尝试备用方案');
          }
        }
      } else {
        console.warn('[Clipboard API 不可用]', {
          clipboardExists: !!navigator.clipboard,
          writeTextExists: !!navigator.clipboard?.writeText,
          isSecureContext,
        });
      }

      // Step 3: execCommand 降级方案（兼容性兜底）
      try {
        const textarea = document.createElement('textarea');
        textarea.value = finalPrompt;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.top = '0';
        textarea.style.opacity = '0';
        textarea.setAttribute('readonly', ''); // 防止iOS键盘弹出
        document.body.appendChild(textarea);

        // iOS兼容性：需要先focus再select
        textarea.focus();
        textarea.select();

        // 设置selection范围（兼容所有浏览器）
        textarea.setSelectionRange(0, finalPrompt.length);

        const success = document.execCommand('copy');
        document.body.removeChild(textarea);

        if (success) {
          message.success('已复制到剪贴板');
          console.log('[复制成功] execCommand fallback');
        } else {
          message.error('复制失败，请手动复制');
          console.error('[execCommand 失败] 返回 false');
        }
      } catch (fallbackErr) {
        console.error('[Fallback 失败]', fallbackErr);
        message.error('复制失败，请手动复制');
      }
    }, [finalPrompt, message]);

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
        // HTTP 错误已由 api.ts 拦截器统一 message.error()
      }
    }, [shot, storyboardPrompt, motionPrompt, projectId, onUpdate]);

    // 创建分镜图片节点并触发生成（前提：已有画面提示词）
    const handleGenerateImage = useCallback(async () => {
      if (!shot) return;
      if (!storyboardPrompt.trim()) {
        message.warning('请先生成画面提示词');
        return;
      }
      if (!projectId) return;

      // 已在生成中则阻止重复点击
      const existing = findShotImageNode(scriptNodeId, shot.id);
      if (existing && (existing.data.status === 'running' || existing.data.status === 'pending')) {
        message.warning('该镜头的图片正在生成中，请稍候');
        return;
      }

      setImageGenerating(true);
      try {
        const node = createShotImageNode(scriptNodeId, shot, storyboardPrompt.trim(), defaultImageModelId);
        if (!node) {
          message.error('创建图片节点失败');
          return;
        }
        await persistShotCanvas(projectId);
        message.success('已创建图片节点，请在画布上点击生成');
      } finally {
        setImageGenerating(false);
      }
    }, [shot, storyboardPrompt, scriptNodeId, projectId, defaultImageModelId]);

    // 创建分镜视频节点并触发生成
    // 有图片节点时只需运动提示词；无图片节点时需画面+运动提示词
    const handleGenerateVideo = useCallback(async () => {
      if (!shot) return;
      if (!projectId) return;

      // 检查是否已有分镜图片节点（作为参考图）
      const hasImageNode = !!findShotImageNode(scriptNodeId, shot.id);

      if (hasImageNode) {
        // 有图片节点：只需要运动提示词
        if (!motionPrompt.trim()) {
          message.warning('请先生成运动提示词');
          return;
        }
      } else {
        // 无图片节点：画面+运动提示词都需要
        if (!storyboardPrompt.trim() || !motionPrompt.trim()) {
          message.warning('请先生成画面提示词和运动提示词');
          return;
        }
      }

      const existing = findShotVideoNode(scriptNodeId, shot.id);
      if (existing && (existing.data.status === 'running' || existing.data.status === 'pending')) {
        message.warning('该镜头的视频正在生成中，请稍候');
        return;
      }

      // 合成最终提示词：有图片节点时只用运动提示词
      const combined = hasImageNode
        ? `视频运动提示词：${motionPrompt.trim()}`
        : `画面提示词：${storyboardPrompt.trim()}\n视频运动提示词：${motionPrompt.trim()}`;
      setVideoGenerating(true);
      try {
        const node = createShotVideoNode(scriptNodeId, shot, combined, defaultVideoModelId);
        if (!node) {
          message.error('创建视频节点失败');
          return;
        }
        await persistShotCanvas(projectId);
        message.success('已创建视频节点，请在画布上点击生成');
      } finally {
        setVideoGenerating(false);
      }
    }, [shot, storyboardPrompt, motionPrompt, scriptNodeId, projectId, defaultVideoModelId]);

    return (
      <Modal
        title={`镜头 ${shot?.shotNumber || ''} - 提示词生成`}
        open={open}
        onCancel={onClose}
        width={1000}
        footer={null}
        destroyOnClose
        styles={{ body: { padding: '16px 20px', height: '68vh', minHeight: 520 } }}
      >
        {/* ✅ 动画性能优化：延迟渲染重型组件，等待弹窗打开动画完成 */}
        {!contentReady ? (
          // 动画进行中：显示轻量级占位符
          <div className="flex items-center justify-center h-full">
            <div className="text-gray-400 text-sm">加载中...</div>
          </div>
        ) : (
          <div className="flex flex-col h-full gap-3">
            {/* 顶部：模型选择 + 生成按钮 */}
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-sm font-medium text-gray-700 shrink-0">文本模型</span>
              <Select
                value={selectedModel}
                onChange={setSelectedModel}
                options={textModels}
                placeholder="选择文本模型"
                className="flex-1"
              />
              <Button
                type="primary"
                onClick={handleGenerate}
                disabled={!shot || !selectedModel}
                loading={generating}
                icon={<ReloadOutlined />}
              >
                {generating ? '生成中...' : storyboardPrompt ? '重新生成' : '生成提示词'}
              </Button>
            </div>

            {/* 中部：左侧提示词编辑区 + 右侧最终提示词 */}
            <div className="flex gap-4 flex-1 min-h-0">
              {/* 左列：画面提示词 + 运动提示词 */}
              <div className="flex-1 min-w-0 flex flex-col gap-3">
                {/* 画面提示词 */}
                <div className="flex-[6] min-h-0 flex flex-col">
                  <div className="text-sm font-medium text-gray-700 mb-1 shrink-0">画面提示词</div>
                  {/* 识别到的 @ 引用标签 */}
                  {storyboardPrompt.trim() && (
                    <div className="mb-1 shrink-0">
                      <PromptReferenceTags
                        prompt={storyboardPrompt}
                        characters={charactersRef.current}
                        scenes={scenesRef.current}
                        props={propsRef.current}
                        delayMs={100}
                      />
                    </div>
                  )}
                  <div className="flex-1 min-h-0 flex">
                    <textarea
                      value={storyboardPrompt}
                      onChange={handleStoryboardChange}
                      onBlur={handleAutoSave}
                      placeholder="点击AI生成按钮或手动输入画面提示词，可使用括号形式引用资产（如：南方（@角色-南方））"
                      className="flex-1 w-full px-3 py-2 rounded-md border border-gray-200 bg-white text-sm text-gray-700 leading-relaxed resize-none focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200 transition-colors"
                    />
                  </div>
                </div>

                {/* 运动提示词 */}
                <div className="flex-[4] min-h-0 flex flex-col">
                  <div className="text-sm font-medium text-gray-700 mb-1 shrink-0">运动提示词</div>
                  <div className="flex-1 min-h-0 flex">
                    <textarea
                      value={motionPrompt}
                      onChange={handleMotionChange}
                      onBlur={handleAutoSave}
                      placeholder="点击AI生成按钮或手动输入运动提示词"
                      className="flex-1 w-full px-3 py-2 rounded-md border border-gray-200 bg-white text-sm text-gray-700 leading-relaxed resize-none focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200 transition-colors"
                    />
                  </div>
                </div>
              </div>

              {/* 右列：最终提示词 */}
              <div className="w-[360px] shrink-0 flex flex-col">
                <div className="text-sm font-medium text-gray-700 mb-1 shrink-0 flex items-center justify-between">
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
                <div className="flex-1 min-h-0 flex">
                  <textarea
                    value={finalPrompt}
                    placeholder="画面提示词 + 运动提示词自动合成"
                    className="flex-1 w-full px-3 py-2 rounded-md border border-gray-200 bg-gray-50 text-sm text-gray-700 leading-relaxed resize-none focus:outline-none"
                    readOnly
                  />
                </div>
              </div>
            </div>

            {/* 底部：创建分镜资产节点（仅在有提示词时显示） */}
            <div className="shrink-0 pt-3 border-t border-gray-200">
              <div className="flex items-center justify-center gap-2">
                {storyboardPrompt.trim() && !imageNodeExists && (
                  <Button
                    onClick={handleGenerateImage}
                    loading={imageGenerating}
                    disabled={!shot}
                    icon={<PictureOutlined />}
                  >
                    创建分镜图片节点
                  </Button>
                )}
                {storyboardPrompt.trim() && motionPrompt.trim() && (
                  <Button
                    onClick={handleGenerateVideo}
                    loading={videoGenerating}
                    disabled={!shot}
                    icon={<VideoCameraOutlined />}
                  >
                    创建分镜视频节点
                  </Button>
                )}
              </div>
              <div className="text-xs text-gray-400 mt-2 text-center">
                输入框失去焦点会自动保存
              </div>
            </div>
          </div>
        )}
      </Modal>
    );
  }
);