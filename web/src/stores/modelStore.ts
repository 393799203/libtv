import { create } from 'zustand';
import { getModels, type ModelConfig } from '@/services/modelApi';

interface ModelStore {
  // 模型配置（按类型分组）
  imageModels: ModelConfig[];
  videoModels: ModelConfig[];
  llmModels: ModelConfig[];  // 后端返回的是 llm 而不是 text
  audioModels: ModelConfig[];
  
  // 加载状态
  isLoading: boolean;
  error: string | null;
  
  // 加载模型配置
  loadModels: () => Promise<void>;
}

export const useModelStore = create<ModelStore>((set) => ({
  imageModels: [],
  videoModels: [],
  llmModels: [],  // 后端返回的是 llm 而不是 text
  audioModels: [],
  isLoading: false,
  error: null,
  
  loadModels: async () => {
    set({ isLoading: true, error: null });
    
    try {
      const models = await getModels();
      set({
        imageModels: models.image || [],
        videoModels: models.video || [],
        llmModels: models.llm || [],  // 后端返回的是 llm 而不是 text
        audioModels: models.audio || [],
        isLoading: false,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : '加载模型配置失败';
      set({ error: errorMsg, isLoading: false });
      console.error('加载模型配置失败:', err);
    }
  },
}));