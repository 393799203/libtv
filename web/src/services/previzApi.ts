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
  replayed?: boolean;  // true=窗口内重复点击，返回的是上一次结果（未重新解析、未再扣费）
}

export const previzApi = {
  // AI 建白模：参考图 → 几何体布局（视觉模型解析约 1-2 分钟，超时放宽到 5 分钟与后端对齐）
  analyzeScene: (imageUrl: string, model?: string, projectId?: string) =>
    api.post<AnalyzeSceneResult>(
      '/previz/analyze-scene',
      { image_url: imageUrl, model, projectId },
      { timeout: 300000 }
    ),
};
