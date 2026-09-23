import { create } from 'zustand';
import { getModels, type ModelConfig } from '@/services/modelApi';
import { channelApi, type ChannelName } from '@/services/channelApi';

// 模块级 promise 缓存：同一会话内多个组件实例共享一次请求（防重复调用）；
// 页面刷新后 JS 重新加载、缓存自动重置 → 下次进入必然重新获取最终渠道 + 对应渠道模型
let modelsPromise: Promise<ModelsData> | null = null;

interface ModelsData {
  image: ModelConfig[];
  video: ModelConfig[];
  llm: ModelConfig[];
  audio: ModelConfig[];
  channel: ChannelName;
}

function fetchModelsWithChannel(): Promise<ModelsData> {
  if (!modelsPromise) {
    modelsPromise = (async () => {
      // 先取当前最终渠道（全局策略 + 用户渠道），再拉对应渠道模型
      const my = await channelApi.getMyChannel().catch(() => ({ channel: 'wasu' as ChannelName }));
      const channel = my?.channel || 'wasu';
      const models = await getModels();
      return {
        image: models.image || [],
        video: models.video || [],
        llm: models.llm || [],
        audio: models.audio || [],
        channel,
      };
    })().catch((err) => {
      // 失败清缓存，允许下次挂载重试
      modelsPromise = null;
      throw err;
    });
  }
  return modelsPromise;
}

interface ModelStore {
  imageModels: ModelConfig[];
  videoModels: ModelConfig[];
  llmModels: ModelConfig[];
  audioModels: ModelConfig[];
  channel: ChannelName;
  isLoading: boolean;
  error: string | null;

  /** 加载模型配置（含渠道）；同一会话内幂等，刷新后自动重新获取 */
  loadModels: () => Promise<void>;
}

export const useModelStore = create<ModelStore>((set) => ({
  imageModels: [],
  videoModels: [],
  llmModels: [],
  audioModels: [],
  channel: 'wasu',
  isLoading: false,
  error: null,

  loadModels: async () => {
    if (useModelStore.getState().isLoading) return;
    set({ isLoading: true, error: null });
    try {
      const data = await fetchModelsWithChannel();
      set({
        imageModels: data.image,
        videoModels: data.video,
        llmModels: data.llm,
        audioModels: data.audio,
        channel: data.channel,
        isLoading: false,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '加载模型配置失败';
      set({ error: errorMsg, isLoading: false });
      console.error('加载模型配置失败:', err);
    }
  },
}));
