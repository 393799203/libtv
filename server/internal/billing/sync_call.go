package billing

import (
	"context"
	"crypto/rand"
	"fmt"
	"log"
	"time"

	"libtv/internal/model"
)

// SyncCall 一次「接口层同步调用」的对账现场。
//
// 适用于前端直连的接口（白模场景解析、提示词生成）：它们不在工作流执行里，
// 既没有执行号/节点号，也没有上游任务号 —— 扣费和执行都发生在接口里。
// 但只要动了钱，就必须留下可核对、可人工处理的记录，规则与视频/图片完全一致：
//
//	上游明确拒绝（errors.Is(err, llm.ErrUpstreamRejected)）→ 自动退费
//	其余（超时 / 连接断 / 结果不完整）→ 不自动退费，进「待人工决定」，管理员在对账页处理
//
// 注意：这里不做「重试」相关的事 —— 接口层的一次调用就是一次点击，失败即返回给用户，
// 不存在队列重试重复扣费的问题（工作流内的同步节点走 engine.syncTask，那条路径要考虑重试）。
type SyncCall struct {
	Ledger   *Ledger
	Biller   *Service
	Key      string // 对账行编号，由调用方生成（没有上游任务号，只能用本地编号）
	Kind     string // 计费动作，如 ActionPromptGenerate（同时作为对账页的任务类型）
	Scene    string // 账单/退费场景名，如「提示词生成」
	Model    string
	Provider string // 渠道（账单口径）
	UserID   string
	// ProjectID 可选：直连接口（提示词/白模解析）由前端带上项目，对账页才能显示项目名。
	// 不带也能跑，只是对账行里项目为空（界面显示「-」）。
	ProjectID string
	Charged   int64
	// Resolution / Seconds 计费口径（可选，仅作展示，退费时原样回传保证账单口径一致）
	Resolution string
	Seconds    int
}

// Write 落一行对账（状态取最新，按 Key upsert）
func (c SyncCall) Write(ctx context.Context, status, note string, refunded int64) {
	if c.Ledger == nil || c.Key == "" {
		return
	}
	note = TruncateNote(note, 240)
	row := &model.ProviderTask{
		TaskID:           c.Key,
		TaskKind:         c.Kind,
		Provider:         c.Provider,
		Model:            c.Model,
		UserID:           c.UserID,
		ProjectID:        c.ProjectID,
		Status:           status,
		ChargedAmount:    c.Charged,
		RefundedAmount:   refunded,
		Note:             note,
		ChargeResolution: c.Resolution,
		ChargeSeconds:    c.Seconds,
	}
	if status == StatusRefunded {
		row.RefundSource = RefundSourceAuto
	}
	if ctx == nil {
		ctx = context.Background()
	}
	_ = c.Ledger.Record(ctx, row)
}

// Settle 调用失败后的结算，返回给用户看的错误。
//
// 文案必须与「钱退没退」一致：退了就说已退还，没退就说未自动退还、待人工复核。
func (c SyncCall) Settle(ctx context.Context, err error) error {
	detail := err.Error()
	extra := ChargeExtra{Resolution: c.Resolution, Seconds: c.Seconds}

	if !ShouldAutoRefund(err) {
		msg := fmt.Errorf("%s；本次扣费未自动退还，已提交人工复核，确认失败后会原路退还", detail)
		c.Write(detached(ctx), StatusPendingReview, msg.Error(), 0)
		return msg
	}

	// 上游明确拒绝：任务没被受理/被判失败，上游不计费 → 立即退还
	if c.Biller == nil || c.Charged <= 0 {
		msg := fmt.Errorf("%s；需人工核对（缺少可退金额）", detail)
		c.Write(detached(ctx), StatusPendingReview, msg.Error(), 0)
		return msg
	}
	reason := AutoRefundReason(detail)
	if refundErr := c.Biller.RefundDetached(detached(ctx), c.UserID, c.Charged, c.Kind, c.Model, c.Scene, reason, extra); refundErr != nil {
		log.Printf("[%s] 自动退费失败（转人工）: %v", c.Scene, refundErr)
		msg := fmt.Errorf("%s；自动退费失败，已提交人工复核", detail)
		c.Write(detached(ctx), StatusPendingReview, msg.Error(), 0)
		return msg
	}
	c.Write(detached(ctx), StatusRefunded, reason, c.Charged)
	return fmt.Errorf("%s（本次扣费已退还，可直接重新生成）", detail)
}

// detached 对账/退费必须能在原请求 ctx 已取消的情况下落下去
func detached(ctx context.Context) context.Context {
	if ctx == nil {
		return context.Background()
	}
	return context.WithoutCancel(ctx)
}

// NewSyncKey 生成「接口层同步调用」的对账行编号：<前缀>:<对象>:<纳秒>:<随机4位>。
//
// 为什么带随机后缀：时间戳在 macOS 上只有微秒精度，同一用户并发两个请求可能撞号 ——
// 撞号后 upsert 会把两笔扣费写成同一行（账面少一笔，退费也只能退一笔）。
// 这类接口没有上游任务号、也没有执行号，编号必须自己造且不能撞。
func NewSyncKey(prefix, subject string) string {
	var buf [2]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return fmt.Sprintf("%s:%s:%d", prefix, subject, time.Now().UnixNano())
	}
	return fmt.Sprintf("%s:%s:%d:%x", prefix, subject, time.Now().UnixNano(), buf)
}
