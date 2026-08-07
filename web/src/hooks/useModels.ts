import { useEffect, useMemo } from 'react';
import { useModelStore } from '@/stores/modelStore';
import type { ModelOption } from '@/types/prompt';
import type { ModelConfig } from '@/services/modelApi';
import type { NodeType } from '@/types/canvas';

/**
 * 将后端 ModelConfig 转换为前端 ModelOption 格式
 */
function convertToModelOption(model: ModelConfig): ModelOption {
  return {
    value: model.ID,
    modelId: model.ModelID,  // ✅ 实际调用API使用的model_id
    label: model.Name,
    description: model.Description,
    isDefault: model.Default,  // 从后端配置读取默认标记
    // 标签逻辑：Z-Image-Turbo 标记"快速"（其他标签可根据需要配置）
    tag: model.ID === 'z-image-turbo' ? '快速' : undefined,
    tagColor: model.ID === 'z-image-turbo' ? '#3b82f6' : undefined,
  };
}

/**
 * 根据节点用途过滤模型
 */
function filterModelsByUsage(models: ModelConfig[], nodeType: NodeType): ModelConfig[] {
  return models.filter(model => {
    // 检查模型的 Usage 字段是否包含当前节点类型
    // Usage 字段示例：["script"], ["text"], ["image", "character", "scene", "prop"]
    const usage = model.Usage || [];

    // 映射节点类型到 usage 关键字
    const usageKeywords: Record<NodeType, string[]> = {
      text: ['text', 'llm'],  // text 节点使用 text 或通用 llm 模型
      script: ['script', 'llm'],  // script 节点使用 script 模型
      image: ['image', 'character', 'scene', 'prop'],  // image 节点支持多种用途
      video: ['video'],
      audio: ['audio'],
    };

    const keywords = usageKeywords[nodeType] || [];
    return keywords.some(keyword => usage.includes(keyword));
  });
}

/**
 * 获取指定类型的模型列表
 */
export function useModels(nodeType: NodeType): ModelOption[] {
  const {
    imageModels,
    videoModels,
    llmModels,  // 后端返回的是 llm 而不是 text
    audioModels,
    isLoading,
    error,
    loadModels
  } = useModelStore();

  // 组件初始化时加载模型配置
  useEffect(() => {
    if (imageModels.length === 0 && !isLoading && !error) {
      loadModels();
    }
  }, [imageModels.length, isLoading, error, loadModels]);

  // ✅ 使用 useMemo 缓存结果，避免每次渲染都返回新数组引用
  // 使用 JSON.stringify 确保只有在内容真正变化时才重新计算
  return useMemo(() => {
    switch (nodeType) {
      case 'image':
        return filterModelsByUsage(imageModels, nodeType).map(convertToModelOption);
      case 'video':
        return filterModelsByUsage(videoModels, nodeType).map(convertToModelOption);
      case 'text':
        return filterModelsByUsage(llmModels, nodeType).map(convertToModelOption);  // text 使用 llm 模型
      case 'audio':
        return filterModelsByUsage(audioModels, nodeType).map(convertToModelOption);
      case 'script':
        return filterModelsByUsage(llmModels, nodeType).map(convertToModelOption);  // script 使用 llm 模型
      default:
        return [];
    }
  }, [
    nodeType,
    // 使用 JSON.stringify 确保内容变化时才重新计算
    JSON.stringify(imageModels),
    JSON.stringify(videoModels),
    JSON.stringify(llmModels),
    JSON.stringify(audioModels),
  ]);
}