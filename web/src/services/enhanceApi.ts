import api from './api';

/** 一个档位（由后端 enhance.yaml 定义，前端不硬编码） */
export interface EnhanceModeInfo {
  id: string;
  label: string;
  description: string;
  default: boolean;
}

/** 一条清晰化渠道（配置 × 实现合并后的视图，来自 /enhance/providers） */
export interface EnhanceChannelInfo {
  id: string;
  label: string;
  description: string;
  available: boolean;
  modes: EnhanceModeInfo[];
}

/** 本机档的运维旋钮（来自 enhance.yaml 的 limits）：前端据此把边界说清楚 */
export interface EnhanceLimitsInfo {
  max_concurrency: number;
  max_duration_seconds: number;
  timeout_seconds: number;
  crf: number;
  preset: string;
}

export interface EnhanceChannelsResult {
  channels: EnhanceChannelInfo[];
  defaultChannel: string;
  limits?: EnhanceLimitsInfo;
}

/**
 * 兜底清单：接口失败时仍要让节点可用（本机 FFmpeg 两档）。
 * 文案与 enhance.yaml 保持一致；渠道/档位以后端返回为准 ——
 * 兜底的意义是「接口挂了节点还能干活」，不是「前端自己维护一份清单」。
 */
export const FALLBACK_ENHANCE_CHANNELS: EnhanceChannelsResult = {
  channels: [
    {
      id: 'ffmpeg',
      label: '本机 FFmpeg',
      description: '本机处理：去块 + 轻降噪 + 锐化，可把短边不足 720p 的放大到 720p。不额外扣积分、不补帧、素材不出境',
      available: true,
      modes: [
        { id: 'clean', label: '标准', description: '去块 + 轻降噪 + 锐化，分辨率不变（压掉压缩伪影，画面变干净）', default: false },
        { id: 'hd', label: '增强', description: '标准档 + 短边不足 720p 的用 lanczos 放大到 720p（480p 出片也能凑到 720p 观感）', default: true },
      ],
    },
  ],
  defaultChannel: 'ffmpeg',
};

// 渠道清单全局只请求一次（画布上可能有多个清晰化节点）；
// 失败时清空缓存，允许下次挂载时重试 —— 与 pricingApi 同一套策略
let channelsPromise: Promise<EnhanceChannelsResult> | null = null;

export const enhanceApi = {
  listChannels: (): Promise<EnhanceChannelsResult> => {
    if (!channelsPromise) {
      // 拦截器已把 {code,msg,data} 解包，这里拿到的就是 payload 本身
      channelsPromise = api
        .get<EnhanceChannelsResult>('/enhance/providers')
        .then((data) => {
          if (!data || !Array.isArray(data.channels) || data.channels.length === 0) {
            return FALLBACK_ENHANCE_CHANNELS;
          }
          return {
            channels: data.channels,
            defaultChannel: data.defaultChannel || data.channels[0].id,
            limits: data.limits,
          };
        })
        .catch((e) => {
          console.error('[enhanceApi] 获取清晰化渠道失败，使用兜底清单:', e);
          channelsPromise = null;
          return FALLBACK_ENHANCE_CHANNELS;
        });
    }
    return channelsPromise;
  },
};
