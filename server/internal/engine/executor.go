package engine

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"libtv/internal/billing"
	"log"
	"math"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"libtv/internal/apperr"
	"libtv/internal/llm"
	"libtv/internal/model"
	"libtv/internal/service"
)

// NodeOutput 节点执行输出
type NodeOutput struct {
	NodeID string                 `json:"nodeId"`
	Status string                 `json:"status"` // success / failed
	Data   map[string]interface{} `json:"data"`
	Error  string                 `json:"error,omitempty"`
}

// ---------- 同步调用的对账（图片/文本/剧本/故事/音频）----------
//
// 为什么同步调用也要落对账：它们的失败形态和视频一样 —— 请求挂到超时、连接断掉、
// 被中断，这时我们并不知道上游有没有生成、有没有计费。规则必须一致：
// 上游明确报错 → 自动退费；其余（超时/拿不到结果）→ 不自动退，进「待人工决定」。
// 区别只在编号：同步调用没有上游任务号，用「执行 + 节点」当 key（同一节点重试只更新同一行）。

// syncTask 一次同步调用的对账现场
type syncTask struct {
	Ledger     *billing.Ledger
	Action     string // billing.ActionX
	Scene      string // 账单/退费场景名，如「图片生成」
	Model      string
	Provider   string // 渠道（账单口径）
	Resolution string // 计费口径（图片=尺寸），无则空
	Seconds    int    // 计费口径（音频=字数折算秒），无则 0
	Charged    int64
	// ChargeKey 这一笔扣费的唯一编号 —— **对账行的身份**，扣费那一刻生成、此后永不改变。
	// 没有它时行的身份是「sync:执行:节点」，拿到上游任务号后又被改写成任务号：
	// 同一节点在同一次执行里被扣两次费时，第二次写入会挤进第一行并覆盖金额（线上出现过）。
	ChargeKey string
	ExecID    int64
	NodeID    string
}

// newSyncTask 组装一次同步调用的对账现场（provider 从 ctx 的渠道取）
func newSyncTask(ledger *billing.Ledger, ctx context.Context, execCtx *ExecutionContext, action, scene, model, resolution string, charged int64) syncTask {
	t := syncTask{
		Ledger:     ledger,
		Action:     action,
		Scene:      scene,
		Model:      model,
		Provider:   llm.ChannelFrom(ctx),
		Resolution: resolution,
		Charged:    charged,
		// 行身份 = 扣费编号，必须与账单分录同一把（从 ctx 取）。
		// ctx 里没有才自己生成：保证老调用路径行为不变。
		ChargeKey: chargeKeyForRow(ctx),
	}
	if execCtx != nil {
		t.ExecID = execCtx.GetExecutionID()
	}
	return t
}

// key 历史对账行编号（sync:执行:节点）。
// 仅用于兼容本次改动前写入的老行：新行的身份是 ChargeKey，不再用这个编号。
func (t syncTask) key(nodeID string) string {
	return fmt.Sprintf("sync:%d:%s", t.ExecID, nodeID)
}

// lookupKey 查询对账行时用的键：优先 charge_key，老行退回 sync 编号
func (t syncTask) lookupKey(nodeID string) string {
	if t.ChargeKey != "" {
		return t.ChargeKey
	}
	return t.key(nodeID)
}

// noteMaxBytes 备注最终落库的长度上限（字节，且不切半个汉字）。
//
// 原先是 240 字节，中文一个字 3 字节 —— 相当于只留 80 个汉字，而「上游明确拒绝本次任务，
// 自动退还本次扣费: 」这句前缀就占掉 28 个字，上游报错只剩几十个字，管理员看到的备注
// 是被切掉的半句。现在放到 1000 字节（≈330 汉字 / 1000 英文），
// 对应列宽 varchar(1200)，字节数永远小于字符数，不会写爆列。
const noteMaxBytes = 1000

// write 落一行对账
func (t syncTask) write(ctx context.Context, execCtx *ExecutionContext, nodeID, status, note string, refunded int64, resultURL string) {
	if t.Ledger == nil {
		return
	}
	note = billing.TruncateNote(note, noteMaxBytes)
	// 行身份 = charge_key；同步调用没有上游任务号，task_id 就一直是空。
	// （以前这里塞的是自造的 sync:执行:节点，界面还得专门认出来别当任务号展示）
	// t.ChargeKey 为空只可能是历史遗留调用路径 → 退回老的 sync 编号，行为不变。
	taskID := ""
	if t.ChargeKey == "" {
		taskID = t.key(nodeID)
	}
	row := &model.ProviderTask{
		TaskID:           taskID,
		ChargeKey:        t.ChargeKey,
		TaskKind:         t.Action,
		Provider:         t.Provider,
		Model:            t.Model,
		ExecID:           t.ExecID,
		NodeID:           nodeID,
		Status:           status,
		ChargedAmount:    t.Charged,
		RefundedAmount:   refunded,
		Note:             note,
		ChargeResolution: t.Resolution,
		ChargeSeconds:    t.Seconds,
		ResultURL:        resultURL,
	}
	if status == billing.StatusRefunded {
		row.RefundSource = billing.RefundSourceAuto
	}
	if execCtx != nil {
		row.UserID = execCtx.GetUserID()
		row.ProjectID = execCtx.GetProjectID()
	}
	// 上游真实消耗（对账成本侧）：采集器挂在 ctx 上，谁拿到响应谁登记（见 llm/usage.go）
	row.ProviderTokens, _, row.ProviderUsage, _ = llm.UsageFrom(ctx).Snapshot()
	_ = t.Ledger.Record(detachedCtx(ctx), row)
}

// settleFailure 同步调用失败的结算：唯一判定入口 billing.ShouldAutoRefund。
//
// 返回给用户的失败原因（文案必须与「钱退没退」一致）：
//   - 上游明确报错 → 自动退费，文案说「已退还」
//   - 其余（超时 / 连接断 / 没拿到结果）→ 不自动退，进「待人工决定」，文案说「未自动退还」
//
// 并在「不自动退」时把这个节点标成不可重试：否则队列重试会**再扣一次费**，
// 用户就为一次失败付两遍钱（视频路径早有同样的处理，见 isNoRetryVideoFailure）。
func (t syncTask) settleFailure(ctx context.Context, biller *billing.Service, execCtx *ExecutionContext, nodeID string, err error) error {
	detail := err.Error()
	if !billing.ShouldAutoRefund(err) {
		if execCtx != nil {
			execCtx.MarkNonRetryable()
		}
		msg := fmt.Errorf("%s；本次扣费未自动退还，已提交人工复核，确认失败后会原路退还", detail)
		t.write(ctx, execCtx, nodeID, billing.StatusPendingReview, msg.Error(), 0, "")
		return msg
	}
	// 上游明确拒绝：任务没被受理/被判失败，上游不计费 → 立即退还
	if biller == nil || t.Charged <= 0 {
		msg := fmt.Errorf("%s；需人工核对（缺少可退金额）", detail)
		t.write(ctx, execCtx, nodeID, billing.StatusPendingReview, msg.Error(), 0, "")
		return msg
	}
	// 管理员可能刚刚在对账页手动退过这一笔 —— 再自动退一次就是同一笔钱退两遍
	if t.Ledger != nil && t.Ledger.AlreadyRefunded(detachedCtx(ctx), t.lookupKey(nodeID)) {
		log.Printf("[%s] 这一笔扣费已退过（人工或自动），跳过自动退费: node=%s", t.Scene, nodeID)
		if execCtx != nil {
			execCtx.MarkNonRetryable()
		}
		t.write(ctx, execCtx, nodeID, billing.StatusRefunded, detail+"；该笔扣费此前已退还", t.Charged, "")
		return fmt.Errorf("%s（本次扣费此前已退还）", detail)
	}
	// 退费与扣费必须带同一把 charge_key：这样「同一笔生成」的扣费/退费两条账单分录
	// 才能在对账里被归到一起，金额也能精确核对
	extra := billing.ChargeExtra{Resolution: t.Resolution, Seconds: t.Seconds, ChargeKey: t.ChargeKey}
	reason := billing.AutoRefundReason(detail)
	if refundErr := biller.RefundDetached(ctx, execCtx.GetUserID(), t.Charged, t.Action, t.Model, t.Scene, reason, extra); refundErr != nil {
		log.Printf("[%s] 自动退费失败（转人工）: %v", t.Scene, refundErr)
		if execCtx != nil {
			execCtx.MarkNonRetryable()
		}
		msg := fmt.Errorf("%s；自动退费失败，已提交人工复核", detail)
		t.write(ctx, execCtx, nodeID, billing.StatusPendingReview, msg.Error(), 0, "")
		return msg
	}
	t.write(ctx, execCtx, nodeID, billing.StatusRefunded, reason, t.Charged, "")
	// 钱退了也要标记「不自动重试」：队列重试会重新扣一次费，用户就为同一次点击付两遍
	// （文案说「可直接重新生成」，那也该由用户自己决定要不要再来一次）
	if execCtx != nil {
		execCtx.MarkNonRetryable()
	}
	return fmt.Errorf("%s（本次扣费已退还，可直接重新生成）", detail)
}

// chargeAlreadyDone 这一笔（同一执行 + 同一节点）是不是已经扣过费了。
//
// 为什么必须有：队列重投、worker 被杀后锁过期重领、服务重启续跑，都会把**同一个节点**
// 再跑一遍。执行器每次都无条件扣费 → 同一个点击被扣两遍（对账行还会被第二次覆盖，
// 账面看着只有一笔）。扣费前先查一次，扣过就直接沿用那笔金额，本次不再扣。
func chargeAlreadyDone(ledger *billing.Ledger, ctx context.Context, execID int64, nodeID string) (int64, string, bool) {
	row, ok := activeChargeByNode(ledger, ctx, execID, nodeID)
	if !ok {
		return 0, "", false
	}
	return row.ChargedAmount, row.ChargeKey, true
}

// chargeKeyForRow 写对账行要用的扣费编号：优先 ctx（与账单分录同一把编号），没有才新生成。
func chargeKeyForRow(ctx context.Context) string {
	if key := billing.ChargeKeyFrom(ctx); key != "" {
		return key
	}
	return billing.NewChargeKey()
}

// activeChargeByNode 同一执行 + 同一节点上「还没退费」的那一笔扣费（最新一条）。
//
// 为什么按 exec+node 查而不是按编号查（这里踩过坑）：老行的编号在拿到上游任务号后
// 被改写过，按老编号根本查不到那一行 —— 判断也就失效了。按执行+节点查，老行新行都认。
func activeChargeByNode(ledger *billing.Ledger, ctx context.Context, execID int64, nodeID string) (*model.ProviderTask, bool) {
	if ledger == nil || execID == 0 || nodeID == "" {
		return nil, false
	}
	return ledger.ActiveChargeByNode(detachedCtx(ctx), execID, nodeID)
}

// isNoRetryVideoFailure 判断视频节点的这次失败是否「重试有害」。
//
// 命中条件都满足同一个前提：**本次扣费已经退还给用户、界面也已经显示失败**。
// 此时自动重试只有两种结局，都不是用户想要的：
//   - 重新下发 → 重新扣费：用户从没要求过第二次生成，却被动付了第二次钱；
//   - 复用那个仍在跑的上游任务 → 不扣费拿到视频：白送一次生成。
//
// 因此这类失败一律交给用户自己决定是否重试。
//
// 具体三类：
//   - ErrVideoPollTimeout：上游一直在 processing，轮询预算用尽（本轮新增 25 分钟预算）；
//   - DeadlineExceeded：执行自身的 30 分钟预算耗尽（此时轮询预算还没走完）；
//   - Canceled：用户主动停止生成 —— 停止更不该被队列自动重跑。
func isNoRetryVideoFailure(err error) bool {
	return errors.Is(err, llm.ErrVideoPollTimeout) ||
		errors.Is(err, context.DeadlineExceeded) ||
		errors.Is(err, context.Canceled)
}

// videoFailureMessage 把底层的超时/中断错误翻译成用户看得懂、也知道下一步怎么做的话。
//
// 原来的裸错误是 "context deadline exceeded" —— 用户既不知道是上游没响应、还是平台掐了任务，
// 也不知道钱退没退。用 %w 保留原始错误链，isNoRetryVideoFailure / errors.Is 判断不受影响。
// videoFailureMessage 把底层错误翻成能给人看的失败原因。
//
// 文案必须跟着退费规则走（退款规则：只有上游明确拒绝才自动退费，其余待人工复核）：
// 说「已退还」的话就绝不能出现「其实没退」，否则用户按文案去查余额会觉得被骗。
func videoFailureMessage(ctx context.Context, err error) error {
	// 上游明确拒绝：这类才自动退费
	if errors.Is(err, llm.ErrUpstreamRejected) {
		return fmt.Errorf("%w（本次扣费已退还，可直接重新生成）", err)
	}
	switch {
	case errors.Is(err, llm.ErrVideoPollTimeout):
		// 轮询预算用尽 = 上游一直在生成中，钱不退（上游可能已经在计费），交人工复核
		return fmt.Errorf("%w；本次扣费未自动退还，已提交人工复核，确认失败后会原路退还", err)
	case errors.Is(err, context.Canceled):
		return fmt.Errorf("生成被中断（服务重启或任务被取消）；本次扣费未自动退还，已提交人工复核，确认失败后会原路退还（原始错误: %w）", err)
	case errors.Is(err, context.DeadlineExceeded):
		// 两种超时要分开说：执行预算（30 分钟）耗尽 vs 上游请求无响应
		if ctx != nil && errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return fmt.Errorf("本次生成超过执行时限被终止；本次扣费未自动退还，已提交人工复核，确认失败后会原路退还（原始错误: %w）", err)
		}
		return fmt.Errorf("上游视频服务无响应（创建任务请求超时 %s，已重试一次）；本次扣费未自动退还，已提交人工复核，确认失败后会原路退还（原始错误: %w）",
			llm.VideoCreateTimeout, err)
	}
	return err
}

// refundCharge 退还视频节点的一次扣费，并保证「同一个上游任务对应的那笔扣费」只退一次。
//
// taskID 为该次扣费对应的上游任务号（提交阶段就失败、还没拿到任务号时传空）。
// 三层保护叠加，缺一条都会漏钱：
//  1. 调用方先 TakeAsyncTaskRef（GETDEL）认领登记 —— 并发副本里只有一个拿得到；
//  2. 这里以任务号为幂等键 SETNX —— 拦住「重试复用同一登记再退一次」这类顺序重复；
//  3. 退费成功后由调用方消费掉登记 —— 登记只能对应一笔尚未退还的扣费。
func (v *VideoExecutor) refundCharge(ctx context.Context, execCtx *ExecutionContext, taskID string, amount int64, model, reason string, extra billing.ChargeExtra) error {
	// 上游任务号随退费账单永久落库：任务登记（Redis，24h）在退费成功后就被消费掉了，
	// 不留这一笔，事后就无法向渠道核对「这次失败到底有没有让上游接单并计费」，
	// 也找不回上游可能已经产出的结果（线上实例：10-03 00:04 那次超时中断）。
	extra.TaskID = taskID
	if !llm.TryMarkRefunded(taskID) {
		log.Printf("[VideoExecutor] 上游任务 %s 的扣费已退过，跳过重复退费（node 无关）", taskID)
		return nil
	}
	if err := v.biller.RefundDetached(ctx, execCtx.GetUserID(), amount, billing.ActionVideo, model, "视频生成", reason, extra); err != nil {
		// 退费没成功 → 撤掉幂等标记，后续重试还能补退（否则这笔钱就永远退不掉了）
		llm.UnmarkRefunded(taskID)
		return err
	}
	return nil
}

// recordLocalCharge 按 charge_key 写/更新视频这一笔扣费的对账行。
//
// 行的身份是扣费时生成的 charge_key（不可变），task_id 只是行上的一个属性：
//   - 扣费后立刻调用一次：状态「进行中」—— 从这一刻起这笔钱在对账页上就是可见的，
//     进程即使随后被杀，管理员也知道有这笔钱、能手动处理（以前是等到任务号到手才写，
//     中间那段时间账上是空白）；
//   - 创建请求超时/连接中断（压根没拿到任务号）时再调用一次，更新成失败/已退费；
//   - 拿到任务号后由 recordProviderTask 往同一行补 task_id。
func (v *VideoExecutor) recordLocalCharge(ctx context.Context, execCtx *ExecutionContext, nodeID, modelName string, charged int64, detail billing.ChargeExtra, status, note string, refunded int64) {
	if v.providerTasks == nil {
		return
	}
	note = billing.TruncateNote(note, noteMaxBytes)
	// 行身份 = charge_key（不可变）；task_id 只在真拿到上游任务号时才有值
	row := &model.ProviderTask{
		TaskID:           detail.TaskID,
		ChargeKey:        detail.ChargeKey,
		TaskKind:         billing.ActionVideo,
		Provider:         execCtx.GetChannel(),
		Model:            modelName,
		ExecID:           execCtx.GetExecutionID(),
		NodeID:           nodeID,
		UserID:           execCtx.GetUserID(),
		ProjectID:        execCtx.GetProjectID(),
		Status:           status,
		ChargedAmount:    charged,
		RefundedAmount:   refunded,
		Note:             note,
		ChargeResolution: detail.Resolution,
		ChargeSeconds:    detail.Seconds,
		ChargeRefSeconds: detail.RefVideoSeconds,
	}
	if status == billing.StatusRefunded {
		row.RefundSource = billing.RefundSourceAuto
	}
	_ = v.providerTasks.Record(detachedCtx(ctx), row)
}

// handleDownloadFailure 处理「视频已生成、但转存到自有存储失败」。
//
// 这里刻意不做「退费用临时 URL 顶成功」：上游 URL 会过期，那是假成功。
// 策略按失败次数分档（计数存在任务登记里，跨队列重试累计）：
//   - 第 1 次：保留任务登记直接失败 —— 队列重试会命中登记、复用这个**已完成的上游任务**
//     重新转存（不重新下发、不重新扣费），这是最省用户钱又能真正交付的路径；
//   - 达到上限（downloadFailureLimit）：消费登记 + 标记不自动重试，扣的费不自动退 ——
//     上游明明出了片（钱也花了），只是我们没转存下来，按规则交人工复核（对账行里有任务号、
//     金额、口径和上游原始产物地址）。
func (v *VideoExecutor) handleDownloadFailure(ctx context.Context, execCtx *ExecutionContext, nodeID, model, upstreamURL string, dlErr error, taskRef *llm.AsyncTaskRef, chargeDetail billing.ChargeExtra) (*NodeOutput, error) {
	const downloadFailureLimit = 2

	failures := 0
	if taskRef != nil {
		taskRef.DownloadFailures++
		failures = taskRef.DownloadFailures
		// 落盘累计次数：队列重试时通过登记读回来，才能判断是否已达上限
		llm.SaveAsyncTaskRef(taskRef)
	}
	log.Printf("[VideoExecutor] ❌ 视频已生成但转存失败（累计第 %d/%d 次）: upstream=%s err=%v",
		failures, downloadFailureLimit, upstreamURL, dlErr)

	msg := fmt.Sprintf("视频已生成，但转存到自有存储失败（第 %d/%d 次）：%v", failures, downloadFailureLimit, dlErr)
	if failures < downloadFailureLimit {
		// 交给队列重试：复用同一个上游任务重新转存，不重新扣费
		msg += "；系统将自动重试转存（不会重复扣费）"
		return &NodeOutput{NodeID: nodeID, Status: "failed", Error: msg}, nil
	}

	// 反复失败 → 交人工复核：上游已经出片（钱也花了），退不退不能由我们单方面决定
	msg += "；本次扣费未自动退还，已提交人工复核，确认失败后会原路退还"
	execCtx.MarkNonRetryable()
	// 退费金额优先用登记里记的那笔扣费；登记缺失（异常情况）时退不了就只报错，不猜金额
	amount := taskRef.ChargedAmount
	_ = chargeDetail
	if amount > 0 {
		// 不自动退费：上游明明出了片（钱也花了），只是我们没转存下来 —— 这不是「上游拒绝」，
		// 按规则交人工复核（对账表里已有任务号、金额与口径），避免白付上游一次。
		if claimed := llm.TakeAsyncTaskRef(execCtx.GetExecutionID(), nodeID); claimed != nil {
			log.Printf("[VideoExecutor] 已消费任务登记（转存失败收场，不自动退费）: taskID=%s amount=%d", claimed.TaskID, amount)
		}
		// 转存失败了，但上游地址仍然有效 —— 记下来，人工复核时点得开
		taskRef.ProviderURL = upstreamURL
		v.recordProviderTask(ctx, execCtx, taskRef, billing.StatusPendingReview, msg, 0)
	}
	return &NodeOutput{NodeID: nodeID, Status: "failed", Error: msg}, nil
}

// ExecutionContext 执行上下文（节点间数据传递）
type ExecutionContext struct {
	mu      sync.RWMutex
	outputs map[string]*NodeOutput
	// upstreamByTarget target 节点 ID -> 上游 source 节点 ID 列表
	// 节点执行器可借此从 execCtx.GetUpstreamSources(n.ID) 拿到所有上游节点 ID，
	// 再配合 execCtx.GetNodeData(...) 拿到上游节点的原始 data。
	upstreamByTarget map[string][]string
	// nodeDataByID 全图所有节点的原始 data（来自 plan.Schema.Nodes），
	// 即便是没被本次执行选中（不在 Levels 里）的节点，data 也保留在此供执行器参考。
	nodeDataByID map[string]json.RawMessage
	// projectID 项目ID，用于确定存储路径
	projectID string
	// userID 项目属主用户ID，画布文件存到 users/<userID>/canvas/<projectID>/
	userID string
	// channel 项目属主用户的 AI 渠道（wasu/dianxin，经全局策略解析后的最终渠道）
	channel string
	// executionID 本次执行ID（异步任务登记 / 重启续跑复用已提交任务时用于定位）
	executionID int64
	// nonRetryable 本次执行出现了「重试有害」的失败（见 MarkNonRetryable）
	nonRetryable bool
	// nodeProgress 节点当前进度文案（由节点执行器写入，如「上游处理中 62%」），
	// 引擎的 10s 进度心跳会带上它，界面因此能看到上游的真实进展而不只是"已运行 Ns"
	nodeProgress map[string]string
}

// SetNodeProgress 记录某节点的进度文案（给心跳用）
func (ec *ExecutionContext) SetNodeProgress(nodeID, msg string) {
	if nodeID == "" || msg == "" {
		return
	}
	ec.mu.Lock()
	defer ec.mu.Unlock()
	if ec.nodeProgress == nil {
		ec.nodeProgress = make(map[string]string)
	}
	ec.nodeProgress[nodeID] = msg
}

// GetNodeProgress 取某节点的进度文案（没有则返回空串）
func (ec *ExecutionContext) GetNodeProgress(nodeID string) string {
	ec.mu.RLock()
	defer ec.mu.RUnlock()
	return ec.nodeProgress[nodeID]
}

// MarkNonRetryable 标记本次执行失败后**不要重试**。
//
// 供节点执行器在「失败已经收口（扣费已退、用户已看到失败），重试反而会更糟」时调用：
// 典型是上游视频任务轮询超时 —— 自动重试要么重新下发重新扣费（用户以为失败却扣两次），
// 要么复用那个仍在跑的上游任务（不扣费拿到视频 = 免费出片）。
// 引擎在层失败返回时会据此给错误打上 apperr.ErrNoRetry，队列识别后不再安排重试。
func (ec *ExecutionContext) MarkNonRetryable() {
	ec.mu.Lock()
	defer ec.mu.Unlock()
	ec.nonRetryable = true
}

// NonRetryable 本次执行是否被标记为「失败后不重试」
func (ec *ExecutionContext) NonRetryable() bool {
	ec.mu.RLock()
	defer ec.mu.RUnlock()
	return ec.nonRetryable
}

func NewExecutionContext() *ExecutionContext {
	return &ExecutionContext{
		outputs:          make(map[string]*NodeOutput),
		upstreamByTarget: make(map[string][]string),
		nodeDataByID:     make(map[string]json.RawMessage),
		nodeProgress:     make(map[string]string),
		projectID:        "",
		userID:           "",
	}
}

func (ec *ExecutionContext) SetOutput(nodeID string, output *NodeOutput) {
	ec.mu.Lock()
	defer ec.mu.Unlock()
	ec.outputs[nodeID] = output
}

func (ec *ExecutionContext) GetOutput(nodeID string) (*NodeOutput, bool) {
	ec.mu.RLock()
	defer ec.mu.RUnlock()
	out, ok := ec.outputs[nodeID]
	return out, ok
}

// SetUpstreamMap 设置全图的上游关系（target -> [source, ...]）。
// 由调度器在执行前一次性写入，节点执行器通过 GetUpstreamSources 查自己节点的上游。
func (ec *ExecutionContext) SetUpstreamMap(m map[string][]string) {
	ec.mu.Lock()
	defer ec.mu.Unlock()
	ec.upstreamByTarget = m
}

// GetUpstreamSources 拿指定节点的所有上游 source 节点 ID（按 connections 顺序）。
func (ec *ExecutionContext) GetUpstreamSources(targetNodeID string) []string {
	ec.mu.RLock()
	defer ec.mu.RUnlock()
	src := ec.upstreamByTarget[targetNodeID]
	out := make([]string, len(src))
	copy(out, src)
	return out
}

// SetNodeDataMap 一次性写入全图所有节点的原始 data，让执行器可以读到上游节点 data。
func (ec *ExecutionContext) SetNodeDataMap(m map[string]json.RawMessage) {
	ec.mu.Lock()
	defer ec.mu.Unlock()
	ec.nodeDataByID = m
}

// GetNodeData 拿指定节点的原始 data（json.RawMessage）。计划只跑目标节点，
// 其余节点不会被执行，但其 data 已保存在此，可供执行器作为输入参考
// （上游已生成的 videoUrl/imageUrl 就是从这里读到的）。
func (ec *ExecutionContext) GetNodeData(nodeID string) (json.RawMessage, bool) {
	ec.mu.RLock()
	defer ec.mu.RUnlock()
	data, ok := ec.nodeDataByID[nodeID]
	return data, ok
}

// SetProjectID 设置项目ID
func (ec *ExecutionContext) SetProjectID(projectID string) {
	ec.mu.Lock()
	defer ec.mu.Unlock()
	ec.projectID = projectID
}

// GetProjectID 获取项目ID
func (ec *ExecutionContext) GetProjectID() string {
	ec.mu.RLock()
	defer ec.mu.RUnlock()
	return ec.projectID
}

// SetUserID 设置项目属主用户ID
func (ec *ExecutionContext) SetUserID(userID string) {
	ec.mu.Lock()
	defer ec.mu.Unlock()
	ec.userID = userID
}

// GetUserID 获取项目属主用户ID（执行器扣费用）
func (ec *ExecutionContext) GetUserID() string {
	ec.mu.RLock()
	defer ec.mu.RUnlock()
	return ec.userID
}

// SetChannel 设置项目属主用户的 AI 渠道（wasu/dianxin，经全局策略解析后的最终渠道）
func (ec *ExecutionContext) SetChannel(channel string) {
	ec.mu.Lock()
	defer ec.mu.Unlock()
	ec.channel = channel
}

// SetExecutionID 设置本次执行ID。
// 异步生成任务（视频）按「执行ID + 节点ID」登记已提交的上游 taskID，
// 进程重启续跑时据此接着取结果，而不是重新下发一次。
func (ec *ExecutionContext) SetExecutionID(executionID int64) {
	ec.mu.Lock()
	defer ec.mu.Unlock()
	ec.executionID = executionID
}

// GetExecutionID 获取本次执行ID
func (ec *ExecutionContext) GetExecutionID() int64 {
	ec.mu.RLock()
	defer ec.mu.RUnlock()
	return ec.executionID
}

// GetChannel 获取用户 AI 渠道；未设置时回退 wasu
func (ec *ExecutionContext) GetChannel() string {
	ec.mu.RLock()
	defer ec.mu.RUnlock()
	if ec.channel == "" {
		return "wasu"
	}
	return ec.channel
}

// GetCanvasDir 返回画布文件的存储目录前缀：
// 有 userID 时存 users/<userID>/canvas（落到用户目录，删用户时级联清理），
// 否则降级存公共 canvas 目录（历史兼容）
func (ec *ExecutionContext) GetCanvasDir() string {
	ec.mu.RLock()
	defer ec.mu.RUnlock()
	if ec.userID != "" {
		return "users/" + ec.userID + "/canvas"
	}
	return "canvas"
}

// NodeExecutor 节点执行器接口
type NodeExecutor interface {
	Execute(ctx context.Context, node WorkflowNode, execCtx *ExecutionContext) (*NodeOutput, error)
}

// ExecutorRegistry 执行器注册表
type ExecutorRegistry struct {
	executors map[string]NodeExecutor
}

func NewExecutorRegistry() *ExecutorRegistry {
	return &ExecutorRegistry{
		executors: make(map[string]NodeExecutor),
	}
}

func (r *ExecutorRegistry) Register(nodeType string, executor NodeExecutor) {
	r.executors[nodeType] = executor
}

func (r *ExecutorRegistry) Get(nodeType string) (NodeExecutor, bool) {
	exec, ok := r.executors[nodeType]
	return exec, ok
}

// WorkflowEngine 工作流执行引擎
type WorkflowEngine struct {
	registry *ExecutorRegistry
	// lastOutputs 保留给 sync writer 同步使用
	lastOutputs map[string]*NodeOutput
	// subscribers 多播：每个 SSE 连接订阅一份
	mu          sync.Mutex
	subscribers map[int64]map[chan WorkflowEvent]struct{} // executionID -> set of chans
	// channelResolver 解析用户最终 AI 渠道（全局策略 + 用户渠道）；nil 时回退 wasu
	channelResolver func(ctx context.Context, userID string) string
	// nodeOutputHook 单个节点一有结果就落库的钩子（由 handler 注入，见 SetNodeOutputHook）
	nodeOutputHook func(ctx context.Context, projectID string, out *NodeOutput)
	// creditsReplay 每条执行「最后一条余额变动事件」。
	// 为什么需要：扣费发生在引擎开始跑节点的那一刻，而前端要等 execute 响应回来才建立 SSE 流 ——
	// 扣费早于建流时那条事件没有订阅者、按设计被丢弃，前端界面就停在旧余额上。
	// 缓存一条，谁建流就补发给谁：这样「点生成 → 扣费 → 余额立刻变」不依赖时间窗口，
	// 前端也不需要另外去查一次余额。
	creditsReplay map[int64]creditsReplayItem
}

func NewWorkflowEngine(registry *ExecutorRegistry) *WorkflowEngine {
	return &WorkflowEngine{
		registry:      registry,
		subscribers:   make(map[int64]map[chan WorkflowEvent]struct{}),
		creditsReplay: make(map[int64]creditsReplayItem),
	}
}

// SetChannelResolver 设置渠道路由回调（由 main.go 注入：全局策略 + 用户渠道 → 最终渠道）
func (e *WorkflowEngine) SetChannelResolver(fn func(ctx context.Context, userID string) string) {
	e.channelResolver = fn
}

// SetNodeOutputHook 注入「单个节点产出后立即落库」的钩子（handler 注入：把该节点产物写进画布）。
//
// 为什么要即时落库：原来所有节点产物只在 Execute 全部结束时由 handler 一次性写画布，
// 中间任何一件事出问题（进程被杀、执行超时、上游卡死、队列重投）都会让
// 「已经生成并上传到对象存储的结果」只活在内存里 —— 画布仍旧是 running，
// 用户看到的就是「明明生成了还说生成中」，看门狗/重启续跑也拿不到任何凭据。
func (e *WorkflowEngine) SetNodeOutputHook(fn func(ctx context.Context, projectID string, out *NodeOutput)) {
	e.nodeOutputHook = fn
}

// recordNodeOutput 节点一有结果立即落库（成功/失败都算）。
//
// 用独立 ctx + 短超时：执行 ctx 可能已经取消（用户停止/执行超时/进程关停），
// 但「把这个节点的真相写下去」必须完成，否则又回到「状态没跟上」的老问题。
func (e *WorkflowEngine) recordNodeOutput(projectID string, out *NodeOutput) {
	if e.nodeOutputHook == nil || out == nil || projectID == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	e.nodeOutputHook(ctx, projectID, out)
}

// Subscribe 订阅某个 execution 的事件。返回只读 channel；调用方在断开时调 Unsubscribe。
func (e *WorkflowEngine) Subscribe(executionID int64) <-chan WorkflowEvent {
	ch := make(chan WorkflowEvent, 64)
	e.mu.Lock()
	if e.subscribers[executionID] == nil {
		e.subscribers[executionID] = make(map[chan WorkflowEvent]struct{})
	}
	e.subscribers[executionID][ch] = struct{}{}
	e.pruneCreditsReplayLocked()
	// 补发最后一条余额变动：扣费早于建流时，那条事件当时没人接收，这里补上
	if item, ok := e.creditsReplay[executionID]; ok {
		select {
		case ch <- item.event: // 通道容量 64，非阻塞发送
			// 留下证据：说明这次余额是「建流晚于扣费」时由补发送到的
			log.Printf("[Engine] 补发余额变动: exec=%d（扣费早于建流）", executionID)
		default:
		}
	}
	e.mu.Unlock()
	return ch
}

// Unsubscribe 取消订阅并关闭 channel
func (e *WorkflowEngine) Unsubscribe(executionID int64, ch <-chan WorkflowEvent) {
	e.mu.Lock()
	defer e.mu.Unlock()
	subs := e.subscribers[executionID]
	if subs == nil {
		return
	}
	for c := range subs {
		if c == ch {
			delete(subs, c)
			close(c)
			break
		}
	}
	if len(subs) == 0 {
		delete(e.subscribers, executionID)
	}
}

// LastOutputs 返回最近一次 Execute 收集到的所有节点输出
func (e *WorkflowEngine) LastOutputs() map[string]*NodeOutput {
	e.mu.Lock()
	defer e.mu.Unlock()
	out := make(map[string]*NodeOutput, len(e.lastOutputs))
	for k, v := range e.lastOutputs {
		out[k] = v
	}
	return out
}

// Execute 执行工作流（userID 为项目属主，画布文件存到 users/<userID>/canvas/<projectID>/）
func (e *WorkflowEngine) Execute(ctx context.Context, plan *ExecutionPlan, executionID int64, projectID string, userID string) error {
	log.Printf("[Engine] Execute start: executionID=%d, projectID=%s, userID=%s, plan levels=%d, totalNodes=%d", executionID, projectID, userID, len(plan.Levels), len(plan.Schema.Nodes))
	execCtx := NewExecutionContext()

	// 设置项目ID与属主用户ID，供节点执行器使用（确定存储路径）
	execCtx.SetProjectID(projectID)
	execCtx.SetUserID(userID)
	// 本次执行ID：异步生成任务按「执行ID+节点ID」登记上游 taskID，供重启续跑复用
	execCtx.SetExecutionID(executionID)

	// 解析用户最终 AI 渠道（全局策略 + 用户渠道），供执行器调用 LLM 时选择 token 渠道
	if e.channelResolver != nil {
		execCtx.SetChannel(e.channelResolver(ctx, userID))
		log.Printf("[Engine] user channel resolved: userID=%s channel=%s", userID, execCtx.GetChannel())
	} else {
		log.Printf("[Engine] channelResolver 未配置，默认渠道 wasu")
	}

	// 构造上游映射表（target -> [source, ...]），供 ScriptExecutor 等需要读上游的节点使用
	upstreamByTarget := make(map[string][]string, len(plan.Schema.Connections))
	for _, c := range plan.Schema.Connections {
		upstreamByTarget[c.Target] = append(upstreamByTarget[c.Target], c.Source)
	}
	execCtx.SetUpstreamMap(upstreamByTarget)

	// 把全图所有节点的原始 data 写进 execCtx（即便不在本次执行的 Levels 里）
	// 让执行器可以读到上游节点的最新 data（来自画布，已包含上一次执行结果）
	nodeDataByID := make(map[string]json.RawMessage, len(plan.Schema.Nodes))
	for _, n := range plan.Schema.Nodes {
		nodeDataByID[n.ID] = n.Data
	}
	execCtx.SetNodeDataMap(nodeDataByID)

	e.emit(WorkflowEvent{
		ExecutionID: executionID,
		EventType:   EventExecutionStart,
		Timestamp:   time.Now().UnixMilli(),
	})

	// 收集本次执行的所有输出，供外部回写画布
	outputs := make(map[string]*NodeOutput)

	// 打印 plan 概览，方便排查"是不是在重跑上游"
	for levelIdx, level := range plan.Levels {
		ids := make([]string, 0, len(level))
		for _, n := range level {
			ids = append(ids, n.ID+":"+n.Type)
		}
		log.Printf("[Engine] plan: levels=%d, level[%d] nodes=%v", len(plan.Levels), levelIdx, ids)
	}

	for levelIdx, level := range plan.Levels {
		var wg sync.WaitGroup
		var mu sync.Mutex
		var levelErrors []error

		for _, node := range level {
			wg.Add(1)
			go func(n WorkflowNode) {
				defer wg.Done()

				execStart := time.Now()
				// 进度心跳：每 10s 推送一次 node_progress，让前端显示耗时
				// 节点真正完成 / 失败时 cancel 掉
				heartbeatCtx, stopHeartbeat := context.WithCancel(ctx)
				defer stopHeartbeat()
				go func() {
					t := time.NewTicker(10 * time.Second)
					defer t.Stop()
					for {
						select {
						case <-heartbeatCtx.Done():
							return
						case <-t.C:
							elapsed := time.Since(execStart)
							// 进度文案 = 本地耗时 + 上游真实进度（若节点执行器上报了）：
							// 只有「已运行 12s」时用户无法判断上游到底动没动
							msg := fmt.Sprintf("已运行 %ds", int(elapsed.Seconds()))
							if detail := execCtx.GetNodeProgress(n.ID); detail != "" {
								msg = fmt.Sprintf("%s · %s", msg, detail)
							}
							log.Printf("[Engine] node %s (%s) still running, elapsed=%v detail=%q", n.ID, n.Type, elapsed.Round(time.Second), execCtx.GetNodeProgress(n.ID))
							e.emit(WorkflowEvent{
								ExecutionID: executionID,
								EventType:   EventNodeProgress,
								NodeID:      n.ID,
								NodeName:    n.Type,
								Data: map[string]interface{}{
									"elapsed":   elapsed.Seconds(),
									"elapsedMs": elapsed.Milliseconds(),
									"message":   msg,
								},
								Timestamp: time.Now().UnixMilli(),
							})
						}
					}
				}()

				e.emit(WorkflowEvent{
					ExecutionID: executionID,
					EventType:   EventNodeStart,
					NodeID:      n.ID,
					NodeName:    n.Type,
					Timestamp:   time.Now().UnixMilli(),
				})

				executor, ok := e.registry.Get(n.Type)
				if !ok {
					err := fmt.Errorf("no executor for node type: %s", n.Type)
					log.Printf("[Engine] no executor for nodeID=%s type=%s", n.ID, n.Type)
					mu.Lock()
					levelErrors = append(levelErrors, err)
					mu.Unlock()

					noExecOut := &NodeOutput{
						NodeID: n.ID,
						Status: "failed",
						Error:  err.Error(),
					}
					execCtx.SetOutput(n.ID, noExecOut)
					e.recordNodeOutput(projectID, noExecOut)

					e.emit(WorkflowEvent{
						ExecutionID: executionID,
						EventType:   EventNodeFailed,
						NodeID:      n.ID,
						NodeName:    n.Type,
						Data:        map[string]interface{}{"error": err.Error()},
						Timestamp:   time.Now().UnixMilli(),
					})
					return
				}

				// 每个节点一份独立的用量采集器：上游消耗是按节点记进对账行的，
				// 若共用执行级 ctx，同一执行里多个节点的 token 会累加到同一行（对账就错了）
				nodeCtx := llm.WithUsageRecorder(ctx)
				// 把执行号带进计费层：扣费那一刻要顺着这条执行的事件流把新余额推给前端
				// （前端余额显示跟账本走，后端一扣、画布右上角立刻变，不用等生成结束）
				nodeCtx = billing.WithExecutionID(nodeCtx, execCtx.GetExecutionID())
				output, err := executor.Execute(nodeCtx, n, execCtx)
				if err != nil {
					log.Printf("[Engine] executor error nodeID=%s type=%s err=%v", n.ID, n.Type, err)
					// 失败节点同样要进 outputs：它才是 saveOutputs → LastOutputs →
					// persistNodeOutputs 的数据源。原来只写 execCtx（+发 node_failed 事件），
					// 回写画布时 `if out, ok := outputs[n.ID]; ok` 判定为 false，
					// 该节点被整条跳过 —— 失败态与错误信息永远落不到画布：
					// 页面一关/一刷新就只剩 idle，重进项目像没执行过。
					failedOutput := &NodeOutput{
						NodeID: n.ID,
						Status: "failed",
						Error:  err.Error(),
					}
					mu.Lock()
					levelErrors = append(levelErrors, err)
					outputs[n.ID] = failedOutput
					mu.Unlock()

					execCtx.SetOutput(n.ID, failedOutput)
					// 失败也立即落库：节点失败态与原因必须马上可见（否则页面一关就只剩 idle）
					e.recordNodeOutput(projectID, failedOutput)

					e.emit(WorkflowEvent{
						ExecutionID: executionID,
						EventType:   EventNodeFailed,
						NodeID:      n.ID,
						NodeName:    n.Type,
						Data:        map[string]interface{}{"error": err.Error()},
						Timestamp:   time.Now().UnixMilli(),
					})
					return
				}

				execCtx.SetOutput(n.ID, output)

				// 收集 output 供外部回写
				mu.Lock()
				outputs[n.ID] = output
				mu.Unlock()

				// ✅ 产物立即落库：这一刻起，画布/DB 就等于「已经做完的事实」，
				// 进程再被杀也不会出现「视频已上传、状态还是生成中」
				e.recordNodeOutput(projectID, output)

				e.emit(WorkflowEvent{
					ExecutionID: executionID,
					EventType:   EventNodeComplete,
					NodeID:      n.ID,
					NodeName:    n.Type,
					Data:        output.Data,
					Timestamp:   time.Now().UnixMilli(),
				})
			}(node)
		}

		wg.Wait()

		// 节点"自报失败"也必须算本层失败：
		// executor 有些失败路径返回的是 &NodeOutput{Status:"failed"}, nil（error 为 nil），
		// 只看 levelErrors 会把这一层当成成功，执行被标 done —— 线上实证 2026-10-03 执行 1258：
		// 视频被 10 分钟超时掐死，节点与积分都正确标失败并退费，执行却显示 done（界面"成功但没东西"）。
		// 这里按 outputs 里每个节点的 Status 兜底一次，保证"失败就是失败"。
		for _, out := range outputs {
			if out != nil && out.Status == "failed" {
				msg := "节点执行失败"
				if out.Data != nil {
					if s, ok := out.Data["error"].(string); ok && s != "" {
						msg = s
					}
				}
				levelErrors = append(levelErrors, fmt.Errorf("node %s failed: %s", out.NodeID, msg))
			}
		}

		if len(levelErrors) > 0 {
			e.emit(WorkflowEvent{
				ExecutionID: executionID,
				EventType:   EventExecutionFailed,
				Data:        map[string]interface{}{"error": fmt.Sprintf("level %d failed: %v", levelIdx, levelErrors)},
				Timestamp:   time.Now().UnixMilli(),
			})
			// 即使失败也保存已收集的输出
			e.saveOutputs(outputs)
			// 该层里有节点把失败标成「不重试」（如视频轮询超时：钱已退、界面已显示失败，
			// 重试要么重复扣费、要么复用旧任务免费出片）→ 给错误打标记，队列据此跳过重试
			if execCtx.NonRetryable() {
				return fmt.Errorf("%w: level %d failed: %v", apperr.ErrNoRetry, levelIdx, levelErrors)
			}
			return fmt.Errorf("level %d failed: %v", levelIdx, levelErrors)
		}
	}

	e.saveOutputs(outputs)

	e.emit(WorkflowEvent{
		ExecutionID: executionID,
		EventType:   EventExecutionDone,
		Timestamp:   time.Now().UnixMilli(),
	})

	return nil
}

// saveOutputs 把本次执行的所有输出存到 engine.lastOutputs
func (e *WorkflowEngine) saveOutputs(outputs map[string]*NodeOutput) {
	if len(outputs) == 0 {
		return
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	e.lastOutputs = outputs
}

func (e *WorkflowEngine) emit(event WorkflowEvent) {
	if event.Type == "" {
		event.Type = eventTypeToWSName(event.EventType)
	}
	e.mu.Lock()
	subs := e.subscribers[event.ExecutionID]
	if len(subs) == 0 {
		e.mu.Unlock()
		return
	}
	// fan-out to all subscribers; drop on full (避免慢消费者阻塞引擎)
	for ch := range subs {
		select {
		case ch <- event:
		default:
			// channel full, drop for this subscriber
		}
	}
	e.mu.Unlock()
}

// Publish 向某条执行的事件流推送一个自定义事件（订阅了该执行的 SSE 连接都会收到）。
// 用途：余额变动这类不属于节点生命周期、但前端要立刻知道的事件。
// 与 emit 一样是**非阻塞**的：没有订阅者就直接丢弃，慢消费者满了也丢，绝不拖住调用方。
func (e *WorkflowEngine) Publish(executionID int64, eventType string, data interface{}) {
	if executionID <= 0 || eventType == "" {
		return
	}
	event := WorkflowEvent{
		Type:        eventType,
		ExecutionID: executionID,
		Data:        data,
		Timestamp:   time.Now().UnixMilli(),
	}

	// 余额变动额外缓存一份：建流晚于扣费时靠它补发，前端不必再单独查余额
	if eventType == creditsEventType {
		e.mu.Lock()
		e.pruneCreditsReplayLocked()
		e.creditsReplay[executionID] = creditsReplayItem{event: event, at: time.Now()}
		e.mu.Unlock()
	}

	e.mu.Lock()
	subs := len(e.subscribers[executionID])
	e.mu.Unlock()
	// 订阅者为 0 时这条事件会被丢弃（正常行为：余额变动这类事件已缓存，建流时会补发）。
	// 记一行日志是为了能事后判断「前端到底有没有收到」。
	log.Printf("[Engine] 推送自定义事件: exec=%d type=%s 当前订阅者=%d", executionID, eventType, subs)

	e.emit(event)
}

// creditsEventType 余额变动事件名（与 main 注入的监听器、前端监听的名字一致）
const creditsEventType = "credits_changed"

// creditsReplayItem 缓存的一条余额变动事件 + 写入时间（用于过期清理）
type creditsReplayItem struct {
	event WorkflowEvent
	at    time.Time
}

// creditsReplayTTL 缓存存活时长：执行早已结束时还留着没有意义
const creditsReplayTTL = 30 * time.Minute

// pruneCreditsReplayLocked 清掉过期缓存（调用方必须已持锁）
func (e *WorkflowEngine) pruneCreditsReplayLocked() {
	if len(e.creditsReplay) == 0 {
		return
	}
	now := time.Now()
	for id, item := range e.creditsReplay {
		if now.Sub(item.at) > creditsReplayTTL {
			delete(e.creditsReplay, id)
		}
	}
}

// --- 事件系统 ---

type EventType string

const (
	EventExecutionStart  EventType = "execution.start"
	EventNodeStart       EventType = "node.start"
	EventNodeProgress    EventType = "node.progress"
	EventNodeComplete    EventType = "node.complete"
	EventNodeFailed      EventType = "node.failed"
	EventExecutionDone   EventType = "execution.done"
	EventExecutionFailed EventType = "execution.failed"
)

type WorkflowEvent struct {
	// Type 前端约定的 WSEventType 命名（如 node_completed / execution_started）
	Type string `json:"type"`
	// EventType 内部用的事件名（如 node.complete / execution.start）
	EventType   EventType   `json:"eventType"`
	ExecutionID int64       `json:"executionId"`
	NodeID      string      `json:"nodeId,omitempty"`
	NodeName    string      `json:"nodeName,omitempty"`
	Data        interface{} `json:"data,omitempty"`
	Timestamp   int64       `json:"timestamp"`
}

// eventTypeToWSName 把内部 EventType 映射到前端约定的 WSEventType
func eventTypeToWSName(t EventType) string {
	switch t {
	case EventExecutionStart:
		return "execution_started"
	case EventExecutionDone:
		return "execution_completed"
	case EventExecutionFailed:
		return "execution_failed"
	case EventNodeStart:
		return "node_started"
	case EventNodeProgress:
		return "node_progress"
	case EventNodeComplete:
		return "node_completed"
	case EventNodeFailed:
		return "node_failed"
	default:
		return string(t)
	}
}

// --- 默认执行器 ---

// TextExecutor 文本节点执行器（调用 LLM 生成故事剧本文本）
type TextExecutor struct {
	llmClient     *llm.Client
	biller        *billing.Service
	modelManager  *llm.ModelManager
	providerTasks *billing.Ledger
}

// NewTextExecutor 创建文本执行器
func NewTextExecutor(client *llm.Client, biller *billing.Service, ledger *billing.Ledger, modelManager ...*llm.ModelManager) *TextExecutor {
	var mm *llm.ModelManager
	if len(modelManager) > 0 {
		mm = modelManager[0]
	}
	return &TextExecutor{llmClient: client, biller: biller, modelManager: mm, providerTasks: ledger}
}

func (t *TextExecutor) Execute(ctx context.Context, node WorkflowNode, execCtx *ExecutionContext) (*NodeOutput, error) {
	var data struct {
		Content string `json:"content"`
		Prompt  string `json:"prompt"`
		Model   string `json:"model"`
	}
	if err := json.Unmarshal(node.Data, &data); err != nil {
		return nil, fmt.Errorf("parse text node data: %w", err)
	}

	// 优先使用 prompt（用户输入的提示词），如果为空则用 content
	userInput := stripMentionMarkers(data.Prompt)
	if userInput == "" {
		userInput = data.Content
	}

	// 如果没有用户输入，直接透传
	if userInput == "" {
		return &NodeOutput{
			NodeID: node.ID,
			Status: "success",
			Data:   map[string]interface{}{"content": ""},
		}, nil
	}

	// 扣费校验：通过后才调用 LLM（账单记录模型与场景；文本模型按次计费）
	// 注入用户渠道（全局策略+用户渠道）后再计费：账单「渠道-模型」前缀与实际调用渠道一致
	ctx = llm.WithChannel(ctx, execCtx.GetChannel())

	// 先问「这一笔是不是已经扣过」再扣费 —— 顺序反了会真丢钱：
	// 先扣再查的话，重复投递（队列重投 / worker 被杀重领 / 重启续跑）会把钱扣两遍，
	// 而查到的旧金额只是把对账行写成 0，账面完全看不出多扣过一笔。
	var chargedAmount int64
	if prev, prevKey, done := chargeAlreadyDone(t.providerTasks, ctx, execCtx.GetExecutionID(), node.ID); done {
		log.Printf("[TextExecutor] ♻ 该节点本执行已扣过费(%d)，本次重跑不再扣费: node=%s", prev, node.ID)
		chargedAmount = prev // 沿用当初那笔金额：对账行必须记真实扣了多少
		// 重跑复用当初那笔编号：对账行的身份就是它，换一把会把同一节点写成两行
		ctx = billing.WithChargeKey(ctx, prevKey)
	} else {
		// 扣费编号在扣费前生成：账单分录与对账行靠它绑定（视频路径一直如此）。
		// 同步路径曾漏注入 → 分录 charge_key 为空，自检按编号找不到分录，逐笔误报金额不符
		ctx = billing.WithChargeKey(ctx, billing.NewChargeKey())
		var err error
		chargedAmount, err = t.biller.ChargeByModel(ctx, execCtx.GetUserID(), billing.ActionStory, data.Model, "故事生成", 1)
		if err != nil {
			return nil, err
		}
	}

	// 调用 LLM 生成故事文本（模型 ID 由前端按用户渠道选择，直接使用）
	// 对账：扣了费就先落一行「进行中」，收场时再更新（规则与视频一致）
	task := newSyncTask(t.providerTasks, ctx, execCtx, billing.ActionStory, "故事生成", data.Model, "", chargedAmount)
	task.NodeID = node.ID
	task.write(ctx, execCtx, node.ID, billing.StatusSubmitted, "", 0, "")

	storyContent, err := llm.GenerateStory(ctx, t.llmClient, userInput, data.Model)
	if err != nil {
		// 上游明确报错→自动退费；超时/没拿到结果→不自动退，交人工（见 settleFailure）
		return nil, task.settleFailure(ctx, t.biller, execCtx, node.ID, err)
	}
	if strings.TrimSpace(storyContent) == "" {
		// 上游 200 但内容是空的：用户付了钱却什么都没拿到 —— 按「没拿到结果」处理，
		// 不自动退费（上游并没有拒绝），写进对账表交人工
		return nil, task.settleFailure(ctx, t.biller, execCtx, node.ID,
			errors.New("上游返回内容为空（未拿到故事正文）"))
	}

	task.write(ctx, execCtx, node.ID, billing.StatusDelivered, "", 0, "")

	return &NodeOutput{
		NodeID: node.ID,
		Status: "success",
		Data:   map[string]interface{}{"content": storyContent},
	}, nil
}

// ScriptExecutor 脚本节点执行器：用户输入 prompt + 上游文本 → LLM 生成分镜剧本
type ScriptExecutor struct {
	llmClient     *llm.Client
	biller        *billing.Service
	modelManager  *llm.ModelManager
	providerTasks *billing.Ledger
}

// NewScriptExecutor 创建脚本执行器
func NewScriptExecutor(client *llm.Client, biller *billing.Service, ledger *billing.Ledger, modelManager ...*llm.ModelManager) *ScriptExecutor {
	var mm *llm.ModelManager
	if len(modelManager) > 0 {
		mm = modelManager[0]
	}
	return &ScriptExecutor{llmClient: client, biller: biller, modelManager: mm, providerTasks: ledger}
}

func (s *ScriptExecutor) Execute(ctx context.Context, node WorkflowNode, execCtx *ExecutionContext) (*NodeOutput, error) {
	var data struct {
		Prompt        string          `json:"prompt"`
		Model         string          `json:"model"`
		ScriptContent string          `json:"scriptContent"`
		Mentions      json.RawMessage `json:"mentions"` // ✅ 添加 Mentions 字段，用于用户明确@引用的上游节点
	}
	if err := json.Unmarshal(node.Data, &data); err != nil {
		return nil, fmt.Errorf("parse script node data: %w", err)
	}

	// ✅ 解析 mentions 字段，提取用户明确@引用的节点ID
	// 根据nodeId从节点data中提取完整content，而不是使用截断的textSnippet（前端预览用）
	var upstreamText strings.Builder
	var mentions []struct {
		NodeID      string `json:"nodeId"`
		NodeType    string `json:"nodeType"`
		TextSnippet string `json:"textSnippet"` // 前端预览用（后端不使用）
	}
	// ✅ 记录用户@引用了哪些文本节点，用于错误提示
	var referencedTextNodes []string // 引用的文本节点ID列表
	if err := json.Unmarshal(data.Mentions, &mentions); err == nil {
		for _, m := range mentions {
			// ✅ 只处理用户明确@引用的文本节点
			if m.NodeType == "text" {
				referencedTextNodes = append(referencedTextNodes, m.NodeID)
				// ✅ 根据nodeId从节点data中提取完整content（支持实时更新）
				if raw, ok := execCtx.GetNodeData(m.NodeID); ok && len(raw) > 0 {
					var nd struct {
						Content string `json:"content"`
					}
					if err := json.Unmarshal(raw, &nd); err == nil && nd.Content != "" {
						if upstreamText.Len() > 0 {
							upstreamText.WriteString("\n\n")
						}
						upstreamText.WriteString(nd.Content) // ✅ 完整剧本正文（不截断）
					}
				}
			}
		}
	}
	material := upstreamText.String() // ✅ 直接使用完整内容（不截断）

	// ✅ 如果用户@引用了文本节点，但提取不到任何剧本内容，返回错误提示
	if len(referencedTextNodes) > 0 && material == "" {
		return nil, fmt.Errorf("您引用的上游剧本节点没有内容，请确保剧本节点已生成或上传剧本内容（引用的节点ID: %s）", strings.Join(referencedTextNodes, ", "))
	}

	// ✅ 检查用户是否连接了上游剧本节点但没有@引用
	// 场景1：上游输入栏有剧本节点，但提示词中没有@引用
	upstreamSources := execCtx.GetUpstreamSources(node.ID)
	var hasUpstreamTextNode bool // 是否连接了上游text节点
	for _, srcID := range upstreamSources {
		if raw, ok := execCtx.GetNodeData(srcID); ok && len(raw) > 0 {
			var nd struct {
				Type string `json:"type"`
			}
			if err := json.Unmarshal(raw, &nd); err == nil && nd.Type == "text" {
				hasUpstreamTextNode = true
				break
			}
		}
	}
	// ✅ 如果连接了上游text节点，但没有@引用任何text节点，返回错误提示
	if hasUpstreamTextNode && len(referencedTextNodes) == 0 {
		return nil, fmt.Errorf("您已连接上游剧本节点，但未在提示词中通过@引用使用剧本内容，请点击上游输入栏插入@引用")
	}

	// ✅ 场景2：没有连接任何上游节点，也没有输入提示词
	if len(upstreamSources) == 0 && data.Prompt == "" {
		return nil, fmt.Errorf("请连接上游剧本节点并在提示词中通过@引用，或直接输入创作提示词")
	}

	// 既没有上游文本也没有用户 prompt：透传保留的 scriptContent
	if material == "" && data.Prompt == "" {
		return &NodeOutput{
			NodeID: node.ID,
			Status: "success",
			Data: map[string]interface{}{
				"scriptContent": data.ScriptContent,
				"characters":    []interface{}{},
				"scenes":        []interface{}{},
				"props":         []interface{}{},
				"shots":         []interface{}{},
			},
		}, nil
	}

	// 没有 LLM client 时（MVP）：把上游文本当作剧本正文兜底
	if s.llmClient == nil {
		return &NodeOutput{
			NodeID: node.ID,
			Status: "success",
			Data: map[string]interface{}{
				"scriptContent": material,
				"characters":    []interface{}{},
				"scenes":        []interface{}{},
				"props":         []interface{}{},
				"shots":         []interface{}{},
			},
		}, nil
	}

	// 清理 prompt 文本里的 [[m:ID]] 占位符（前端 @ 引用渲染标记，LLM 看了会困惑）
	cleanedPrompt := stripMentionMarkers(data.Prompt)

	// 把用户 prompt 作为创作方向附加在素材末尾
	fullInput := material
	if cleanedPrompt != "" {
		if fullInput != "" {
			fullInput += "\n\n[创作方向]\n" + cleanedPrompt
		} else {
			fullInput = cleanedPrompt
		}
	}

	log.Printf("[ScriptExecutor] nodeID=%s upstreamChars=%d promptChars=%d fullInputChars=%d model=%s", node.ID, len(material), len(cleanedPrompt), len(fullInput), data.Model)
	// 注入用户渠道（全局策略+用户渠道）后再计费：账单「渠道-模型」前缀与实际调用渠道一致
	ctx = llm.WithChannel(ctx, execCtx.GetChannel())
	// 扣费校验：通过后才调用 LLM（账单记录模型与场景；剧本使用文本模型按次计费）
	// 先问「这一笔是不是已经扣过」再扣费 —— 顺序反了会真丢钱：
	// 先扣再查的话，重复投递（队列重投 / worker 被杀重领 / 重启续跑）会把钱扣两遍，
	// 而查到的旧金额只是把对账行写成 0，账面完全看不出多扣过一笔。
	var chargedAmount int64
	if prev, prevKey, done := chargeAlreadyDone(s.providerTasks, ctx, execCtx.GetExecutionID(), node.ID); done {
		log.Printf("[ScriptExecutor] ♻ 该节点本执行已扣过费(%d)，本次重跑不再扣费: node=%s", prev, node.ID)
		chargedAmount = prev // 沿用当初那笔金额：对账行必须记真实扣了多少
		// 重跑复用当初那笔编号：对账行的身份就是它，换一把会把同一节点写成两行
		ctx = billing.WithChargeKey(ctx, prevKey)
	} else {
		// 扣费编号在扣费前生成：账单分录与对账行靠它绑定（视频路径一直如此）。
		// 同步路径曾漏注入 → 分录 charge_key 为空，自检按编号找不到分录，逐笔误报金额不符
		ctx = billing.WithChargeKey(ctx, billing.NewChargeKey())
		var err error
		chargedAmount, err = s.biller.ChargeByModel(ctx, execCtx.GetUserID(), billing.ActionScript, data.Model, "分镜剧本生成", 1)
		if err != nil {
			return nil, err
		}
	}
	// 调用 LLM 生成分镜剧本（模型 ID 由前端按用户渠道选择，直接使用）
	task := newSyncTask(s.providerTasks, ctx, execCtx, billing.ActionScript, "分镜剧本生成", data.Model, "", chargedAmount)
	task.write(ctx, execCtx, node.ID, billing.StatusSubmitted, "", 0, "")

	result, err := llm.GenerateScript(ctx, s.llmClient, fullInput, data.Model)
	if err != nil {
		// 上游明确报错→自动退费；超时/没拿到结果→不自动退，交人工
		return nil, task.settleFailure(ctx, s.biller, execCtx, node.ID, err)
	}

	task.write(ctx, execCtx, node.ID, billing.StatusDelivered, "", 0, "")

	return &NodeOutput{
		NodeID: node.ID,
		Status: "success",
		Data: map[string]interface{}{
			"scriptContent": result.ScriptContent,
			"characters":    toAnySlice(result.Characters),
			"scenes":        toAnySlice(result.Scenes),
			"props":         toAnySlice(result.Props),
			"shots":         toAnySlice(result.Shots),
		},
	}, nil
}

// toAnySlice 把结构体切片转成 interface{} 切片，方便写进 map[string]interface{}
func toAnySlice[T any](s []T) []interface{} {
	out := make([]interface{}, len(s))
	for i, v := range s {
		out[i] = v
	}
	return out
}

// truncateStr 把字符串截断到 max 字符（按 rune 计，避免切到中文中间）。
// 超过 max 会在末尾追加 "...[truncated]"，方便 LLM 知道这是被截断的素材。
func truncateStr(s string, max int) string {
	if max <= 0 || len([]rune(s)) <= max {
		return s
	}
	runes := []rune(s)
	return string(runes[:max]) + "\n...[truncated]"
}

// mentionMarkerRe 匹配前端 @ 引用占位符 [[m:<id>]]，id 是字母数字随机串
var mentionMarkerRe = regexp.MustCompile(`\[\[m:[A-Za-z0-9_]+\]\]`)

// stripMentionMarkers 把 prompt 文本里的 [[m:ID]] 占位符去掉（它们是前端渲染标记，
// LLM 看了会当成垃圾文本）。
func stripMentionMarkers(s string) string {
	if s == "" {
		return s
	}
	return strings.TrimSpace(mentionMarkerRe.ReplaceAllString(s, ""))
}

// getAssetTypeFromNodeID 从节点 ID 中提取资产类型
// 节点 ID 格式：{类型}-{资产名}-{脚本节点ID}
// 例如："角色-小明-node123"、"场景-教室-node123"、"道具-椅子-node123"
func getAssetTypeFromNodeID(nodeID string) string {
	if strings.HasPrefix(nodeID, "角色-") {
		return "character"
	} else if strings.HasPrefix(nodeID, "场景-") {
		return "scene"
	} else if strings.HasPrefix(nodeID, "道具-") {
		return "prop"
	}
	return "" // 普通图片节点
}

// ImageExecutor 图像节点执行器（调用图像生成API）
type ImageExecutor struct {
	imageClient       *llm.ImageClient
	modelManager      *llm.ModelManager
	fileUploadService *service.FileUploadService
	biller            *billing.Service
	// providerTasks 对账账本：图片/音频是同步调用，没有上游任务号，用「执行+节点」当 key
	providerTasks            *billing.Ledger
	generationHistoryService *service.GenerationHistoryService
}

// NewImageExecutor 创建图像执行器
func NewImageExecutor(client *llm.ImageClient, modelManager *llm.ModelManager, fileUploadService *service.FileUploadService, biller *billing.Service, generationHistoryService *service.GenerationHistoryService, ledger *billing.Ledger) *ImageExecutor {
	return &ImageExecutor{
		imageClient:              client,
		modelManager:             modelManager,
		fileUploadService:        fileUploadService,
		biller:                   biller,
		generationHistoryService: generationHistoryService,
		providerTasks:            ledger,
	}
}

func (i *ImageExecutor) Execute(ctx context.Context, node WorkflowNode, execCtx *ExecutionContext) (*NodeOutput, error) {
	var data struct {
		Mode        string          `json:"mode"`
		Prompt      string          `json:"prompt"`
		Model       string          `json:"model"`
		Resolution  string          `json:"resolution"`  // 清晰度：1K/2K/4K
		AspectRatio string          `json:"aspectRatio"` // 比例：16:9/9:16/1:1等
		Quality     string          `json:"quality"`     // 画质：低画质/标准画质/高画质
		Count       int             `json:"count"`       // 生成数量
		Mentions    json.RawMessage `json:"mentions"`    // ✅ 添加 Mentions 字段，用于用户明确@引用的上游节点
	}
	if err := json.Unmarshal(node.Data, &data); err != nil {
		return nil, fmt.Errorf("parse image node data: %w", err)
	}

	// ✅ 解析 mentions 字段，提取用户明确@引用的节点ID
	// 根据nodeId从节点data中提取完整imageUrl，而不是直接使用mentions中的imageUrl（前端预览用）
	var styleImageURLs []string     // 风格图：只提取画风/色彩/视觉风格
	var referenceImageURLs []string // 普通参考图：保持主体结构进行修改
	var mentions []struct {
		ID       string `json:"id"`
		NodeID   string `json:"nodeId"`
		NodeType string `json:"nodeType"`
		ImageUrl string `json:"imageUrl"` // 前端预览用（后端不使用）
	}

	// ✅ 详细日志：打印mentions字段内容（用于调试图生图判断逻辑）
	log.Printf("[ImageExecutor] ========== 图生图判断逻辑（开始） ========== ")
	log.Printf("[ImageExecutor] 当前节点ID: %s", node.ID)
	log.Printf("[ImageExecutor] data.Mentions字段: %s", string(data.Mentions))

	if err := json.Unmarshal(data.Mentions, &mentions); err == nil {
		// 防御：只保留 prompt 中实际存在的 [[m:xxx]] 对应的 mentions
		validMentions := mentions[:0]
		for _, m := range mentions {
			marker := fmt.Sprintf("[[m:%s]]", m.ID)
			if m.ID != "" && !strings.Contains(data.Prompt, marker) {
				log.Printf("[ImageExecutor] ⚠️ 跳过残留mention: id=%s nodeId=%s type=%s (prompt中不存在)", m.ID, m.NodeID, m.NodeType)
				continue
			}
			validMentions = append(validMentions, m)
		}
		mentions = validMentions

		log.Printf("[ImageExecutor] mentions解析成功，找到%d个引用", len(mentions))
		for idx, m := range mentions {
			log.Printf("[ImageExecutor] mentions[%d]: nodeId=%s nodeType=%s imageUrl=%s", idx, m.NodeID, m.NodeType, m.ImageUrl)
			// ✅ 只处理用户明确@引用的图片节点
			if m.NodeType == "image" {
				// ✅ 根据nodeId从节点data中提取完整imageUrl（支持实时更新）
				if raw, ok := execCtx.GetNodeData(m.NodeID); ok && len(raw) > 0 {
					var nd struct {
						ImageUrl string `json:"imageUrl"`
						StyleId  string `json:"styleId"`
					}
					if err := json.Unmarshal(raw, &nd); err == nil && nd.ImageUrl != "" {
						// 区分风格图（ID以style-开头或有styleId字段）和普通参考图
						if strings.HasPrefix(m.NodeID, "style-") || nd.StyleId != "" {
							styleImageURLs = append(styleImageURLs, nd.ImageUrl)
							log.Printf("[ImageExecutor] 🎨 从@引用的风格图提取到URL: nodeId=%s imageUrl=%s", m.NodeID, nd.ImageUrl)
						} else {
							referenceImageURLs = append(referenceImageURLs, nd.ImageUrl)
							log.Printf("[ImageExecutor] ✅ 从@引用的图片节点提取到URL: nodeId=%s imageUrl=%s", m.NodeID, nd.ImageUrl)
						}
					} else {
						log.Printf("[ImageExecutor] ❌ @引用的图片节点没有imageUrl: nodeId=%s raw=%s", m.NodeID, string(raw))
					}
				} else {
					log.Printf("[ImageExecutor] ❌ @引用的图片节点找不到数据: nodeId=%s", m.NodeID)
				}
			} else if m.NodeType == "previz" {
				// ✅ 白模预演节点：用它导出的静帧作为构图参考图
				if raw, ok := execCtx.GetNodeData(m.NodeID); ok && len(raw) > 0 {
					var nd struct {
						StillUrl string `json:"stillUrl"`
					}
					if err := json.Unmarshal(raw, &nd); err == nil && nd.StillUrl != "" {
						referenceImageURLs = append(referenceImageURLs, nd.StillUrl)
						log.Printf("[ImageExecutor] ✅ 从@引用的白模节点提取静帧作为参考图: nodeId=%s stillUrl=%s", m.NodeID, nd.StillUrl)
					} else {
						log.Printf("[ImageExecutor] ⚠️ @引用的白模节点还没有静帧（需先在预演编辑器导出静帧）: nodeId=%s", m.NodeID)
					}
				}
			}
		}
	} else {
		log.Printf("[ImageExecutor] ❌ mentions解析失败: err=%v", err)
	}

	// 合并所有上游图片URL
	upstreamImageURLs := append(styleImageURLs, referenceImageURLs...)

	if len(upstreamImageURLs) > 0 {
		// ✅ 风格图是独立通道：不参与 @ 引用，无论用户是否 @ 了参考图，
		// 上游连线的风格节点（style- 前缀或带 styleId）始终参与生成，按 URL 去重
		for _, sourceNodeID := range execCtx.GetUpstreamSources(node.ID) {
			if raw, ok := execCtx.GetNodeData(sourceNodeID); ok && len(raw) > 0 {
				var nd struct {
					ImageUrl string `json:"imageUrl"`
					StyleId  string `json:"styleId"`
				}
				if err := json.Unmarshal(raw, &nd); err == nil && nd.ImageUrl != "" {
					if strings.HasPrefix(sourceNodeID, "style-") || nd.StyleId != "" {
						dup := false
						for _, u := range styleImageURLs {
							if u == nd.ImageUrl {
								dup = true
								break
							}
						}
						if !dup {
							styleImageURLs = append(styleImageURLs, nd.ImageUrl)
							log.Printf("[ImageExecutor] 🎨 上游风格图（独立通道）: nodeId=%s imageUrl=%s", sourceNodeID, nd.ImageUrl)
						}
					}
				}
			}
		}
		// 风格图补充后重新合并
		upstreamImageURLs = append(styleImageURLs, referenceImageURLs...)
		log.Printf("[ImageExecutor] ✅ 最终结果：风格图=%d 普通参考图=%d 总计=%d", len(styleImageURLs), len(referenceImageURLs), len(upstreamImageURLs))
	} else {
		log.Printf("[ImageExecutor] ⚠️ 没有找到@引用的图片，尝试fallback逻辑（查找上游连接的图片节点）")
		// ✅ 如果用户没有明确@引用图片，但当前节点有上游连接的图片节点，默认使用第一个上游图片作为参考图
		// 这符合直觉：用户通过画布连接上游图片节点，本身就表示"基于上游图片生成"
		upstreamSources := execCtx.GetUpstreamSources(node.ID)
		log.Printf("[ImageExecutor] 上游节点列表: %v", upstreamSources)

		for idx, sourceNodeID := range upstreamSources {
			log.Printf("[ImageExecutor] 检查上游节点[%d]: nodeId=%s", idx, sourceNodeID)
			if raw, ok := execCtx.GetNodeData(sourceNodeID); ok && len(raw) > 0 {
				var nd struct {
					Type     string `json:"type"`     // 节点类型
					ImageUrl string `json:"imageUrl"` // 图片URL
					StillUrl string `json:"stillUrl"` // 白模预演导出的静帧
					StyleId  string `json:"styleId"`  // 风格图标识
				}
				if err := json.Unmarshal(raw, &nd); err == nil {
					log.Printf("[ImageExecutor] 上游节点数据: type=%s imageUrl=%s stillUrl=%s", nd.Type, nd.ImageUrl, nd.StillUrl)
					// ✅ 白模预演节点：静帧即参考图（锁构图）
					if nd.Type == "previz" && nd.StillUrl != "" {
						referenceImageURLs = append(referenceImageURLs, nd.StillUrl)
						log.Printf("[ImageExecutor] ✅ 使用上游白模节点的静帧作为参考图: upstreamNodeID=%s stillUrl=%s", sourceNodeID, nd.StillUrl)
					} else if nd.Type == "previz" {
						log.Printf("[ImageExecutor] ⚠️ 上游白模节点还没有静帧（需先在预演编辑器导出静帧）: upstreamNodeID=%s", sourceNodeID)
					} else if nd.Type == "image" || nd.ImageUrl != "" {
						// 区分风格图和普通参考图
						if strings.HasPrefix(sourceNodeID, "style-") || nd.StyleId != "" {
							styleImageURLs = append(styleImageURLs, nd.ImageUrl)
							log.Printf("[ImageExecutor] 🎨 默认使用上游风格图: upstreamNodeID=%s upstreamImageURL=%s", sourceNodeID, nd.ImageUrl)
						} else {
							referenceImageURLs = append(referenceImageURLs, nd.ImageUrl)
							log.Printf("[ImageExecutor] ✅ 默认使用上游连接的图片作为参考图: upstreamNodeID=%s upstreamImageURL=%s", sourceNodeID, nd.ImageUrl)
						}
					} else {
						log.Printf("[ImageExecutor] ❌ 上游节点不是图片节点: type=%s imageUrl=%s", nd.Type, nd.ImageUrl)
					}
				} else {
					log.Printf("[ImageExecutor] ❌ 上游节点数据解析失败: nodeId=%s", sourceNodeID)
				}
			} else {
				log.Printf("[ImageExecutor] ❌ 上游节点找不到数据: nodeId=%s", sourceNodeID)
			}
		}
		// fallback 后重新合并
		upstreamImageURLs = append(styleImageURLs, referenceImageURLs...)
	}

	// ✅ 最终判断结果
	log.Printf("[ImageExecutor] ========== 图生图判断逻辑（结束） ========== ")
	log.Printf("[ImageExecutor] 最终结果: upstreamImageURLs=%v (是否使用图生图=%v 图片数=%d)", upstreamImageURLs, len(upstreamImageURLs) > 0, len(upstreamImageURLs))

	// 没有提示词时直接返回空结果
	if data.Prompt == "" {
		return &NodeOutput{
			NodeID: node.ID,
			Status: "success",
			Data: map[string]interface{}{
				"imageUrl":  "",
				"imageUrls": []string{},
			},
		}, nil
	}

	// 没有图像客户端时(MVP 阶段):透传返回空 URL
	if i.imageClient == nil {
		log.Printf("[ImageExecutor] no imageClient, returning empty imageUrl")
		return &NodeOutput{
			NodeID: node.ID,
			Status: "success",
			Data: map[string]interface{}{
				"imageUrl":  "",
				"imageUrls": []string{},
			},
		}, nil
	}

	// ✅ 尺寸参数：从 resolution + aspectRatio 计算
	// 前端保存时确保这两个字段必有值
	var width, height int

	if data.Resolution != "" && data.AspectRatio != "" {
		// 根据分辨率和比例计算尺寸
		width, height = calculateSizeFromResolutionAndRatio(data.Resolution, data.AspectRatio)
		log.Printf("[ImageExecutor] 从分辨率和比例计算尺寸: resolution=%s aspectRatio=%s -> %dx%d", data.Resolution, data.AspectRatio, width, height)
	} else {
		// 如果节点没有保存resolution/aspectRatio（异常情况），使用系统默认值
		width = 1920
		height = 1080
		log.Printf("[ImageExecutor] 使用系统默认尺寸: %dx%d", width, height)
	}

	size := fmt.Sprintf("%dx%d", width, height)

	// 清理提示词中的占位符
	cleanedPrompt := stripMentionMarkers(data.Prompt)

	// ✅ 根据节点 ID 提取资产类型，使用统一的提示词构建函数
	assetType := getAssetTypeFromNodeID(node.ID)
	finalPrompt := llm.BuildAssetImagePrompt(assetType, cleanedPrompt)

	if assetType != "" {
		log.Printf("[ImageExecutor] 检测到资产节点: nodeID=%s assetType=%s (视图要求由脚本节点生成分镜时自动添加)", node.ID, assetType)
	} else {
		log.Printf("[ImageExecutor] 普通图片节点: nodeID=%s", node.ID)
	}

	// 确定使用的模型 ID（前端已按用户渠道选择，直接使用）
	apiModelID := data.Model

	// 华数TokenHub部分模型有最小像素要求，自动提升分辨率
	minPixels := getModelMinPixels(apiModelID)
	if minPixels > 0 && width*height < minPixels {
		log.Printf("[ImageExecutor] 模型%s要求最小%d像素，当前%d像素(%dx%d)，自动提升", apiModelID, minPixels, width*height, width, height)
		width, height = upscaleToMinPixels(width, height, minPixels)
		size = fmt.Sprintf("%dx%d", width, height)
		log.Printf("[ImageExecutor] 提升后尺寸: %dx%d (%d像素)", width, height, width*height)
	}

	log.Printf("[ImageExecutor] nodeID=%s promptLen=%d model=%s size=%s hasRefImage=%v refImageCount=%d data.Count=%d", node.ID, len(finalPrompt), apiModelID, size, len(upstreamImageURLs) > 0, len(upstreamImageURLs), data.Count)

	// 生成数量：count <= 0 时默认为 1
	count := data.Count
	if count <= 0 {
		count = 1
	}
	log.Printf("[ImageExecutor] 生成数量: data.Count=%d -> 实际count=%d", data.Count, count)

	// 注入用户渠道（全局策略+用户渠道）后再计费：账单「渠道-模型」前缀与实际调用渠道一致
	ctx = llm.WithChannel(ctx, execCtx.GetChannel())
	// 扣费校验：通过后才调用图像生成 API（账单记录模型与场景；图片模型按次计费，按生成张数计）
	// 先问「这一笔是不是已经扣过」再扣费 —— 顺序反了会真丢钱：
	// 先扣再查的话，重复投递（队列重投 / worker 被杀重领 / 重启续跑）会把钱扣两遍，
	// 而查到的旧金额只是把对账行写成 0，账面完全看不出多扣过一笔。
	// 本次计费的档位（分辨率档）：价格按档查，账单也按档记
	chargeTier := strings.TrimSpace(data.Resolution)
	var chargedAmount int64
	var err error
	if prev, prevKey, done := chargeAlreadyDone(i.providerTasks, ctx, execCtx.GetExecutionID(), node.ID); done {
		log.Printf("[ImageExecutor] ♻ 该节点本执行已扣过费(%d)，本次重跑不再扣费: node=%s", prev, node.ID)
		chargedAmount = prev // 沿用当初那笔金额：对账行必须记真实扣了多少
		// 重跑复用当初那笔编号：对账行的身份就是它，换一把会把同一节点写成两行
		ctx = billing.WithChargeKey(ctx, prevKey)
	} else {
		// 扣费编号在扣费前生成：账单分录与对账行靠它绑定（视频路径一直如此）。
		// 图片这里曾漏注入 → 分录 charge_key 为空，自检按编号找不到分录
		ctx = billing.WithChargeKey(ctx, billing.NewChargeKey())
		// 计费档位 = 节点选的分辨率（2K/4K）。
		// 图片上游按 token 计费，token ≈ 像素/256：4K 是 2K 的 4 倍成本，
		// 不分档就会每卖一张 4K 都按 2K 收费，成本缺口在账上完全看不见。
		// tier 为空（老画布没选过分辨率）时价格侧退回默认档，行为与改动前一致。
		chargedAmount, err = i.biller.ChargeByModelWithResolution(ctx, execCtx.GetUserID(), billing.ActionImage, apiModelID, chargeTier, "图片生成", count)
		if err != nil {
			return nil, err
		}
	}
	// 对账：图片是同步调用（没有上游任务号），用「执行+节点」当 key。
	// 计费口径记「档位(实际尺寸)」两个信息都要：
	// 只记尺寸看不出按哪一档收的钱，只记档位又核对不了实际交付像素。
	chargeBasis := size
	if chargeTier != "" {
		chargeBasis = fmt.Sprintf("%s(%s)", chargeTier, size)
	}
	imgTask := newSyncTask(i.providerTasks, ctx, execCtx, billing.ActionImage, "图片生成", apiModelID, chargeBasis, chargedAmount)
	imgTask.write(ctx, execCtx, node.ID, billing.StatusSubmitted, "", 0, "")

	// ✅ 调用图像生成 API（根据是否有用户@引用的上游图片选择文生图或图生图）
	// 返回所有生成图片的 URL 列表（N>1 时有多个）
	var generatedURLs []string

	if len(upstreamImageURLs) > 0 {
		// 根据风格图/参考图组合构建不同的提示词
		var imageToImagePrompt string
		if len(styleImageURLs) > 0 && len(referenceImageURLs) > 0 {
			// 既有风格图又有参考图：参考风格图的画风，基于参考图内容修改
			imageToImagePrompt = fmt.Sprintf("参考风格图的画风、色彩和视觉风格，基于参考图的内容进行修改：%s。请保持参考图的主体结构，同时采用风格图的艺术风格。", finalPrompt)
		} else if len(styleImageURLs) > 0 {
			// 只有风格图：仅提取风格元素，严禁复制内容
			imageToImagePrompt = fmt.Sprintf("仅从风格图中提取以下艺术元素：画风（如油画/水彩/赛博朋克等）、色彩色调、光影氛围、笔触纹理、构图风格。严格禁止复制风格图中的任何具体内容，包括但不限于：人物、角色、物体、场景、建筑、背景。根据用户描述生成全新的画面：%s。生成结果应具有与风格图相同的艺术风格，但内容完全不同。", finalPrompt)
		} else {
			// 只有普通参考图：基于参考图修改
			imageToImagePrompt = fmt.Sprintf("基于参考图修改：%s。请保持参考图中的主体结构、细节特征和整体风格，只进行用户指定的修改。", finalPrompt)
		}
		log.Printf("[ImageExecutor] 使用图生图模式: styleCount=%d refCount=%d prompt=%s", len(styleImageURLs), len(referenceImageURLs), imageToImagePrompt)
		generatedURLs, err = i.imageClient.GenerateImageFromImageWithGuidance(ctx, apiModelID, upstreamImageURLs, imageToImagePrompt, size, 12.0, count)
		if err != nil {
			// 上游明确报错→自动退费；超时/没拿到结果→不自动退，交人工
			return nil, imgTask.settleFailure(ctx, i.biller, execCtx, node.ID, err)
		}
	} else {
		log.Printf("[ImageExecutor] 使用文生图模式")
		generatedURLs, err = i.imageClient.GenerateImageWithModel(ctx, apiModelID, finalPrompt, size, count)
		if err != nil {
			return nil, imgTask.settleFailure(ctx, i.biller, execCtx, node.ID, err)
		}
	}

	log.Printf("[ImageExecutor] 生成完成: imageCount=%d", len(generatedURLs))

	// 逐个下载图片并使用 FileUploadService 上传
	// 失败的图片回退使用原始 URL，确保功能可用
	ownURLs := make([]string, 0, len(generatedURLs))
	thumbURLs := make([]string, 0, len(generatedURLs))
	for idx, generatedURL := range generatedURLs {
		// 转存带重试：失败一次就回退上游临时 URL 的话，用户过一阵拿到的是死链
		// （图确实生成过、钱也扣了）。多数失败是瞬时网络问题，重试即可救回。
		var imageInfo *imageInfo
		var dlErr error
		for attempt := 1; attempt <= 3; attempt++ {
			imageInfo, dlErr = i.downloadAndUpload(ctx, generatedURL, node.ID, execCtx.GetCanvasDir(), execCtx.GetProjectID(), width, height)
			if dlErr == nil {
				break
			}
			log.Printf("[ImageExecutor] ⚠️ 下载转存失败(idx=%d 第%d/3次): %v", idx, attempt, dlErr)
			if attempt < 3 {
				select {
				case <-ctx.Done():
					dlErr = ctx.Err()
					attempt = 3
				case <-time.After(time.Duration(attempt) * 3 * time.Second):
				}
			}
		}
		if dlErr != nil {
			log.Printf("[ImageExecutor] ❌ 下载上传失败(idx=%d)，回退上游临时 URL（可能过期，需人工核查）: %v", idx, dlErr)
			ownURLs = append(ownURLs, generatedURL)
			thumbURLs = append(thumbURLs, "")
		} else {
			log.Printf("[ImageExecutor] 图片上传成功(idx=%d): generatedURL=%s -> ownURL=%s size=%dx%d", idx, generatedURL, imageInfo.url, imageInfo.width, imageInfo.height)
			ownURLs = append(ownURLs, imageInfo.url)
			thumbURLs = append(thumbURLs, imageInfo.thumbURL)
		}
	}

	// 第一个 URL（兼容现有前端逻辑读取 data.imageUrl）
	firstURL := ""
	firstThumbURL := ""
	if len(ownURLs) > 0 {
		firstURL = ownURLs[0]
		if len(thumbURLs) > 0 {
			firstThumbURL = thumbURLs[0]
		}
	}

	if len(generatedURLs) < count {
		// 要了 N 张只回来 M 张：上游没拒绝（也按张计费了），但结果是残缺的 ——
		// 按「结果不完整」处理：不自动退费、不自动重试，写进对账表交人工
		msg := fmt.Sprintf("上游只返回 %d/%d 张图片；本次扣费未自动退还，已提交人工复核，确认无效后会原路退还",
			len(generatedURLs), count)
		if execCtx != nil {
			execCtx.MarkNonRetryable()
		}
		imgTask.write(ctx, execCtx, node.ID, billing.StatusPendingReview, msg, 0, firstURL)
		return &NodeOutput{
			NodeID: node.ID,
			Status: "failed",
			Data:   map[string]interface{}{"error": msg},
		}, nil
	}

	// 对账：交付（产物地址一并留痕，对账页点得开）
	imgTask.write(ctx, execCtx, node.ID, billing.StatusDelivered, "", 0, firstURL)

	// 记录生成历史
	if firstURL != "" && i.generationHistoryService != nil {
		userID := execCtx.GetUserID()
		projectID := execCtx.GetProjectID()
		if userID != "" && projectID != "" {
			for _, url := range ownURLs {
				if err := i.generationHistoryService.RecordGeneration(detachedCtx(ctx), userID, projectID, node.ID, "image", data.Prompt, data.Model, url); err != nil {
					log.Printf("[ImageExecutor] 记录生成历史失败: %v", err)
				}
			}
		}
	}

	return &NodeOutput{
		NodeID: node.ID,
		Status: "success",
		Data: map[string]interface{}{
			"imageUrl":  firstURL,      // ✅ 第一个，兼容现有前端逻辑
			"imageUrls": ownURLs,       // ✅ 全部 URL，供前端创建多节点
			"thumbUrl":  firstThumbURL, // ✅ 第一张缩略图（640px webp）
			"thumbUrls": thumbURLs,     // ✅ 全部缩略图
			"width":     width,         // ✅ 返回实际图片宽度
			"height":    height,        // ✅ 返回实际图片高度
		},
	}, nil
}

// imageInfo 包含图片URL和尺寸信息
type imageInfo struct {
	url      string
	thumbURL string
	width    int
	height   int
}

// downloadAndUpload 下载图片并使用 FileUploadService 上传（复用哈希去重等逻辑）
func (i *ImageExecutor) downloadAndUpload(ctx context.Context, imageURL string, nodeID string, canvasDir string, projectID string, width int, height int) (*imageInfo, error) {
	log.Printf("[ImageExecutor] 开始下载图片: url=%s dir=%s projectID=%s nodeID=%s", imageURL, canvasDir, projectID, nodeID)

	httpClient := &http.Client{
		Timeout: 60 * time.Second,
	}

	resp, err := httpClient.Get(imageURL)
	if err != nil {
		return nil, fmt.Errorf("download image: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("download image failed: status=%d", resp.StatusCode)
	}

	imageData, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read image data: %w", err)
	}

	log.Printf("[ImageExecutor] 图片下载成功: size=%d bytes, 使用生成尺寸: %dx%d", len(imageData), width, height)

	// 扩展名按真实字节判定：上游网关返回的 Content-Type 不可信
	// （常见把 JPEG 声明成 image/png），照声明落盘会得到与内容不符的后缀与 Content-Type
	imgExt, _ := service.DetectImageExt(imageData)
	if imgExt == "" {
		imgExt = ".png" // 识别不出时保持原行为
	}
	log.Printf("[ImageExecutor] 实际图片格式: %s（按字节判定）", imgExt)

	result, err := i.fileUploadService.UploadFromReader(bytes.NewReader(imageData), int64(len(imageData)), "image"+imgExt, service.UploadOptions{
		Dir:            canvasDir,
		ProjectID:      projectID,
		DefaultExt:     imgExt,
		ContentTypeFor: service.ContentTypeForImage,
	})
	if err != nil {
		return nil, fmt.Errorf("upload image: %w", err)
	}

	log.Printf("[ImageExecutor] 图片上传成功: objectName=%s url=%s cached=%v", result.ObjectName, result.URL, result.Cached)

	// ✅ 生成 640px webp 缩略图（失败不阻断主流程）
	thumbURL := ""
	if thumbBytes, terr := service.GenerateImageThumbnail(imageData); terr == nil {
		thumbObject := service.ThumbnailObjectName(result.ObjectName)
		if perr := i.fileUploadService.PutBytes(thumbObject, thumbBytes, "image/webp"); perr != nil {
			log.Printf("[ImageExecutor] 缩略图写入失败: object=%s err=%v", thumbObject, perr)
		} else {
			thumbURL = i.fileUploadService.ObjectURL(thumbObject)
		}
	} else {
		log.Printf("[ImageExecutor] 缩略图生成跳过: %v", terr)
	}

	return &imageInfo{
		url:      result.URL,
		thumbURL: thumbURL,
		width:    width,
		height:   height,
	}, nil
}

// VideoExecutor 视频节点执行器（doubao-seedance）
type VideoExecutor struct {
	videoClient              *llm.VideoClient
	fileUploadService        *service.FileUploadService
	biller                   *billing.Service
	generationHistoryService *service.GenerationHistoryService
	// providerTasks 上游任务对账表：任务号一旦拿到就落库（失败/退费/交付都补状态）。
	// 没有它，失败之后连「上游有没有接单、有没有计费」都查不了（10-03 00:04 的教训）。
	providerTasks *billing.Ledger
	modelManager  *llm.ModelManager
}

// NewVideoExecutor 创建视频执行器
func NewVideoExecutor(videoClient *llm.VideoClient, fileUploadService *service.FileUploadService, biller *billing.Service, generationHistoryService *service.GenerationHistoryService, providerTaskService *billing.Ledger, modelManager ...*llm.ModelManager) *VideoExecutor {
	var mm *llm.ModelManager
	if len(modelManager) > 0 {
		mm = modelManager[0]
	}
	return &VideoExecutor{
		videoClient:              videoClient,
		fileUploadService:        fileUploadService,
		biller:                   biller,
		generationHistoryService: generationHistoryService,
		providerTasks:            providerTaskService,
		modelManager:             mm,
	}
}

// recordProviderTask 把这次上游任务的结局写进对账表（按任务号 upsert，状态取最新）。
//
// 记的是「事实」而不是「推断」：只有真拿到了任务号才写 —— 创建请求连响应都没回来时
// 我们手里没有任务号，也就没有可对账的凭据（那种情况下唯一能做的就是别让它发生，
// 即创建阶段的重试，见 llm.doCreateWithRetry）。
// detached ctx：执行 ctx 可能正随失败/关停被取消，而对账必须落下去。
func (v *VideoExecutor) recordProviderTask(ctx context.Context, execCtx *ExecutionContext, ref *llm.AsyncTaskRef, status, note string, refunded int64) {
	// 有 charge_key 就能定位到行，**不要求**已经有任务号：创建阶段就被上游拒绝时
	// 我们手里没有任务号，这一行同样必须能更新成「已退费」（否则管理员会对同一笔钱再退一次）
	if v.providerTasks == nil || ref == nil || (ref.TaskID == "" && ref.ChargeKey == "") {
		return
	}
	note = billing.TruncateNote(note, noteMaxBytes)
	task := &model.ProviderTask{
		TaskID:           ref.TaskID,
		ChargeKey:        ref.ChargeKey,
		TaskKind:         billing.ActionVideo,
		Provider:         ref.Provider,
		Model:            ref.Model,
		ExecID:           ref.ExecID,
		NodeID:           ref.NodeID,
		Status:           status,
		ChargedAmount:    ref.ChargedAmount,
		RefundedAmount:   refunded,
		Note:             note,
		ChargeResolution: ref.ChargeResolution,
		ChargeSeconds:    ref.ChargeSeconds,
		ChargeRefSeconds: ref.ChargeRefSeconds,
		ResultURL:        ref.ResultURL,
		ProviderURL:      ref.ProviderURL,
		RefundSource:     ref.RefundSource,
	}
	if execCtx != nil {
		task.UserID = execCtx.GetUserID()
		task.ProjectID = execCtx.GetProjectID()
	}
	if task.ExecID == 0 && execCtx != nil {
		task.ExecID = execCtx.GetExecutionID()
	}
	// 上游真实消耗（token 口径 + 其它口径原文快照）：
	// 视频的用量在轮询结果里，由 llm 侧登记进 ctx 上的采集器，这里统一取一次。
	// 注意 upsert 侧是「只增不减」（GREATEST），所以后续再写一次（如退费）不会把已记的用量抹掉。
	task.ProviderTokens, _, task.ProviderUsage, _ = llm.UsageFrom(ctx).Snapshot()
	_ = v.providerTasks.Record(detachedCtx(ctx), task)
}

func (v *VideoExecutor) Execute(ctx context.Context, node WorkflowNode, execCtx *ExecutionContext) (*NodeOutput, error) {
	var data struct {
		Mode          string          `json:"mode"`
		Prompt        string          `json:"prompt"`
		Model         string          `json:"model"`
		Duration      int             `json:"duration"`
		Fps           int             `json:"fps"`
		AspectRatio   string          `json:"aspectRatio"`
		Resolution    string          `json:"resolution"`
		VideoMode     string          `json:"videoMode"`
		GenerateAudio *bool           `json:"generateAudio"` // 指针类型，区分未设置(nil)和显式false
		Mentions      json.RawMessage `json:"mentions"`
	}
	if err := json.Unmarshal(node.Data, &data); err != nil {
		return nil, fmt.Errorf("parse video node data: %w", err)
	}

	// generateAudio 默认为 true（开启声音生成）
	generateAudio := true
	if data.GenerateAudio != nil {
		generateAudio = *data.GenerateAudio
	}

	log.Printf("[VideoExecutor] nodeID=%s model=%s promptLen=%d duration=%d videoMode=%s generateAudio=%v", node.ID, data.Model, len(data.Prompt), data.Duration, data.VideoMode, generateAudio)

	// 解析 mentions，收集上游图片URL和视频URL
	var imageURLs []string
	var videoURLs []string
	var audioURLs []string
	var mentions []struct {
		ID       string `json:"id"`
		NodeID   string `json:"nodeId"`
		NodeType string `json:"nodeType"`
	}
	if err := json.Unmarshal(data.Mentions, &mentions); err == nil {
		// 防御：只保留 prompt 中实际存在的 [[m:xxx]] 对应的 mentions
		// 防止前端残留已删除的 mention 导致错误收集资源
		validMentions := mentions[:0]
		for _, m := range mentions {
			marker := fmt.Sprintf("[[m:%s]]", m.ID)
			if m.ID != "" && !strings.Contains(data.Prompt, marker) {
				log.Printf("[VideoExecutor] ⚠️ 跳过残留mention: id=%s nodeId=%s type=%s (prompt中不存在)", m.ID, m.NodeID, m.NodeType)
				continue
			}
			validMentions = append(validMentions, m)
		}
		mentions = validMentions

		for _, m := range mentions {
			if m.NodeType == "image" {
				if raw, ok := execCtx.GetNodeData(m.NodeID); ok && len(raw) > 0 {
					var nd struct {
						ImageUrl string `json:"imageUrl"`
					}
					if err := json.Unmarshal(raw, &nd); err == nil && nd.ImageUrl != "" {
						imageURLs = append(imageURLs, nd.ImageUrl)
						log.Printf("[VideoExecutor] ✅ 参考图: nodeId=%s imageUrl=%s", m.NodeID, nd.ImageUrl)
					}
				}
			} else if m.NodeType == "video" {
				if raw, ok := execCtx.GetNodeData(m.NodeID); ok && len(raw) > 0 {
					var nd struct {
						VideoUrl string `json:"videoUrl"`
					}
					if err := json.Unmarshal(raw, &nd); err == nil && nd.VideoUrl != "" {
						videoURLs = append(videoURLs, nd.VideoUrl)
						log.Printf("[VideoExecutor] ✅ 参考视频: nodeId=%s videoUrl=%s", m.NodeID, nd.VideoUrl)
					}
				}
			} else if m.NodeType == "audio" {
				if raw, ok := execCtx.GetNodeData(m.NodeID); ok && len(raw) > 0 {
					var nd struct {
						AudioUrl string `json:"audioUrl"`
					}
					if err := json.Unmarshal(raw, &nd); err == nil && nd.AudioUrl != "" {
						audioURLs = append(audioURLs, nd.AudioUrl)
						log.Printf("[VideoExecutor] ✅ 参考音频: nodeId=%s audioUrl=%s", m.NodeID, nd.AudioUrl)
					}
				}
			} else if m.NodeType == "previz" {
				// ✅ 白模预演节点：白片作视频参考（走位/动作/运镜以此为准），静帧作图片参考
				if raw, ok := execCtx.GetNodeData(m.NodeID); ok && len(raw) > 0 {
					var nd struct {
						VideoUrl string `json:"videoUrl"`
						StillUrl string `json:"stillUrl"`
					}
					if err := json.Unmarshal(raw, &nd); err == nil {
						if nd.VideoUrl != "" {
							videoURLs = append(videoURLs, nd.VideoUrl)
							log.Printf("[VideoExecutor] ✅ 白模白片作为参考视频: nodeId=%s videoUrl=%s", m.NodeID, nd.VideoUrl)
						}
						if nd.StillUrl != "" {
							imageURLs = append(imageURLs, nd.StillUrl)
							log.Printf("[VideoExecutor] ✅ 白模静帧作为参考图: nodeId=%s stillUrl=%s", m.NodeID, nd.StillUrl)
						}
					}
				}
			}
		}
	}

	// fallback: 查找上游连接的图片/视频/音频节点
	// 仅当 mentions 完全没有提供某类资源时，才从上游补充（尊重用户 @mentions 的选择）
	// 首尾帧模式需要2张图，所以不能只收集1张；video.go 会按模式截断数量
	mentionsImageCount := len(imageURLs)
	mentionsVideoCount := len(videoURLs)
	mentionsAudioCount := len(audioURLs)
	if mentionsImageCount == 0 || mentionsVideoCount == 0 || mentionsAudioCount == 0 {
		upstreamSources := execCtx.GetUpstreamSources(node.ID)
		for _, sourceNodeID := range upstreamSources {
			if raw, ok := execCtx.GetNodeData(sourceNodeID); ok && len(raw) > 0 {
				var nd struct {
					ImageUrl string `json:"imageUrl"`
					VideoUrl string `json:"videoUrl"`
					AudioUrl string `json:"audioUrl"`
					StillUrl string `json:"stillUrl"` // 白模预演导出的静帧
					Type     string `json:"type"`
				}
				if err := json.Unmarshal(raw, &nd); err == nil {
					if nd.Type == "previz" {
						// ✅ 白模预演节点：白片补充视频参考，静帧补充图片参考
						if nd.VideoUrl != "" && mentionsVideoCount == 0 && len(videoURLs) == 0 {
							videoURLs = append(videoURLs, nd.VideoUrl)
							log.Printf("[VideoExecutor] ✅ 从上游白模节点获取参考视频（白片）: nodeId=%s", sourceNodeID)
						}
						if nd.StillUrl != "" && mentionsImageCount == 0 && len(imageURLs) < 9 {
							imageURLs = append(imageURLs, nd.StillUrl)
							log.Printf("[VideoExecutor] ✅ 从上游白模节点获取参考图（静帧）: nodeId=%s", sourceNodeID)
						}
					} else if nd.Type == "image" && nd.ImageUrl != "" && mentionsImageCount == 0 && len(imageURLs) < 9 {
						imageURLs = append(imageURLs, nd.ImageUrl)
						log.Printf("[VideoExecutor] ✅ 从上游图片节点获取参考图: nodeId=%s", sourceNodeID)
					} else if nd.Type == "video" && nd.VideoUrl != "" && mentionsVideoCount == 0 && len(videoURLs) == 0 {
						videoURLs = append(videoURLs, nd.VideoUrl)
						log.Printf("[VideoExecutor] ✅ 从上游视频节点获取参考视频: nodeId=%s", sourceNodeID)
					} else if nd.Type == "audio" && nd.AudioUrl != "" && mentionsAudioCount == 0 {
						audioURLs = append(audioURLs, nd.AudioUrl)
						log.Printf("[VideoExecutor] ✅ 从上游音频节点获取参考音频: nodeId=%s", sourceNodeID)
					}
				}
			}
		}
	}

	// 参考音频约束：① 不能作为唯一参考（华数要求 reference_audio 必须搭配图片/视频参考）；
	// ② 带参考音频时强制开启声音生成（generateAudio=true）
	if len(audioURLs) > 0 && len(imageURLs) == 0 && len(videoURLs) == 0 {
		return nil, fmt.Errorf("参考音频需搭配图片或视频参考素材（音频不能作为唯一参考）")
	}
	if len(audioURLs) > 0 && !generateAudio {
		log.Printf("[VideoExecutor] 检测到参考音频，强制开启声音生成 generateAudio=false→true")
		generateAudio = true
	}

	// 确定模型：计费用逻辑 ID（data.Model），API 调用用渠道解析后的真实 ID
	model := data.Model
	if model == "" {
		model = "doubao-seedance-2.0-fast"
	}

	// 视频节点直接使用前端传来的分辨率（480p/720p/1080p/4K）
	resolution := data.Resolution
	if resolution == "" {
		resolution = "1080p"
	}
	if resolution == "4K" {
		resolution = "4k"
	}

	// 时长按模型钳制后再扣费，保证扣费时长与实际生成时长一致。
	// 范围来自 models.yaml 的 duration_range（与渠道无关），未配置的模型回退默认 4-15
	minDur, maxDur := llm.DefaultVideoDurationRange()
	if v.modelManager != nil {
		minDur, maxDur = v.modelManager.VideoDurationRange(execCtx.GetChannel(), model)
	}
	data.Duration = llm.ClampVideoDuration(data.Duration, minDur, maxDur)

	// 计费时长里的「输入视频时长」：只有 models.yaml 开启 ref_video_billing 的模型
	// （当前 3 个 Seedance 模型）才测量并计入，其余模型（wan3.0 等）保持「只按输出时长」计费。
	// 首尾帧模式与参考素材互斥，video.go 的 collectMedia 会把参考视频直接丢掉，
	// 那种情况参考视频既没上送也不该计费，故一并排除。
	// 测量与模型侧的限制校验共用 ffprobe 口径（恰好等于受模型限制约束的那个数）；
	// 测量失败时按 0 计（本次只算输出时长），失败原因在日志里
	billRefVideo := v.modelManager != nil && v.modelManager.RefVideoBilling(execCtx.GetChannel(), model)
	var refVideoSeconds float64
	if billRefVideo {
		if data.VideoMode == "first-last-frame" {
			log.Printf("[VideoExecutor] 首尾帧模式忽略参考视频（不上送也不计费）: nodeId=%s refVideos=%d", node.ID, len(videoURLs))
		} else if len(videoURLs) > 0 {
			refVideoSeconds = llm.SumRefVideoDuration(ctx, videoURLs)
			log.Printf("[VideoExecutor] 参考视频计费: nodeId=%s refVideos=%d 参考视频总时长=%.2fs 输出时长=%ds",
				node.ID, len(videoURLs), refVideoSeconds, data.Duration)
		}
	}

	// 注入用户渠道（全局策略+用户渠道）后再计费：账单「渠道-模型」前缀与实际调用渠道一致
	ctx = llm.WithChannel(ctx, execCtx.GetChannel())

	// ── 异步任务续跑：优先接着上次已提交的上游任务取结果 ──
	// 进程重启/发版中断后队列会重投该任务，此时上游那次视频其实还在跑甚至已跑完。
	// 若重新下发一次：上游重复生成、用户重复扣费，而第一次的结果被白白丢掉。
	// 因此先查有没有「已提交但未取回结果」的 taskID，命中就直接续查，且**不再扣费**。
	execID := execCtx.GetExecutionID()
	resumeRef := llm.LoadAsyncTaskRef(ctx, execID, node.ID)
	taskRef := llm.NewAsyncTaskRef(execID, node.ID)
	var chargedAmount int64
	// chargeDetail 本次扣费的计费口径（分辨率 / 计费时长 / 其中参考视频时长）：
	// 调用失败退费时原样回传，退费账单与扣费账单口径完全一致
	var chargeDetail billing.ChargeExtra

	if resumeRef != nil {
		taskRef.Provider, taskRef.Model = resumeRef.Provider, resumeRef.Model
		taskRef.TaskID, taskRef.ChargedAmount = resumeRef.TaskID, resumeRef.ChargedAmount
		// 转存失败次数也要带回来（跨队列重试累计）：丢了它计数每次从 1 开始，
		// 「达到上限→交人工复核」这条分支永远走不到 —— 钱扣着、片子拿不到、对账页也不提示
		taskRef.DownloadFailures = resumeRef.DownloadFailures
		// 复用失败要退当初那笔钱，口径也得跟着复用过来（改动前落盘的旧登记没有这三项，取出为零值）
		taskRef.ChargeResolution, taskRef.ChargeSeconds, taskRef.ChargeRefSeconds =
			resumeRef.ChargeResolution, resumeRef.ChargeSeconds, resumeRef.ChargeRefSeconds
		// 复用同一笔扣费 → 沿用原 charge_key，退费分录才能与扣费分录归到同一笔
		taskRef.ChargeKey = resumeRef.ChargeKey
		log.Printf("[VideoExecutor] ♻ 命中已提交的上游任务: taskID=%s model=%s（%s）→ 续取结果，跳过重复下发与扣费",
			resumeRef.TaskID, resumeRef.Model, resumeRef.CreateAt)
	} else if prev, done := activeChargeByNode(v.providerTasks, ctx, execID, node.ID); done {
		// 有本地对账行说明这一笔已经扣过费（进程在创建任务前后崩过、队列重投），
		// 本次重跑不再扣费：宁可让这一次白送，也不能让用户为一次点击付两遍
		log.Printf("[VideoExecutor] ♻ 该节点本执行已扣过费(%d)，本次重跑不再扣费: node=%s", prev.ChargedAmount, node.ID)
		taskRef.ChargedAmount = prev.ChargedAmount
		taskRef.Model = model
		// 金额与计费口径一律沿用原来那一行（退费要按同一口径写账单），
		// charge_key 也沿用 —— 否则这张账单会和原扣费分录对不上
		taskRef.ChargeKey = prev.ChargeKey
		taskRef.ChargeResolution, taskRef.ChargeSeconds, taskRef.ChargeRefSeconds =
			prev.ChargeResolution, prev.ChargeSeconds, prev.ChargeRefSeconds
		chargeDetail = billing.ChargeExtra{
			Resolution:      prev.ChargeResolution,
			Seconds:         prev.ChargeSeconds,
			RefVideoSeconds: prev.ChargeRefSeconds,
			ChargeKey:       prev.ChargeKey,
		}
	} else {
		// 扣费校验：通过后才调用视频生成 API（账单记录模型与场景）。
		// 视频按秒计费：计费时长 = 输出视频时长 + 参考视频时长（见 ChargeVideoByDuration），
		// 单价按分辨率档位；带参考视频输入时取「带参考视频」档（后台未配置则按无参考视频单价 6 折）
		var chargeErr error
		// 扣费编号在扣费前生成：账单分录和对账行靠它绑定，且**不可变**
		//（不能拿「执行+节点」推导 —— 同一节点在同一次执行里可能被扣多次费，会撞）
		chargeKey := billing.NewChargeKey()
		ctx = billing.WithChargeKey(ctx, chargeKey)
		chargedAmount, chargeDetail, chargeErr = v.biller.ChargeVideoByDuration(
			ctx, execCtx.GetUserID(), billing.ActionVideo, model, "视频生成",
			resolution, data.Duration, refVideoSeconds)
		if chargeErr != nil {
			return nil, chargeErr
		}
		chargeDetail.ChargeKey = chargeKey
		taskRef.ChargeKey = chargeKey
		taskRef.ChargedAmount = chargedAmount
		// 模型名随登记落盘：看门狗退费按登记写账单（渠道由 client 侧登记真实调用渠道）
		taskRef.Model = model
		// 计费口径随任务登记落盘：进程重启后若该任务不可复用，退费按同一口径写账单
		taskRef.ChargeResolution = chargeDetail.Resolution
		taskRef.ChargeSeconds = chargeDetail.Seconds
		taskRef.ChargeRefSeconds = chargeDetail.RefVideoSeconds
		// 钱一扣就落账：不等任务号。这一步堵住的是「扣了费但账上什么都没有」的窗口
		// （进程在扣费后、拿到任务号前被杀 → 以前这笔钱在对账页上完全隐形）
		v.recordLocalCharge(ctx, execCtx, node.ID, model, chargedAmount, chargeDetail,
			billing.StatusSubmitted, "已扣费，正在下发上游任务", 0)
	}
	ctx = llm.WithAsyncTaskHolder(ctx, taskRef)
	// 任务号一到手就写永久对账（状态 submitted=进行中）：等生成结束再写的话，
	// 生成中的那几分钟（长视频十几分钟）运营在对账页上一片空白 —— 线上就踩了这个。
	// 后续交付/失败/退费会更新到同一行（provider_tasks 按任务号 upsert）。
	ctx = llm.WithTaskSubmittedHook(ctx, func(provider, model, taskID string) {
		v.recordProviderTask(ctx, execCtx, &llm.AsyncTaskRef{
			TaskID: taskID,
			// charge_key 不变：任务号到手只是往**同一行**补一个属性，行不换身份
			ChargeKey:        taskRef.ChargeKey,
			Provider:         provider,
			Model:            model,
			ExecID:           execID,
			NodeID:           node.ID,
			ChargedAmount:    taskRef.ChargedAmount,
			ChargeResolution: taskRef.ChargeResolution,
			ChargeSeconds:    taskRef.ChargeSeconds,
			ChargeRefSeconds: taskRef.ChargeRefSeconds,
		}, billing.StatusSubmitted, "", 0)
	})
	// 把上游真实进度透出到节点进度：轮询每 5s 报一次「上游处理中 62%」，
	// 引擎的 10s 心跳带上它 → 界面显示「已运行 3m20s · 上游处理中 62%」
	// 只透出上游自己的状态（"上游生成中" / "上游生成中 62%"）：本地耗时由心跳统一带
	// （"已运行 3m20s"），这里再叠一个"已等待"就是同一句话说两遍
	ctx = llm.WithProgressReporter(ctx, func(msg string, _ int) {
		execCtx.SetNodeProgress(node.ID, msg)
	})

	// 调用视频生成API；注入用户渠道供多 token 路由
	videoURL, err := v.videoClient.GenerateVideo(
		ctx,
		model,
		data.Prompt,
		data.Duration,
		resolution,
		data.AspectRatio,
		imageURLs,
		videoURLs,
		audioURLs,
		data.VideoMode,
		generateAudio,
	)
	if err != nil {
		err = videoFailureMessage(ctx, err)
		log.Printf("[VideoExecutor] ❌ 视频生成失败: %v", err)
		// 退款规则（产品口径）：只有「上游明确报错/拒绝」才自动退费。
		// 其余（请求超时、没拿到任务号、连接中断、轮询预算耗尽、用户中断、转存失败）都属于
		// 「我们不知道上游到底做了什么」——上游很可能已经受理并按生成后计费，
		// 我们单方面退费就是白付上游一次（线上实例：10-03 00:04 创建超时后自动退款）。
		// 这类不自动退，写进对账表交管理员手动处理。
		autoRefund := billing.ShouldAutoRefund(err)
		// 先落一行「待人工退费」（拿到任务号才写得进去）；若下面自动退费成功，
		// 会再写一次升级成 refunded —— 对账表按任务号 upsert，终态不会被回写覆盖
		v.recordProviderTask(ctx, execCtx, taskRef, billing.StatusPendingReview, err.Error(), 0)
		// 创建阶段就失败（连任务号都没拿到）时，上面那句写不进去 —— 那笔扣费会在对账页上
		// 完全看不见，管理员想手动退都找不到。这种情况用本地编号补一行（与同步调用同一套约定）。
		if taskRef.TaskID == "" && chargedAmount > 0 {
			v.recordLocalCharge(ctx, execCtx, node.ID, model, chargedAmount, chargeDetail,
				billing.StatusPendingReview, err.Error(), 0)
		}
		if !autoRefund {
			log.Printf("[VideoExecutor] 💤 本次失败不自动退费（待人工复核）: %v", err)
		}
		// 这类失败（轮询超时 / 执行预算耗尽 / 用户主动停止）：本次扣费马上要退给用户、
		// 界面也会显示失败，自动重试只会「重复扣费」或「复用仍在跑的上游任务免费出片」
		// → 标记不重试，交给用户自己决定
		// 不自动退费的失败一律不重试：钱没退，重试就会「再扣一次费」，
		// 用户为一次失败付两遍（创建阶段连接中断、没拿到任务号这类尤其危险 ——
		// 重试时登记里没有任务号，会重新下发重新扣费）。决定权交回用户/管理员。
		if !autoRefund || isNoRetryVideoFailure(err) {
			execCtx.MarkNonRetryable()
			log.Printf("[VideoExecutor] ⛔ 该失败不自动重试（不自动退费=%v）node=%s err=%v", !autoRefund, node.ID, err)
		}
		if resumeRef != nil {
			// 复用失败：该上游任务已不可用（过期/已失败），退还当初下发它的那笔扣费 ——
			// 重试会重新下发并重新扣费，不退的话用户等于为一个拿不到结果的任务白付一次。
			// 认领必须先做（GETDEL 原子操作）：同一个执行可能被并发跑多份（队列重投/重复触发），
			// 只有认领到登记的那一份去退费，否则同一笔扣费会被退多次
			ref := llm.TakeAsyncTaskRef(execID, node.ID)
			if ref == nil {
				log.Printf("[VideoExecutor] 任务登记已被其它执行认领并处理，跳过重复退费（node=%s）", node.ID)
			} else if ref.ChargedAmount > 0 && !autoRefund {
				log.Printf("[VideoExecutor] 💤 复用失败但不自动退费（上游未明确拒绝，待人工复核）: taskID=%s amount=%d",
					ref.TaskID, ref.ChargedAmount)
			} else if ref.ChargedAmount > 0 {
				reason := billing.AutoRefundReason("上游任务已失效，退还该次扣费并稍后重新生成: " + err.Error())
				// 退费口径取自任务登记（当初扣费时落盘的那一份），与扣费账单一致
				resumeExtra := billing.ChargeExtra{
					Resolution:      ref.ChargeResolution,
					Seconds:         ref.ChargeSeconds,
					RefVideoSeconds: ref.ChargeRefSeconds,
				}
				if refundErr := v.refundCharge(ctx, execCtx, ref.TaskID, ref.ChargedAmount, model, reason, resumeExtra); refundErr != nil {
					// 自动退费失败 → 落到待人工退费，管理员在对账页补退（不能显示成已退费）
					v.recordProviderTask(ctx, execCtx, ref, billing.StatusPendingReview, "上游任务已失效且退费失败: "+err.Error(), 0)
					log.Printf("[VideoExecutor] 复用失败退费失败: %v", refundErr)
					// 放回登记：后续重试还能把这次扣费退掉，避免用户白付
					llm.SaveAsyncTaskRef(ref)
				} else {
					log.Printf("[VideoExecutor] 复用失败，已退还上次扣费 %d 积分（口径 %s/%d秒，其中参考视频 %d 秒；重试时重新下发并扣费）",
						ref.ChargedAmount, resumeExtra.Resolution, resumeExtra.Seconds, resumeExtra.RefVideoSeconds)
					ref.RefundSource = billing.RefundSourceAuto
					v.recordProviderTask(ctx, execCtx, ref, billing.StatusRefunded, reason, ref.ChargedAmount)
				}
			}
		} else if chargedAmount > 0 && !autoRefund {
			// 不自动退费：登记消费掉，避免后续重试命中复用路径免费出片；
			// 扣的钱去哪退由管理员在对账页决定（对账表里已有任务号与金额）
			if claimed := llm.TakeAsyncTaskRef(execID, node.ID); claimed != nil {
				log.Printf("[VideoExecutor] 已消费任务登记（本次不自动退费，待人工复核）: taskID=%s amount=%d",
					claimed.TaskID, claimed.ChargedAmount)
			}
		} else if chargedAmount > 0 {
			// 上游明确拒绝 → 退还已扣费用（口径用本次扣费的那一份，退费账单与扣费账单一致）
			// 优先用 charge_key（同一笔扣费的唯一编号）；老登记没有它时退回任务号/老 sync 编号
			ledgerKey := taskRef.ChargeKey
			if ledgerKey == "" {
				ledgerKey = taskRef.TaskID
			}
			if ledgerKey == "" {
				ledgerKey = fmt.Sprintf("sync:video:%d:%s", execCtx.GetExecutionID(), node.ID)
			}
			if v.providerTasks != nil && v.providerTasks.AlreadyRefunded(detachedCtx(ctx), ledgerKey) {
				// 管理员可能已经在对账页手动退过这一笔 —— 再自动退一次就是同一笔钱退两遍
				log.Printf("[VideoExecutor] 这一笔扣费已退过（人工或自动），跳过自动退费: key=%s", ledgerKey)
				return &NodeOutput{NodeID: node.ID, Status: "failed", Data: map[string]interface{}{
					"error": fmt.Sprintf("%s（本次扣费此前已退还）", err.Error()),
				}}, nil
			}
			if refundErr := v.refundCharge(ctx, execCtx, taskRef.TaskID, chargedAmount, model, billing.AutoRefundReason(err.Error()), chargeDetail); refundErr != nil {
				log.Printf("[VideoExecutor] 退费失败: %v", refundErr)
				// 文案不能与钱矛盾：videoFailureMessage 已经写了「本次扣费已退还」，
				// 这里退费失败就必须改口（对账行留在待人工复核，管理员会补退）
				err = errors.New(strings.Replace(err.Error(),
					"（本次扣费已退还，可直接重新生成）",
					"（自动退费失败，已提交人工复核，管理员会尽快补退）", 1))
			} else {
				taskRef.RefundSource = billing.RefundSourceAuto
				v.recordProviderTask(ctx, execCtx, taskRef, billing.StatusRefunded, billing.AutoRefundReason(err.Error()), chargedAmount)
				// 没有任务号的情况（创建阶段就被拒）走的是本地编号那一行：
				// 上面这句会直接 return（TaskID 为空），必须把那一行也改成已退费 ——
				// 否则它停在「待人工决定 / 未退金额 0」，管理员在对账页会把同一笔钱再退一次
				if taskRef.TaskID == "" {
					v.recordLocalCharge(ctx, execCtx, node.ID, model, chargedAmount, chargeDetail,
						billing.StatusRefunded, billing.AutoRefundReason(err.Error()), chargedAmount)
				}
				// 退费成功 → 立刻消费掉这次的任务登记。
				// 登记只能对应「一笔尚未退还的扣费」：留着它，队列重试会命中登记走复用路径 ——
				// 复用成功即不扣费拿到视频（免费出片），复用失败则按已退金额再退一次（双退费）。
				// GETDEL 原子认领：并发副本里只有一个能消费掉，不会误删他次的登记。
				if claimed := llm.TakeAsyncTaskRef(execID, node.ID); claimed != nil {
					log.Printf("[VideoExecutor] 已消费任务登记（该笔扣费已退还，重试将重新下发并扣费）: taskID=%s amount=%d",
						claimed.TaskID, claimed.ChargedAmount)
				}
			}
		}
		return &NodeOutput{
			NodeID: node.ID,
			Status: "failed",
			Data: map[string]interface{}{
				"error": err.Error(),
			},
		}, nil
	}

	log.Printf("[VideoExecutor] ✅ 视频生成成功: nodeId=%s videoUrl=%s", node.ID, videoURL)

	// 下载视频并使用 FileUploadService 上传到 users/<userID>/canvas/<projectID>/（与图片保存机制一致）。
	// 必须转存成功才算交付：原来失败时直接拿上游的临时 URL 当成功结果 ——
	// 那个 URL 有有效期，用户过一阵再看就是死链，而账单早就扣了（假成功）。
	var ownVideoURL string
	var dlErr error
	var deliverW, deliverH int // 上游实际交付的尺寸（校验「设置的分辨率有没有被照办」）
	const downloadAttempts = 3
	for attempt := 1; attempt <= downloadAttempts; attempt++ {
		ownVideoURL, deliverW, deliverH, dlErr = v.downloadAndUpload(ctx, videoURL, node.ID, execCtx.GetCanvasDir(), execCtx.GetProjectID())
		if dlErr == nil {
			break
		}
		log.Printf("[VideoExecutor] ⚠️ 视频下载转存失败（第 %d/%d 次）: %v", attempt, downloadAttempts, dlErr)
		if attempt < downloadAttempts {
			select {
			case <-ctx.Done():
				dlErr = ctx.Err()
				attempt = downloadAttempts
			case <-time.After(time.Duration(attempt) * 5 * time.Second):
			}
		}
	}
	if dlErr != nil {
		return v.handleDownloadFailure(ctx, execCtx, node.ID, model, videoURL, dlErr, taskRef, chargeDetail)
	}
	log.Printf("[VideoExecutor] ✅ 视频已保存: original=%s -> ownURL=%s", videoURL, ownVideoURL)

	// 交付分辨率校验（只记录、不拦截）：交付尺寸与设置不符是真实发生过的工单 ——
	// 电信 cdance 路径曾经漏传 resolution（2026-10-04 修复），设置 480p 却交付 1280x720，
	// 而且是按 480p 收的费。片子已生成、钱已扣，这时报错只会让用户拿不到本该能用的片子，
	// 所以只留痕：日志一行 + 节点数据一个字段，便于按模型/渠道统计规模与验证修复效果。
	resolutionMismatch := ""
	if deliverW > 0 && deliverH > 0 {
		actualShort := deliverW
		if deliverH < actualShort {
			actualShort = deliverH
		}
		if want := service.NominalShortSide(resolution); want > 0 {
			diff := actualShort - want
			if diff < 0 {
				diff = -diff
			}
			if diff > 32 {
				resolutionMismatch = fmt.Sprintf("设置 %s（短边 %d），实际交付 %dx%d", resolution, want, deliverW, deliverH)
				log.Printf("[VideoExecutor] ⚠️ 交付分辨率与设置不符: nodeId=%s model=%s channel=%s %s url=%s",
					node.ID, model, execCtx.GetChannel(), resolutionMismatch, videoURL)
			}
		}
	}

	// 记录生成历史。
	// 这条记录不只是「历史」：它是流程之外唯一一份「该节点确实交付了」的凭据 ——
	// 看门狗/排障靠它区分「结果已交付、只是执行状态没写」与「真失败」，
	// 所以要在清理任务登记之前写，并且用 detached ctx（不随执行 ctx 取消而丢）。
	if ownVideoURL != "" && v.generationHistoryService != nil {
		userID := execCtx.GetUserID()
		projectID := execCtx.GetProjectID()
		if userID != "" && projectID != "" {
			if err := v.generationHistoryService.RecordGeneration(detachedCtx(ctx), userID, projectID, node.ID, "video", data.Prompt, data.Model, ownVideoURL); err != nil {
				log.Printf("[VideoExecutor] 记录生成历史失败: %v", err)
			}
		}
	}

	// 上游任务的对账结局：已交付（钱扣了、片子也落库了）
	// 产物地址一起留痕：对账页「状态」列上悬停就能看到并直接打开
	taskRef.ResultURL = ownVideoURL
	taskRef.ProviderURL = videoURL
	taskRef.RefundSource = ""
	v.recordProviderTask(ctx, execCtx, taskRef, billing.StatusDelivered, "", 0)

	// 产物已落库（对象存储 + 生成历史），任务登记才真正不再需要。
	// 放在这里而不是「拿到上游 URL 就清」：上传/落库期间进程若被杀，登记还在，
	// 后续重试可以直接复用那个已完成的上游任务把视频取回来（不重复扣费），
	// 而不是留下一笔「已扣费、产物却没落下来」的账。
	llm.ClearAsyncTaskRef(execID, node.ID)

	outData := map[string]interface{}{
		"mode":     data.Mode,
		"prompt":   data.Prompt,
		"videoUrl": ownVideoURL,
	}
	if deliverW > 0 && deliverH > 0 {
		// 交付尺寸留痕：前端可用于展示，对账/排障也可直接查（空 = 探测失败）
		outData["deliveredWidth"] = deliverW
		outData["deliveredHeight"] = deliverH
	}
	if resolutionMismatch != "" {
		outData["resolutionMismatch"] = resolutionMismatch
	}

	return &NodeOutput{
		NodeID: node.ID,
		Status: "success",
		Data:   outData,
	}, nil
}

// downloadAndUpload 下载视频并使用 FileUploadService 上传（复用哈希去重等逻辑）
func (v *VideoExecutor) downloadAndUpload(ctx context.Context, videoURL string, nodeID string, canvasDir string, projectID string) (string, int, int, error) {
	log.Printf("[VideoExecutor] 开始下载视频: url=%s dir=%s projectID=%s nodeID=%s", videoURL, canvasDir, projectID, nodeID)

	httpClient := &http.Client{
		Timeout: 300 * time.Second, // 视频文件较大，超时设为5分钟
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, videoURL, nil)
	if err != nil {
		return "", 0, 0, fmt.Errorf("create request: %w", err)
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return "", 0, 0, fmt.Errorf("download video: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", 0, 0, fmt.Errorf("download video failed: status=%d", resp.StatusCode)
	}

	videoData, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", 0, 0, fmt.Errorf("read video data: %w", err)
	}

	log.Printf("[VideoExecutor] 视频下载成功: size=%d bytes", len(videoData))

	// 从 Content-Type 推断扩展名
	ext := ".mp4"
	contentType := resp.Header.Get("Content-Type")
	if strings.Contains(contentType, "webm") {
		ext = ".webm"
	} else if strings.Contains(contentType, "mov") {
		ext = ".mov"
	}

	// 交付尺寸校验：顺手在内存里的这份字节上量一下（落临时文件探测，比再走一次网络便宜）。
	// 量不到不算失败 —— 探测失败只影响「能不能发现交付不符」，不该影响出片。
	deliverW, deliverH, probeErr := service.ProbeVideoDimensionsFromBytes(ctx, videoData, ext)
	if probeErr != nil {
		log.Printf("[VideoExecutor] ⚠️ 交付尺寸探测失败（不影响出片）: nodeId=%s err=%v", nodeID, probeErr)
	}

	result, err := v.fileUploadService.UploadFromReader(bytes.NewReader(videoData), int64(len(videoData)), "video"+ext, service.UploadOptions{
		Dir:            canvasDir,
		ProjectID:      projectID,
		DefaultExt:     ext,
		ContentTypeFor: service.ContentTypeForVideo,
	})
	if err != nil {
		return "", 0, 0, fmt.Errorf("upload video: %w", err)
	}

	log.Printf("[VideoExecutor] 视频上传成功: objectName=%s url=%s cached=%v 交付尺寸=%dx%d", result.ObjectName, result.URL, result.Cached, deliverW, deliverH)
	return result.URL, deliverW, deliverH, nil
}

// AudioExecutor 音频节点执行器
type AudioExecutor struct {
	providerTasks     *billing.Ledger
	audioClient       *llm.AudioClient
	fileUploadService *service.FileUploadService
	biller            *billing.Service
	modelManager      *llm.ModelManager
}

// NewAudioExecutor 创建音频执行器
func NewAudioExecutor(audioClient *llm.AudioClient, fileUploadService *service.FileUploadService, biller *billing.Service, ledger *billing.Ledger, modelManager ...*llm.ModelManager) *AudioExecutor {
	var mm *llm.ModelManager
	if len(modelManager) > 0 {
		mm = modelManager[0]
	}
	return &AudioExecutor{
		audioClient:       audioClient,
		fileUploadService: fileUploadService,
		biller:            biller,
		modelManager:      mm,
		providerTasks:     ledger,
	}
}

func (a *AudioExecutor) Execute(ctx context.Context, node WorkflowNode, execCtx *ExecutionContext) (*NodeOutput, error) {
	var data struct {
		Mode     string          `json:"mode"`
		Text     string          `json:"text"`
		Model    string          `json:"model"`
		Voice    string          `json:"voice"`
		Speed    float64         `json:"speed"`
		Style    string          `json:"style"`
		Tone     string          `json:"tone"`
		Prompt   string          `json:"prompt"`
		Mentions json.RawMessage `json:"mentions"`
	}
	if err := json.Unmarshal(node.Data, &data); err != nil {
		return nil, fmt.Errorf("parse audio node data: %w", err)
	}

	// 确定模型：计费用逻辑 ID（data.Model），API 调用用渠道解析后的真实 ID
	model := data.Model
	if model == "" {
		model = "qwen3-tts-instruct-flash"
	}

	// 确定音色
	voice := data.Voice
	if voice == "" || voice == "default" {
		voice = "Cherry"
	}

	// 确定输入文本：优先用 prompt（用户直接在音频节点输入的文本），其次用 text（上游传入）
	inputText := strings.TrimSpace(data.Prompt)
	if inputText == "" {
		inputText = strings.TrimSpace(data.Text)
	}

	// 如果都没有，尝试从上游文本节点获取
	if inputText == "" {
		sources := execCtx.GetUpstreamSources(node.ID)
		for _, sourceID := range sources {
			if raw, ok := execCtx.GetNodeData(sourceID); ok && len(raw) > 0 {
				var nd struct {
					Type    string `json:"type"`
					Content string `json:"content"`
				}
				if err := json.Unmarshal(raw, &nd); err == nil && nd.Type == "text" && nd.Content != "" {
					inputText = strings.TrimSpace(nd.Content)
					log.Printf("[AudioExecutor] ✅ 从上游文本节点获取内容: nodeId=%s len=%d", sourceID, len(inputText))
					break
				}
			}
		}
	}

	if inputText == "" {
		return &NodeOutput{
			NodeID: node.ID,
			Status: "failed",
			Data: map[string]interface{}{
				"error": "没有输入文本，无法生成音频",
			},
		}, nil
	}

	log.Printf("[AudioExecutor] nodeID=%s model=%s voice=%s speed=%.2f style=%s tone=%s textLen=%d", node.ID, model, voice, data.Speed, data.Style, data.Tone, len(inputText))

	// 注入用户渠道（全局策略+用户渠道）后再计费：账单「渠道-模型」前缀与实际调用渠道一致
	ctx = llm.WithChannel(ctx, execCtx.GetChannel())
	// 扣费校验：按输入字符数计费（每 100 字为单位），通过后才调用 TTS API
	charCount := len([]rune(inputText))
	// 先问「这一笔是不是已经扣过」再扣费 —— 顺序反了会真丢钱：
	// 先扣再查的话，重复投递（队列重投 / worker 被杀重领 / 重启续跑）会把钱扣两遍，
	// 而查到的旧金额只是把对账行写成 0，账面完全看不出多扣过一笔。
	var chargedAmount int64
	if prev, prevKey, done := chargeAlreadyDone(a.providerTasks, ctx, execCtx.GetExecutionID(), node.ID); done {
		log.Printf("[AudioExecutor] ♻ 该节点本执行已扣过费(%d)，本次重跑不再扣费: node=%s", prev, node.ID)
		chargedAmount = prev // 沿用当初那笔金额：对账行必须记真实扣了多少
		// 重跑复用当初那笔编号：对账行的身份就是它，换一把会把同一节点写成两行
		ctx = billing.WithChargeKey(ctx, prevKey)
	} else {
		// 扣费编号在扣费前生成：账单分录与对账行靠它绑定（视频路径一直如此）。
		// 同步路径曾漏注入 → 分录 charge_key 为空，自检按编号找不到分录，逐笔误报金额不符
		ctx = billing.WithChargeKey(ctx, billing.NewChargeKey())
		var err error
		chargedAmount, err = a.biller.ChargeByChars(ctx, execCtx.GetUserID(), billing.ActionAudio, model, "音频生成", charCount)
		if err != nil {
			return nil, err
		}
	}

	// 调用 TTS API
	audioTask := newSyncTask(a.providerTasks, ctx, execCtx, billing.ActionAudio, "音频生成", model, "", chargedAmount)
	audioTask.write(ctx, execCtx, node.ID, billing.StatusSubmitted, "", 0, "")

	audioData, err := a.audioClient.GenerateSpeech(ctx, model, inputText, voice, data.Speed, data.Style, data.Tone)
	if err != nil {
		log.Printf("[AudioExecutor] ❌ TTS生成失败: %v", err)
		// 上游明确报错→自动退费；超时/没拿到结果→不自动退，交人工
		return nil, audioTask.settleFailure(ctx, a.biller, execCtx, node.ID, err)
	}

	log.Printf("[AudioExecutor] ✅ TTS生成成功: nodeId=%s audioBytes=%d", node.ID, len(audioData))

	// 上传到 users/<userID>/canvas/<projectID>/（无 userID 时降级 canvas/<projectID>/）
	projectID := execCtx.GetProjectID()
	result, err := a.fileUploadService.UploadFromReader(
		bytes.NewReader(audioData),
		int64(len(audioData)),
		fmt.Sprintf("%s.wav", node.ID),
		service.UploadOptions{
			Dir:         execCtx.GetCanvasDir(),
			ProjectID:   projectID,
			AllowedExts: map[string]bool{".wav": true, ".mp3": true},
			DefaultExt:  ".wav",
			ContentTypeFor: func(ext string) string {
				if ext == ".mp3" {
					return "audio/mpeg"
				}
				return "audio/wav"
			},
		},
	)
	if err != nil {
		log.Printf("[AudioExecutor] ❌ 音频上传失败: %v", err)
		// 与视频「转存失败」完全同性质：上游已经生成成功（钱花了），是我们没存下来。
		// 不自动退费（上游没拒绝）、也不自动重试（重试会重新扣一次费）——
		// 写进对账表交人工复核，管理员看到后决定退不退。
		msg := fmt.Sprintf("音频已生成，但转存到自有存储失败：%v；本次扣费未自动退还，已提交人工复核，确认失败后会原路退还", err)
		if execCtx != nil {
			execCtx.MarkNonRetryable()
		}
		audioTask.write(ctx, execCtx, node.ID, billing.StatusPendingReview, msg, 0, "")
		return &NodeOutput{
			NodeID: node.ID,
			Status: "failed",
			Data: map[string]interface{}{
				"error": msg,
			},
		}, nil
	}

	log.Printf("[AudioExecutor] ✅ 音频上传成功: objectName=%s url=%s cached=%v", result.ObjectName, result.URL, result.Cached)

	audioTask.write(ctx, execCtx, node.ID, billing.StatusDelivered, "", 0, result.URL)

	return &NodeOutput{
		NodeID: node.ID,
		Status: "success",
		Data: map[string]interface{}{
			"mode":     data.Mode,
			"text":     inputText,
			"audioUrl": result.URL,
		},
	}, nil
}

// wavDurationSeconds 从 WAV 字节流解析音频时长（秒，向上取整）；非标准 WAV 或解析失败返回 0
func wavDurationSeconds(data []byte) int {
	if len(data) < 44 || string(data[0:4]) != "RIFF" || string(data[8:12]) != "WAVE" {
		return 0
	}
	var byteRate, dataSize uint32
	for i := 12; i+8 <= len(data); {
		chunkID := string(data[i : i+4])
		chunkSize := binary.LittleEndian.Uint32(data[i+4 : i+8])
		switch chunkID {
		case "fmt ":
			// fmt 块数据布局：audioFormat(2) numChannels(2) sampleRate(4) byteRate(4)...
			if i+20 <= len(data) {
				byteRate = binary.LittleEndian.Uint32(data[i+16 : i+20])
			}
		case "data":
			dataSize = chunkSize
		}
		i += 8 + int(chunkSize)
		if chunkSize%2 == 1 {
			i++ // 奇数长度块有 1 字节填充
		}
	}
	if byteRate == 0 || dataSize == 0 {
		return 0
	}
	return int(math.Ceil(float64(dataSize) / float64(byteRate)))
}

// calculateSizeFromResolutionAndRatio 根据分辨率和比例计算图片尺寸
// resolution: "1K" / "2K" / "4K"
// aspectRatio: "16:9" / "9:16" / "1:1" / "4:3" 等
func calculateSizeFromResolutionAndRatio(resolution, aspectRatio string) (int, int) {
	// 1. 计算目标像素总数
	var totalPixels int
	switch resolution {
	case "1K":
		totalPixels = 1280 * 720 // 约92万像素
	case "2K":
		totalPixels = 1920 * 1080 // 约207万像素
	case "4K":
		totalPixels = 3840 * 2160 // 约829万像素
	default:
		totalPixels = 1280 * 720 // 默认1K
	}

	// 2. 解析宽高比
	var ratioW, ratioH float64
	// 自适应比例 → 本地按 16:9 估尺寸（上游按输入图/视频自己定，这里只用于画布与请求预检）。
	// "free" 是历史枚举值，已统一改名为 "adaptive"（前端 normalizeAspectRatio 做兼容）；
	// 两个值都要认，否则老画布（以及旧版本前端）会走到下面的按 ":" 切分，落到 16:9 兜底分支。
	if aspectRatio == "free" || aspectRatio == "adaptive" || aspectRatio == "" {
		ratioW = 16
		ratioH = 9
	} else {
		parts := strings.Split(aspectRatio, ":")
		if len(parts) == 2 {
			// 将字符串转换为浮点数
			w, err1 := parseFloat(parts[0])
			h, err2 := parseFloat(parts[1])
			if err1 == nil && err2 == nil && w > 0 && h > 0 {
				ratioW = w
				ratioH = h
			} else {
				// 解析失败，使用默认16:9
				ratioW = 16
				ratioH = 9
			}
		} else {
			// 格式错误，使用默认16:9
			ratioW = 16
			ratioH = 9
		}
	}

	// 3. 计算实际宽度和高度
	// width * height = totalPixels
	// width / height = ratioW / ratioH
	// => width = sqrt(totalPixels * ratioW / ratioH)
	// => height = sqrt(totalPixels * ratioH / ratioW)
	ratio := ratioW / ratioH
	width := int(math.Sqrt(float64(totalPixels) * ratio))
	height := int(math.Sqrt(float64(totalPixels) / ratio))

	// 确保是8的倍数（大多数图片生成API的要求）
	width = roundTo8(width)
	height = roundTo8(height)

	return width, height
}

// getModelMinPixels 返回模型要求的最小像素数（0表示无限制）
// 华数TokenHub的 doubao-seedream 系列要求至少 3,686,400 像素
func getModelMinPixels(modelID string) int {
	switch {
	case strings.HasPrefix(modelID, "doubao-seedream"):
		return 3686400 // 至少约 1920x1920
	default:
		return 0
	}
}

// upscaleToMinPixels 等比放大尺寸以满足最小像素要求
func upscaleToMinPixels(width, height, minPixels int) (int, int) {
	if width*height >= minPixels {
		return width, height
	}
	// 按比例放大：scale = sqrt(minPixels / (width * height))
	scale := math.Sqrt(float64(minPixels) / float64(width*height))
	newW := roundTo8(int(math.Ceil(float64(width) * scale)))
	newH := roundTo8(int(math.Ceil(float64(height) * scale)))
	return newW, newH
}

// parseFloat 辅助函数：将字符串解析为浮点数
func parseFloat(s string) (float64, error) {
	var f float64
	_, err := fmt.Sscanf(s, "%f", &f)
	return f, err
}

// roundTo8 将数值调整为最接近的8的倍数
func roundTo8(n int) int {
	return ((n + 4) / 8) * 8
}

// detachedCtx 返回「不受执行超时影响」的 ctx，专供生成结束后的记账类写入使用。
// 线上实证（2026-10-02 执行 1256）：执行 ctx 是 10 分钟硬超时，而视频轮询本身跑到 10 分 26 秒，
// 收尾写库时 deadline 已过期 → generation_history 丢记录、执行状态卡 running、界面一直转圈、
// 用户以为没成功又点一次 → 同一节点重复扣费。这里去掉取消/超时（DB 驱动自带超时兜底）。
func detachedCtx(ctx context.Context) context.Context {
	return context.WithoutCancel(ctx)
}

// PrevizExecutor 白模预演节点执行器。
//
// 白模的搭建、走位、录制与静帧导出全部发生在前端预演编辑器里，引擎侧不做任何推理；
// 这里只需要"承认"该节点，把它已导出的白片/静帧当作节点输出暴露给下游。
// 关键作用：若不给 previz 注册执行器，引擎会把该节点判为 failed（no executor for node type），
// 用户一把白模连给图片/视频节点再点生成，白模节点就会变红报错。
type PrevizExecutor struct{}

func NewPrevizExecutor() *PrevizExecutor { return &PrevizExecutor{} }

func (p *PrevizExecutor) Execute(ctx context.Context, node WorkflowNode, execCtx *ExecutionContext) (*NodeOutput, error) {
	var d struct {
		VideoUrl string `json:"videoUrl"`
		StillUrl string `json:"stillUrl"`
	}
	if len(node.Data) > 0 {
		_ = json.Unmarshal(node.Data, &d)
	}
	log.Printf("[PrevizExecutor] nodeID=%s 白片=%v 静帧=%v（不调用模型、不扣积分）", node.ID, d.VideoUrl != "", d.StillUrl != "")
	return &NodeOutput{
		NodeID: node.ID,
		Status: "success",
		Data: map[string]interface{}{
			"videoUrl": d.VideoUrl,
			"stillUrl": d.StillUrl,
		},
	}, nil
}

// NewDefaultRegistry 创建默认执行器注册表（biller 为积分扣费服务，各执行器在真实 AI 调用前扣费并记账）
func NewDefaultRegistry(llmClient *llm.Client, imageClient *llm.ImageClient, videoClient *llm.VideoClient, audioClient *llm.AudioClient, modelManager *llm.ModelManager, fileUploadService *service.FileUploadService, biller *billing.Service, generationHistoryService *service.GenerationHistoryService, providerTaskService *billing.Ledger) *ExecutorRegistry {
	registry := NewExecutorRegistry()
	registry.Register("text", NewTextExecutor(llmClient, biller, providerTaskService, modelManager))
	registry.Register("script", NewScriptExecutor(llmClient, biller, providerTaskService, modelManager))
	registry.Register("image", NewImageExecutor(imageClient, modelManager, fileUploadService, biller, generationHistoryService, providerTaskService))
	registry.Register("video", NewVideoExecutor(videoClient, fileUploadService, biller, generationHistoryService, providerTaskService, modelManager))
	registry.Register("audio", NewAudioExecutor(audioClient, fileUploadService, biller, providerTaskService, modelManager))
	// 白模预演：无模型调用，仅承认前端已导出的白片/静帧，避免节点被判为失败
	registry.Register("previz", NewPrevizExecutor())
	// 清晰化节点（P0 本地档）：本机 ffmpeg 去块/降噪/锐化（可放大到 720p），不调用外部服务、不扣积分。
	// 做成独立节点而不是挂在视频节点上：可对已有素材重做（不重复生成）、可独立超时与并发，
	// 也是 P1（腾讯云 MPS / 火山）云端超分与补帧的落点。
	registry.Register("enhance", NewEnhanceExecutor(fileUploadService))
	return registry
}
