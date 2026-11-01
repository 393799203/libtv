package handler

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"

	"libtv/internal/assistant"
	"libtv/internal/idem"
	"libtv/internal/llm"
	"libtv/internal/middleware"
	"libtv/internal/model"
	"libtv/internal/pkg/response"
	"libtv/internal/repository"
	"libtv/internal/service"

	"gorm.io/datatypes"
	"gorm.io/gorm"
)

type assistantChatClient interface {
	ChatWithModel(context.Context, string, string, string, ...llm.Option) (*llm.ChatResponse, error)
}

type CanvasAssistantHandler struct {
	client   assistantChatClient
	models   *llm.ModelManager
	projects repository.ProjectRepo
	channels *service.ChannelService
	idem     *idem.Store
	limiter  *recognizeLimiter
	db       *gorm.DB
}

func NewCanvasAssistantHandler(client assistantChatClient, models *llm.ModelManager, projects repository.ProjectRepo, channels *service.ChannelService, store *idem.Store, db *gorm.DB) *CanvasAssistantHandler {
	return &CanvasAssistantHandler{client, models, projects, channels, store, newRecognizeLimiter(12), db}
}

type assistantMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type assistantChatRequest struct {
	Message  string             `json:"message"`
	Model    string             `json:"model"`
	History  []assistantMessage `json:"history"`
	Snapshot assistant.Snapshot `json:"snapshot"`
}

type assistantChatResponse struct {
	Plan     *assistant.Plan `json:"plan"`
	Model    string          `json:"model"`
	Charged  int64           `json:"charged"`
	Replayed bool            `json:"replayed,omitempty"`
}

func (h *CanvasAssistantHandler) Chat(c *gin.Context) {
	// Ownership is checked before parsing user-controlled context or charging.
	userID := middleware.GetUserID(c)
	if userID == "" {
		response.Fail(c, http.StatusUnauthorized, "请先登录")
		return
	}
	project, err := h.projects.FindByID(c.Request.Context(), c.Param("id"))
	if err != nil || project == nil || project.UserID != userID {
		response.Fail(c, http.StatusNotFound, "项目不存在或无权访问")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 256*1024)
	var req assistantChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "对话参数无效或上下文过大")
		return
	}
	req.Message = strings.TrimSpace(req.Message)
	if req.Message == "" || utf8.RuneCountInString(req.Message) > 4000 || len(req.History) > 16 {
		response.Fail(c, http.StatusBadRequest, "请输入4000字以内的指令，历史最多16条")
		return
	}
	historyRunes := 0
	for _, m := range req.History {
		historyRunes += utf8.RuneCountInString(m.Content)
		if (m.Role != "user" && m.Role != "assistant") || utf8.RuneCountInString(m.Content) > 6000 {
			response.Fail(c, http.StatusBadRequest, "对话历史无效")
			return
		}
	}
	if historyRunes > 24000 {
		response.Fail(c, http.StatusBadRequest, "历史对话过长，请清空对话后重试")
		return
	}
	if err := assistant.ValidateSnapshot(req.Snapshot); err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}
	channel := "wasu"
	if h.channels != nil {
		channel = h.channels.ResolveUserChannel(c.Request.Context(), userID)
	}
	var selected *llm.ModelConfig
	if h.models != nil {
		for _, m := range h.models.ListModelsForChannel(channel)["llm"] {
			if !containsUsage(m.Usage, "text") {
				continue
			}
			if req.Model != "" && (m.ID == req.Model || m.ModelID == req.Model) {
				cp := m
				selected = &cp
				break
			}
			if req.Model == "" && (selected == nil || m.Default) {
				cp := m
				selected = &cp
			}
		}
	}
	if selected == nil {
		response.Fail(c, http.StatusBadRequest, "当前渠道没有可用的助手文本模型，请重新选择")
		return
	}
	payload, err := json.Marshal(req)
	if err != nil {
		response.Fail(c, http.StatusBadRequest, "上下文无法读取")
		return
	}
	key := idem.Fingerprint("canvas-assistant", userID, project.ID, selected.ModelID, string(payload))
	completed := false
	if h.idem != nil {
		state, cached, _ := h.idem.Begin(c.Request.Context(), key, 5*time.Minute)
		if state == idem.Done {
			var out assistantChatResponse
			if json.Unmarshal(cached, &out) == nil {
				out.Charged, out.Replayed = 0, true
				response.OK(c, out)
				return
			}
		}
		if state == idem.InFlight {
			response.Fail(c, http.StatusConflict, "这条指令正在处理中，请稍候")
			return
		}
		defer func() {
			if !completed {
				h.idem.Release(context.WithoutCancel(c.Request.Context()), key)
			}
		}()
	}
	if !h.limiter.allow(userID, time.Now()) {
		response.Fail(c, http.StatusTooManyRequests, "对话太频繁，请稍后再试")
		return
	}
	ctx := llm.WithUsageRecorder(llm.WithChannel(c.Request.Context(), channel))
	started := time.Now()
	callCtx, cancel := context.WithTimeout(ctx, 150*time.Second)
	defer cancel()
	budget := selected.MaxTokens
	if budget <= 0 || budget > 8192 {
		budget = 8192
	}
	reply, err := h.client.ChatWithModel(callCtx, selected.ModelID, assistant.CanvasSystemPrompt,
		string(payload), llm.WithTemperature(0.3), llm.WithMaxTokens(budget))
	var plan *assistant.Plan
	if err == nil {
		plan, err = parseCanvasReply(reply, req.Snapshot)
	}
	var planErr *assistant.PlanError
	if errors.As(err, &planErr) && callCtx.Err() == nil {
		log.Printf("[CanvasAssistant] correcting model output channel=%s model=%s kind=%s reason=%s",
			channel, selected.ID, planErr.Kind, planErr.Reason)
		invalid := ""
		if reply != nil && len(reply.Choices) > 0 {
			invalid = reply.Choices[0].Message.Content
			if chars := []rune(invalid); len(chars) > 12000 {
				invalid = string(chars[:12000])
			}
		}
		repair, _ := json.Marshal(struct {
			Request     assistantChatRequest `json:"originalRequest"`
			Invalid     string               `json:"invalidPlan"`
			Reason      string               `json:"validationError"`
			Instruction string               `json:"instruction"`
		}{req, invalid, planErr.Reason,
			"上一份计划尚未执行。保持用户原始意图，根据当前快照修正全部格式和关联错误，只返回完整JSON。普通节点省略所有分镜专用字段。不能确认归属时先解释缺少的前提并返回空操作数组，不猜ID。"})
		reply, err = h.client.ChatWithModel(callCtx, selected.ModelID, assistant.CanvasSystemPrompt,
			string(repair), llm.WithTemperature(0.2), llm.WithMaxTokens(budget))
		if err == nil {
			plan, err = parseCanvasReply(reply, req.Snapshot)
		}
	}
	if err != nil {
		h.logTurn(context.WithoutCancel(ctx), userID, selected.ModelID, req.Message, nil, started, err)
		response.Fail(c, http.StatusBadGateway, canvasAssistantErrorMessage(err))
		return
	}
	h.logTurn(context.WithoutCancel(ctx), userID, selected.ModelID, req.Message, plan, started, nil)
	out := assistantChatResponse{Plan: plan, Model: selected.ID, Charged: 0}
	if h.idem != nil {
		h.idem.Finish(context.WithoutCancel(ctx), key, out, 5*time.Minute)
		completed = true
	}
	response.OK(c, out)
}

func canvasAssistantErrorMessage(err error) string {
	detail := err.Error()
	if strings.Contains(detail, "TokenStatusExhausted") || strings.Contains(detail, "额度已用尽") {
		return "当前 AI 渠道额度已用尽，请联系管理员补充额度或更换渠道"
	}
	var planErr *assistant.PlanError
	if errors.As(err, &planErr) {
		if planErr.Kind == "validation" && (strings.Contains(planErr.Reason, "分镜归属") || strings.Contains(planErr.Reason, "引用的镜头")) {
			return "助手未能正确关联分镜和镜头，已自动纠正一次，本次没有修改画布。请选中已有分镜节点后重试"
		}
		switch planErr.Kind {
		case "validation":
			return "助手的节点关联或操作检查未通过，已自动纠正一次，本次没有修改画布。请选中要操作的节点后重试"
		case "truncated":
			return "模型回复被截断，自动纠正后仍未完整返回，本次没有修改画布。请减少本轮要创建的节点数量"
		default:
			return "模型返回的操作格式有误，已自动纠正一次，本次没有修改画布。请重试"
		}
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return "助手响应超时，本次没有修改画布，请稍后重试"
	}
	// Never forward upstream response bodies, token identifiers or internal URLs.
	return "AI 渠道调用失败，本次没有修改画布，请稍后重试或联系管理员检查渠道"
}

func parseCanvasReply(reply *llm.ChatResponse, snapshot assistant.Snapshot) (*assistant.Plan, error) {
	if reply == nil || len(reply.Choices) == 0 {
		return nil, &assistant.PlanError{Kind: "format", Reason: "模型没有返回操作计划"}
	}
	if reply.Choices[0].FinishReason == "length" {
		return nil, &assistant.PlanError{Kind: "truncated", Reason: "模型输出被token上限截断，请缩短计划正文"}
	}
	return assistant.Parse(reply.Choices[0].Message.Content, snapshot)
}

// Keep the existing platform-cost accounting. Chat remains free for users.
func (h *CanvasAssistantHandler) logTurn(ctx context.Context, userID, modelID, message string, plan *assistant.Plan, started time.Time, failure error) {
	if h.db == nil {
		return
	}
	total, completion, _, _ := llm.UsageFrom(ctx).Snapshot()
	payload, _ := json.Marshal(plan)
	reply := ""
	rejected := 0
	if plan != nil {
		reply = plan.Message
	}
	if failure != nil {
		reply, rejected = "规划失败："+failure.Error(), 1
	}
	row := model.AssistantLog{
		UserID: userID, Message: message, Reply: reply, Commands: datatypes.JSON(payload),
		Model: modelID, TotalTokens: total, CompletionTokens: completion,
		LatencyMs: time.Since(started).Milliseconds(), Rejected: rejected,
	}
	// Logging must never make a successful canvas plan fail.
	_ = h.db.WithContext(ctx).Create(&row).Error
}

func containsUsage(usages []string, target string) bool {
	for _, u := range usages {
		if u == target {
			return true
		}
	}
	return false
}
