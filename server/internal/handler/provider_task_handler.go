package handler

import (
	"errors"
	"libtv/internal/audit"
	"libtv/internal/billing"
	"net/http"
	"strconv"
	"strings"

	"libtv/internal/pkg/response"
	"libtv/internal/repository"

	"github.com/gin-gonic/gin"
)

// ProviderTaskHandler 上游任务对账（仅管理员）。
//
// 用途：把「每一次下发到上游的视频任务」摊开看 —— 任务号、渠道、模型、执行、节点、
// 用户、项目、状态（已下发/已交付/失败/已退费）、扣费与退费积分、备注。
// 默认排序是「已退费的排前面」：那类行意味着用户已经拿回了积分，
// 但上游按生成后计费照样收了我们钱 —— 这是唯一会真金白银漏出去的一类。
type ProviderTaskHandler struct {
	service *billing.Ledger
	// checker 一致性自检：后台「立即核对」按钮手动触发一次（只读+标记，不动钱）
	checker *audit.Checker
}

// NewProviderTaskHandler 创建对账处理器
func NewProviderTaskHandler(svc *billing.Ledger, checker *audit.Checker) *ProviderTaskHandler {
	return &ProviderTaskHandler{service: svc, checker: checker}
}

// RunAudit POST /api/admin/provider-tasks/audit
// 手动跑一次一致性自检（后台「立即核对」按钮）：只读+标记，绝不改金额或状态。
func (h *ProviderTaskHandler) RunAudit(c *gin.Context) {
	if h.checker == nil {
		response.Fail(c, 500, "一致性自检未启用")
		return
	}
	report := h.checker.RunLogged(c.Request.Context())
	if report == nil {
		response.Fail(c, 500, "一致性自检执行失败，请查看服务端日志")
		return
	}
	response.OK(c, report)
}

// List GET /api/admin/provider-tasks?status=&project_id=&user_id=&task_id=&page=&page_size=
func (h *ProviderTaskHandler) List(c *gin.Context) {
	page, _ := strconv.Atoi(c.Query("page"))
	size, _ := strconv.Atoi(c.Query("page_size"))
	filter := repository.ProviderTaskFilter{
		Status:    strings.TrimSpace(c.Query("status")),
		TaskKind:  strings.TrimSpace(c.Query("task_kind")),
		ProjectID: strings.TrimSpace(c.Query("project_id")),
		UserID:    strings.TrimSpace(c.Query("user_id")),
		OnlyAlert: c.Query("only_alert") == "1" || c.Query("only_alert") == "true",
		TaskID:    strings.TrimSpace(c.Query("task_id")),
		Page:      page,
		PageSize:  size,
	}
	items, total, err := h.service.List(c.Request.Context(), filter)
	if err != nil {
		response.FailWith(c, err)
		return
	}
	stats, err := h.service.Stats(c.Request.Context(), filter)
	if err != nil {
		// 汇总失败不影响列表本身
		stats = repository.ProviderTaskStats{}
	}
	response.OK(c, gin.H{"items": items, "total": total, "stats": stats})
}

// Refund POST /api/admin/provider-tasks/:id/refund
//
// 管理员手动退费：只对「待人工退费」这类记录生效（上游明确报错的那类已经自动退了）。
// 请求体可选 {"reason": "..."}，会写进退费账单备注。
func (h *ProviderTaskHandler) Refund(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		response.Fail(c, http.StatusBadRequest, "记录 ID 不合法")
		return
	}
	var body struct {
		Reason string `json:"reason"`
	}
	_ = c.ShouldBindJSON(&body)

	task, err := h.service.RefundManually(c.Request.Context(), id, adminLabel(c), strings.TrimSpace(body.Reason))
	if err != nil {
		if errors.Is(err, billing.ErrRefundNotAllowed) {
			response.Fail(c, http.StatusBadRequest, err.Error())
			return
		}
		response.FailWith(c, err)
		return
	}
	response.OK(c, gin.H{"task": task})
}

// adminLabel 操作人标识：优先邮箱，便于退费账单里看出是谁操作的
func adminLabel(c *gin.Context) string {
	if email := c.GetString("email"); email != "" {
		return email
	}
	if uid := c.GetString("userID"); uid != "" {
		return uid
	}
	return "管理员"
}

// Stats GET /api/admin/provider-tasks/stats
func (h *ProviderTaskHandler) Stats(c *gin.Context) {
	filter := repository.ProviderTaskFilter{
		Status:    strings.TrimSpace(c.Query("status")),
		TaskKind:  strings.TrimSpace(c.Query("task_kind")),
		ProjectID: strings.TrimSpace(c.Query("project_id")),
		UserID:    strings.TrimSpace(c.Query("user_id")),
		OnlyAlert: c.Query("only_alert") == "1" || c.Query("only_alert") == "true",
		TaskID:    strings.TrimSpace(c.Query("task_id")),
	}
	stats, err := h.service.Stats(c.Request.Context(), filter)
	if err != nil {
		response.FailWith(c, err)
		return
	}
	response.OK(c, stats)
}
