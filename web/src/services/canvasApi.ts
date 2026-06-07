import api from './api';
import type { CanvasData } from '@/types/canvas';

export const canvasApi = {
  // 获取画布（后端直接返回 content JSON，不走 ApiResponse 包装）
  getCanvas: (projectId: string) =>
    api.get<CanvasData>(`/projects/${projectId}/canvas`),

  // 保存画布（后端接收 raw body，返回 { code: 0, msg: "saved" }）
  saveCanvas: (projectId: string, data: CanvasData) =>
    api.put<void>(`/projects/${projectId}/canvas`, data),
};
