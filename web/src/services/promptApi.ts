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
  imageCount?: number;             // 需要几份画面提示词（1=单张参考图；2=起始画面+结束画面）
  projectId?: string;              // 所在项目（对账页要显示项目名，可选）
}

interface GeneratePromptData {
  storyboardPrompt: string;      // 生成的画面提示词（含 @ 引用）；多份时等于第 1 份
  storyboardPrompts?: string[];  // 多份画面提示词（与参考图一一对应）
  motionPrompt: string;          // 生成的运动提示词
  replayed?: boolean;            // true=窗口内重复点击，返回上一次结果（未重新生成、未再扣费）
}

/**
 * 生成提示词（画面 + 运动一起生成）
 * @param request 生成请求参数
 * @returns 生成的画面提示词和运动提示词
 */
export async function generatePrompt(
  request: GeneratePromptRequest
): Promise<GeneratePromptData> {
  // 区别于统一的 60 秒：提示词生成是同步 LLM 调用，大剧本 + 多份提示词时
  // 上游首字节常在 30~60 秒、偶发超过 60 秒，放宽到 5 分钟与后端 LLM 客户端对齐
  // （此前 60 秒会先掐断请求，后端只能记到 context canceled）
  return api.post<GeneratePromptData>('/prompt/generate', request, { timeout: 300000 });
}