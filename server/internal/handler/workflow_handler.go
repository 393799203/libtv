package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"libtv/internal/engine"
	"libtv/internal/model"
	"libtv/internal/repository"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"gorm.io/datatypes"
)

var wsUpgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

type WorkflowHandler struct {
	execRepo   repository.ExecutionRepo
	aiTaskRepo repository.AITaskRepo
	engine     *engine.WorkflowEngine
	registry   *engine.ExecutorRegistry
}

func NewWorkflowHandler(
	execRepo repository.ExecutionRepo,
	aiTaskRepo repository.AITaskRepo,
	eng *engine.WorkflowEngine,
	registry *engine.ExecutorRegistry,
) *WorkflowHandler {
	return &WorkflowHandler{
		execRepo:   execRepo,
		aiTaskRepo: aiTaskRepo,
		engine:     eng,
		registry:   registry,
	}
}

type ExecuteRequest struct {
	ProjectID   string          `json:"projectId" binding:"required"`
	CanvasData  json.RawMessage `json:"canvasData" binding:"required"`
}

func (h *WorkflowHandler) Execute(c *gin.Context) {
	var req ExecuteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": err.Error()})
		return
	}

	// 解析 → 校验 → 拓扑排序
	schema, err := engine.Parse(req.CanvasData)
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

	// 创建执行记录
	now := time.Now()
	exec := &model.WorkflowExecution{
		ProjectID:      req.ProjectID,
		CanvasSnapshot: datatypes.JSON(req.CanvasData),
		Status:         "running",
		StartedAt:      &now,
	}
	if err := h.execRepo.Create(c.Request.Context(), exec); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": err.Error()})
		return
	}

	// 异步执行工作流
	go func() {
		ctx := context.Background()
		err := h.engine.Execute(ctx, plan, exec.ID)

		status := "done"
		errMsg := ""
		if err != nil {
			status = "failed"
			errMsg = err.Error()
		}
		h.execRepo.UpdateStatus(ctx, exec.ID, status, errMsg)
	}()

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{"executionId": exec.ID},
	})
}

func (h *WorkflowHandler) GetExecution(c *gin.Context) {
	id, _ := strconv.ParseInt(c.Param("id"), 10, 64)
	exec, err := h.execRepo.FindByID(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "msg": "execution not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": exec})
}

// WebSocket handler for execution progress
func (h *WorkflowHandler) WebSocket(c *gin.Context) {
	conn, err := wsUpgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	// 监听引擎事件并推送
	eventCh := h.engine.Events()
	for {
		select {
		case event, ok := <-eventCh:
			if !ok {
				return
			}
			data, _ := json.Marshal(event)
			if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
				return
			}
		case <-c.Request.Context().Done():
			return
		}
	}
}
