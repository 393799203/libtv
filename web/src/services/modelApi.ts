import api from './api';

// 模型配置类型（对应后端 ModelConfig，字段名使用大写）
export interface ModelConfig {
  ID: string;          // 后端返回的是大写字段名
  Name: string;
  Provider: string;
  ModelID: string;
  Usage: string[];
  MaxTokens: number;
  Temperature: number;
  Description: string;
  Parameters?: Record<string, unknown>;
  Default?: boolean;   // 是否为默认模型（从配置文件读取）
  Resolutions?: string[];  // 支持的分辨率（视频模型用，后端 models.yaml 配置）
}

// 模型列表响应（按类型分组）
export interface ModelsResponse {
  image?: ModelConfig[];
  video?: ModelConfig[];
  llm?: ModelConfig[];  // 后端返回的是 llm 而不是 text
  audio?: ModelConfig[];
}

/**
 * 获取所有可用模型配置（按类型分组）
 */
export async function getModels(): Promise<ModelsResponse> {
  // api.ts 的响应拦截器已经解包了：
  // 原始响应: { code: 0, msg: "ok", data: {...模型数据...} }
  // 拦截器返回: {...模型数据...}（直接就是 ModelsResponse）
  const models = await api.get<ModelsResponse>('/models');
  
  // 如果响应为空，返回空数组防止错误
  if (!models) {
    return {
      image: [],
      video: [],
      llm: [],
      audio: [],
    };
  }
  
  return models;
}