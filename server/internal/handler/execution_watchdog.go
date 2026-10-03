package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"libtv/internal/engine"
	"libtv/internal/llm"
	"libtv/internal/model"
	"libtv/internal/service"

	"gorm.io/datatypes"
)

// watchdogBudget 看门狗判定阈值：执行超过这个时长仍未结束，就认为它不会结束了。
//
// 取执行预算（executionTimeout=30 分钟）再加 5 分钟余量：
//   - 正常情况下执行自身的 ctx 会在 30 分钟到期，节点失败 → 退费 → 执行落 failed；
//     走到这里的只可能是「ctx 到期后收尾也没跑成」或「进程被杀后没人再捡起来」的执行。
//   - 「还在被 worker 推进」的执行不会被误杀：处理中锁存在即跳过（见 HasExecutionLock）。
func watchdogBudget() time.Duration { return executionTimeout + 5*time.Minute }

// watchdogInterval 巡检间隔。取 1 分钟：卡死类问题本来就要求「尽快自愈」，
// 而每次巡检只是一条带索引的轻查询（status IN + started_at 比较），代价可以忽略。
const watchdogInterval = time.Minute

// StartExecutionWatchdog 启动「无进展看门狗」。
//
// 为什么必须有它：workflow_handler.go 里 executionTimeout 的注释早就承诺了
// 「真正的卡死由后续的看门狗（无进展超时 → 标 failed + 退积分）兜底」，但一直没有实现。
// 没有它的时候，一个卡死的执行会永久停在 running：
//   - 前端 useResumeActiveExecution 会把它当「进行中」永久恢复成「生成中」，节点永远转圈；
//   - 重复提交闸门（只拦 pending/running）会永久 409 拦住该节点，用户刷新也没用；
//   - 该次生成扣掉的钱没人退。
//
// ctx 取消即停止（进程关停时随主 ctx 一起退出）。
func (h *WorkflowHandler) StartExecutionWatchdog(ctx context.Context, interval time.Duration) {
	if h.execRepo == nil {
		return
	}
	if interval <= 0 {
		interval = watchdogInterval
	}
	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		log.Printf("[Watchdog] 已启动：每 %s 巡检一次，「超过 %s 未结束且无 worker 在跑」的执行判失败并退还积分",
			interval, watchdogBudget().Round(time.Minute))
		for {
			select {
			case <-ctx.Done():
				log.Printf("[Watchdog] 已停止")
				return
			case <-t.C:
			}
			h.sweepStaleExecutions(ctx)
		}
	}()
}

// SetBillingService 注入计费服务：看门狗退还「已扣但没取回结果」的积分时用
func (h *WorkflowHandler) SetBillingService(b *service.BillingService) { h.billingService = b }

// SetGenerationHistoryService 注入生成历史服务：看门狗用它判断「产物其实已经交付」，
// 避免把已生成并上传对象存储的结果误判成失败（见 failStaleExecution 的收口前提）
func (h *WorkflowHandler) SetGenerationHistoryService(s *service.GenerationHistoryService) {
	h.generationHistoryService = s
}

func (h *WorkflowHandler) sweepStaleExecutions(ctx context.Context) {
	stale, err := h.execRepo.ListStaleActive(ctx, time.Now().Add(-watchdogBudget()))
	if err != nil {
		log.Printf("[Watchdog] 查询超期执行失败: %v", err)
		return
	}
	for _, exec := range stale {
		// 有 worker 正在跑（处理中锁存在且被续租）→ 只是跑得久，不是卡死
		if h.genQueue != nil && h.genQueue.HasExecutionLock(ctx, exec.ID) {
			continue
		}
		h.failStaleExecution(ctx, exec)
	}
}

// deliveredResult 某个节点「本次执行期间确实产出并交付」的证据
type deliveredResult struct {
	nodeType  string // image / video（决定 URL 写回哪个字段）
	resultURL string // 产物地址（已上传到对象存储）
}

// failStaleExecution 收口一个卡死的执行。
//
// 核心前提：**不能凭「跑得久」就否定已经交付的结果**。
// 视频可能早就生成并上传到对象存储、前端甚至已经拿到 URL 显示出来了，只是进程在写执行状态
// 之前被杀掉 —— 这恰恰是「状态没跟上」的典型场景。所以收口前先找证据，按证据决定这次执行
// 到底是「成功但状态没写」还是「真失败」：
//
//	证据一 generation_history：节点产物上传成功后立刻落库的记录（executor 用 detached ctx 写），
//	        只认 started_at/created_at 之后的记录，避免拿上一次生成的旧结果充数；
//	证据二 画布：节点 data.status 已是 success（后端收尾已写盘，或前端已存盘）。
//
// 全部节点都有证据 → 这次执行其实是成功的：缺的产物 URL 补进画布、执行落 done、**不退费**。
// 存在没证据的节点 → 真失败：没交付的节点标 failed、只退还「已扣费但没交付」的那部分积分、
// 执行落 failed。
func (h *WorkflowHandler) failStaleExecution(ctx context.Context, exec *model.WorkflowExecution) {
	nodeIDs := parseExecutionNodeIDs(exec.NodeIDs)
	waited := time.Since(exec.CreatedAt).Round(time.Minute)

	delivered := h.deliveredByNode(ctx, exec, nodeIDs)
	canvasStatus := h.canvasNodeStatuses(ctx, exec.ProjectID, nodeIDs)

	// 逐节点判定「这次是否已交付」：
	//   - 有生成历史记录 → 已交付（上传成功后才会写，是最硬的凭据）；
	//   - 画布已是 success 且该节点**没有未结清的任务登记** → 已交付。
	//     加后半句是为了防「上一次生成的旧 success」被当成这次的交付凭据：
	//     只要这次还挂着一笔没有取回结果的登记（= 扣了费、没交付），就必须按失败处理。
	var missing []string
	for _, id := range nodeIDs {
		if _, ok := delivered[id]; ok {
			continue
		}
		if canvasStatus[id] == "success" && llm.LoadAsyncTaskRef(ctx, exec.ID, id) == nil {
			continue
		}
		missing = append(missing, id)
	}

	if len(nodeIDs) > 0 && len(missing) == 0 {
		// ✅ 结果都在：这次执行实际是成功的，只是状态没写上去。补状态、不退费。
		h.reconcileCanvasNodes(ctx, exec.ProjectID, nodeIDs, delivered, "")
		for _, id := range nodeIDs {
			// 结果已取回，登记不该再留着（留着会被后续重试当成可复用的上游任务）
			llm.ClearAsyncTaskRef(exec.ID, id)
		}
		// 条件写：万一此刻正常路径刚好写了终态，不要覆盖它
		ok, err := h.execRepo.UpdateStatusIfActive(ctx, exec.ID, "done", "")
		if err != nil {
			log.Printf("[Watchdog] ⚠️ 执行 %d 补记成功失败: %v", exec.ID, err)
			return
		}
		if !ok {
			log.Printf("[Watchdog] 执行 %d 已被其它路径收口，跳过补记", exec.ID)
			return
		}
		log.Printf("[Watchdog] ✅ 执行 %d 的节点结果均已交付（产物已在对象存储/画布已标成功），补记为成功，不退费", exec.ID)
		return
	}

	msg := fmt.Sprintf("看门狗：执行已超过 %s 没有结果（进程中断或任务卡死），已判定失败并退还本次已扣积分",
		waited)
	log.Printf("[Watchdog] 判定执行卡死: execID=%d projectID=%s 已等待=%s 未交付节点=%d/%d",
		exec.ID, exec.ProjectID, waited, len(missing), len(nodeIDs))

	// 1) 只退还「已扣费但没交付」的那部分：登记里带着当初扣的金额与计费口径。
	//    已交付的节点在成功时就清掉了登记，这里再显式跳过一遍，确保「交付了就不退钱」。
	userID := ""
	refunded := int64(0)
	refundCount := 0
	for _, nodeID := range missing {
		ref := llm.LoadAsyncTaskRef(ctx, exec.ID, nodeID)
		if ref == nil || ref.ChargedAmount <= 0 {
			continue
		}
		if userID == "" {
			userID = h.ownerOfExecution(ctx, exec)
			if userID == "" {
				log.Printf("[Watchdog] 取不到执行 %d 的项目属主，跳过退费（需人工核对）", exec.ID)
				break
			}
		}
		// 认领登记（GETDEL）：并发副本/看门狗/重试里只有一个能退这笔钱
		claimed := llm.TakeAsyncTaskRef(exec.ID, nodeID)
		if claimed == nil || claimed.ChargedAmount <= 0 {
			continue
		}
		// 幂等：同一笔扣费只退一次
		if !llm.TryMarkRefunded(claimed.TaskID) {
			log.Printf("[Watchdog] 上游任务 %s 的扣费已退过，跳过（exec=%d node=%s）", claimed.TaskID, exec.ID, nodeID)
			continue
		}
		refundCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		// 渠道从任务登记带过来（登记里的 Provider 就是当初真实调用的渠道）：
		// 新 ctx 没有渠道信息，不带上就会按默认渠道记账，退费账单的渠道标签就错了
		if claimed.Provider != "" {
			refundCtx = llm.WithChannel(refundCtx, claimed.Provider)
		}
		extra := service.ChargeExtra{
			Resolution:      claimed.ChargeResolution,
			Seconds:         claimed.ChargeSeconds,
			RefVideoSeconds: claimed.ChargeRefSeconds,
		}
		err := h.billingService.Refund(refundCtx, userID, claimed.ChargedAmount,
			service.BillingActionVideo, claimed.Model, "视频生成",
			"看门狗：执行卡死且该节点未交付，退还本次扣费", extra)
		cancel()
		if err != nil {
			log.Printf("[Watchdog] ⚠️ 退还执行 %d 节点 %s 的扣费失败: %v", exec.ID, nodeID, err)
			llm.UnmarkRefunded(claimed.TaskID) // 撤标记，留给后续核对补退
			continue
		}
		refunded += claimed.ChargedAmount
		refundCount++
	}

	// 2) 按证据修正画布：已交付的保留成功（缺 URL 的补上），没交付的标 failed。
	//    不修正的话，节点会永久停在「生成中」（前端会原样恢复存盘里的 status）。
	h.reconcileCanvasNodes(ctx, exec.ProjectID, nodeIDs, delivered, msg)

	// 3) 执行落 failed：只有这里落了 failed，前端 active 列表才不再把它当「进行中」，
	//    重复提交闸门也会放开该节点。
	// 条件写：只在它仍然是 pending/running 时才判失败。
	// 若此刻正常路径已写 done（执行刚好跑完、产物已交付），绝不能覆盖成 failed。
	ok, err := h.execRepo.UpdateStatusIfActive(ctx, exec.ID, "failed", msg)
	if err != nil {
		log.Printf("[Watchdog] ⚠️ 执行 %d 状态落 failed 失败: %v", exec.ID, err)
		return
	}
	if !ok {
		log.Printf("[Watchdog] 执行 %d 已被其它路径收口（可能刚好成功），本次不判失败", exec.ID)
		return
	}
	log.Printf("[Watchdog] ✅ 已收口执行 %d：退还 %d 笔共 %d 积分", exec.ID, refundCount, refunded)
}

// ownerOfExecution 取该执行的用户（退费需要记账到人）
func (h *WorkflowHandler) ownerOfExecution(ctx context.Context, exec *model.WorkflowExecution) string {
	if h.projectRepo == nil || exec.ProjectID == "" {
		return ""
	}
	project, err := h.projectRepo.FindByID(ctx, exec.ProjectID)
	if err != nil || project == nil {
		return ""
	}
	return project.UserID
}

// deliveredByNode 取「本次执行期间确实产出」的节点产物证据（节点 ID → 类型与产物 URL）。
//
// 数据来源是 generation_history：节点产物上传成功后立刻落库（executor 用 detached ctx 写，
// 不随执行 ctx 取消而丢），是进程之外最可靠的「已交付」证据。
// 只认 started_at（/created_at）之后的记录：同一个节点可能被多次生成，
// 上一次的旧结果不能拿来证明这次交付了。
func (h *WorkflowHandler) deliveredByNode(ctx context.Context, exec *model.WorkflowExecution, nodeIDs []string) map[string]deliveredResult {
	out := make(map[string]deliveredResult)
	if h.generationHistoryService == nil || exec.ProjectID == "" || len(nodeIDs) == 0 {
		return out
	}
	since := exec.CreatedAt
	if exec.StartedAt != nil && !exec.StartedAt.IsZero() && exec.StartedAt.Before(since) {
		since = *exec.StartedAt
	}
	rows, err := h.generationHistoryService.LatestByProjectNodes(ctx, exec.ProjectID, nodeIDs, since)
	if err != nil {
		// 取不到证据时按「没交付」处理：宁可走失败路径（钱退给用户），也不能凭猜测记成功
		log.Printf("[Watchdog] 查询交付证据失败（按未交付处理）: exec=%d err=%v", exec.ID, err)
		return out
	}
	for _, row := range rows {
		if row.ResultURL == "" {
			continue
		}
		if _, ok := out[row.NodeID]; ok {
			continue // 已按 created_at 倒序，每个节点只取最新一条
		}
		out[row.NodeID] = deliveredResult{nodeType: row.NodeType, resultURL: row.ResultURL}
	}
	return out
}

// canvasNodeStatuses 读画布上这些节点的当前状态（节点 ID → status）
func (h *WorkflowHandler) canvasNodeStatuses(ctx context.Context, projectID string, nodeIDs []string) map[string]string {
	out := make(map[string]string)
	dsl, canvas := h.loadCanvasDSL(ctx, projectID)
	if dsl == nil || canvas == nil {
		return out
	}
	want := make(map[string]bool, len(nodeIDs))
	for _, id := range nodeIDs {
		want[id] = true
	}
	for i := range dsl.Nodes {
		if !want[dsl.Nodes[i].ID] {
			continue
		}
		var data struct {
			Status string `json:"status"`
		}
		if err := json.Unmarshal(dsl.Nodes[i].Data, &data); err == nil {
			out[dsl.Nodes[i].ID] = data.Status
		}
	}
	return out
}

// reconcileCanvasNodes 按证据修正画布的节点状态：
//   - 有产物证据的节点：补上产物 URL、标 success、清掉旧 error（保留已交付的成果，
//     这是「明明生成了却说还在 running」的正解）；
//   - 其余仍处于 running/pending 的节点：标 failed 并写入原因（failMsg 为空表示本次不算失败）；
//   - 已经是 success/failed 且没有新证据的节点：不动（不破坏既有结果）。
func (h *WorkflowHandler) reconcileCanvasNodes(ctx context.Context, projectID string, nodeIDs []string, delivered map[string]deliveredResult, failMsg string) {
	dsl, canvas := h.loadCanvasDSL(ctx, projectID)
	if dsl == nil || canvas == nil {
		return
	}
	want := make(map[string]bool, len(nodeIDs))
	for _, id := range nodeIDs {
		want[id] = true
	}
	repaired, failed := 0, 0
	changed := false
	for i := range dsl.Nodes {
		id := dsl.Nodes[i].ID
		if !want[id] {
			continue
		}
		var data map[string]json.RawMessage
		if err := json.Unmarshal(dsl.Nodes[i].Data, &data); err != nil {
			data = make(map[string]json.RawMessage)
		}
		var status string
		_ = json.Unmarshal(data["status"], &status)

		if d, ok := delivered[id]; ok {
			// 已交付：URL 与状态都按证据写回（进程死在收尾前时画布可能还停在 running）
			field := "videoUrl"
			if d.nodeType == "image" {
				field = "imageUrl"
			}
			urlBytes, _ := json.Marshal(d.resultURL)
			data[field] = urlBytes
			data["status"], _ = json.Marshal("success")
			delete(data, "error")
			repaired++
		} else if failMsg != "" && (status == "running" || status == "pending") {
			data["status"], _ = json.Marshal("failed")
			data["error"], _ = json.Marshal(failMsg)
			failed++
		} else {
			continue
		}

		if merged, err := json.Marshal(data); err == nil {
			dsl.Nodes[i].Data = merged
			changed = true
		}
	}
	if !changed {
		return
	}
	updated, err := json.Marshal(dsl)
	if err != nil {
		return
	}
	canvas.Content = datatypes.JSON(updated)
	if err := h.canvasRepo.Save(ctx, canvas); err != nil {
		log.Printf("[Watchdog] ⚠️ 画布节点修正落库失败: projectID=%s err=%v", projectID, err)
		return
	}
	log.Printf("[Watchdog] 画布节点已修正: projectID=%s 补回产物=%d 标失败=%d", projectID, repaired, failed)
}

// loadCanvasDSL 读取并解析画布；任何一步失败都返回 (nil, nil) 让调用方跳过修正
func (h *WorkflowHandler) loadCanvasDSL(ctx context.Context, projectID string) (*engine.CanvasDSL, *model.Canvas) {
	if h.canvasRepo == nil || projectID == "" {
		return nil, nil
	}
	canvas, err := h.canvasRepo.FindByProjectID(ctx, projectID)
	if err != nil || canvas == nil || len(canvas.Content) == 0 {
		return nil, nil
	}
	var dsl engine.CanvasDSL
	if err := json.Unmarshal([]byte(canvas.Content), &dsl); err != nil {
		log.Printf("[Watchdog] 解析画布失败: projectID=%s err=%v", projectID, err)
		return nil, nil
	}
	return &dsl, canvas
}

// parseExecutionNodeIDs 解析执行记录里的节点 ID 列表
func parseExecutionNodeIDs(raw datatypes.JSON) []string {
	if len(raw) == 0 {
		return nil
	}
	var ids []string
	if err := json.Unmarshal(raw, &ids); err != nil {
		return nil
	}
	return ids
}
