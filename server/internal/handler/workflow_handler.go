package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"libtv/internal/config"
	"libtv/internal/engine"
	"libtv/internal/llm"
	"libtv/internal/model"
	"libtv/internal/pkg/response"
	"libtv/internal/queue"
	"libtv/internal/repository"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"gorm.io/datatypes"
)

type WorkflowHandler struct {
	execRepo    repository.ExecutionRepo
	aiTaskRepo  repository.AITaskRepo
	canvasRepo  repository.CanvasRepo
	projectRepo repository.ProjectRepo
	engine      *engine.WorkflowEngine
	registry    *engine.ExecutorRegistry
	// genQueue 生成任务队列：非 nil 时生成任务入 Redis Stream 由 worker 消费
	// （进程重启不丢任务、失败重试、并发受控）；为 nil 时降级为进程内直接起协程
	genQueue *queue.Queue
}

// SetQueue 注入生成任务队列（传 nil 表示降级为进程内执行）
func (h *WorkflowHandler) SetQueue(q *queue.Queue) { h.genQueue = q }

func NewWorkflowHandler(
	execRepo repository.ExecutionRepo,
	aiTaskRepo repository.AITaskRepo,
	canvasRepo repository.CanvasRepo,
	projectRepo repository.ProjectRepo,
	eng *engine.WorkflowEngine,
	registry *engine.ExecutorRegistry,
) *WorkflowHandler {
	return &WorkflowHandler{
		execRepo:    execRepo,
		aiTaskRepo:  aiTaskRepo,
		canvasRepo:  canvasRepo,
		projectRepo: projectRepo,
		engine:      eng,
		registry:    registry,
	}
}

type ExecuteRequest struct {
	ProjectID   string `json:"projectId"`
	StartNodeID string `json:"startNodeId"`
	// Mode 控制执行粒度：
	//   ""          → 全图执行（默认）
	//   "single"    → 只跑 StartNodeID 一个节点（用于节点内"生成"按钮）
	//   "downstream"→ 跑 StartNodeID + 所有 BFS 后代（"重新生成下游"按钮）
	Mode string `json:"mode"`
}

func (h *WorkflowHandler) Execute(c *gin.Context) {
	// 支持多种入参方式：
	// 1) 路径参数 /api/projects/:id/workflows/execute
	// 2) Query projectId
	// 3) Body { projectId, startNodeId }
	projectID := c.Param("id")
	if projectID == "" {
		projectID = c.Query("projectId")
	}

	var req ExecuteRequest
	// body 可选；若 body 解析失败忽略（按无 body 处理）
	_ = c.ShouldBindJSON(&req)
	if projectID == "" {
		projectID = req.ProjectID
	}
	if projectID == "" {
		response.Fail(c, http.StatusBadRequest, "projectId is required")
		return
	}

	// startNodeId 也支持 query 传
	startNodeID := c.Query("startNodeId")
	if startNodeID == "" {
		startNodeID = req.StartNodeID
	}
	mode := req.Mode
	if mode == "" {
		mode = c.Query("mode")
	}

	// 加载画布 → 校验 → 拓扑排序 → 按 mode 裁剪
	// （与队列 worker 共用 buildPlan，保证两条路径行为一致）
	canvas, plan, ownerUserID, err := h.buildPlan(c.Request.Context(), projectID, startNodeID, mode)
	if err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	canvasData := []byte(canvas.Content)

	// 本次执行实际涉及的节点，供前端重进项目时恢复「生成中」状态
	nodeIDsJSON, _ := json.Marshal(planNodeIDs(plan))

	// 创建执行记录。
	// 状态先置 pending：任务被 worker 真正取走时才转 running（见 HandleQueuedTask），
	// 这样排队中的任务在前端显示为「等待生成中」，而不是假装已经在跑。
	// StartedAt 记入队时刻，便于前端显示已等待时长。
	now := time.Now()
	exec := &model.WorkflowExecution{
		ProjectID:      projectID,
		CanvasSnapshot: datatypes.JSON(canvasData),
		Status:         "pending",
		StartedAt:      &now,
		NodeIDs:        datatypes.JSON(nodeIDsJSON),
	}
	if err := h.execRepo.Create(c.Request.Context(), exec); err != nil {
		response.FailWith(c, err)
		return
	}

	// 派发执行：
	//  - 队列可用：任务入 Redis Stream，由 worker 消费
	//    （进程重启不丢任务、失败按退避重试、worker 数即并发闸门）
	//  - 队列不可用或入队失败：降级为进程内起协程（原行为）
	if h.genQueue != nil {
		task := queue.Task{
			ExecutionID: exec.ID,
			ProjectID:   projectID,
			UserID:      ownerUserID,
			StartNodeID: startNodeID,
			Mode:        mode,
		}
		if qErr := h.genQueue.Enqueue(c.Request.Context(), task); qErr == nil {
			log.Printf("[Handler] 任务已入队: executionID=%d projectID=%s startNodeID=%s mode=%s",
				exec.ID, projectID, startNodeID, mode)
			response.OK(c, gin.H{"executionId": exec.ID, "queued": true})
			return
		} else {
			log.Printf("[Handler] 入队失败，降级为进程内执行: %v", qErr)
		}
	}
	h.runExecutionAsync(exec.ID, projectID, ownerUserID, canvas, plan)
	response.OK(c, gin.H{"executionId": exec.ID})
}

// ==================== 执行计划构建与执行（HTTP 入口与队列 worker 共用）====================

// planNodeIDs 取出计划中实际要执行的节点 ID
// （plan.Levels 是经 mode 裁剪后的真实执行集合，非全图）
func planNodeIDs(plan *engine.ExecutionPlan) []string {
	if plan == nil {
		return nil
	}
	ids := make([]string, 0, len(plan.Levels))
	for _, level := range plan.Levels {
		for _, n := range level {
			ids = append(ids, n.ID)
		}
	}
	return ids
}

// GetActiveExecutions 查询项目下仍在进行中的执行（pending/running）。
// 前端进入项目时调用：把仍在跑的节点恢复为「生成中」并重建进度订阅，
// 避免用户退出再回来后以为没在生成而重复点击（重复生成、重复扣费）。
func (h *WorkflowHandler) GetActiveExecutions(c *gin.Context) {
	projectID := c.Param("id")
	execs, err := h.execRepo.ListActiveByProject(c.Request.Context(), projectID)
	if err != nil {
		response.FailWith(c, err)
		return
	}
	list := make([]gin.H, 0, len(execs))
	for _, e := range execs {
		var nodeIDs []string
		if len(e.NodeIDs) > 0 {
			if uErr := json.Unmarshal(e.NodeIDs, &nodeIDs); uErr != nil {
				nodeIDs = nil
			}
		}
		list = append(list, gin.H{
			"executionId": e.ID,
			"status":      e.Status,
			"startedAt":   e.StartedAt,
			"nodeIds":     nodeIDs,
		})
	}
	response.OK(c, gin.H{"executions": list})
}

// buildPlan 加载画布 → 校验 → 拓扑排序 → 按 mode 裁剪，产出可执行计划。
// startNodeID 为空表示全图执行；mode=downstream 跑该节点及其所有后代，否则只跑该节点。
func (h *WorkflowHandler) buildPlan(ctx context.Context, projectID, startNodeID, mode string) (*model.Canvas, *engine.ExecutionPlan, string, error) {
	canvas, err := h.canvasRepo.FindByProjectID(ctx, projectID)
	if err != nil || canvas == nil {
		return nil, nil, "", fmt.Errorf("canvas not found for project: %s", projectID)
	}

	// 项目属主：生成文件存到 users/<userID>/canvas/<projectID>/；
	// 查不到时执行器降级存 canvas/<projectID>/
	ownerUserID := ""
	if project, pErr := h.projectRepo.FindByID(ctx, projectID); pErr == nil && project != nil {
		ownerUserID = project.UserID
	}

	schema, err := engine.Parse([]byte(canvas.Content))
	if err != nil {
		return nil, nil, "", fmt.Errorf("parse canvas failed: %w", err)
	}
	if err := engine.Validate(schema); err != nil {
		return nil, nil, "", fmt.Errorf("validate failed: %w", err)
	}
	plan, err := engine.TopologicalSort(schema)
	if err != nil {
		return nil, nil, "", fmt.Errorf("topological sort failed: %w", err)
	}

	// 按 mode 裁剪 plan
	// 注意：当前 MVP 的 executor 不消费上游输出，所以"单节点"和"上游节点重跑"语义重合。
	// 保留 single / downstream 两个粒度足以覆盖所有用户操作（节点内生成 / 重新生成下游）。
	if startNodeID != "" {
		switch mode {
		case "downstream":
			plan, err = engine.FilterDownstream(plan, startNodeID)
		default:
			// 不传 mode / 传 "single" / 传未知值：都按"只跑这一个节点"处理
			plan, err = engine.FilterSingle(plan, startNodeID)
		}
		if err != nil {
			return nil, nil, "", fmt.Errorf("filter plan failed: %w", err)
		}
	}
	return canvas, plan, ownerUserID, nil
}

// runExecutionAsync 降级路径：进程内起协程执行（原行为，进程重启会中断该任务）
func (h *WorkflowHandler) runExecutionAsync(execID int64, projectID, ownerUserID string, canvas *model.Canvas, plan *engine.ExecutionPlan) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()
		_ = h.runExecution(ctx, execID, projectID, ownerUserID, canvas, plan)
	}()
}

// runExecution 执行工作流 → 回写节点输出 → 更新执行状态。
// 返回 engine 的执行错误（队列据此决定是否重试；降级路径忽略该返回值）
func (h *WorkflowHandler) runExecution(ctx context.Context, execID int64, projectID, ownerUserID string, canvas *model.Canvas, plan *engine.ExecutionPlan) error {
	log.Printf("[Handler] execute start: executionID=%d, projectID=%s", execID, projectID)
	execErr := h.engine.Execute(ctx, plan, execID, projectID, ownerUserID)
	if execErr != nil {
		log.Printf("[Handler] engine.Execute returned error: %v", execErr)
	} else {
		log.Printf("[Handler] engine.Execute done")
	}

	// 把每个节点的 output 回写到画布（持久化生成的 content / 后续字段）
	h.persistNodeOutputs(ctx, canvas, plan)
	log.Printf("[Handler] persistNodeOutputs done: executionID=%d", execID)

	status := "done"
	errMsg := ""
	if execErr != nil {
		status = "failed"
		errMsg = execErr.Error()
	} else {
		// 执行成功：清理本执行遗留的异步任务登记（节点内正常路径已清理，此处兜底）。
		// 失败时**不清理** —— 那些已提交但还没取回结果的上游任务要留给重试继续复用。
		llm.ClearAsyncTaskRefsOfExecution(execID)
	}
	h.execRepo.UpdateStatus(ctx, execID, status, errMsg)
	log.Printf("[Handler] execution %d final status=%s", execID, status)
	return execErr
}

// HandleQueuedTask 队列消费者回调（由 queue 包调用）。
// worker 可能运行在另一个进程、或运行在进程重启之后，因此这里**重新加载画布并重建执行计划**，
// 不复用入队时的内存对象 —— 这正是"重启后续跑"赖以成立的基础。
func (h *WorkflowHandler) HandleQueuedTask(ctx context.Context, t queue.Task) error {
	// 幂等：已成功（done）的执行不再重跑，避免重复生成与重复扣费；
	// failed 允许重试，所以这里只拦 done
	if exec, err := h.execRepo.FindByID(ctx, t.ExecutionID); err == nil && exec != nil && exec.Status == "done" {
		log.Printf("[Handler] 执行 %d 已成功，跳过重复投递", t.ExecutionID)
		return nil
	}

	canvas, plan, ownerUserID, err := h.buildPlan(ctx, t.ProjectID, t.StartNodeID, t.Mode)
	if err != nil {
		// 永久性错误（画布被删、DSL 校验失败等）：重试无意义，判失败并确认消息
		log.Printf("[Handler] 重建执行计划失败（不重试）: executionID=%d err=%v", t.ExecutionID, err)
		h.execRepo.UpdateStatus(ctx, t.ExecutionID, "failed", err.Error())
		return nil
	}

	// 重试场景下状态复位为 running，便于前端展示"进行中"
	_ = h.execRepo.UpdateStatus(ctx, t.ExecutionID, "running", "")

	// 单任务超时与降级路径保持一致（10 分钟）
	runCtx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	return h.runExecution(runCtx, t.ExecutionID, t.ProjectID, ownerUserID, canvas, plan)
}

func (h *WorkflowHandler) GetExecution(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("execId"), 10, 64)
	exec, err := h.execRepo.FindByID(c.Request.Context(), id)
	if err != nil {
		response.Fail(c, http.StatusNotFound, "execution not found")
		return
	}

	// 基础响应：执行状态
	resp := gin.H{
		"id":          exec.ID,
		"project_id":  exec.ProjectID,
		"status":      exec.Status,
		"error_msg":   exec.ErrorMsg,
		"started_at":  exec.StartedAt,
		"finished_at": exec.FinishedAt,
	}

	// 如果传了 nodeId，额外返回该节点的最新数据（从画布中提取）
	if nodeID := c.Query("nodeId"); nodeID != "" {
		canvas, err := h.canvasRepo.FindByProjectID(c.Request.Context(), exec.ProjectID)
		if err == nil && canvas.Content != nil {
			var canvasData struct {
				Nodes []json.RawMessage `json:"nodes"`
			}
			if json.Unmarshal(canvas.Content, &canvasData) == nil {
				for _, n := range canvasData.Nodes {
					var node struct {
						ID   string          `json:"id"`
						Data json.RawMessage `json:"data"`
					}
					if json.Unmarshal(n, &node) == nil && node.ID == nodeID {
						resp["node_data"] = node.Data
						break
					}
				}
			}
		}
	}

	response.OK(c, resp)
}

// StreamExecution SSE 流式订阅工作流执行事件
// 鉴权：原生 EventSource 不支持自定义 header，token 走 query (?t=xxx)；
//
//	也兼容标准 Authorization 头（Postman/curl 测试时方便）
//
// 路径: GET /api/projects/:id/workflows/:execId/stream
func (h *WorkflowHandler) StreamExecution(c *gin.Context) {
	// 1) 鉴权：query token 优先，header 次之
	tokenStr := c.Query("t")
	if tokenStr == "" {
		authHeader := c.GetHeader("Authorization")
		tokenStr = strings.TrimPrefix(authHeader, "Bearer ")
	}
	if tokenStr == "" {
		response.Fail(c, http.StatusUnauthorized, "missing token")
		return
	}
	if _, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
		return []byte(config.C.JWT.Secret), nil
	}); err != nil {
		response.Fail(c, http.StatusUnauthorized, "invalid token")
		return
	}

	execIDStr := c.Param("execId")
	execID, err := strconv.ParseInt(execIDStr, 10, 64)
	if err != nil || execID <= 0 {
		response.Fail(c, http.StatusBadRequest, "invalid execId")
		return
	}

	// 确认执行存在（避免订阅一个不存在的 execution）
	if _, err := h.execRepo.FindByID(c.Request.Context(), execID); err != nil {
		response.Fail(c, http.StatusNotFound, "execution not found")
		return
	}

	// SSE 标准头
	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")
	c.Writer.Header().Set("X-Accel-Buffering", "no") // 禁用 nginx 缓冲
	c.Writer.WriteHeader(http.StatusOK)
	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		response.Fail(c, http.StatusInternalServerError, "streaming not supported")
		return
	}

	// 获取执行记录并立即推送当前状态
	exec, err := h.execRepo.FindByID(c.Request.Context(), execID)
	if err == nil {
		// ✅ 立即推送当前状态（包含type字段，方便前端识别事件类型）
		var eventType string
		if exec.Status == "failed" {
			eventType = "execution_failed"
		} else if exec.Status == "done" {
			eventType = "execution_completed"
		} else {
			eventType = "execution_started"
		}
		statusEvent := map[string]interface{}{
			"type":        eventType, // ✅ 添加type字段，前端需要这个字段识别事件类型
			"executionId": execID,
			"status":      exec.Status,
			"errorMsg":    exec.ErrorMsg,
		}
		if exec.Status == "failed" || exec.Status == "done" {
			// 如果执行已经结束，立即推送终态事件
			payload, _ := json.Marshal(statusEvent)
			fmt.Fprintf(c.Writer, "event: %s\ndata: %s\n\n", eventType, string(payload))
			flusher.Flush()
			log.Printf("[SSE] pushed final status: execID=%d status=%s type=%s", execID, exec.Status, eventType)
			return // 执行已结束，直接返回，不再订阅后续事件
		} else {
			// 执行还在运行，推送当前状态
			payload, _ := json.Marshal(statusEvent)
			fmt.Fprintf(c.Writer, "event: %s\ndata: %s\n\n", eventType, string(payload))
			flusher.Flush()
		}
	}

	// 订阅引擎事件
	eventCh := h.engine.Subscribe(execID)
	defer h.engine.Unsubscribe(execID, eventCh)

	// 立即推一条 connected 事件
	fmt.Fprintf(c.Writer, "event: connected\ndata: {\"executionId\":%d}\n\n", execID)
	flusher.Flush()

	// 心跳：每 15s 一条注释行，防止代理切断
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()

	// 客户端断开检测
	disconnected := c.Request.Context().Done()

	for {
		select {
		case <-disconnected:
			log.Printf("[SSE] client disconnected: execID=%d", execID)
			return
		case <-heartbeat.C:
			// 用真实 event 而不是 SSE 注释行：
			// - 注释行只有部分代理会识别为"活动"
			// - 真实 event 客户端 EventSource 一定会触发 message，更新前端超时熔断器
			if _, err := fmt.Fprintf(c.Writer, "event: heartbeat\ndata: {\"ts\":%d}\n\n", time.Now().UnixMilli()); err != nil {
				return
			}
			flusher.Flush()
		case event, ok := <-eventCh:
			if !ok {
				return
			}
			payload, _ := json.Marshal(event)
			if _, err := fmt.Fprintf(c.Writer, "event: %s\ndata: %s\n\n", event.Type, string(payload)); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

// toInt 把引擎输出里的数值字段转成 int（Go 侧是 int，经 JSON 往返可能是 float64/json.Number）
func toInt(v interface{}) (int, bool) {
	switch n := v.(type) {
	case int:
		return n, true
	case int64:
		return int(n), true
	case float64:
		return int(n), true
	case json.Number:
		if i, err := n.Int64(); err == nil {
			return int(i), true
		}
	}
	return 0, false
}

// persistNodeOutputs 把执行结果回写到画布节点 data 中
// - 把用户输入的 prompt 写回 data.prompt（持久化提示词）
// - 把生成的 content 写回 data.content（持久化生成结果）
func (h *WorkflowHandler) persistNodeOutputs(ctx context.Context, canvas *model.Canvas, plan *engine.ExecutionPlan) {
	if canvas == nil || plan == nil {
		return
	}

	// 解析当前画布内容
	var dsl engine.CanvasDSL
	if err := json.Unmarshal([]byte(canvas.Content), &dsl); err != nil {
		return
	}

	// 从引擎拿到本次所有节点输出
	outputs := h.engine.LastOutputs()

	for i := range dsl.Nodes {
		n := dsl.Nodes[i]
		var existing map[string]json.RawMessage
		if err := json.Unmarshal(n.Data, &existing); err != nil {
			existing = make(map[string]json.RawMessage)
		}

		// 1) 回写 prompt（来自 plan 节点的原始 data）
		for _, planNode := range plan.Schema.Nodes {
			if planNode.ID != n.ID {
				continue
			}
			var nodeData struct {
				Prompt string `json:"prompt"`
			}
			if err := json.Unmarshal(planNode.Data, &nodeData); err == nil && nodeData.Prompt != "" {
				promptBytes, _ := json.Marshal(nodeData.Prompt)
				existing["prompt"] = promptBytes
			}
			break
		}

		// 2) 回写节点状态与引擎产物。
		// 状态单独回写：前端徽章/Done 判定看 status，媒体内容看 imageUrl/videoUrl，
		// 两者缺一都会出现"图有了但节点还是未生成"这类矛盾显示。
		//
		// 产物字段必须覆盖多媒体：原来只回写 content（文本/剧本类），
		// 图片 imageUrl/imageUrls、视频 videoUrl 都落不下 —— 于是「生成后还没等前端保存
		// 就退出/刷新页面」时，积分已扣但结果永久丢失（前端写回是另一条独立路径，
		// 关掉页面就没了）。这里按字段名逐一合并，与前端类型保持一致。
		if out, ok := outputs[n.ID]; ok {
			if out.Status != "" {
				statusBytes, _ := json.Marshal(out.Status)
				existing["status"] = statusBytes
			}
			if out.Status == "success" {
				// 成功时清掉历史错误：否则"失败过一次、之后重试成功"的节点
				// 会一直挂着旧 error，前端红框与错误文案不会消失。
				delete(existing, "error")
				for _, field := range []string{"content", "imageUrl", "videoUrl", "thumbUrl"} {
					if v, ok := out.Data[field].(string); ok && v != "" {
						fieldBytes, _ := json.Marshal(v)
						existing[field] = fieldBytes
					}
				}
				// 尺寸必须回写：前端右上角显示的是原图尺寸，缺了它前端只能加载图片来测，
				// 而画布渲染的是缩略图 —— 测出来就是缩略图尺寸（2560×1440 的图显示成 640×360）。
				for _, field := range []string{"width", "height"} {
					if n, ok := toInt(out.Data[field]); ok && n > 0 {
						nBytes, _ := json.Marshal(n)
						existing[field] = nBytes
					}
				}
				// 多图场景（imageUrls 为数组）
				if urls, ok := out.Data["imageUrls"].([]string); ok && len(urls) > 0 {
					urlsBytes, _ := json.Marshal(urls)
					existing["imageUrls"] = urlsBytes
				}
			} else if out.Error != "" {
				// 失败原因必须回写画布：前端 BaseNode 读 data.error 才显示红框和具体原因
				// （只写 status 会变成"失败了但不知道为什么"，重进项目更是什么都没有）。
				errBytes, _ := json.Marshal(out.Error)
				existing["error"] = errBytes
			}
		}

		merged, err := json.Marshal(existing)
		if err != nil {
			continue
		}
		dsl.Nodes[i].Data = merged
	}

	// 写回
	updated, err := json.Marshal(dsl)
	if err != nil {
		return
	}
	canvas.Content = datatypes.JSON(updated)
	_ = h.canvasRepo.Save(ctx, canvas)
}
