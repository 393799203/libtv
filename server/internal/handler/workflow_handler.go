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
	"libtv/internal/model"
	"libtv/internal/repository"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
	"gorm.io/datatypes"
)

type WorkflowHandler struct {
	execRepo   repository.ExecutionRepo
	aiTaskRepo repository.AITaskRepo
	canvasRepo repository.CanvasRepo
	engine     *engine.WorkflowEngine
	registry   *engine.ExecutorRegistry
}

func NewWorkflowHandler(
	execRepo repository.ExecutionRepo,
	aiTaskRepo repository.AITaskRepo,
	canvasRepo repository.CanvasRepo,
	eng *engine.WorkflowEngine,
	registry *engine.ExecutorRegistry,
) *WorkflowHandler {
	return &WorkflowHandler{
		execRepo:   execRepo,
		aiTaskRepo: aiTaskRepo,
		canvasRepo: canvasRepo,
		engine:     eng,
		registry:   registry,
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
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "projectId is required"})
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

	// 从 CanvasRepo 加载最新画布
	canvas, err := h.canvasRepo.FindByProjectID(c.Request.Context(), projectID)
	if err != nil || canvas == nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "canvas not found for project: " + projectID})
		return
	}
	canvasData := []byte(canvas.Content)

	// 解析 → 校验 → 拓扑排序
	schema, err := engine.Parse(canvasData)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "parse canvas failed: " + err.Error()})
		return
	}

	if err := engine.Validate(schema); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "validate failed: " + err.Error()})
		return
	}

	plan, err := engine.TopologicalSort(schema)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "topological sort failed: " + err.Error()})
		return
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
			c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "filter plan failed: " + err.Error()})
			return
		}
	}

	// 创建执行记录
	now := time.Now()
	exec := &model.WorkflowExecution{
		ProjectID:      projectID,
		CanvasSnapshot: datatypes.JSON(canvasData),
		Status:         "running",
		StartedAt:      &now,
	}
	if err := h.execRepo.Create(c.Request.Context(), exec); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": err.Error()})
		return
	}

	// 异步执行工作流 + 回写节点 output 到 Canvas
	go func() {
		log.Printf("[Handler] async execute start: executionID=%d, projectID=%s, startNodeID=%s", exec.ID, projectID, startNodeID)
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()

		err := h.engine.Execute(ctx, plan, exec.ID)
		if err != nil {
			log.Printf("[Handler] engine.Execute returned error: %v", err)
		} else {
			log.Printf("[Handler] engine.Execute done")
		}

		status := "done"
		errMsg := ""
		if err != nil {
			status = "failed"
			errMsg = err.Error()
		}

		// 把每个节点的 output 回写到画布（持久化生成的 content / 后续字段）
		h.persistNodeOutputs(ctx, canvas, plan)
		log.Printf("[Handler] persistNodeOutputs done: executionID=%d", exec.ID)

		finishTime := time.Now()
		exec.FinishedAt = &finishTime
		h.execRepo.UpdateStatus(ctx, exec.ID, status, errMsg)
		log.Printf("[Handler] execution %d final status=%s", exec.ID, status)
	}()

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{"executionId": exec.ID},
	})
}

func (h *WorkflowHandler) GetExecution(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("execId"), 10, 64)
	exec, err := h.execRepo.FindByID(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "msg": "execution not found"})
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

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": resp})
}

// StreamExecution SSE 流式订阅工作流执行事件
// 鉴权：原生 EventSource 不支持自定义 header，token 走 query (?t=xxx)；
//      也兼容标准 Authorization 头（Postman/curl 测试时方便）
// 路径: GET /api/projects/:id/workflows/:execId/stream
func (h *WorkflowHandler) StreamExecution(c *gin.Context) {
	// 1) 鉴权：query token 优先，header 次之
	tokenStr := c.Query("t")
	if tokenStr == "" {
		authHeader := c.GetHeader("Authorization")
		tokenStr = strings.TrimPrefix(authHeader, "Bearer ")
	}
	if tokenStr == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 401, "msg": "missing token"})
		return
	}
	if _, err := jwt.Parse(tokenStr, func(t *jwt.Token) (interface{}, error) {
		return []byte(config.C.JWT.Secret), nil
	}); err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 401, "msg": "invalid token"})
		return
	}

	execIDStr := c.Param("execId")
	execID, err := strconv.ParseInt(execIDStr, 10, 64)
	if err != nil || execID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "invalid execId"})
		return
	}

	// 确认执行存在（避免订阅一个不存在的 execution）
	if _, err := h.execRepo.FindByID(c.Request.Context(), execID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "msg": "execution not found"})
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
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "streaming not supported"})
		return
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

		// 2) 回写 content（来自引擎输出）
		if out, ok := outputs[n.ID]; ok && out.Status == "success" {
			if content, ok := out.Data["content"].(string); ok && content != "" {
				contentBytes, _ := json.Marshal(content)
				existing["content"] = contentBytes
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
