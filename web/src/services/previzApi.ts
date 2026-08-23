import api from './api';
import type { PrevizObjectType } from '@/pages/previz/types';

// AI 建白模：后端视觉模型解析返回的场景对象（已做防御性清洗）
export interface AnalyzedSceneObject {
  type: PrevizObjectType;
  name: string;
  position: [number, number, number];
  rotation: [number, number, number]; // 弧度欧拉角
  scale: [number, number, number];
}

export interface AnalyzeSceneResult {
  objects: AnalyzedSceneObject[];
  description: string; // 场景一句话概述
}

export const previzApi = {
  // AI 建白模：参考图 → 几何体布局（视觉模型解析较慢，放宽超时到 2 分钟）
  analyzeScene: (imageUrl: string, model?: string) =>
    api.post<AnalyzeSceneResult>(
      '/previz/analyze-scene',
      { image_url: imageUrl, model },
      { timeout: 120000 }
    ),
};
