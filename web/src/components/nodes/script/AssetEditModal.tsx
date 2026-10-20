import { memo, useState, useRef, useCallback, useEffect } from 'react';
import { Modal } from 'antd';
import { message } from '@/utils/antdApp';
import { LoadingOutlined } from '@ant-design/icons';
import type {
  ScriptCharacter,
  ScriptScene,
  ScriptProp,
} from '@/types/canvas';
import type { MentionMarker } from '@/types/prompt';
import { uploadImage } from '@/services/uploadApi';
import { useCanvasStore } from '@/stores/canvasStore';
import { useExecutionStore } from '@/stores/executionStore';
import { workflowApi } from '@/services/workflowApi';
import { canvasApi } from '@/services/canvasApi';
import { useModels } from '@/hooks/useModels';
import { PROMPT_PANEL_CONFIGS } from '@/configs/promptConfig';
import { buildAssetReferenceLine } from '@/utils/imageViewPrompts';
import {
  getAssetImageNodeId,
  createAssetImageNode,
  ensureAssetReferenceNode,
} from '@/utils/assetImageSync';

type AssetType = 'character' | 'scene' | 'prop';
type Asset = ScriptCharacter | ScriptScene | ScriptProp;

/**
 * 资产类型 → 视图名。
 *
 * 口径以**代码实际生成的东西**为准（本次统一）：脚本节点给资产描述追加的视图要求块是
 * 【角色四视图】/【场景四视图】/【道具六视图】（server/internal/llm/prompt.go 的
 * ScriptSystemPrompt），也就是角色 1×4（正脸近景特写 + 正面/侧面/背面全身）、场景 2×2、
 * 道具 2×3；资产描述原样进提示词，所以这里出的就是这几种宫格图。
 * 文案原来对角色写"三视图"——那是图片节点上「生成视图」里的**另一个可选档**（1×3），
 * 与资产流程实际产出的 1×4 不是一回事：用户会按"三视图"去切 1×3，切出来每格都不对。
 * 名字统一用 imageViewPrompts 里 VIEW_PRESETS 的标签，同一个产物不给两个叫法。
 */
const ASSET_VIEW_NAME: Record<AssetType, string> = {
  character: '角色四视图',
  scene: '场景四视图',
  prop: '道具六视图',
};

/** 资产类型 → viewKind：切分宫格 / 生成视图据此预选宫格行列（对应 VIEW_PRESETS 的行列） */
const ASSET_VIEW_KIND: Record<AssetType, string> = {
  character: 'character4',
  scene: 'scene4',
  prop: 'prop6',
};

// 从 hook 动态获取图像生成模型选项
// IMAGE_MODEL_OPTIONS 将在组件中使用 useModels hook 获取

// ==================== 资产生成状态监听（模块级，与弹窗生命周期解耦）====================
// loading 消息跟随画布图片节点的生成状态（SSE 驱动 canvasStore 节点 status 变化），
// 节点 success / failed / 超时 时才销毁；关闭资产弹窗不影响监听
//
// 注意这里**不再回填资产**（生成结果 URL 不再写进资产的 imageUrl / 不再走
// AssetPreparationPanel 的上传路径）：上传路径会把 URL 记成"用户原图"，
// 生成结果从那里过一遍，下一次生成就会拿生成结果当参考图、真原图被顶掉。
// 资产的 imageUrl 语义是"用户上传的参考图"（见 ScriptSystemPrompt 的字段说明），
// 生成结果落在画布节点上（卡片、分镜参考图都按 nodeId 读节点），
// 落库由后端 persistNodeOutputs 负责。
const assetGenWatchers = new Map<string, () => void>(); // imageNodeId -> cancel

function watchAssetGeneration(
  imageNodeId: string,
  onSettled: () => void,
) {
  const msgKey = `asset-gen-${imageNodeId}`;
  // 同一节点重新生成时，取消上一个监听，避免重复提示
  assetGenWatchers.get(imageNodeId)?.();

  let timer: ReturnType<typeof setTimeout>;
  const unsubscribe = useCanvasStore.subscribe((state, prevState) => {
    const node = state.nodes.find((n) => n.id === imageNodeId);
    const prevNode = prevState.nodes.find((n) => n.id === imageNodeId);
    if (!node || node === prevNode) return;
    const status = (node.data as { status?: string; imageUrl?: string })?.status;
    const prevStatus = (prevNode?.data as { status?: string })?.status;
    if (status === prevStatus) return;

    if (status === 'success') {
      cancel();
      message.destroy(msgKey);
      message.success('图像生成成功');
      onSettled();
    } else if (status === 'failed') {
      cancel();
      message.destroy(msgKey);
      // 节点右上角 Badge 已显示错误状态和 Tooltip，不需要全局提示
      onSettled();
    }
  });

  const cancel = () => {
    clearTimeout(timer);
    unsubscribe();
    assetGenWatchers.delete(imageNodeId);
  };

  // 超时保护（180 秒）
  timer = setTimeout(() => {
    cancel();
    message.destroy(msgKey);
    message.warning('图像生成超时，可在画布上查看图片节点状态');
    onSettled();
  }, 180000);

  assetGenWatchers.set(imageNodeId, cancel);
}

interface AssetEditModalProps {
  open: boolean;
  scriptNodeId: string;
  assetType: AssetType;
  asset: Asset | null;
  onClose: () => void;
  /** 图片上传后更新资产 */
  onUpload: (name: string, url: string) => void;
  /** 资产描述变更（失焦时自动保存） */
  onDescriptionChange: (name: string, description: string) => void;
}

/**
 * 通用资产编辑弹窗（角色/场景/道具）
 * - 顶部大图区域，可点击上传 / 右上角按钮基于描述生成视图
 * - 资产名称只读、资产描述可编辑（失焦自动保存）
 * - 根据资产类型显示不同的额外属性
 */
export const AssetEditModal = memo<AssetEditModalProps>(
  function AssetEditModal({
    open,
    scriptNodeId,
    assetType,
    asset,
    onClose,
    onUpload,
    onDescriptionChange,
  }) {
    // 从后端 API 动态获取图像模型列表
    const IMAGE_MODEL_OPTIONS = useModels('image');

    // ✅ 从画布图片节点实时读取 imageUrl（不再依赖脚本节点 data）
    const nodes = useCanvasStore((s) => s.nodes);
    const imageNodeId = asset ? getAssetImageNodeId(scriptNodeId, assetType, asset.name) : null;
    const imageNode = nodes.find(n => n.id === imageNodeId);
    const imageUrl = (imageNode?.data as any)?.imageUrl as string | undefined;

    const [uploading, setUploading] = useState(false);
    const [generating, setGenerating] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // 模型选择状态
    const [selectedModel, setSelectedModel] = useState('');
    const [modelDropdownOpen, setModelDropdownOpen] = useState(false);

    // 打开/切换资产时，从图片节点读取当前模型选中（仅在资产切换时触发，不随节点更新重置）
    useEffect(() => {
      if (IMAGE_MODEL_OPTIONS.length > 0) {
        // 读取当前图片节点的 model
        const store = useCanvasStore.getState();
        const nid = imageNodeId;
        const node = nid ? store.nodes.find(n => n.id === nid) : null;
        const nodeModel = node ? (node.data as any)?.model : undefined;
        if (nodeModel && IMAGE_MODEL_OPTIONS.some(m => m.modelId === nodeModel)) {
          setSelectedModel(nodeModel);
        } else {
          // 优先使用 promptConfig 配置的默认模型，其次 isDefault 标记，最后第一个
          const configDefault = PROMPT_PANEL_CONFIGS.image.defaultModel;
          const matched = IMAGE_MODEL_OPTIONS.find(m => m.modelId === configDefault)
            || IMAGE_MODEL_OPTIONS.find(m => m.isDefault === true);
          setSelectedModel(matched ? matched.modelId : IMAGE_MODEL_OPTIONS[0].modelId);
        }
      }
    }, [IMAGE_MODEL_OPTIONS, asset?.name, imageNodeId]);

    // 描述本地草稿 + 上一份已保存的描述（用于失焦比对）
    const [descriptionDraft, setDescriptionDraft] = useState('');
    const [savedDescription, setSavedDescription] = useState('');

    // 切换资产时同步本地草稿
    useEffect(() => {
      if (asset) {
        setDescriptionDraft(asset.description || '');
        setSavedDescription(asset.description || '');
      }
    }, [asset?.name, asset?.description, asset]);

    // 关闭时重置本地状态（生成监听是模块级的，不随弹窗关闭而清理）
    useEffect(() => {
      if (!open) {
        setUploading(false);
        setGenerating(false);
        setModelDropdownOpen(false);
      }
    }, [open]);

    /** 点击图片区域 → 触发文件选择 */
    const handleImageClick = useCallback(() => {
      if (uploading || generating) return;
      fileInputRef.current?.click();
    }, [uploading, generating]);

    /** 上传图片到服务器 */
    const handleFileChange = useCallback(
      async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !asset) return;
        setUploading(true);
        try {
          // ✅ uploadImage 现在返回 { url, width, height }
          const result = await uploadImage(file);
          onUpload(asset.name, result.url);  // 使用 result.url
          message.success('上传成功');
        } catch {
          // HTTP 错误已由 api.ts 拦截器统一 message.error()
        } finally {
          setUploading(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      },
      [asset, onUpload]
    );

    /**
     * 基于资产描述生成视图
     * 流程：确保图片节点存在 → 把抽屉状态写入节点 → 保存画布 → 执行
     */
    const handleGenerate = useCallback(async () => {
      if (!asset) return;

      if (generating) {
        message.warning('正在生成中，请稍候');
        return;
      }

      if (!selectedModel) {
        message.error('请先选择生成模型');
        return;
      }

      const store = useCanvasStore.getState();
      const projectId = store.projectId;
      if (!projectId) {
        message.error('无法获取项目 ID');
        return;
      }

      const scriptNode = store.nodes.find(n => n.id === scriptNodeId);
      if (!scriptNode) {
        message.error('找不到分镜节点');
        return;
      }

      setGenerating(true);

      const assetView = ASSET_VIEW_NAME[assetType];

      // 资产对应的图片节点：先看资产自己的 nodeId 引用，没有就建一个（id 不再按格式拼）
      const linkedId = getAssetImageNodeId(scriptNodeId, assetType, asset.name);
      const existingNode = linkedId ? store.nodes.find(n => n.id === linkedId) : undefined;
      const created = existingNode ? null : createAssetImageNode(scriptNodeId, assetType, asset.name);
      const imageNodeId = existingNode?.id ?? created?.id;
      const msgKey = `asset-gen-${imageNodeId ?? asset.name}`;
      const modelName = IMAGE_MODEL_OPTIONS.find(m => m.modelId === selectedModel)?.label || selectedModel;
      message.loading({
        content: `正在使用 ${modelName} 生成${assetView}…`,
        key: msgKey,
        duration: 0,
      });

      try {
        // Step 1: 图片节点已在上方确保存在
        if (!imageNodeId) {
          throw new Error('创建图片节点失败');
        }

        // Step 1.5: 把**用户上传的原图**接成参考图。
        //
        // 改造前这条路只写 prompt = asset.description（纯文生图），用户上传的原图从来没被
        // 当参考图用过 —— 生成结果跟原图对不上，这是必然的。参考图必须凑齐三件套，
        // 少一样后端就静默丢掉（与 utils/imageOpsNodes.ts 文件头写的是同一套约定）：
        //   ① prompt 里有 `[[m:<参考图节点id>]]` 占位符（executor.go 按 marker 过滤 mentions）
        //   ② data.mentions 里有对应条目（标记用的是 mention.id，不是 nodeId）
        //   ③ 一条 参考图节点 → 本节点 的 dataFlow 边（上游没有它，后端取不到图）
        //
        // 原图为什么落在**单独的参考图节点**而不是资产图片节点自己：生成结果会覆盖资产
        // 图片节点的 imageUrl（SSE 回写 + 回填），原图留在这里就没了；
        // 参考图节点由上传路径写入、生成过程永不碰，用户原图因此不会被弄丢
        //（详见 assetImageSync.ts 里 ensureAssetReferenceNode 的说明）。
        const reference = ensureAssetReferenceNode(imageNodeId);
        const description = asset.description || '';
        const prompt = reference
          ? `${description}${buildAssetReferenceLine(`[[m:${reference.nodeId}]]`)}`
          : description;
        const mentions: MentionMarker[] = reference
          ? [{
              // 占位符里的 id 就用参考图节点 id（同 shotNodeSync 的资产引用约定），
              // prompt、mentions、边三者指向同一个节点，不会各说各话
              id: reference.nodeId,
              nodeId: reference.nodeId,
              label: reference.label,
              nodeType: 'image',
            }]
          : [];

        // Step 2: 把抽屉状态（模型、提示词等）写入图片节点，并重置运行状态。
        // 拆成两次写，是因为这两部分对"撤销"的意义不同：
        //   - 模型/提示词/视图是**用户改的内容** → 走正常写，能撤销；
        //   - status='running' 是过渡态 → transient，不能占一格撤销（否则撤销会停在"生成中"）。
        // status 仍然要写：订阅靠 running→success/failed 的变化收口，不写的话第二次生成
        // 时状态没变化，loading 不会消失。
        const canvasStore = useCanvasStore.getState();
        canvasStore.updateNodeData(imageNodeId, {
          model: selectedModel,
          prompt,
          // mentions 与 prompt 里的占位符一一对应（PromptEditor 靠它把占位符渲染成 @标签）；
          // 没有参考图时写空数组，免得留下上一次的悬空 mention
          mentions,
          // 写清这套图是什么视图：图节点工具条的「切分宫格」/「生成视图」据此自动预选宫格行列
          viewKind: ASSET_VIEW_KIND[assetType],
        } as any);
        canvasStore.updateNodeData(imageNodeId, { status: 'running' }, { transient: true });

        // Step 3: 保存画布（让后端能读到最新节点数据）
        const currentStore = useCanvasStore.getState();
        const viewport = currentStore._cache.get(projectId)?.savedViewport || { x: 0, y: 0, zoom: 1 };
        await canvasApi.saveCanvas(projectId, {
          nodes: currentStore.nodes,
          edges: currentStore.edges,
          viewport,
        });

        // Step 4: 执行图片节点
        const resp = await workflowApi.execute(projectId, imageNodeId);

        if (!resp?.executionId) {
          throw new Error('启动图像生成失败');
        }

        // 添加到 SSE 订阅列表（WorkspacePage 会自动订阅）
        useExecutionStore.getState().addActiveStream({
          projectId,
          executionId: resp.executionId,
          nodeId: imageNodeId,
        });

        // 模块级监听画布节点生成状态：跟随 SSE 状态变化，生成结束才销毁 loading 消息
        // 弹窗关闭不影响监听（生成结果不回填资产，回填会把原图顶掉，见 watchAssetGeneration 上方注释）
        watchAssetGeneration(
          imageNodeId,
          () => setGenerating(false),
        );

      } catch (error) {
        console.error('图像生成失败:', error);

        message.destroy(msgKey);
        // HTTP 错误已由 api.ts 拦截器统一 message.error()，此处仅兜底非 HTTP 错误
        if (!(error instanceof Error) || !error.message) {
          message.error('图像生成失败', 3);
        }
        setGenerating(false);
      }
    // 依赖里不再有 onUpload：生成结果不回填资产（回填会把原图顶掉，见文件上方说明）
    }, [asset, assetType, selectedModel, scriptNodeId, generating, IMAGE_MODEL_OPTIONS]);

    /** 描述输入 */
    const handleDescriptionChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setDescriptionDraft(e.target.value);
      },
      []
    );

    /** 描述失焦：与上次保存值不同则保存 */
    const handleDescriptionBlur = useCallback(() => {
      if (!asset) return;
      if (descriptionDraft === savedDescription) return;
      onDescriptionChange(asset.name, descriptionDraft);
      setSavedDescription(descriptionDraft);
    }, [asset, descriptionDraft, savedDescription, onDescriptionChange]);

    /** 获取资产类型的标题 */
    const getTitle = () => {
      switch (assetType) {
        case 'character':
          return '编辑角色';
        case 'scene':
          return '编辑场景';
        case 'prop':
          return '编辑道具';
      }
    };

    /** 获取图片区域的标签 */
    const getImageLabel = () => {
      switch (assetType) {
        case 'character':
          return '角色形象';
        case 'scene':
          return '场景图';
        case 'prop':
          return '道具图';
      }
    };

    /** 获取描述占位符 */
    const getDescriptionPlaceholder = () => {
      switch (assetType) {
        case 'character':
          // 与脚本模板的【角色四视图】对齐（原来写"三视图"，那个档位只在图片节点的
          // 「生成视图」里，资产流程出的其实是 1×4 的四视图）
          return '请输入角色描述，例如：年龄、性别、发型、服装、性格、四视图要求等';
        case 'scene':
          return '请输入场景描述，包含：空间布局、环境氛围、主要元素、风格特征、四视图要求等';
        case 'prop':
          return '请输入道具描述，包含：基本外观、细节特征、功能提示、风格调性、六视图要求等';
      }
    };

    /** 渲染资产特定属性 */
    const renderExtraFields = () => {
      if (!asset) return null;

      if (assetType === 'scene') {
        const scene = asset as ScriptScene;
        return (
          <div className="grid grid-cols-3 gap-3">
            <div>
              <div className="text-xs font-medium text-gray-700 mb-1">
                时段
              </div>
              <div className="px-3 py-2 rounded-md border border-gray-200 bg-gray-50 text-sm text-gray-800">
                {scene.timeOfDay}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-gray-700 mb-1">
                地点
              </div>
              <div className="px-3 py-2 rounded-md border border-gray-200 bg-gray-50 text-sm text-gray-800">
                {scene.location}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-gray-700 mb-1">
                氛围
              </div>
              <div className="px-3 py-2 rounded-md border border-gray-200 bg-gray-50 text-sm text-gray-800">
                {scene.mood}
              </div>
            </div>
          </div>
        );
      }

      if (assetType === 'prop') {
        const prop = asset as ScriptProp;
        return (
          <div>
            <div className="text-xs font-medium text-gray-700 mb-2">
              分类
            </div>
            <div className="px-3 py-2 rounded-md border border-gray-200 bg-gray-50 text-sm text-gray-800">
              {prop.category}
            </div>
          </div>
        );
      }

      return null;
    };

    return (
      <Modal
        title={getTitle()}
        open={open}
        onCancel={onClose}
        width={900}
        footer={null}
        destroyOnClose
        styles={{ body: { padding: '16px 20px', height: '66vh', minHeight: 480 } }}
      >
        {asset ? (
          <div className="flex gap-5 h-full">
            {/* 左列：图片 + 名称 */}
            <div className="w-[380px] shrink-0 flex flex-col gap-4">
            {/* 资产名称 */}
            <div>
              <div className="text-xs font-medium text-gray-700 mb-2">
                名称
              </div>
              <div className="px-3 py-2 rounded-md border border-gray-200 bg-gray-50 text-sm text-gray-800">
                {asset.name}
              </div>
            </div>
            {/* 图片区域 */}
            <div>
              <div className="text-xs font-medium text-gray-700 mb-2">
                {getImageLabel()}
              </div>
              <div
                className="relative w-full h-[300px] rounded-lg border border-gray-200 bg-gray-50 group"
                onClick={handleImageClick}
              >
                {imageUrl ? (
                  <>
                    <img
                      src={imageUrl}
                      alt={asset.name}
                      className="w-full h-full object-contain bg-white rounded-lg"
                    />
                    {/* 悬浮遮罩 */}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer rounded-lg">
                      <span className="px-3 py-1.5 bg-white text-xs rounded-md font-medium text-gray-700">
                        替换图片
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-gray-400 cursor-pointer hover:text-blue-500 transition-colors">
                    {uploading || generating ? (
                      <LoadingOutlined className="text-2xl animate-spin" />
                    ) : (
                      // 文案说清"上传原图有什么用"：上传的这张图会作为 AI生成的参考图
                      //（生成前由 ensureAssetReferenceNode 接成 @引用 + 数据流边）
                      <span className="text-xs">上传原图（生成时作为参考图）</span>
                    )}
                  </div>
                )}

                {/* 隐藏的文件 input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </div>

              {/* 图片下方：模型选择 + AI生成按钮 */}
              {asset.description && (
                <div className="flex items-center gap-2 mt-3">
                  {/* 模型选择下拉 */}
                  <div className="relative">
                    <button
                      onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
                      className="px-2 h-8 rounded-md bg-gray-100 hover:bg-gray-200 border border-gray-200 text-gray-800 text-xs font-medium flex items-center gap-1 cursor-pointer transition-colors"
                      title="选择生成模型"
                    >
                      <span className="leading-none truncate max-w-[120px]">
                        {IMAGE_MODEL_OPTIONS.find(m => m.modelId === selectedModel)?.label || selectedModel}
                      </span>
                      <span className="text-[10px]">▼</span>
                    </button>

                    {/* 下拉面板 */}
                    {modelDropdownOpen && (
                      <>
                        <div
                          className="fixed inset-0 z-20"
                          onClick={() => setModelDropdownOpen(false)}
                        />
                        <div
                          className="absolute top-full left-0 mt-1 w-[240px] max-h-[280px] overflow-y-auto bg-white rounded-lg shadow-xl border border-gray-200 z-30"
                        >
                          {IMAGE_MODEL_OPTIONS.map((model) => (
                            <button
                              key={model.value}
                              className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                                selectedModel === model.modelId ? 'bg-gray-100' : 'hover:bg-gray-50'
                              }`}
                              onClick={() => {
                                setSelectedModel(model.modelId);
                                setModelDropdownOpen(false);
                              }}
                            >
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1">
                                  <span className="text-xs font-medium text-gray-800 truncate">
                                    {model.label}
                                  </span>
                                  {model.tag && (
                                    <span
                                      className="px-1 py-0.5 rounded text-[10px] font-medium leading-none"
                                      style={{
                                        backgroundColor: `${model.tagColor || '#10b981'}20`,
                                        color: model.tagColor || '#10b981',
                                      }}
                                    >
                                      {model.tag}
                                    </span>
                                  )}
                                </div>
                                {model.description && (
                                  <div className="text-[11px] text-gray-400 mt-0.5 truncate">
                                    {model.description}
                                  </div>
                                )}
                              </div>
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>

                  {/* AI生成按钮
                      原来用 bg-[var(--dv-surface-2)] + text-white：--dv-surface-2 就是弹窗底色
                      （dark-theme.css 里注释为"弹窗底"），按钮填充和弹窗底同色 → 白字看不见，
                      整个按钮"糊"在背景里。改用全站主操作签名色（与 PromptToolbar 的生成按钮同款）。 */}
                  <button
                    onClick={() => handleGenerate()}
                    disabled={generating || uploading}
                    className="flex-1 h-8 rounded-md bg-gradient-to-br from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-xs font-medium flex items-center justify-center gap-1 cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm shadow-cyan-500/25"
                    title={`基于描述生成${ASSET_VIEW_NAME[assetType]}${
                      // 有图（上传的原图 / 已生成的图）时，生成会把它接成参考图，title 里说清，
                      // 用户才知道"先上传一张原图再生成"是有用的
                      imageUrl ? '（参考图 = 这张原图）' : '（还没有原图：纯文生图）'
                    }`}
                  >
                    {generating ? (
                      <LoadingOutlined className="text-xs animate-spin" />
                    ) : (
                      <span className="leading-none">AI生成</span>
                    )}
                  </button>
                </div>
              )}
            </div>
            </div>

            {/* 右列：描述（弹性撑满）+ 资产特定属性 */}
            <div className="flex-1 min-w-0 flex flex-col gap-4">
            {/* 资产描述 — 可编辑 textarea，失焦自动保存 */}
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-700">
                  提示词描述
                </span>
                {descriptionDraft !== savedDescription && (
                  <span className="text-[10px] text-amber-500">
                    未保存（失焦后自动保存）
                  </span>
                )}
              </div>
              <textarea
                value={descriptionDraft}
                onChange={handleDescriptionChange}
                onBlur={handleDescriptionBlur}
                placeholder={getDescriptionPlaceholder()}
                className="flex-1 w-full px-3 py-2 rounded-md border border-gray-200 bg-white text-xs text-gray-700 leading-relaxed resize-none focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200 transition-colors"
                style={{ whiteSpace: 'pre-wrap' }}
              />
            </div>

            {/* 资产特定属性 */}
            {renderExtraFields()}
            </div>
          </div>
        ) : null}
      </Modal>
    );
  }
);