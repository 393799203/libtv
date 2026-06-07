import type { CanvasData } from '@/types/canvas';

// 导出画布为 JSON
export function exportCanvasToJson(data: CanvasData): string {
  return JSON.stringify(data, null, 2);
}

// 从 JSON 导入画布
export function importCanvasFromJson(json: string): CanvasData | null {
  try {
    const data = JSON.parse(json) as CanvasData;
    if (!data.nodes || !data.edges) {
      throw new Error('Invalid canvas data');
    }
    return data;
  } catch (error) {
    console.error('导入画布失败:', error);
    return null;
  }
}
