import { memo, useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Modal, Button, Select, Segmented } from 'antd';
import { message } from '@/utils/antdApp';
import { ReloadOutlined, PictureOutlined, VideoCameraOutlined } from '@ant-design/icons';
import type { ScriptShot, ScriptNodeData } from '@/types/canvas';
import { useCanvasStore } from '@/stores/canvasStore';
import { useModels } from '@/hooks/useModels';
import { generatePrompt } from '@/services/promptApi';
import { canvasApi } from '@/services/canvasApi';
import { PromptReferenceTags } from './PromptReferenceTags';
import { refreshCredits } from '@/utils/refreshCredits';
import {
  createShotImageNode,
  createShotVideoNode,
  persistShotCanvas,
  findShotImageNodes,
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
 * - 左右两栏：左=画面提示词，右=运动提示词
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
    // 两种模式各自独立的提示词，互不覆盖：1 张模式只读 singlePrompt，2 张模式只读 dual*Prompt
    const [singlePrompt, setSinglePrompt] = useState(''); // 参考模式（单张参考图）的画面提示词
    const [dualStartPrompt, setDualStartPrompt] = useState(''); // 首尾帧模式：起始画面
    const [dualEndPrompt, setDualEndPrompt] = useState(''); // 首尾帧模式：结束画面
    const [refImageCount, setRefImageCount] = useState<1 | 2>(2); // 模式：1=参考模式，2=首尾帧模式（默认首尾帧）
    const [activeRef, setActiveRef] = useState<1 | 2>(1); // 首尾帧模式下当前在编辑哪一张（1=起始 2=结束）
    // 运动提示词同样按模式各存各的：两次生成的结果不可能一样，不能互相覆盖
    const [singleMotion, setSingleMotion] = useState(''); // 参考模式的运动提示词
    const [dualMotion, setDualMotion] = useState(''); // 首尾帧模式的运动提示词
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
    // ✅ 响应式判断：该镜头的参考图节点是否已全部创建（全建好才隐藏"创建参考图节点"按钮）
    const shotImageNodeIds = useMemo(
      () => (shot ? Array.from({ length: refImageCount }, (_, i) => generateShotImageNodeId(shot.id, scriptNodeId, i + 1)) : []),
      [shot, scriptNodeId, refImageCount],
    );
    const imageNodeExists = useCanvasStore(
      (s) => shotImageNodeIds.length > 0 && shotImageNodeIds.every((id) => s.nodes.some((n) => n.id === id)),
    );
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

    // 当前编辑框里显示哪份提示词：1 张模式永远读自己的那份 —— 切到 1 张时不会残留 2 张模式的第 2 份
    const activePrompt = refImageCount === 2
      ? (activeRef === 2 ? dualEndPrompt : dualStartPrompt)
      : singlePrompt;
    // 当前模式是否已有提示词（决定按钮显示/「重新生成」文案）；1=参考模式 2=首尾帧模式
    const modeHasPrompt = refImageCount === 2
      ? !!(dualStartPrompt.trim() || dualEndPrompt.trim())
      : !!singlePrompt.trim();
    // 当前模式的主提示词；首尾帧模式下起始为空时退回结束画面
    const modeFirstPrompt = refImageCount === 2
      ? (dualStartPrompt.trim() || dualEndPrompt.trim())
      : singlePrompt.trim();
    // 第 index 张参考图用哪份画面提示词（仅首尾帧模式需要区分；缺一份时沿用另一份，避免建出空提示词节点）
    const promptForRef = useCallback((index: number) => {
      if (refImageCount === 2) {
        return index === 2
          ? (dualEndPrompt.trim() || dualStartPrompt.trim())
          : (dualStartPrompt.trim() || dualEndPrompt.trim());
      }
      return singlePrompt.trim();
    }, [refImageCount, singlePrompt, dualStartPrompt, dualEndPrompt]);
    // 当前模式生效的运动提示词
    const activeMotion = refImageCount === 2 ? dualMotion : singleMotion;
    // 切换模式：各自独立；切到参考模式时视角也回到第 1 张
    const handleRefCountChange = useCallback((next: 1 | 2) => {
      setRefImageCount(next);
      if (next === 1) setActiveRef(1);
    }, []);

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
        setSinglePrompt(shot.storyboardPrompt || '');
        setDualStartPrompt(shot.storyboardPrompts?.[0] || '');
        setDualEndPrompt(shot.storyboardPrompts?.[1] || '');
        setRefImageCount(2); // 默认首尾帧模式：开箱即可用首尾帧
        setActiveRef(1);
        setSingleMotion(shot.motionPrompt || '');
        setDualMotion(shot.dualMotionPrompt || '');
        // 恢复该镜头上次选用的模式（1 张 / 2 张），默认 2 张
        setRefImageCount(shot.refImageCount === 1 ? 1 : 2); // 1=参考模式 2=首尾帧模式
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
          imageCount: refImageCount, // 首尾帧模式一次生成「起始画面 + 结束画面」两份提示词
          projectId, // 带上项目：对账页要显示是哪个项目的提示词
        };

        // 调用后端 API 生成提示词（api 实例会自动注入 token）
        const result = await generatePrompt(request);
        // 提示词生成是前端直连的计费接口（扣费在 /prompt/generate 里完成）：
        // 这里不刷新的话，用户花了积分却看不到余额变化
        if (!result.replayed) void refreshCredits();
        if (result.replayed) {
          // 后端识别出这是同一镜头/同一模型在窗口内的重复点击：返回上一次结果、没有重新生成、没有扣费
          message.info('这是刚刚生成的结果（重复点击不会重复扣费）；想重新生成请稍后再试');
        }

        // 更新状态（多份时逐份落位）
        const generated = result.storyboardPrompts?.length ? result.storyboardPrompts : [result.storyboardPrompt];
        const prompt1 = generated[0] || '';
        const prompt2 = generated[1] || '';
        // 只写当前模式的提示词，另一模式的存量原样保留
        let promptPatch: Partial<ScriptShot>;
        if (refImageCount === 2) {
          setDualStartPrompt(prompt1);
          setDualEndPrompt(prompt2);
          setActiveRef(1);
          promptPatch = { storyboardPrompts: [prompt1, prompt2] };
        } else {
          setSinglePrompt(prompt1);
          promptPatch = { storyboardPrompt: prompt1 };
        }
        if (refImageCount === 2) setDualMotion(result.motionPrompt);
        else setSingleMotion(result.motionPrompt);

        // 自动保存（更新镜头数据）
        const updatedShot = {
          ...shot,
          ...promptPatch,
          ...(refImageCount === 2 ? { dualMotionPrompt: result.motionPrompt } : { motionPrompt: result.motionPrompt }),
          refImageCount,
          finalPrompt: result.motionPrompt.trim()
            ? `画面提示词：${prompt1.trim()}\n视频运动提示词：${result.motionPrompt.trim()}`
            : `画面提示词：${prompt1.trim()}`,
        };

        onUpdate(updatedShot);

        // ✅ 性能优化：延迟保存，避免阻塞 UI，给用户响应时间
        // 用户可以立即看到生成的提示词，保存操作在后台执行
        message.success(refImageCount > 1 && prompt2 ? '已生成 2 份画面提示词（起始画面 + 结束画面）' : '提示词生成成功'); // 参考模式只生成 1 份

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
    }, [shot?.id, selectedModel, assetReferences, onUpdate, projectId, refImageCount]); // ✅ 使用 shot?.id 而不是 shot 对象，移除 generating 依赖

    // Input onChange 处理器优化（避免每次输入创建新函数）
    const handleStoryboardChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const v = e.target.value;
      if (refImageCount === 2) {
        if (activeRef === 2) setDualEndPrompt(v);
        else setDualStartPrompt(v);
        return;
      }
      setSinglePrompt(v);
    }, [refImageCount, activeRef]);

    const handleMotionChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (refImageCount === 2) setDualMotion(e.target.value);
      else setSingleMotion(e.target.value);
    }, [refImageCount]);

    // 自动保存提示词（失去焦点时保存）
    const handleAutoSave = useCallback(async () => {
      if (!shot) return;

      try {
        // 更新镜头数据
        // 只落当前模式自己的字段，另一模式的数据不动
        const promptPatch: Partial<ScriptShot> = refImageCount === 2
          ? { storyboardPrompts: [dualStartPrompt.trim(), dualEndPrompt.trim()] }
          : { storyboardPrompt: singlePrompt.trim() };
        const updatedShot = {
          ...shot,
          ...promptPatch,
          ...(refImageCount === 2 ? { dualMotionPrompt: dualMotion.trim() } : { motionPrompt: singleMotion.trim() }),
          refImageCount,
          finalPrompt: activeMotion.trim()
            ? `画面提示词：${modeFirstPrompt}\n视频运动提示词：${activeMotion.trim()}`
            : `画面提示词：${modeFirstPrompt}`,
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
    }, [shot, singlePrompt, dualStartPrompt, dualEndPrompt, refImageCount, modeFirstPrompt, singleMotion, dualMotion, activeMotion, projectId, onUpdate]);

    // 创建分镜图片节点并触发生成（前提：已有画面提示词）
    const handleGenerateImage = useCallback(async () => {
      if (!shot) return;
      if (!modeHasPrompt) {
        message.warning('请先生成画面提示词');
        return;
      }
      if (!projectId) return;

      // 已在生成中则阻止重复点击（该镜头任意一张参考图在跑都拦）
      const existingNodes = findShotImageNodes(scriptNodeId, shot.id);
      if (existingNodes.some((n) => n.data.status === 'running' || n.data.status === 'pending')) {
        message.warning('该镜头的图片正在生成中，请稍候');
        return;
      }

      setImageGenerating(true);
      try {
        // 按张数创建参考图节点：第 1 张可作首帧、第 2 张可作尾帧，也可两张一起做全能参考
        let created = 0;
        for (let i = 1; i <= refImageCount; i++) {
          const node = createShotImageNode(scriptNodeId, shot, promptForRef(i), defaultImageModelId, i, refImageCount);
          if (node) created += 1;
        }
        if (created === 0) {
          message.error('创建图片节点失败');
          return;
        }
        await persistShotCanvas(projectId);
        if (refImageCount === 2 && !dualStartPrompt.trim()) {
          message.warning('起始画面还没有自己的提示词，暂时沿用了结束画面');
        } else if (refImageCount === 2 && !dualEndPrompt.trim()) {
          message.warning('结束画面还没有自己的提示词，暂时沿用了起始画面');
        }
        message.success(
          refImageCount === 2
            ? '已创建起始画面 + 结束画面两个节点，请在画布上点击生成'
            : `已创建 ${created} 个参考图节点，请在画布上点击生成`,
        );
      } finally {
        setImageGenerating(false);
      }
    }, [shot, modeHasPrompt, dualStartPrompt, dualEndPrompt, refImageCount, promptForRef, scriptNodeId, projectId, defaultImageModelId]);

    // 创建分镜视频节点并触发生成
    // 有图片节点时只需运动提示词；无图片节点时需画面+运动提示词
    const handleGenerateVideo = useCallback(async () => {
      if (!shot) return;
      if (!projectId) return;

      // 检查是否已有分镜参考图节点（作为参考图）
      const hasImageNode = findShotImageNodes(scriptNodeId, shot.id).length > 0;

      if (hasImageNode) {
        // 有图片节点：只需要运动提示词
        if (!activeMotion.trim()) {
          message.warning('请先生成运动提示词');
          return;
        }
      } else {
        // 无图片节点：画面+运动提示词都需要
        if (!modeFirstPrompt || !activeMotion.trim()) {
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
        ? `视频运动提示词：${activeMotion.trim()}`
        : `画面提示词：${modeFirstPrompt}\n视频运动提示词：${activeMotion.trim()}`;
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
    }, [shot, modeFirstPrompt, activeMotion, scriptNodeId, projectId, defaultVideoModelId]);

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
            {/* 顶部：模式（首尾帧/参考）+ 模型选择 + 生成按钮 */}
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-sm font-medium text-gray-700 shrink-0">模式</span>
              <Segmented
                size="small"
                value={refImageCount}
                onChange={(v) => handleRefCountChange(Number(v) as 1 | 2)}
                options={[
                  { label: '首尾帧模式', value: 2 },
                  { label: '参考模式', value: 1 },
                ]}
              />
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
                {generating ? '生成中...' : modeHasPrompt ? '重新生成' : '生成提示词'}
              </Button>
            </div>

            {/* 中部：左=画面提示词，右=运动提示词 */}
            <div className="flex gap-4 flex-1 min-h-0">
              {/* 左栏：画面提示词 */}
              <div className="flex-1 min-w-0 flex flex-col">
                <div className="flex-1 min-h-0 flex flex-col">
                  <div className="text-sm font-medium text-gray-700 mb-1 shrink-0">
                    画面提示词
                    {refImageCount === 2 && <span className="ml-1 text-xs font-normal text-gray-400">（首尾帧：起始 + 结束两份）</span>}
                  </div>
                  {/* 首尾帧模式：切换编辑起始还是结束画面 */}
                  {refImageCount === 2 && (
                    <Segmented
                      size="small"
                      block
                      className="mb-1 shrink-0"
                      value={activeRef}
                      onChange={(v) => setActiveRef(Number(v) as 1 | 2)}
                      options={[
                        { label: '起始画面', value: 1 },
                        { label: '结束画面', value: 2 },
                      ]}
                    />
                  )}
                  {/* 识别到的 @ 引用标签 */}
                  {activePrompt.trim() && (
                    <div className="mb-1 shrink-0">
                      <PromptReferenceTags
                        prompt={activePrompt}
                        characters={charactersRef.current}
                        scenes={scenesRef.current}
                        props={propsRef.current}
                        delayMs={100}
                      />
                    </div>
                  )}
                  <div className="flex-1 min-h-0 flex">
                    <textarea
                      value={activePrompt}
                      onChange={handleStoryboardChange}
                      onBlur={handleAutoSave}
                      placeholder={refImageCount === 2
                        ? `${activeRef === 1 ? '起始画面' : '结束画面'}的画面提示词，可点击AI生成或手动输入`
                        : '点击AI生成按钮或手动输入画面提示词，可使用括号形式引用资产（如：南方（@角色-南方））'}
                      className="flex-1 w-full px-3 py-2 rounded-md border border-gray-200 bg-white text-sm text-gray-700 leading-relaxed resize-none focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200 transition-colors"
                    />
                  </div>
                </div>
              </div>

              {/* 右栏：运动提示词 */}
              <div className="flex-1 min-w-0 flex flex-col">
                <div className="text-sm font-medium text-gray-700 mb-1 shrink-0">
                  运动提示词
                  {refImageCount === 2 && <span className="ml-1 text-xs font-normal text-gray-400">（首尾帧：起止状态对齐两张参考图）</span>}
                </div>
                <div className="flex-1 min-h-0 flex">
                  <textarea
                    value={activeMotion}
                    onChange={handleMotionChange}
                    onBlur={handleAutoSave}
                    placeholder="点击AI生成按钮或手动输入运动提示词"
                    className="flex-1 w-full px-3 py-2 rounded-md border border-gray-200 bg-white text-sm text-gray-700 leading-relaxed resize-none focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200 transition-colors"
                  />
                </div>
              </div>
            </div>

            {/* 底部：创建分镜资产节点（仅在有提示词时显示） */}
            <div className="shrink-0 pt-3 border-t border-gray-200">
              <div className="flex items-center justify-center gap-2">
                {modeHasPrompt && !imageNodeExists && (
                  <Button
                    onClick={handleGenerateImage}
                    loading={imageGenerating}
                    disabled={!shot}
                    icon={<PictureOutlined />}
                  >
                    {refImageCount === 2 ? '创建首尾帧节点（起始 + 结束）' : '创建参考图节点'}
                  </Button>
                )}
                {modeHasPrompt && activeMotion.trim() && (
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