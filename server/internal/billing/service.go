package billing

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"math"
	"strconv"
	"strings"
	"sync/atomic"
	"time"

	"libtv/internal/llm"
	"libtv/internal/model"
	"libtv/internal/pkg/apperror"
	"libtv/internal/repository"

	"gorm.io/gorm"
)

// 计费动作（扣费维度）：细分到每次真实 AI 调用，账单可精确到模型与场景
const (
	ActionWorkflowExecute = "workflow.execute"  // 工作流入口（中间件仅校验余额，不扣费）
	ActionPromptGenerate  = "prompt.generate"   // 提示词生成
	ActionStory           = "ai.story"          // 故事生成（文本节点）
	ActionScript          = "ai.script"         // 分镜剧本生成（脚本节点）
	ActionImage           = "ai.image"          // 图片生成（图片节点）
	ActionVideo           = "ai.video"          // 视频生成（视频节点）
	ActionAudio           = "ai.audio"          // 音频生成（音频节点）
	ActionPrevizAnalyze   = "ai.previz_analyze" // 白模场景解析（previz 节点）
)

// ErrInsufficientCredits 积分不足（HTTP 402，前端可用 code=4002 区分提示充值）
var ErrInsufficientCredits = apperror.New(4002, 402, "积分不足，请先充值")

// actionRemarks 计费动作的账单描述（展示给用户看的文案）
var actionRemarks = map[string]string{
	ActionPromptGenerate: "提示词生成",
	ActionStory:          "故事生成",
	ActionScript:         "分镜剧本生成",
	ActionImage:          "图片生成",
	ActionVideo:          "视频生成",
	ActionAudio:          "音频生成",
	ActionPrevizAnalyze:  "白模场景解析",
}

// defaultPrices 动作级兜底策略表（仅 EnsureBalance 前置校验用，当前全部为 0 即放行）
// 真实扣费单价以 model_prices 表（运营后台价格管理）为准，按（节点 + 模型）维度计费
var defaultPrices = map[string]int64{
	ActionPromptGenerate: 0,
	ActionStory:          0,
	ActionScript:         0,
	ActionImage:          0,
	ActionVideo:          0,
	ActionAudio:          0,
	ActionPrevizAnalyze:  0,
}

// actionNodeTypes 扣费 action → 定价节点映射：价格按（节点 + 模型）维度配置，
// 同一模型在不同节点可设不同价格（如 llm 模型在文本 / 剧本节点分开定价）
var actionNodeTypes = map[string]string{
	ActionPromptGenerate: "text", // 提示词生成使用文本节点的模型列表
	ActionStory:          "text",
	ActionScript:         "script",
	ActionImage:          "image",
	ActionVideo:          "video",
	ActionAudio:          "audio",
	ActionPrevizAnalyze:  "previz", // 白模解析独立定价维度（价格管理页「白模解析」分组）
}

// RefVideoPriceDiscount 带参考视频输入的预设折扣：只对 models.yaml 里
// ref_video_billing=true 的模型生效（当前为 3 个 Seedance 模型）。
// 后台未单独配置「带参考视频」单价时按无参考视频单价的 6 折计费，
// 价格管理页也用同一折扣预填输入框，避免两边口径不一致
const RefVideoPriceDiscount = 0.6

// Service 积分扣费服务：
//  1. EnsureBalance 实现 middleware.CreditBiller，供扣费中间件在 AI 入口做余额校验（只校验不扣费）
//  2. ChargeByModel / ChargeVideoByDuration / ChargeByChars 在真实 AI 调用点扣费并写入账单明细：
//     单价来自 model_prices 表（运营后台「价格管理」维护，保存后即时生效）：
//     文本/图片模型按次计费（积分/次），视频/语音模型按秒计费（积分/秒）
//     视频节点带参考视频输入时：计费时长 = 输入（参考）视频时长 + 输出视频时长，
//     单价走「带参考视频」档（未配置 → 无参考视频单价的 6 折）
//  3. Refund / Recharge 退款 / 充值，同样写入账单明细；
//     退费必须回传扣费时的口径（ChargeExtra），扣费与退费的账单才能对得上
type Service struct {
	userRepo     repository.UserRepo
	billingRepo  repository.BillingRepo
	priceRepo    repository.ModelPriceRepo // 模型价格配置（nil 时全部按 0 处理）
	modelManager *llm.ModelManager         // 用于把调用方传入的 model_id 归一到配置 ID（nil 时按原值查）
	prices       map[string]int64
}

func NewService(userRepo repository.UserRepo, billingRepo repository.BillingRepo, priceRepo repository.ModelPriceRepo, modelManager *llm.ModelManager) *Service {
	return &Service{
		userRepo:     userRepo,
		billingRepo:  billingRepo,
		priceRepo:    priceRepo,
		modelManager: modelManager,
		prices:       defaultPrices,
	}
}

// refundTimeout 退费请求的独立超时：失败现场的原 ctx 往往已超时/取消，
// 用死 ctx 退费会直接失败，用户积分就白扣了 —— 所以退费一律另起 ctx。
const refundTimeout = 30 * time.Second

// RefundDetached 用独立 context 退费，渠道从原 ctx 带过来。
//
// 用 ctx 传「扣费时那个 ctx」很关键：新 ctx 里没有渠道信息，不带过去退费账单的
// 「渠道-模型」标签会回退成默认渠道（线上实例：dianxin 扣费、退费却记成 wasu-xxx）。
func (s *Service) RefundDetached(ctx context.Context, userID string, amount int64, action, modelName, scene, reason string, extra ChargeExtra) error {
	channel := ""
	if ctx != nil {
		channel = llm.ChannelFrom(ctx)
	}
	return s.RefundOnChannel(userID, amount, action, modelName, scene, reason, extra, channel)
}

// RefundOnChannel 指定渠道退费（渠道为空时按默认渠道记账）。
// 人工退费用它：渠道取当初真实调用的那个（对账行的 provider）。
func (s *Service) RefundOnChannel(userID string, amount int64, action, modelName, scene, reason string, extra ChargeExtra, channel string) error {
	refundCtx, cancel := context.WithTimeout(context.Background(), refundTimeout)
	defer cancel()
	if channel != "" {
		refundCtx = llm.WithChannel(refundCtx, channel)
	}
	return s.Refund(refundCtx, userID, amount, action, modelName, scene, reason, extra)
}

// Price 返回指定动作单次调用消耗的积分（仅动作级前置校验用）
func (s *Service) Price(action string) int64 {
	return s.prices[action]
}

// billingChannel 取计费渠道：从 ctx 解析（executor 已注入用户最终渠道），空值回退 wasu
func channelOf(ctx context.Context) string {
	if ch := llm.ChannelFrom(ctx); ch != "" {
		return ch
	}
	return "wasu"
}

// legacyChannelPrefixes 历史账单把渠道拼在模型名前（wasu-xxx / dianxin-xxx）。
// 读取时按前缀拆回去，展示口径统一为「渠道标签 + 纯模型 ID」。
var legacyChannelPrefixes = []string{"wasu-", "dianxin-"}

// NormalizeChannel 规范化一条账单记录的「渠道 + 模型」，供展示使用。
//
// 新记录：渠道在独立的 channel 列里，模型列本来就是纯模型 ID，直接返回。
// 历史记录：channel 为空且模型名带渠道前缀（wasu-cdance2.5-0807）→ 拆成
// channel=wasu + model=cdance2.5-0807。**只改返回值，不动数据库里的原始文本**，
// 保证账本可追溯（历史那串值本身也是"当初确实走的这个渠道"的证据）。
//
// 注意：只在带前缀时拆分，且真实模型 ID 不会以 wasu-/dianxin- 开头
// （线上核过：cdance2.0-0807 / doubao-* / wan3.0-video / deepseek-* 等），不会误拆。
func NormalizeChannel(rec *model.BillingRecord) {
	if rec == nil {
		return
	}
	for _, prefix := range legacyChannelPrefixes {
		if !strings.HasPrefix(rec.Model, prefix) {
			continue
		}
		// 模型列永远只展示纯模型 ID：前缀一律剥掉
		rec.Model = strings.TrimPrefix(rec.Model, prefix)
		// 渠道以独立列为准（新记录、以及人工校正过的历史记录）；该列为空才用前缀兜底
		if rec.Channel == "" {
			rec.Channel = strings.TrimSuffix(prefix, "-")
		}
		return
	}
}

// lookupPriceModelID 将调用方传入的模型标识（配置 ID 或 API model_id）在**指定渠道内**归一为配置 ID。
// 按渠道归一可避免同名模型（如 deepseek-v4.1-flash 在华数/电信各有一份）跨渠道误取价格
func (s *Service) lookupPriceModelID(channel, modelID string) string {
	if s.modelManager == nil || modelID == "" {
		return modelID
	}
	for _, models := range s.modelManager.ListModelsForChannel(channel) {
		for _, m := range models {
			if m.ID == modelID || m.ModelID == modelID {
				return m.ID
			}
		}
	}
	return modelID
}

// modelUnitPrice 返回指定渠道下某节点模型的单价（按次模型=积分/次，按秒模型=积分/秒）；
// 未配置或查询失败时返回 0（暂不扣费）。每次调用实时查库，后台改价即时生效
func (s *Service) modelUnitPrice(ctx context.Context, nodeType, modelID string) float64 {
	if s.priceRepo == nil || modelID == "" {
		return 0
	}
	channel := channelOf(ctx)
	// 归一：调用方可能传配置 ID（id）也可能传 API 模型 ID（model_id），统一映射到配置 ID 查价
	lookupID := s.lookupPriceModelID(channel, modelID)
	record, err := s.priceRepo.GetByNodeModel(ctx, channel, nodeType, lookupID)
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			log.Printf("[Billing] 查询模型价格失败: channel=%s nodeType=%s modelID=%s err=%v", channel, nodeType, modelID, err)
		}
		return 0
	}
	return record.Price
}

// modelUnitPriceWithResolution 返回指定渠道下模型按分辨率的单价（视频节点用）；
// hasRefVideo 指定「带参考视频输入」档（仅视频节点有这一档）；
// 未配置或查询失败时返回 0（暂不扣费）
func (s *Service) modelUnitPriceWithResolution(ctx context.Context, nodeType, modelID, resolution string, hasRefVideo bool) float64 {
	record, ok := s.lookupPrice(ctx, nodeType, modelID, resolution, hasRefVideo)
	if !ok {
		return 0
	}
	return record.Price
}

// lookupPrice 查询指定维度的价格记录，ok=false 表示该维度**未配置**（区别于「配置为 0 = 免费」，
// 带参考视频档的 6 折预设兜底需要区分这两种情况）
func (s *Service) lookupPrice(ctx context.Context, nodeType, modelID, resolution string, hasRefVideo bool) (*model.ModelPrice, bool) {
	if s.priceRepo == nil || modelID == "" {
		return nil, false
	}
	channel := channelOf(ctx)
	// 归一：调用方可能传配置 ID（id）也可能传 API 模型 ID（model_id），统一映射到配置 ID 查价
	lookupID := s.lookupPriceModelID(channel, modelID)
	record, err := s.priceRepo.GetByNodeModelResolution(ctx, channel, nodeType, lookupID, resolution, hasRefVideo)
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			log.Printf("[Billing] 查询模型价格失败: channel=%s nodeType=%s modelID=%s resolution=%s hasRefVideo=%v err=%v",
				channel, nodeType, modelID, resolution, hasRefVideo, err)
		}
		return nil, false
	}
	return record, true
}

// refVideoBillingEnabled 该模型是否按「参考视频（输入）时长」计费：
// 由 models.yaml 的 ref_video_billing 决定（当前仅 3 个 Seedance 模型开启）。
// 未配置的模型（含 wan3.0 系列）参考视频不参与计费，只按输出时长与常规单价扣费
func (s *Service) refVideoBillingEnabled(ctx context.Context, modelID string) bool {
	if s.modelManager == nil || modelID == "" {
		return false
	}
	return s.modelManager.RefVideoBilling(channelOf(ctx), modelID)
}

// RefVideoPrice 带参考视频输入的单价（积分/秒，仅视频节点）：
// 优先取后台配置的「带参考视频」档；未配置时按无参考视频单价的 6 折（RefVideoPriceDiscount）预设，
// 四舍五入到整数（价格统一为整数）。basePrice<=0（未配置或免费）时预设同样为 0
func RefVideoPrice(basePrice float64) float64 {
	if basePrice <= 0 {
		return 0
	}
	return math.Round(basePrice * RefVideoPriceDiscount)
}

// ChargeByModel 按次计费（文本/剧本/图片/提示词）：费用 = 单价 × 次数（四舍五入取整）
// 返回本次实际扣减的积分（供调用失败时通过 Refund 退还）
func (s *Service) ChargeByModel(ctx context.Context, userID, action, modelID, scene string, count int) (int64, error) {
	if count <= 0 {
		count = 1
	}
	unit := s.modelUnitPrice(ctx, actionNodeTypes[action], modelID)
	cost := int64(math.Round(unit * float64(count)))
	return s.chargeCost(ctx, userID, action, modelID, scene, ChargeExtra{}, cost)
}

// callUnitPrice 按次单价（支持分辨率档位，图片节点用）：
//
//	精确档（如 2K / 4K）已配置 → 用它
//	该档没配 → 退回「不带分辨率」的默认档，行为与「图片只有一行价」的时代一致
//	两档都没有 → 0（沿用「未配置 = 暂不扣费」的既有惯例，但会打日志，不允许静默免费）
//
// 为什么要分档：上游图片按 token 计费，而 token ≈ 像素/256 ——
// 4K（4096² = 65,536 tokens）正好是 2K（2048² = 16,384）的 4 倍。
// 一口价卖 4K，等于每张 4K 都按 2K 的价格卖，成本缺口在账面上完全看不见。
func (s *Service) callUnitPrice(ctx context.Context, nodeType, modelID, resolution string) float64 {
	if resolution != "" {
		if record, ok := s.lookupPrice(ctx, nodeType, modelID, resolution, false); ok {
			return record.Price
		}
		log.Printf("[Billing] ⚠️ 该分辨率档未单独配置价格，退回默认档计费: nodeType=%s modelID=%s resolution=%s", nodeType, modelID, resolution)
	}
	unit := s.modelUnitPrice(ctx, nodeType, modelID)
	if unit <= 0 {
		log.Printf("[Billing] ⚠️ 模型价格未配置（两档都没有），本次不扣费: nodeType=%s modelID=%s resolution=%s", nodeType, modelID, resolution)
	}
	return unit
}

// ChargeByModelWithResolution 按次计费（带分辨率档位）：费用 = 该档单价 × 次数（四舍五入取整）。
// 计费口径（档位）随扣费一起记进账单，退费时口径与扣费完全一致。
// 返回本次实际扣减的积分（供调用失败时通过 Refund 退还）
func (s *Service) ChargeByModelWithResolution(ctx context.Context, userID, action, modelID, resolution, scene string, count int) (int64, error) {
	if count <= 0 {
		count = 1
	}
	unit := s.callUnitPrice(ctx, actionNodeTypes[action], modelID, resolution)
	cost := int64(math.Round(unit * float64(count)))
	return s.chargeCost(ctx, userID, action, modelID, scene, ChargeExtra{Resolution: resolution}, cost)
}

// ChargeByDuration 按秒计费（语音等）：费用 = 单价 × 秒数（向上取整，不足 1 秒按 1 秒计）
// 返回本次实际扣减的积分
func (s *Service) ChargeByDuration(ctx context.Context, userID, action, modelID, scene string, seconds int) (int64, error) {
	if seconds <= 0 {
		seconds = 1
	}
	unit := s.modelUnitPrice(ctx, actionNodeTypes[action], modelID)
	cost := int64(math.Ceil(unit * float64(seconds)))
	return s.chargeCost(ctx, userID, action, modelID, scene, ChargeExtra{Seconds: seconds}, cost)
}

// ChargeVideoByDuration 视频节点按秒计费（按分辨率档位 + 是否带参考视频输入定价）：
//   - 计费时长 = 输出视频时长 + 参考视频（输入）视频时长；
//     仅当模型在 models.yaml 里开启 ref_video_billing（当前为 3 个 Seedance 模型）时，
//     参考视频时长才计入（其余模型如 wan3.0 仍只按输出时长计费，行为与改动前一致）
//   - 时长取整：输出时长本就是整数秒；参考视频时长四舍五入到秒（实测 30.08 秒 → 30 秒）
//   - 单价：无参考视频 → 常规分辨率单价；带参考视频 → 「带参考视频」档单价，
//     该档未配置时按常规单价的 6 折（RefVideoPriceDiscount 预设）
//   - 费用 = 单价 × 计费时长（向上取整）
//
// refVideoSeconds 为实测的参考视频总时长（秒，可为小数）；测量失败传 0 时该部分不计入时长。
// 返回（实际扣减积分, 本次计费口径 ChargeExtra）：口径需随退费一起回传，
// 保证退费账单与扣费账单的分辨率 / 计费时长 / 参考视频时长完全一致
func (s *Service) ChargeVideoByDuration(ctx context.Context, userID, action, modelID, scene, resolution string, outputSeconds int, refVideoSeconds float64) (int64, ChargeExtra, error) {
	// 参考视频时长计入计费的前提：模型开启了该规则，且确实测到了输入时长
	billRef := refVideoSeconds > 0 && s.refVideoBillingEnabled(ctx, modelID)

	extra := ChargeExtra{Resolution: resolution}
	extra.Seconds, extra.RefVideoSeconds = videoBilledSeconds(outputSeconds, refVideoSeconds, billRef)
	unit := s.videoUnitPrice(ctx, modelID, resolution, billRef)
	cost := int64(math.Ceil(unit * float64(extra.Seconds)))
	charged, err := s.chargeCost(ctx, userID, action, modelID, scene, extra, cost)
	return charged, extra, err
}

// videoUnitPrice 视频节点单价（积分/秒）：
// 无参考视频（或该模型未开启 ref_video_billing）取常规档；
// 带参考视频输入取「带参考视频」档，未配置该档时按常规单价的 6 折预设兜底 ——
// 后台还没来得及配这一档时，用户也不会被按原价多扣
func (s *Service) videoUnitPrice(ctx context.Context, modelID, resolution string, hasRefVideo bool) float64 {
	base := s.modelUnitPriceWithResolution(ctx, "video", modelID, resolution, false)
	if !hasRefVideo {
		return base
	}
	if record, ok := s.lookupPrice(ctx, "video", modelID, resolution, true); ok {
		return record.Price
	}
	return RefVideoPrice(base)
}

// videoBilledSeconds 视频计费时长（秒）= 输出视频时长 + 参考视频（输入）视频时长。
// billRef=false（无参考视频输入 / 模型未开启该规则）时只算输出时长；
// 参考视频时长按四舍五入取整到秒（ffprobe 实测 30.08 秒 → 30 秒），
// 输出时长本身就是整数秒（executor 已按模型时长范围钳制），故计费时长恒为整数。
// 返回（计费总时长, 其中参考视频部分）
func videoBilledSeconds(outputSeconds int, refVideoSeconds float64, billRef bool) (int, int) {
	if outputSeconds <= 0 {
		outputSeconds = 1
	}
	ref := 0
	if billRef && refVideoSeconds > 0 {
		ref = int(math.Round(refVideoSeconds))
	}
	return outputSeconds + ref, ref
}

// ChargeByChars 按字符数计费（音频）：费用 = 单价 × (字符数 / 100)（向上取整）
// 单价表示每 100 字的积分，返回本次实际扣减的积分
func (s *Service) ChargeByChars(ctx context.Context, userID, action, modelID, scene string, chars int) (int64, error) {
	if chars <= 0 {
		return 0, nil
	}
	unit := s.modelUnitPrice(ctx, actionNodeTypes[action], modelID)
	// 单价是每 100 字的价格，计算实际费用
	cost := int64(math.Ceil(unit * float64(chars) / 100.0))
	return s.chargeCost(ctx, userID, action, modelID, scene, ChargeExtra{}, cost)
}

// ChargeExtra 账单附加信息（计费口径）。
// 视频节点按「分辨率档位 × 计费时长」定价，账单里必须能看出这笔钱是按哪一档、多少秒算出来的，
// 否则事后无法复核（本次改动前这两项没有落库，历史账单只能靠画布快照反推）。
// 带参考视频输入时还要能拆出「输入视频时长」那一部分。
// 非视频节点传零值。
//
// 扣费与退费必须用同一份 ChargeExtra：扣费时由 ChargeVideoByDuration 返回，
// 退费时原样回传（Refund），两张账单的 Resolution / Duration / RefVideoDuration 才会完全一致
// chargeKeyCtxKey 把「这次扣费的唯一编号」随 ctx 传给计费层。
//
// 为什么用 ctx 而不是加参数：扣费入口有四个（按次/按秒/按视频时长/按字数），
// 逐个加参数会侵入所有调用方；而 charge_key 是「本次调用的属性」，本来就属于 ctx。
// 显式传 ChargeExtra.ChargeKey 时以显式为准（人工退费等路径从对账行里读出来）。
type chargeKeyCtxKey struct{}

// WithChargeKey 给一次调用打上扣费编号（executor 在扣费前调用）
func WithChargeKey(ctx context.Context, key string) context.Context {
	if key == "" {
		return ctx
	}
	return context.WithValue(ctx, chargeKeyCtxKey{}, key)
}

// chargeKeyOf 取这次扣费/退费的编号：显式传入优先，其次 ctx
func chargeKeyOf(ctx context.Context, extra ChargeExtra) string {
	if extra.ChargeKey != "" {
		return extra.ChargeKey
	}
	if v, ok := ctx.Value(chargeKeyCtxKey{}).(string); ok {
		return v
	}
	return ""
}

// ChargeKeyFrom 读这次调用身上的扣费编号（没有则空串）。
//
// 给「写对账行」的一侧用：行身份必须与账单分录同一把编号，才能互相核对
// （同步调用的对账行由 executor 写、账单分录由计费层写，两边都从 ctx 取同一把）。
func ChargeKeyFrom(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	if v, ok := ctx.Value(chargeKeyCtxKey{}).(string); ok {
		return v
	}
	return ""
}

// NewChargeKey 生成一次扣费的唯一编号。
//
// 形态 chg_<纳秒base36>_<8字节随机>：前缀可读、时间部分便于按时间定位、随机部分保证唯一
// （不依赖执行号+节点号推导 —— 同一节点在同一次执行里可能被扣多次费，推导出来的 key 会撞）。
func NewChargeKey() string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		// 随机源失败不该阻断扣费流程：退化成纳秒 + 计数器，仍然能保证唯一
		return fmt.Sprintf("chg_%s_%d", strconv.FormatInt(time.Now().UnixNano(), 36), atomic.AddUint64(&chargeKeySeq, 1))
	}
	return fmt.Sprintf("chg_%s_%s", strconv.FormatInt(time.Now().UnixNano(), 36), hex.EncodeToString(b[:]))
}

var chargeKeySeq uint64

type ChargeExtra struct {
	Resolution string
	// Seconds 计费总时长（秒）：视频 = 输出视频时长 + 参考视频时长
	Seconds int
	// RefVideoSeconds 计费时长中参考视频（输入）那部分（秒），无参考视频时为 0
	RefVideoSeconds int
	// TaskID 上游异步任务号（视频生成才有）。
	// 落库意义：账单行是**永久**记录，而任务登记（Redis，24h）在退费后就被消费掉了 ——
	// 没有这一列，事后就无法回答「这笔失败到底有没有让上游真的接单并计费」，
	// 也找不回上游可能已经产出的结果。线上实例：10-03 00:04 那次超时中断。
	TaskID string
	// ChargeKey 这一笔扣费的唯一编号（与 provider_tasks.charge_key 同值）。
	// 扣费与退费必须带同一把 —— 少了它，账单流水和对账行就无法精确关联。
	ChargeKey string
}

// chargeCost 扣费 + 记账：
// 费用 <= 0 → 不扣费但仍写入一条 0 积分记录（便于验证扣费链路）；
// 积分不足 → ErrInsufficientCredits；
// 账单记录模型（model）、场景（scene）、分辨率/时长/参考视频时长（视频）与扣费后剩余积分（balance_after）
func (s *Service) chargeCost(ctx context.Context, userID, action, modelName, scene string, extra ChargeExtra, cost int64) (int64, error) {
	if cost > 0 {
		ok, err := s.userRepo.DeductCredits(ctx, userID, cost)
		if err != nil {
			return 0, err
		}
		if !ok {
			return 0, ErrInsufficientCredits
		}
	}
	// 钱已经扣了：从这里往后任何一步失败都不能把调用掐掉 ——
	// 否则用户被扣了费却没拿到服务，也拿不到任何失败记录（既没调用、也没退费）。
	// 只记账失败的场景（余额快照读不到 / 账单写不进去）大声打日志，但让调用继续。
	balance, err := s.userRepo.GetCredits(ctx, userID)
	if err != nil {
		log.Printf("[Billing] ⚠️ 扣费成功但读取余额快照失败（不影响本次调用）: user=%s cost=%d err=%v", userID, cost, err)
		balance = 0
	}
	// 账单记录实际调用的渠道（executor 已注入 ctx），无渠道时回退 wasu。
	// 渠道独立成列，模型列只存纯模型 ID —— 不再拼成「wasu-模型名」这种四不像。
	channel := channelOf(ctx)
	s.writeRecord(ctx, &model.BillingRecord{
		UserID: userID,
		Type:   "deduct",
		Amount: cost,
		Action: action,
		Model:  modelName,
		// 扣费分录带上这次扣费的唯一编号：没有它，账单流水与上游对账行无法关联，
		// 扣费侧金额永远核对不了（扣费发生在上游任务号之前，TaskID 那一列必然是空）
		ChargeKey:  chargeKeyOf(ctx, extra),
		Channel:    channel,
		Scene:      scene,
		Resolution: extra.Resolution,
		TaskID:     extra.TaskID,
		Duration:   extra.Seconds,
		// 参考视频时长单独落库：Duration 是计费总时长，这一列是其中输入视频那部分，
		// 两者相减即输出视频时长，事后能按「单价 × (输出 + 输入)」完整复核这笔扣费
		RefVideoDuration: extra.RefVideoSeconds,
		Remark:           s.remarkOf(action, scene),
		BalanceAfter:     balance,
	})
	return cost, nil
}

// EnsureBalance AI 入口余额校验（中间件用，只校验不扣费不记账）：
// 单价 <= 0 → 直接放行；余额不足 → ErrInsufficientCredits
func (s *Service) EnsureBalance(ctx context.Context, userID, action string) error {
	cost := s.Price(action)
	if cost <= 0 {
		return nil
	}
	balance, err := s.userRepo.GetCredits(ctx, userID)
	if err != nil {
		return err
	}
	if balance < cost {
		return ErrInsufficientCredits
	}
	return nil
}

// Refund 退还积分（AI 调用失败时退回已扣金额，reason 为失败的真实原因，如 API 返回的敏感内容信息）。
// extra 必须传「当初扣费时的那一份口径」（ChargeVideoByDuration 的返回值 / 随任务登记持久化的那份）：
// 退费账单与扣费账单记录同样的分辨率、计费时长与参考视频时长，事后核对时两边能一一对上；
// 按次/按字数等无口径的退费传 ChargeExtra{}（零值）
func (s *Service) Refund(ctx context.Context, userID string, amount int64, action, modelName, scene, reason string, extra ChargeExtra) error {
	if amount <= 0 {
		return nil
	}
	if err := s.userRepo.AddCredits(ctx, userID, amount); err != nil {
		return err
	}
	// 钱已经回到用户账上了：从这里往后任何失败都不能再往上抛错误 ——
	// 上层把「退费失败」当信号（写待人工复核），一旦误报，管理员会照着重退一次，
	// 同一笔扣费就退了两遍（真金白银）。余额快照读不到只影响账单上的一列展示。
	balance, err := s.userRepo.GetCredits(ctx, userID)
	if err != nil {
		log.Printf("[Billing] ⚠️ 退费成功但读取余额快照失败（不影响退费结果）: user=%s amount=%d err=%v", userID, amount, err)
		balance = 0
	}
	// 构建退费备注，包含退费原因；截断到安全长度（remark 字段 varchar(255)，按字符计）
	remark := fmt.Sprintf("%s失败退还", scene)
	if reason != "" {
		// 同对账备注：原来的 200 字会把上游报错切掉大半，现在放到 600 字
		// （remark 列已放大到 varchar(1000)，加上「场景+失败退还：」前缀也不会写爆）
		if r := []rune(reason); len(r) > 600 {
			reason = string(r[:600]) + "…"
		}
		remark = fmt.Sprintf("%s失败退还：%s", scene, reason)
	}
	// 退费账单与扣费同口径：渠道同样独立成列（原样退回当初那条记录里的渠道）
	channel := channelOf(ctx)
	s.writeRecord(ctx, &model.BillingRecord{
		UserID:     userID,
		Type:       "refund",
		Amount:     amount,
		Action:     action,
		Model:      modelName,
		Channel:    channel,
		Scene:      scene,
		Resolution: extra.Resolution,
		TaskID:     extra.TaskID,
		// 退费与扣费带**同一把** charge_key：对账才能把同一笔生成的两条分录归到一起
		ChargeKey: chargeKeyOf(ctx, extra),
		Duration:  extra.Seconds,
		// 与扣费同口径：退费也带上参考视频时长，退费账单能还原出「退的是哪一档、多少秒」
		RefVideoDuration: extra.RefVideoSeconds,
		Remark:           remark,
		BalanceAfter:     balance,
	})
	return nil
}

// RechargeOrder 充值的支付订单信息，用于和支付宝对账。
// 只有支付宝回调过来的充值才带这两个号；后台手工充值没有支付宝订单，传零值。
type RechargeOrder struct {
	OrderNo       string // 商户订单号（payment_orders.order_no / 支付宝 out_trade_no）
	AlipayTradeNo string // 支付宝交易号（trade_no）
}

// Recharge 充值积分（后续管理端 / 支付回调调用）
func (s *Service) Recharge(ctx context.Context, userID string, amount int64, scene, remark string, order RechargeOrder) error {
	if amount <= 0 {
		return nil
	}
	if err := s.userRepo.AddCredits(ctx, userID, amount); err != nil {
		return err
	}
	balance, err := s.userRepo.GetCredits(ctx, userID)
	if err != nil {
		return err
	}
	if remark == "" {
		remark = "积分充值"
	}
	if scene == "" {
		scene = "积分充值"
	}
	s.writeRecord(ctx, &model.BillingRecord{
		UserID:        userID,
		Type:          "recharge",
		Amount:        amount,
		Scene:         scene,
		Remark:        remark,
		BalanceAfter:  balance,
		OrderNo:       order.OrderNo,
		AlipayTradeNo: order.AlipayTradeNo,
	})
	return nil
}

// remarkOf 账单描述：优先动作文案，其次场景，兜底动作标识
func (s *Service) remarkOf(action, scene string) string {
	if remark := actionRemarks[action]; remark != "" {
		return remark
	}
	if scene != "" {
		return scene
	}
	return action
}

// writeRecord 写入账单明细（余额变动成功后才调用；写入失败仅记日志不影响主流程）
func (s *Service) writeRecord(ctx context.Context, record *model.BillingRecord) {
	if err := s.billingRepo.Create(ctx, record); err != nil {
		log.Printf("[Billing] 写入账单明细失败: userID=%s type=%s amount=%d err=%v", record.UserID, record.Type, record.Amount, err)
	}
}
