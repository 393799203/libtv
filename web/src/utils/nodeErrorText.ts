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
 * 这里的规则不是猜的 —— 全部来自线上库里真实出现过的错误文案（14 条历史 + 当天的失败）。
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
  /** 引用素材里尺寸不达标的那些（尺寸类错误才有），能直接点出是谁的问题 */
  smallRefs: { label: string; size: string }[];
}

interface Rule {
  kind: string;
  test: RegExp;
  title: string;
  hint?: string;
}

/**
 * 顺序有意义：越具体的越靠前。
 * 例如「含真人」那条原文外面包着 `Video API error (status=400)`，如果先匹配通用状态码，
 * 就会退化成「上游返回错误（400）」，白丢一条能指导用户换素材的信息。
 */
const RULES: Rule[] = [
  {
    kind: 'asset-too-small',
    test: /WidthTooSmall|宽度和高度需在|Width must be between/i,
    title: '参考图尺寸太小，上游拒收',
    hint: '上游要求参考图的宽和高都在 300–6000 像素之间，换一张更大的图再生成',
  },
  {
    kind: 'real-person',
    test: /InputImageSensitiveContentDetected|may contain real person|含真人/i,
    title: '参考图被判定为真人照片',
    hint: '上游不接受真人素材，换成卡通 / 插画形象再生成',
  },
  {
    kind: 'duration-over-limit',
    test: /video total duration|less than or equal to 15\.2/i,
    title: '视频时长超出模型上限',
    hint: '这个模型最长约 15 秒，把分镜时长缩短后再生成',
  },
  {
    kind: 'too-many-refs',
    test: /at most 10 reference_image|reference_image items are allowed/i,
    title: '参考图数量超出上限',
    hint: '上游最多接受 10 张参考图，删掉多余的连线再生成',
  },
  {
    kind: 'model-unavailable',
    test: /model_not_in_pricing_scope|暂不可用/,
    title: '当前模型暂不可用',
    hint: '换一个模型试试；一直不可用请联系管理员',
  },
  {
    kind: 'insufficient-credits',
    test: /积分不足|余额不足|insufficient (balance|credits)/i,
    title: '积分不足，无法生成',
    hint: '请先充值后再生成',
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
 * 这里做一次 best-effort 解包：优先取最内层的 message，取不到就用原文。
 */
export function extractUpstreamDetail(raw: string): string {
  // 形如 Video API error (status=400): {"code":"fail_to_fetch_task","message":"{\"error\":…}"}
  const quoted = raw.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (quoted?.[1]) {
    let inner = quoted[1].replace(/\\"/g, '"').replace(/\\n/g, ' ').replace(/\\\\/g, '\\');
    // 里面可能还套着一层 JSON，再抽一次最内层 message
    const nested = inner.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (nested?.[1]) inner = nested[1].replace(/\\"/g, '"');
    if (inner.trim()) return inner.trim();
  }
  return raw.trim();
}

export interface DescribeOptions {
  /** 引用素材里尺寸不达标的（由调用方从画布上查出来），尺寸类错误会把它点出来 */
  smallRefs?: { label: string; size: string }[];
}

export function describeNodeError(rawInput: unknown, options?: DescribeOptions): DescribedNodeError {
  const raw = typeof rawInput === 'string' ? rawInput : String(rawInput ?? '');
  const refund = detectRefund(raw);
  const smallRefs = options?.smallRefs ?? [];
  const detail = extractUpstreamDetail(raw);

  for (const rule of RULES) {
    if (!rule.test.test(raw)) continue;
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
    return { kind: rule.kind, title, hint, refund, raw, detail, smallRefs };
  }

  return {
    kind: 'unknown',
    title: '生成失败',
    hint: '可以重试一次；若一直失败请把下面的详情发给我们',
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