package billing

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"

	"libtv/internal/llm"
	"libtv/internal/model"
	"libtv/internal/pkg/textcut"
	"libtv/internal/repository"
)

// Ledger 上游任务对账记录（谁、哪个项目、哪个节点、哪个上游任务、结局如何）。
//
// 与 Redis 任务登记（llm.AsyncTaskRef）的区别：登记是**运行时**凭据，24 小时过期、
// 退费成功后即被消费；本服务写的是**永久**账：任务号一旦拿到就落库，
// 失败、退费、交付都往同一行上补状态。
type Ledger struct {
	repo repository.ProviderTaskRepo
	// biller 人工退费要动积分，走与自动退费同一套记账（同一个 Refund，账单口径一致）
	biller *Service
}

// NewLedger 创建上游任务对账服务
func NewLedger(repo repository.ProviderTaskRepo) *Ledger {
	return &Ledger{repo: repo}
}

// SetBillingService 注入计费服务（管理员手动退费用）。main 里在建 BillingService 之后再调用。
func (s *Ledger) SetBillingService(b *Service) { s.biller = b }

// Record 记录/更新一条上游任务（按任务号去重，状态取最新）。
//
// 注意：任务号是跟渠道对账的唯一凭据，写失败必须留日志 —— 但只要写失败不影响
// 用户看到的结果，就不该把执行带崩（对账表是旁路账，不是主流程）。
func (s *Ledger) Record(ctx context.Context, task *model.ProviderTask) error {
	if s == nil || s.repo == nil || task == nil || task.TaskID == "" {
		return nil
	}
	if err := s.repo.Upsert(ctx, task); err != nil {
		log.Printf("[ProviderTask] ⚠️ 写入上游任务对账失败: taskID=%s status=%s err=%v", task.TaskID, task.Status, err)
		return err
	}
	return nil
}

// List 后台对账列表（筛选 + 分页）
func (s *Ledger) List(ctx context.Context, filter repository.ProviderTaskFilter) ([]repository.ProviderTaskView, int64, error) {
	if s == nil || s.repo == nil {
		return nil, 0, nil
	}
	return s.repo.List(ctx, filter)
}

// Stats 按同一筛选条件汇总（各状态条数 + 扣费/退费合计）
func (s *Ledger) Stats(ctx context.Context, filter repository.ProviderTaskFilter) (repository.ProviderTaskStats, error) {
	if s == nil || s.repo == nil {
		return repository.ProviderTaskStats{}, nil
	}
	return s.repo.Stats(ctx, filter)
}

// RefundManually 管理员在对账页手动退费。
//
// 退款规则（产品口径）：只有「上游明确报错」那类才自动退；超时、没拿到结果、转存失败等
// 一律不自动退，由管理员在这里判断后退 —— 所以这个动作必须**又稳又只退一次**：
//  1. 先用 CAS 占住那一行（status 进 refunding、refunded_amount 落金额），并发点两次只有一次能占；
//  2. 再走与自动退费完全相同的 BillingService.Refund 记账（渠道、口径、备注一致）；
//  3. 退成功才落 refunded 终态；失败把行放回待人工退费，绝不会出现「显示退了、钱没到账」。
func (s *Ledger) RefundManually(ctx context.Context, id int64, operator, reason string) (*model.ProviderTask, error) {
	if s == nil || s.repo == nil {
		return nil, errors.New("对账服务不可用")
	}
	if s.biller == nil {
		return nil, errors.New("计费服务不可用")
	}
	by := operator
	if by == "" {
		by = "管理员"
	}
	note := textcut.NotLongerThan("管理员手动退费（"+by+"）: "+reason, 240)
	task, err := s.repo.ClaimForRefund(ctx, id, by, note)
	if err != nil {
		return nil, err
	}
	if task == nil {
		return nil, ErrRefundNotAllowed
	}
	if task.ChargedAmount <= 0 || task.UserID == "" {
		_ = s.repo.RevertRefund(ctx, id, "管理员手动退费失败：缺少扣费金额或用户，需人工核对")
		return nil, errors.New("缺少扣费金额或用户，无法退费")
	}

	// 计费口径按当初扣费时落盘的那一份，退费账单才能与扣费账单对齐
	extra := ChargeExtra{
		Resolution:      task.ChargeResolution,
		Seconds:         task.ChargeSeconds,
		RefVideoSeconds: task.ChargeRefSeconds,
		TaskID:          task.TaskID,
	}
	// 动作与场景取这一行自己的（task_kind 就是当初扣费时的动作）：人工退费也必须与原扣费同口径，
	// 否则退一张图片的费会被记成「视频生成失败退还」，按动作对账/统计全都对不上
	action := task.TaskKind
	if action == "" {
		action = ActionVideo // 历史行没有 task_kind，按视频兜底
	}
	scene := SceneOf(action)
	// 视频：给引擎的「这笔扣费已退」幂等键也打上标记，避免它随后又自动退一次（同一笔钱退两遍）
	videoTaskID := ""
	if action == ActionVideo && !strings.HasPrefix(task.TaskID, "sync:") && task.TaskID != "" {
		videoTaskID = task.TaskID
		if !llm.TryMarkRefunded(videoTaskID) {
			log.Printf("[ProviderTask] 该上游任务 %s 的扣费已退过，跳过重复退费", videoTaskID)
			_ = s.repo.RevertRefund(ctx, id, "该笔扣费已退过，无需重复退费")
			return nil, ErrRefundNotAllowed
		}
	}
	// 退费走与自动退费完全相同的一份实现（独立 ctx + 当初真实渠道 + 同一份计费口径）
	if err := s.biller.RefundOnChannel(task.UserID, task.ChargedAmount,
		action, task.Model, scene, note, extra, task.Provider); err != nil {
		if videoTaskID != "" {
			llm.UnmarkRefunded(videoTaskID) // 钱没退成，撤掉标记，后续还能补退
		}
		// 钱没退成 → 放回待人工退费，避免「看起来退了其实没退」
		_ = s.repo.RevertRefund(ctx, id, "管理员手动退费失败，待重试: "+err.Error())
		return nil, err
	}
	if err := s.repo.MarkRefundedFromClaim(ctx, id, note); err != nil {
		// 钱已经退回用户了，只是状态没落上 —— 错误信息必须说清楚，
		// 否则管理员会以为退费失败再点一次（虽然重复退费已被 refunded_amount 挡住）
		log.Printf("[ProviderTask] ⚠️ 已退费但状态落库失败（需人工核对）: id=%d err=%v", id, err)
		return nil, fmt.Errorf("积分已退还给用户，但退费状态落库失败（请刷新查看；不要重复退费）: %w", err)
	}
	log.Printf("[ProviderTask] ✅ 管理员手动退费: id=%d taskID=%s user=%s amount=%d by=%s",
		id, task.TaskID, task.UserID, task.ChargedAmount, by)
	task.Status = StatusRefunded
	task.Note = note
	return task, nil
}

// SceneOf 计费动作对应的场景名（人工退费写账单时用，必须与扣费时的场景一致，
// 否则同一笔业务在账单里会显示成两个场景）
func SceneOf(action string) string {
	if scene, ok := actionScenes[action]; ok {
		return scene
	}
	return action
}

var actionScenes = map[string]string{
	ActionVideo:          "视频生成",
	ActionImage:          "图片生成",
	ActionStory:          "故事生成",
	ActionScript:         "分镜剧本生成",
	ActionAudio:          "音频生成",
	ActionPrevizAnalyze:  "白模场景解析",
	ActionPromptGenerate: "提示词生成",
}

// State 读一行对账（按编号）。用于两个「钱」上的判断：
//   - 扣费前：这一笔（同一执行+同一节点）是不是已经扣过了 → 重试/重投不再重复扣费；
//   - 退费前：这一笔是不是已经退过了（人工退费也算）→ 自动退费不再重复打款。
func (s *Ledger) State(ctx context.Context, taskID string) (charged, refunded int64, status string, ok bool) {
	if s == nil || s.repo == nil || taskID == "" {
		return 0, 0, "", false
	}
	items, _, err := s.repo.List(ctx, repository.ProviderTaskFilter{TaskID: taskID, Page: 1, PageSize: 5})
	if err != nil || len(items) == 0 {
		return 0, 0, "", false
	}
	for i := range items {
		if items[i].TaskID != taskID {
			continue // List 的 task_id 是模糊匹配，这里只认精确相等
		}
		return items[i].ChargedAmount, items[i].RefundedAmount, items[i].Status, true
	}
	return 0, 0, "", false
}

// AlreadyRefunded 这笔扣费是不是已经退过了（人工或自动）。自动退费打款前必须问这一句 ——
// 否则「管理员刚退过一笔进行中的、随后引擎又判定失败」就会退第二遍。
func (s *Ledger) AlreadyRefunded(ctx context.Context, taskID string) bool {
	_, refunded, status, ok := s.State(ctx, taskID)
	return ok && (refunded > 0 || status == StatusRefunded)
}
