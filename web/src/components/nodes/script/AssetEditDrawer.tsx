import { memo, useState, useRef, useCallback, useEffect } from 'react';
import { Drawer, message } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';
import type {
  ScriptCharacter,
  ScriptScene,
  ScriptProp,
} from '@/types/canvas';
import { uploadImage } from '@/services/uploadApi';
import { useCanvasStore } from '@/stores/canvasStore';
import { useExecutionStore } from '@/stores/executionStore';
import { workflowApi } from '@/services/workflowApi';
import { canvasApi } from '@/services/canvasApi';
import { useModels } from '@/hooks/useModels';
import {
  getAssetImageNodeId,
  createAssetImageNode,
  generateAssetImageNodeId,
} from '@/utils/assetImageSync';

type AssetType = 'character' | 'scene' | 'prop';
type Asset = ScriptCharacter | ScriptScene | ScriptProp;

// 从 hook 动态获取图像生成模型选项
// IMAGE_MODEL_OPTIONS 将在组件中使用 useModels hook 获取

interface AssetEditDrawerProps {
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
 * 通用资产编辑侧屏（角色/场景/道具）
 * - 顶部大图区域，可点击上传 / 右上角按钮基于描述生成视图
 * - 资产名称只读、资产描述可编辑（失焦自动保存）
 * - 根据资产类型显示不同的额外属性
 */
export const AssetEditDrawer = memo<AssetEditDrawerProps>(
  function AssetEditDrawer({
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

    // 模型选择状态（默认选中第一个模型，如果模型列表还未加载则使用空字符串）
    const [selectedModel, setSelectedModel] = useState('');
    const [modelDropdownOpen, setModelDropdownOpen] = useState(false);

    // 用于清理资源的 ref（防止组件卸载后资源泄漏）
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const unsubscribeRef = useRef<(() => void) | null>(null);

    // 当模型列表加载完成后，设置默认模型
    useEffect(() => {
      if (IMAGE_MODEL_OPTIONS.length > 0 && selectedModel === '') {
        setSelectedModel(IMAGE_MODEL_OPTIONS[0].value);
      }
    }, [IMAGE_MODEL_OPTIONS, selectedModel]);

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

    // 关闭时重置状态并清理资源
    useEffect(() => {
      if (!open) {
        setUploading(false);
        setGenerating(false);
        setModelDropdownOpen(false);

        // 清理资源：防止组件卸载后资源泄漏
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        if (unsubscribeRef.current) {
          unsubscribeRef.current();
          unsubscribeRef.current = null;
        }
      }
    }, [open]);

    // 组件卸载时清理所有资源
    useEffect(() => {
      return () => {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
        if (unsubscribeRef.current) {
          unsubscribeRef.current();
        }
      };
    }, []);

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
          const url = await uploadImage(file);
          onUpload(asset.name, url);
          message.success('上传成功');
        } catch {
          message.error('上传失败');
        } finally {
          setUploading(false);
          if (fileInputRef.current) fileInputRef.current.value = '';
        }
      },
      [asset, onUpload]
    );

    /**
     * 基于资产描述生成视图
     * 使用新的 ID 映射机制，确保高性能和可靠性
     */
    const handleGenerate = useCallback(async () => {
      if (!asset) return;

      // ✅ P0: 并发保护 - 防止重复点击
      if (generating) {
        message.warning('正在生成中，请稍候');
        return;
      }

      // ✅ P1: 验证模型选择
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

      // 找到脚本节点
      const scriptNode = store.nodes.find(n => n.id === scriptNodeId);
      if (!scriptNode) {
        message.error('找不到脚本节点');
        return;
      }

      // 清理之前的资源（防止重复点击时资源泄漏）
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }

      // 立即显示loading状态
      setGenerating(true);

      const viewText =
        assetType === 'character'
          ? '三视图'
          : assetType === 'scene'
            ? '四视图'
            : '六视图';

      // ✅ P2: 显示模型名称而非 ID
      const modelName = IMAGE_MODEL_OPTIONS.find(m => m.value === selectedModel)?.label || selectedModel;
      message.loading({
        content: `正在使用 ${modelName} 生成${viewText}…`,
        key: 'gen',
        duration: 0,
      });

      // ✅ 生成唯一的图片节点 ID（避免重复创建）
      const imageNodeId = generateAssetImageNodeId(assetType, asset.name, scriptNodeId);

      try {
        // ✅ 使用新的同步工具创建图片节点并建立映射
        const imageNode = createAssetImageNode(
          scriptNodeId,
          assetType,
          asset.name,
          undefined, // imageUrl 初始为空，等待 AI 生成
          asset.description,
          selectedModel
        );

        if (!imageNode) {
          throw new Error('创建图片节点失败');
        }

        // 保存画布(让后端能看到节点状态)
        const currentStore = useCanvasStore.getState();
        const viewport = currentStore._cache.get(projectId)?.savedViewport || { x: 0, y: 0, zoom: 1 };
        await canvasApi.saveCanvas(projectId, {
          nodes: currentStore.nodes,
          edges: currentStore.edges,
          viewport,
        });

        // 执行图片节点
        const resp = await workflowApi.execute(projectId, {
          startNodeId: imageNode.id,
          mode: 'single',
        });

        if (!resp?.executionId) {
          throw new Error('启动图像生成失败');
        }

        // 添加到 SSE 订阅列表（WorkspacePage 会自动订阅）
        useExecutionStore.getState().addActiveStream({
          projectId,
          executionId: resp.executionId,
          nodeId: imageNode.id,
        });

        // 监听节点状态变化（使用 Zustand 订阅，实时响应）
        const unsubscribe = useCanvasStore.subscribe((state, prevState) => {
          const node = state.nodes.find(n => n.id === imageNode.id);
          const prevNode = prevState.nodes.find(n => n.id === imageNode.id);

          // 只在节点数据变化时处理
          if (node && node !== prevNode) {
            const nodeData = node.data as any;
            const prevData = prevNode?.data as any;

            // 检测状态变化
            if (nodeData.status !== prevData?.status) {
              if (nodeData.status === 'success' && nodeData.imageUrl) {
                // 清理资源
                if (timeoutRef.current) {
                  clearTimeout(timeoutRef.current);
                  timeoutRef.current = null;
                }
                unsubscribe();
                unsubscribeRef.current = null;

                const imageUrl = nodeData.imageUrl;
                onUpload(asset.name, imageUrl);
                message.success('图像生成成功');
                setGenerating(false);
                message.destroy('gen');
              } else if (nodeData.status === 'failed') {
                // 清理资源
                if (timeoutRef.current) {
                  clearTimeout(timeoutRef.current);
                  timeoutRef.current = null;
                }
                unsubscribe();
                unsubscribeRef.current = null;

                // 节点右上角的 Badge 已经显示错误状态和 Tooltip，不需要全局提示
                setGenerating(false);
                message.destroy('gen');
              }
            }
          }
        });

        // 保存 unsubscribe 到 ref，用于组件卸载时清理
        unsubscribeRef.current = unsubscribe;

        // 超时保护（120秒）
        timeoutRef.current = setTimeout(() => {
          unsubscribe();
          unsubscribeRef.current = null;
          message.destroy('gen');
          message.warning('图像生成超时，可在画布上查看图片节点状态');
          setGenerating(false);
        }, 120000);

      } catch (error) {
        console.error('图像生成失败:', error);

        message.destroy('gen');
        // 节点创建失败时用户可能看不到节点，所以需要全局提示
        const errorMsg = (error as Error).message || '图像生成失败';
        message.error(errorMsg, 3); // 3秒后自动消失
        setGenerating(false);
      }
    }, [asset, assetType, selectedModel, scriptNodeId, onUpload, generating, IMAGE_MODEL_OPTIONS]);

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
          return '请输入角色描述，例如：年龄、性别、发型、服装、性格、三视图要求等';
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
      <Drawer
        title={getTitle()}
        placement="right"
        open={open}
        onClose={onClose}
        width={500}
        destroyOnClose
        styles={{ body: { padding: '16px 20px' } }}
      >
        {asset ? (
          <div className="flex flex-col gap-4">
            {/* 图片区域 */}
            <div>
              <div className="text-xs font-medium text-gray-700 mb-2">
                {getImageLabel()}
              </div>
              {/* ✅ 图片显示区域默认 16:9 比例（宽度 460px，高度约 260px） */}
              <div
                className="relative w-full h-[260px] rounded-lg border border-gray-200 bg-gray-50 overflow-hidden group"
                onClick={handleImageClick}
              >
                {/* ✅ 使用从画布图片节点实时读取的 imageUrl */}
                {imageUrl ? (
                  <>
                    <img
                      src={imageUrl}
                      alt={asset.name}
                      className="w-full h-full object-contain bg-white"
                    />
                    {/* 悬浮遮罩 */}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer">
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
                      <span className="text-xs">生成或上传参考图</span>
                    )}
                  </div>
                )}

                {/* 右上角生成按钮 + 模型选择 */}
                {asset.description && (
                  <div className="absolute top-2 right-2 flex items-center gap-1">
                    {/* 模型选择下拉 */}
                    <div className="relative">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setModelDropdownOpen(!modelDropdownOpen);
                        }}
                        className="px-2 h-8 rounded-md bg-gray-700/80 hover:bg-gray-800 text-white text-xs font-medium flex items-center gap-1 cursor-pointer transition-colors"
                        title="选择生成模型"
                      >
                        <span className="leading-none truncate max-w-[80px]">
                          {IMAGE_MODEL_OPTIONS.find(m => m.value === selectedModel)?.label || selectedModel}
                        </span>
                        <span className="text-[10px]">▼</span>
                      </button>

                      {/* 下拉面板 */}
                      {modelDropdownOpen && (
                        <>
                          <div
                            className="fixed inset-0 z-20"
                            onClick={(e) => {
                              e.stopPropagation();
                              setModelDropdownOpen(false);
                            }}
                          />
                          <div
                            className="absolute top-full right-0 mt-1 w-[240px] bg-white rounded-lg shadow-xl border border-gray-200 overflow-hidden z-30"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {IMAGE_MODEL_OPTIONS.map((model) => (
                              <button
                                key={model.value}
                                className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                                  selectedModel === model.value ? 'bg-gray-100' : 'hover:bg-gray-50'
                                }`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedModel(model.value);
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

                    {/* AI生成按钮 */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleGenerate();
                      }}
                      disabled={generating || uploading}
                      className="px-3 h-8 rounded-md bg-gray-800/80 hover:bg-gray-900 text-white text-xs font-medium flex items-center gap-1 cursor-pointer transition-colors disabled:opacity-50"
                      title={`基于描述生成${assetType === 'character' ? '三视图' : assetType === 'scene' ? '四视图' : '六视图'}`}
                    >
                      {generating ? (
                        <LoadingOutlined className="text-xs animate-spin" />
                      ) : (
                        <span className="leading-none">AI生成</span>
                      )}
                    </button>
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
            </div>

            {/* 资产名称 */}
            <div>
              <div className="text-xs font-medium text-gray-700 mb-2">
                名称
              </div>
              <div className="px-3 py-2 rounded-md border border-gray-200 bg-gray-50 text-sm text-gray-800">
                {asset.name}
              </div>
            </div>

            {/* 资产描述 — 可编辑 textarea，失焦自动保存 */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-gray-700">
                  描述
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
                className="w-full px-3 py-2 rounded-md border border-gray-200 bg-white text-xs text-gray-700 leading-relaxed min-h-[280px] max-h-[340px] resize-y focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200 transition-colors"
                style={{ whiteSpace: 'pre-wrap' }}
              />
            </div>

            {/* 资产特定属性 */}
            {renderExtraFields()}
          </div>
        ) : null}
      </Drawer>
    );
  }
);