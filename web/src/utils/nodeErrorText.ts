/**
 * 把后端返回的原始错误，翻译成用户能看懂的一句话。
 *
 * 为什么要做这一层：节点上的 error 字段是**后端原样透传**的，里面混着上游 API 的
 * 字段路径、错误码和 JSON，比如：
 *   「上游明确拒绝本次任务: 电信视频任务失败: 素材 content[6].image_url.url（重试已耗尽）
 *     素材尺寸不符合要求，宽度和高度需在 300 至 6000 像素之间。… InvalidParameter.WidthTooSmall:
 *     Width must be between 300px and 6000px.（本次扣费已退还，可直接重新生成）」
 * 用户看不懂 content[6] 是什么，也看不懂 WidthTooSmall；但他真正需要知道的只有一句：
 * 「参考图太小了，换一张大一点的」。
 *
 * 按线上历史错误的明确错误码或确切原文映射；未知错误保留原文。
 * 原始文案不会被丢掉：它仍然随节点一起返回（detail/raw），给运营排查用。
 */

/** 扣费处理情况：已退费 / 已提交人工复核（这两种要显式告诉用户，否则他不敢重试） */
export type NodeErrorRefund = 'refunded' | 'manual' | null;

export interface DescribedNodeError {
  /** 命中的分类，便于出问题时统计哪类错误最多 */
  kind: string;
  /** 一句话人话，直接显示在节点上 */
  title: string;
  /** 可行动的建议（第二行，可能为空） */
  hint?: string;
  /** 扣费情况 */
  refund: NodeErrorRefund;
  /** 原始错误（不丢，详情里给运营看） */
  raw: string;
  /** 从原始错误里尽量抽出的「上游原话」，详情里更好读 */
  detail: string;
  /** 渠道内部问题不在客户界面展示诊断信息。 */
  hideDetails?: boolean;
  /** 引用素材里尺寸不达标的那些（尺寸类错误才有），能直接点出是谁的问题 */
  smallRefs: { label: string; size: string }[];
}

interface Rule {
  kind: string;
  test: RegExp;
  title: string;
  hint?: string;
  internal?: boolean;
}

/**
 * 顺序有意义：越具体的越靠前。
 * 例如「含真人」那条原文外面包着 `Video API error (status=400)`，如果先匹配通用状态码，
 * 就会退化成「上游返回错误（400）」，白丢一条能指导用户换素材的信息。
 */
const RULES: Rule[] = [
  {
    kind: 'copyright-restriction',
    test: /(?:output video|input (?:image|video)).*may be related to copyright restrictions/i,
    title: '生成内容可能涉及版权限制',
  },
  {
    kind: 'asset-too-small',
    test: /(?:Width|Height)TooSmall|宽度和高度需在|(?:Width|Height) must be between/i,
    title: '参考图尺寸太小，上游拒收',
    hint: '上游要求参考图的宽和高都在 300–6000 像素之间，换一张更大的图再生成',
  },
  {
    kind: 'real-person',
    test: /InputImageSensitiveContentDetected\.PrivacyInformation|may contain real person|含真人/i,
    title: '参考图被判定为真人照片',
    hint: '上游不接受真人素材，换成卡通 / 插画形象再生成',
  },
  {
    kind: 'content-review',
    test: /(?:Input|Output)(?:Text|Image|Video|Audio)SensitiveContentDetected|DataInspectionFailed|content_policy_violation|The request failed because the output image may contain sensitive information/i,
    title: '内容未通过模型审核',
  },
  {
    kind: 'duration-over-limit',
    test: /video total duration|less than or equal to 15\.2|参考视频时长[^\n]*超过[^\n]*模型的\s*\d+(?:\.\d+)?秒限制/i,
    title: '视频时长超出模型上限',
  },
  {
    kind: 'frame-input',
    test: /首尾帧模式需要 1–2 张图片/,
    title: '首尾帧模式需要 1–2 张图片',
  },
  {
    kind: 'script-reference-missing',
    test: /已连接上游剧本节点，但未在提示词中通过@引用使用剧本内容/,
    title: '提示词尚未引用已连接的剧本',
  },
  {
    kind: 'frame-aspect-ratio',
    test: /seedance2\.5 首帧\/首尾帧任务仅支持 ratio=adaptive|For first-frame or first-last-frame generation the output ratio follows the first-frame image/i,
    title: '首尾帧模式的输出比例需跟随首帧',
  },
  {
    kind: 'too-many-refs',
    test: /at most \d+ reference[_ ]image|reference_image items are allowed/i,
    title: '参考图数量超出上限',
  },
  {
    kind: 'invalid-parameter',
    test: /\bInvalidParameter(?:\.[A-Za-z]+)?\b|\binvalid_parameter\b|请求参数不符合要求/,
    title: '请求参数不符合模型要求',
  },
  {
    kind: 'burst-rate-limit',
    test: /\blimit_burst_rate\b/,
    title: '请求增长过快，触发上游限流',
    internal: true,
  },
  {
    kind: 'rate-limit',
    test: /\bThrottling(?:\.[A-Za-z]+)?\b|\bRateLimitExceeded\b|\brate_limit_exceeded\b/,
    title: '请求过于频繁',
  },
  {
    kind: 'model-not-activated',
    test: /\bmodel_not_activated\b/,
    title: '当前模型未开通',
    internal: true,
  },
  {
    kind: 'model-unavailable',
    test: /model_not_in_pricing_scope|暂不可用/,
    title: '当前模型暂不可用',
    hint: '换一个模型试试；一直不可用请联系管理员',
  },
  {
    kind: 'upstream-quota-exhausted',
    test: /\bTokenStatusExhausted\b|该令牌额度已用尽/,
    title: '上游渠道额度已用尽',
    internal: true,
  },
  {
    kind: 'insufficient-credits',
    test: /积分不足|余额不足|insufficient (balance|credits)/i,
    title: '积分不足，无法生成',
    hint: '请先充值后再生成',
  },
  {
    kind: 'empty-shots',
    test: /模型未返回分镜镜头/,
    title: '模型未返回分镜镜头',
  },
  {
    kind: 'invalid-model-output',
    test: /模型输出的 JSON 格式有误|分镜模型已返回 HTTP 200，但输出不是合法 JSON/,
    title: '模型返回的分镜格式有误',
  },
  {
    kind: 'unsupported-image-format',
    test: /元素编辑：这张图的格式无法处理（仅支持 PNG\/JPEG）/,
    title: '元素编辑仅支持 PNG/JPEG 图片',
  },
  {
    kind: 'image-read-failed',
    test: /图片读取失败（未调用上游）/,
    title: '图片读取失败，未调用上游',
  },
  {
    kind: 'upstream-network',
    test: /connect: network is unreachable/i,
    title: '无法连接上游服务',
  },
  {
    kind: 'upstream-timeout',
    test: /timeout awaiting response headers|context deadline exceeded|未响应|请求超时|响应超时/i,
    title: '上游服务超时，没有返回结果',
    hint: '可以直接重试；上游可能已经受理了这个任务',
  },
  {
    kind: 'upstream-auth',
    test: /status=40[13]|unauthorized|invalid api ?key|鉴权/i,
    title: '上游拒绝了调用（鉴权 / 权限问题）',
    hint: '这类问题用户无法自行解决，请联系管理员',
  },
  {
    kind: 'upstream-status',
    test: /\(status=(\d{3})\)/i,
    title: '上游服务返回错误',
    hint: '稍后重试；如果一直失败，请把下面的详情发给我们',
  },
  {
    kind: 'generic-failed',
    test: /^\s*执行失败\s*$/,
    title: '生成失败',
    hint: '可以重试一次；若一直失败请把详情发给我们',
  },
];

/** 上游错误码，用于把「上游服务返回错误」补成「上游服务返回错误（403）」 */
const STATUS_CODE = /\(status=(\d{3})\)/i;

/** 退款相关的补充说明：用户最关心的两件事之一（另一件是「我该改什么」） */
function detectRefund(raw: string): NodeErrorRefund {
  if (/人工复核|未自动退还/.test(raw)) return 'manual';
  if (/已退还|已退回|已原路退回/.test(raw)) return 'refunded';
  return null;
}

/**
 * 从原始错误里尽量抽出上游的原话。
 * 后端把上游响应整个塞进了错误串（有时还被转义过一层），直接展示给运营很难读，
 * 只去除我们自己加的包装，JSON 里的错误码和请求 ID 不做删减。
 */
export function extractUpstreamDetail(raw: string): string {
  let detail = raw.trim();
  const prefixes = [
    '上游明确拒绝本次任务，自动退还本次扣费: ', '上游明确拒绝本次任务: ',
    '电信视频任务失败: ', '电信视频API错误: ', '电信 wan3.0 视频任务失败: ',
    '电信 wan3.0 API错误: ', 'Video API error: ', 'Image API error: ', 'LLM error: ', 'task failed: ',
  ];
  for (;;) {
    const before = detail;
    for (const prefix of prefixes) {
      if (detail.startsWith(prefix)) detail = detail.slice(prefix.length);
    }
    if (before === detail) break;
  }
  detail = detail.replace(/（本次扣费(?:已退还，可直接重新生成|此前已退还)）$/, '');
  return detail;
}

export interface DescribeOptions {
  /** 引用素材里尺寸不达标的（由调用方从画布上查出来），尺寸类错误会把它点出来 */
  smallRefs?: { label: string; size: string }[];
  audience?: 'customer' | 'admin';
}

/** 仅屏蔽已确认的平台渠道内部故障，其余错误保持原文。 */
export function customerErrorText(raw: string): string {
  return RULES.some(rule => rule.internal && rule.test.test(raw)) ? '服务暂不可用' : raw;
}

export function describeNodeError(rawInput: unknown, options?: DescribeOptions): DescribedNodeError {
  const raw = typeof rawInput === 'string' ? rawInput : String(rawInput ?? '');
  const refund = detectRefund(raw);
  const smallRefs = options?.smallRefs ?? [];
  const detail = extractUpstreamDetail(raw);

  // 内部错误优先，避免外层 HTTP 状态或同一错误串里的泛化描述遮住它。
  const internal = RULES.find(rule => rule.internal && rule.test.test(raw));
  for (const rule of internal ? [internal] : RULES) {
    if (!rule.test.test(raw)) continue;
    if (rule.internal && options?.audience !== 'admin') {
      return { kind: rule.kind, title: customerErrorText(raw), refund, raw, detail: '', hideDetails: true, smallRefs };
    }
    let title = rule.title;
    let hint = rule.hint;
    if (rule.kind === 'upstream-status') {
      const code = raw.match(STATUS_CODE)?.[1];
      if (code) title = `${rule.title}（${code}）`;
    }
    if (rule.kind === 'asset-too-small' && smallRefs.length > 0) {
      // 能指出具体哪张图太小，用户就不用自己去一张张试
      hint = `这几张引用图太小：${smallRefs.map((r) => `${r.label}（${r.size}）`).join('、')}；上游要求宽和高都在 300–6000 像素之间`;
    }
    if (rule.kind === 'too-many-refs') {
      const limit = raw.match(/at most (\d+) reference[_ ]image/i)?.[1];
      if (limit) hint = `模型最多接受 ${limit} 张参考图`;
    }
    if (rule.kind === 'duration-over-limit') {
      const limit = raw.match(/模型的\s*(\d+(?:\.\d+)?)秒限制/)?.[1]
        ?? raw.match(/less than or equal to (\d+(?:\.\d+)?)/i)?.[1];
      if (limit) hint = `模型的总时长上限为 ${limit} 秒`;
    }
    return { kind: rule.kind, title, hint, refund, raw, detail, smallRefs };
  }

  return {
    kind: 'unknown',
    title: detail || '生成失败',
    refund,
    raw,
    detail,
    smallRefs,
  };
}

/** 扣费情况的展示文案 */
export function refundText(refund: NodeErrorRefund): string | null {
  if (refund === 'refunded') return '本次扣费已退还，可直接重新生成';
  if (refund === 'manual') return '本次扣费未自动退还，已提交人工复核';
  return null;
}

/** 上游要求参考图的最小边长（和 RULES 里 asset-too-small 的说明保持一致，供前端做前置校验） */
export const UPSTREAM_MIN_IMAGE_EDGE = 300;
