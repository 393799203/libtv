package service

import (
	"context"
	"errors"
	"fmt"
	"log"
	"math"

	"libtv/internal/llm"
	"libtv/internal/model"
	"libtv/internal/pkg/apperror"
	"libtv/internal/repository"

	"gorm.io/gorm"
)

// 计费动作（扣费维度）：细分到每次真实 AI 调用，账单可精确到模型与场景
const (
	BillingActionWorkflowExecute = "workflow.execute"  // 工作流入口（中间件仅校验余额，不扣费）
	BillingActionPromptGenerate  = "prompt.generate"   // 提示词生成
	BillingActionStory           = "ai.story"          // 故事生成（文本节点）
	BillingActionScript          = "ai.script"         // 分镜剧本生成（脚本节点）
	BillingActionImage           = "ai.image"          // 图片生成（图片节点）
	BillingActionVideo           = "ai.video"          // 视频生成（视频节点）
	BillingActionAudio           = "ai.audio"          // 音频生成（音频节点）
	BillingActionPrevizAnalyze   = "ai.previz_analyze" // 白模场景解析（previz 节点）
)

// ErrInsufficientCredits 积分不足（HTTP 402，前端可用 code=4002 区分提示充值）
var ErrInsufficientCredits = apperror.New(4002, 402, "积分不足，请先充值")

// actionRemarks 计费动作的账单描述（展示给用户看的文案）
var actionRemarks = map[string]string{
	BillingActionPromptGenerate: "提示词生成",
	BillingActionStory:          "故事生成",
	BillingActionScript:         "分镜剧本生成",
	BillingActionImage:          "图片生成",
	BillingActionVideo:          "视频生成",
	BillingActionAudio:          "音频生成",
	BillingActionPrevizAnalyze:  "白模场景解析",
}

// defaultPrices 动作级兜底策略表（仅 EnsureBalance 前置校验用，当前全部为 0 即放行）
// 真实扣费单价以 model_prices 表（运营后台价格管理）为准，按（节点 + 模型）维度计费
var defaultPrices = map[string]int64{
	BillingActionPromptGenerate: 0,
	BillingActionStory:          0,
	BillingActionScript:         0,
	BillingActionImage:          0,
	BillingActionVideo:          0,
	BillingActionAudio:          0,
	BillingActionPrevizAnalyze:  0,
}

// actionNodeTypes 扣费 action → 定价节点映射：价格按（节点 + 模型）维度配置，
// 同一模型在不同节点可设不同价格（如 llm 模型在文本 / 剧本节点分开定价）
var actionNodeTypes = map[string]string{
	BillingActionPromptGenerate: "text", // 提示词生成使用文本节点的模型列表
	BillingActionStory:          "text",
	BillingActionScript:         "script",
	BillingActionImage:          "image",
	BillingActionVideo:          "video",
	BillingActionAudio:          "audio",
	BillingActionPrevizAnalyze:  "previz", // 白模解析独立定价维度（价格管理页「白模解析」分组）
}

// RefVideoPriceDiscount 带参考视频输入的预设折扣：只对 models.yaml 里
// ref_video_billing=true 的模型生效（当前为 3 个 Seedance 模型）。
// 后台未单独配置「带参考视频」单价时按无参考视频单价的 6 折计费，
// 价格管理页也用同一折扣预填输入框，避免两边口径不一致
const RefVideoPriceDiscount = 0.6

// BillingService 积分扣费服务：
//  1. EnsureBalance 实现 middleware.CreditBiller，供扣费中间件在 AI 入口做余额校验（只校验不扣费）
//  2. ChargeByModel / ChargeVideoByDuration / ChargeByChars 在真实 AI 调用点扣费并写入账单明细：
//     单价来自 model_prices 表（运营后台「价格管理」维护，保存后即时生效）：
//     文本/图片模型按次计费（积分/次），视频/语音模型按秒计费（积分/秒）
//     视频节点带参考视频输入时：计费时长 = 输入（参考）视频时长 + 输出视频时长，
//     单价走「带参考视频」档（未配置 → 无参考视频单价的 6 折）
//  3. Refund / Recharge 退款 / 充值，同样写入账单明细；
//     退费必须回传扣费时的口径（ChargeExtra），扣费与退费的账单才能对得上
type BillingService struct {
	userRepo     repository.UserRepo
	billingRepo  repository.BillingRepo
	priceRepo    repository.ModelPriceRepo // 模型价格配置（nil 时全部按 0 处理）
	modelManager *llm.ModelManager         // 用于把调用方传入的 model_id 归一到配置 ID（nil 时按原值查）
	prices       map[string]int64
}

func NewBillingService(userRepo repository.UserRepo, billingRepo repository.BillingRepo, priceRepo repository.ModelPriceRepo, modelManager *llm.ModelManager) *BillingService {
	return &BillingService{
		userRepo:     userRepo,
		billingRepo:  billingRepo,
		priceRepo:    priceRepo,
		modelManager: modelManager,
		prices:       defaultPrices,
	}
}

// Price 返回指定动作单次调用消耗的积分（仅动作级前置校验用）
func (s *BillingService) Price(action string) int64 {
	return s.prices[action]
}

// billingChannel 取计费渠道：从 ctx 解析（executor 已注入用户最终渠道），空值回退 wasu
func billingChannel(ctx context.Context) string {
	if ch := llm.ChannelFrom(ctx); ch != "" {
		return ch
	}
	return "wasu"
}

// lookupPriceModelID 将调用方传入的模型标识（配置 ID 或 API model_id）在**指定渠道内**归一为配置 ID。
// 按渠道归一可避免同名模型（如 deepseek-v4.1-flash 在华数/电信各有一份）跨渠道误取价格
func (s *BillingService) lookupPriceModelID(channel, modelID string) string {
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
func (s *BillingService) modelUnitPrice(ctx context.Context, nodeType, modelID string) float64 {
	if s.priceRepo == nil || modelID == "" {
		return 0
	}
	channel := billingChannel(ctx)
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
func (s *BillingService) modelUnitPriceWithResolution(ctx context.Context, nodeType, modelID, resolution string, hasRefVideo bool) float64 {
	record, ok := s.lookupPrice(ctx, nodeType, modelID, resolution, hasRefVideo)
	if !ok {
		return 0
	}
	return record.Price
}

// lookupPrice 查询指定维度的价格记录，ok=false 表示该维度**未配置**（区别于「配置为 0 = 免费」，
// 带参考视频档的 6 折预设兜底需要区分这两种情况）
func (s *BillingService) lookupPrice(ctx context.Context, nodeType, modelID, resolution string, hasRefVideo bool) (*model.ModelPrice, bool) {
	if s.priceRepo == nil || modelID == "" {
		return nil, false
	}
	channel := billingChannel(ctx)
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
func (s *BillingService) refVideoBillingEnabled(ctx context.Context, modelID string) bool {
	if s.modelManager == nil || modelID == "" {
		return false
	}
	return s.modelManager.RefVideoBilling(billingChannel(ctx), modelID)
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
func (s *BillingService) ChargeByModel(ctx context.Context, userID, action, modelID, scene string, count int) (int64, error) {
	if count <= 0 {
		count = 1
	}
	unit := s.modelUnitPrice(ctx, actionNodeTypes[action], modelID)
	cost := int64(math.Round(unit * float64(count)))
	return s.chargeCost(ctx, userID, action, modelID, scene, ChargeExtra{}, cost)
}

// ChargeByDuration 按秒计费（语音等）：费用 = 单价 × 秒数（向上取整，不足 1 秒按 1 秒计）
// 返回本次实际扣减的积分
func (s *BillingService) ChargeByDuration(ctx context.Context, userID, action, modelID, scene string, seconds int) (int64, error) {
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
func (s *BillingService) ChargeVideoByDuration(ctx context.Context, userID, action, modelID, scene, resolution string, outputSeconds int, refVideoSeconds float64) (int64, ChargeExtra, error) {
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
func (s *BillingService) videoUnitPrice(ctx context.Context, modelID, resolution string, hasRefVideo bool) float64 {
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
func (s *BillingService) ChargeByChars(ctx context.Context, userID, action, modelID, scene string, chars int) (int64, error) {
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
type ChargeExtra struct {
	Resolution string
	// Seconds 计费总时长（秒）：视频 = 输出视频时长 + 参考视频时长
	Seconds int
	// RefVideoSeconds 计费时长中参考视频（输入）那部分（秒），无参考视频时为 0
	RefVideoSeconds int
}

// chargeCost 扣费 + 记账：
// 费用 <= 0 → 不扣费但仍写入一条 0 积分记录（便于验证扣费链路）；
// 积分不足 → ErrInsufficientCredits；
// 账单记录模型（model）、场景（scene）、分辨率/时长/参考视频时长（视频）与扣费后剩余积分（balance_after）
func (s *BillingService) chargeCost(ctx context.Context, userID, action, modelName, scene string, extra ChargeExtra, cost int64) (int64, error) {
	if cost > 0 {
		ok, err := s.userRepo.DeductCredits(ctx, userID, cost)
		if err != nil {
			return 0, err
		}
		if !ok {
			return 0, ErrInsufficientCredits
		}
	}
	balance, err := s.userRepo.GetCredits(ctx, userID)
	if err != nil {
		return cost, err
	}
	// 账单模型显示「渠道-模型」：从 ctx 取渠道（executor 已注入），
	// 无渠道时回退 wasu；历史纯 ID 记录保持原样（无前缀）
	channel := "wasu"
	if ch := llm.ChannelFrom(ctx); ch != "" {
		channel = ch
	}
	displayModel := modelName
	if displayModel != "" {
		displayModel = channel + "-" + displayModel
	}
	s.writeRecord(ctx, &model.BillingRecord{
		UserID:     userID,
		Type:       "deduct",
		Amount:     cost,
		Action:     action,
		Model:      displayModel,
		Scene:      scene,
		Resolution: extra.Resolution,
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
func (s *BillingService) EnsureBalance(ctx context.Context, userID, action string) error {
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
func (s *BillingService) Refund(ctx context.Context, userID string, amount int64, action, modelName, scene, reason string, extra ChargeExtra) error {
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
	// 构建退费备注，包含退费原因；截断到安全长度（remark 字段 varchar(255)，按字符计）
	remark := fmt.Sprintf("%s失败退还", scene)
	if reason != "" {
		if r := []rune(reason); len(r) > 200 {
			reason = string(r[:200]) + "…"
		}
		remark = fmt.Sprintf("%s失败退还：%s", scene, reason)
	}
	// 退费账单模型同样带渠道前缀，与扣费记录显示一致
	channel := "wasu"
	if ch := llm.ChannelFrom(ctx); ch != "" {
		channel = ch
	}
	displayModel := modelName
	if displayModel != "" {
		displayModel = channel + "-" + displayModel
	}
	s.writeRecord(ctx, &model.BillingRecord{
		UserID:     userID,
		Type:       "refund",
		Amount:     amount,
		Action:     action,
		Model:      displayModel,
		Scene:      scene,
		Resolution: extra.Resolution,
		Duration:   extra.Seconds,
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
func (s *BillingService) Recharge(ctx context.Context, userID string, amount int64, scene, remark string, order RechargeOrder) error {
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
func (s *BillingService) remarkOf(action, scene string) string {
	if remark := actionRemarks[action]; remark != "" {
		return remark
	}
	if scene != "" {
		return scene
	}
	return action
}

// writeRecord 写入账单明细（余额变动成功后才调用；写入失败仅记日志不影响主流程）
func (s *BillingService) writeRecord(ctx context.Context, record *model.BillingRecord) {
	if err := s.billingRepo.Create(ctx, record); err != nil {
		log.Printf("[Billing] 写入账单明细失败: userID=%s type=%s amount=%d err=%v", record.UserID, record.Type, record.Amount, err)
	}
}
