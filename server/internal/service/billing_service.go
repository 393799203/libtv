package service

import (
	"context"
	"log"

	"libtv/internal/model"
	"libtv/internal/pkg/apperror"
	"libtv/internal/repository"
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

// defaultPrices 扣费策略表（TODO: 具体扣费策略后续补充）
// key = 计费动作，value = 单次调用消耗积分；0 或未配置表示暂不扣费
var defaultPrices = map[string]int64{
	BillingActionPromptGenerate: 0,
	BillingActionStory:          0,
	BillingActionScript:         0,
	BillingActionImage:          0,
	BillingActionVideo:          0,
	BillingActionAudio:          0,
}

// BillingService 积分扣费服务：
//  1. EnsureBalance 实现 middleware.CreditBiller，供扣费中间件在 AI 入口做余额校验（只校验不扣费）
//  2. Charge 在真实 AI 调用点扣费并写入账单明细（含模型 / 场景 / 扣费后余额）
//  3. Refund / Recharge 退款 / 充值，同样写入账单明细
//  4. 具体扣费策略（每个动作的单价）统一在 defaultPrices 配置，当前全部为 0
type BillingService struct {
	userRepo    repository.UserRepo
	billingRepo repository.BillingRepo
	prices      map[string]int64
}

func NewBillingService(userRepo repository.UserRepo, billingRepo repository.BillingRepo) *BillingService {
	return &BillingService{userRepo: userRepo, billingRepo: billingRepo, prices: defaultPrices}
}

// Price 返回指定动作单次调用消耗的积分
func (s *BillingService) Price(action string) int64 {
	return s.prices[action]
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

// Charge 真实 AI 调用点扣费 + 记账：
// 单价 <= 0 → 不扣费但仍写入一条 0 积分记录（便于验证扣费链路）；
// 积分不足 → ErrInsufficientCredits；
// 账单记录模型（model）、场景（scene）与扣费后剩余积分（balance_after）。
// 返回本次实际扣减的积分（供调用失败时通过 Refund 退还）
func (s *BillingService) Charge(ctx context.Context, userID, action, modelName, scene string) (int64, error) {
	cost := s.Price(action)
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

// Refund 退还积分（AI 调用失败时退回已扣金额）
func (s *BillingService) Refund(ctx context.Context, userID string, amount int64) error {
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
	s.writeRecord(ctx, &model.BillingRecord{
		UserID:       userID,
		Type:         "refund",
		Amount:       amount,
		Remark:       "积分退还",
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
