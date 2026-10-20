import api from './api';

/**
 * 画布图片派生处理接口（后端 handler/image_ops_handler.go）。
 *
 * 为什么这些活走服务端而不是浏览器 canvas：
 * 线上单张原图实测 4.3MB，前端切 16 格等于拉一次 4.3MB 再传 16 次；
 * 服务端做是拉一次、切完直接落对象存储，并且会顺手生成 640px webp 缩略图
 * （画布渲染用的是 thumbUrl，不生成的话画布会去加载十几张原图）。
 */

export interface OpsTile {
  url: string;
  thumb_url?: string;
  width: number;
  height: number;
  /** true = 无需处理，url 就是入参原图（例如放大目标小于等于原尺寸） */
  skipped?: boolean;
  /** 切分结果专用：这一格在宫格里的序号（0 起，行优先）与行列号 */
  cell_index?: number;
  cell_row?: number;
  cell_col?: number;
}

export interface SplitParams {
  imageUrl: string;
  rows: number;
  cols: number;
  /**
   * 归一化切割位置（0~1），来自弹层里用户拖动的那几条分割线。
   * 传了就以后端以线条数为准（列数 = cutsX.length + 1），rows/cols 只作为回退。
   */
  cutsX?: number[];
  cutsY?: number[];
  /** 每格四边各内缩的像素数（默认 0；大于 0 时用来吃掉宫格之间的白边） */
  trimPx: number;
  /** 只切选中的几格（0 起，行优先）；不传 = 全切 */
  cells?: number[];
  projectId?: string;
}

export interface ScaleParams {
  imageUrl: string;
  /** 目标短边像素 */
  targetShort: number;
  projectId?: string;
}

/**
 * 擦除（blur/mosaic/solid）已从产品上撤掉：涂抹只能把一块区域糊掉，用户真正要的是
 * "把这里换成别的" —— 现在是「元素编辑」（选区 + 提示词，只重画选区内，走节点执行扣积分），
 * 见 components/canvas/imageops/ElementEditOverlay.tsx。
 * 后端 /images/erase 暂时保留（元素编辑的合成复用它的蒙版混合原语），前端不再调用。
 */

export interface RecognizeObjectParams {
  imageUrl: string;
  /** 归一化坐标（左上为原点，0~1） */
  x: number;
  y: number;
  /** 用户点选时的笔刷圈半径（相对图宽，0~1）：告诉模型要认的是这一片里最显眼的东西 */
  radius?: number;
  projectId?: string;
  /** 在哪个图片节点上点的：对账行带上节点号，后台对账页就能显示节点名 */
  nodeId?: string;
}

/** 识别出的一个层级（由具体到宽泛）：点鼻子 → 鼻子 / 人脸 / 人物 */
export interface RecognizeCandidate {
  label: string;
  box: { x: number; y: number; w: number; h: number };
}

export interface RecognizeObjectResult {
  /** 识别出的物体名（可能为空 = 没认出来）；等于 candidates[0] 那一层 */
  label: string;
  /** 多层级候选；空/缺省 = 只有一层（老行为） */
  candidates?: RecognizeCandidate[];
  /** 物体的归一化外接框；为空表示模型没给出可用的框，前端保留用户自己画的圈 */
  box: { x: number; y: number; w: number; h: number } | null;
  model: string;
  cached?: boolean;
  /** 本次扣了多少积分（0 = 命中缓存或未配价；展示用） */
  charged?: number;
  /** 回显：前端据此丢弃过期的识别结果（图已经换了就别用旧结果） */
  imageUrl: string;
}

export interface VideoFrameParams {
  videoUrl: string;
  /**
   * first=首帧、last=尾帧、at=指定时刻（秒，前端传播放器当前进度）。
   * 三个动作都是**本机 ffmpeg**，不调上游模型、不扣积分。
   */
  mode: 'first' | 'last' | 'at';
  /** mode='at' 时的时刻（秒） */
  time?: number;
  projectId?: string;
}

export const imageOpsApi = {
  /**
   * 点选识别：在某一点上问视觉模型"那是什么"，拿回名字 + 外接框。
   *
   * 为什么要它：改图接口没有蒙版入参，"把这个去掉"里的"这个"模型看不到；
   * 先认出「自动售货机」，指令里就能点名，同时把点选的小圆圈换成物体的真实范围。
   * 这是一次真实的视觉模型调用（电信渠道实测约 16s、华数约 5s），后端按 (图, 点) 缓存 10 分钟，
   * 所以前端必须**异步**用：先给用户圈，结果回来再替换，不能卡住交互。
   */
  recognizeObject: (params: RecognizeObjectParams) =>
    // silentError：这是"更准一点"的加分项，失败时前端自己降级（保留用户画的圈），
    // 不该弹一个用户看不懂、也没法处理的错误框
    api.post<RecognizeObjectResult>('/images/recognize-object', params, { timeout: 60000, silentError: true }),

  split: (params: SplitParams) =>
    api.post<{ tiles: OpsTile[]; count: number }>('/images/split', params),

  scale: (params: ScaleParams) =>
    api.post<{ tile: OpsTile }>('/images/scale', params),

  /**
   * 视频缩略图条：整条视频抽 N 帧拼成一张图，给片段选择条当底图（像剪映那样）。
   * 前端自己抽帧不行：线上视频跨域且不回 CORS 头，canvas 会被污染、toDataURL 抛 SecurityError。
   */
  videoFilmstrip: (params: { videoUrl: string; count?: number; projectId?: string }) =>
    api.post<{ url: string; count: number; height: number; duration: number }>('/videos/filmstrip', params, {
      timeout: 120000,
    }),

  /**
   * 视频裁剪：把选中的区间**真的裁成一个新视频**（片段重拍用）。
   *
   * 为什么不是"只把区间写进提示词"：上游没有"只重拍某一段"的能力，整条 llm 包里
   * 唯一的视频入参是 reference_video（整条视频，上游按视频延长处理）。要让模型真的
   * 只对着这一段干活，只能在这边先把片段裁出来。重编码（不是 -c copy）所以
   * 落点是精确的，不会从关键帧切偏。下载 + 重编码，超时给足 300s（与后端 ctx 一致）。
   */
  videoTrim: (params: { videoUrl: string; start: number; end: number; projectId?: string }) =>
    api.post<{ url: string; duration: number; width: number; height: number; size: number; start: number; end: number }>(
      '/videos/trim',
      params,
      { timeout: 300000 }
    ),

  /**
   * 视频截帧：取视频的一帧存成图片（首帧/尾帧/指定时刻）。
   *
   * 为什么必须走服务端：线上视频在对象存储域名、**不回 CORS 头**，跨域视频画进 canvas
   * 会污染画布，前端 toBlob 直接抛 SecurityError；服务端 ffmpeg 一步到位，
   * 而且顺带生成 640px webp 缩略图（画布渲染用的是 thumbUrl）。
   * 下载 + seek 需要时间，超时给足 120s（与后端 ctx 一致）。
   */
  videoFrame: (params: VideoFrameParams) =>
    api.post<{ tile: OpsTile }>('/videos/frame', params, { timeout: 120000 }),

  /**
   * 音视频分离：把一条视频拆成「无声视频」+「音频」两份产物（本机 ffmpeg，不扣积分）。
   * 无声视频走流拷贝（画面零损失）、音轨重编码成 AAC/m4a（浏览器能直接播）。
   * 源视频本来没有音轨时后端会明确报错，不会返回一个空音频。
   */
  videoDemux: (params: { videoUrl: string; projectId?: string }) =>
    api.post<{
      silentVideoUrl: string;
      audioUrl: string;
      duration: number;
      width: number;
      height: number;
      silentSize: number;
      audioSize: number;
    }>('/videos/demux', params, { timeout: 300000 }),
};