import api from './api';

// 提示词生成 API

interface ShotDataForGeneration {
  visual: string;        // 画面描述
  shotSize: string;            // 镜别
  cameraMovement: string;      // 运镜方式（含角度，如"俯视缓慢推镜头"、"仰视快速摇镜头"）
  dialogue: string;            // 对白
  soundEffect: string;         // 音效
  lightingAtmosphere: string;  // 光影氛围（如"柔和自然光"、"强烈对比光"、"温暖夕阳光"）
  toneHint: string;            // 基调提示
}

interface AssetReference {
  name: string;        // 资产名称
  description: string; // 资产描述
  imageUrl: string;    // 资产图片 URL
}

interface GeneratePromptRequest {
  model: string;                // 文本模型 ID
  shotId: string;               // 镜头 ID
  shotData: ShotDataForGeneration; // 镜头数据
  characters: AssetReference[];    // 角色列表
  scenes: AssetReference[];        // 场景列表
  props: AssetReference[];         // 道具列表
}

interface GeneratePromptData {
  storyboardPrompt: string; // 生成的画面提示词（含 @ 引用）
  motionPrompt: string;     // 生成的运动提示词
}

/**
 * 生成提示词（画面 + 运动一起生成）
 * @param request 生成请求参数
 * @returns 生成的画面提示词和运动提示词
 */
export async function generatePrompt(
  request: GeneratePromptRequest
): Promise<GeneratePromptData> {
  return api.post<GeneratePromptData>('/prompt/generate', request);
}