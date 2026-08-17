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
	BillingActionWorkflowExecute = "workflow.execute" // 工作流入口（中间件仅校验余额，不扣费）
	BillingActionPromptGenerate  = "prompt.generate"  // 提示词生成
	BillingActionStory           = "ai.story"         // 故事生成（文本节点）
	BillingActionScript          = "ai.script"        // 分镜剧本生成（脚本节点）
	BillingActionImage           = "ai.image"         // 图片生成（图片节点）
	BillingActionVideo           = "ai.video"         // 视频生成（视频节点）
	BillingActionAudio           = "ai.audio"         // 音频生成（音频节点）
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
}

// BillingService 积分扣费服务：
//  1. EnsureBalance 实现 middleware.CreditBiller，供扣费中间件在 AI 入口做余额校验（只校验不扣费）
//  2. ChargeByModel / ChargeByDuration 在真实 AI 调用点扣费并写入账单明细：
//     单价来自 model_prices 表（运营后台「价格管理」维护，保存后即时生效）：
//     文本/图片模型按次计费（积分/次），视频/语音模型按秒计费（积分/秒）
//  3. Refund / Recharge 退款 / 充值，同样写入账单明细
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

// modelUnitPrice 返回指定节点下模型的单价（按次模型=积分/次，按秒模型=积分/秒）；
// 未配置或查询失败时返回 0（暂不扣费）。每次调用实时查库，后台改价即时生效
func (s *BillingService) modelUnitPrice(ctx context.Context, nodeType, modelID string) float64 {
	if s.priceRepo == nil || modelID == "" {
		return 0
	}
	// 归一：调用方可能传配置 ID（id）也可能传 API 模型 ID（model_id），统一映射到配置 ID 查价
	lookupID := modelID
	if s.modelManager != nil {
		if cfg := s.modelManager.FindModelByID(modelID); cfg != nil {
			lookupID = cfg.ID
		} else {
			for _, models := range s.modelManager.ListModels() {
				for _, m := range models {
					if m.ModelID == modelID {
						lookupID = m.ID
						break
					}
				}
			}
		}
	}
	record, err := s.priceRepo.GetByNodeModel(ctx, nodeType, lookupID)
	if err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			log.Printf("[Billing] 查询模型价格失败: nodeType=%s modelID=%s err=%v", nodeType, modelID, err)
		}
		return 0
	}
	return record.Price
}

// ChargeByModel 按次计费（文本/剧本/图片/提示词）：费用 = 单价 × 次数（四舍五入取整）
// 返回本次实际扣减的积分（供调用失败时通过 Refund 退还）
func (s *BillingService) ChargeByModel(ctx context.Context, userID, action, modelID, scene string, count int) (int64, error) {
	if count <= 0 {
		count = 1
	}
	unit := s.modelUnitPrice(ctx, actionNodeTypes[action], modelID)
	cost := int64(math.Round(unit * float64(count)))
	return s.chargeCost(ctx, userID, action, modelID, scene, cost)
}

// ChargeByDuration 按秒计费（视频/语音）：费用 = 单价 × 秒数（向上取整，不足 1 秒按 1 秒计）
// 返回本次实际扣减的积分
func (s *BillingService) ChargeByDuration(ctx context.Context, userID, action, modelID, scene string, seconds int) (int64, error) {
	if seconds <= 0 {
		seconds = 1
	}
	unit := s.modelUnitPrice(ctx, actionNodeTypes[action], modelID)
	cost := int64(math.Ceil(unit * float64(seconds)))
	return s.chargeCost(ctx, userID, action, modelID, scene, cost)
}

// chargeCost 扣费 + 记账：
// 费用 <= 0 → 不扣费但仍写入一条 0 积分记录（便于验证扣费链路）；
// 积分不足 → ErrInsufficientCredits；
// 账单记录模型（model）、场景（scene）与扣费后剩余积分（balance_after）
func (s *BillingService) chargeCost(ctx context.Context, userID, action, modelName, scene string, cost int64) (int64, error) {
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
	s.writeRecord(ctx, &model.BillingRecord{
		UserID:       userID,
		Type:         "deduct",
		Amount:       cost,
		Action:       action,
		Model:        modelName,
		Scene:        scene,
		Remark:       s.remarkOf(action, scene),
		BalanceAfter: balance,
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

// Refund 退还积分（AI 调用失败时退回已扣金额）
func (s *BillingService) Refund(ctx context.Context, userID string, amount int64, action, modelName, scene string) error {
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
	// 构建退费备注，包含退费原因
	remark := fmt.Sprintf("%s失败退还", scene)
	s.writeRecord(ctx, &model.BillingRecord{
		UserID:       userID,
		Type:         "refund",
		Amount:       amount,
		Action:       action,
		Model:        modelName,
		Scene:        scene,
		Remark:       remark,
		BalanceAfter: balance,
	})
	return nil
}

// Recharge 充值积分（后续管理端 / 支付回调调用）
func (s *BillingService) Recharge(ctx context.Context, userID string, amount int64, remark string) error {
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
	s.writeRecord(ctx, &model.BillingRecord{
		UserID:       userID,
		Type:         "recharge",
		Amount:       amount,
		Remark:       remark,
		BalanceAfter: balance,
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
