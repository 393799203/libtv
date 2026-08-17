package handler

import (
	"net/http"
	"strconv"
	"time"

	"libtv/internal/middleware"
	"libtv/internal/pkg/response"
	"libtv/internal/repository"

	"github.com/gin-gonic/gin"
)

type BillingHandler struct {
	billingRepo repository.BillingRepo
}

func NewBillingHandler(billingRepo repository.BillingRepo) *BillingHandler {
	return &BillingHandler{billingRepo: billingRepo}
}

// List 当前用户的费用明细（分页 + 筛选，按时间倒序，需登录）
// 查询参数：page / page_size、type（deduct|refund|recharge）、scene、model（均支持模糊）、
// start_time / end_time（支持 2006-01-02 或 2006-01-02 15:04:05）
func (h *BillingHandler) List(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		response.Fail(c, http.StatusUnauthorized, "未登录")
		return
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "10"))

	filter := repository.BillingFilter{
		Type:    c.Query("type"),
		Scene:   c.Query("scene"),
		ModelID: c.Query("model"),
	}
	// 时间筛选：仅日期时结束时间按当天 23:59:59 处理
	if v := c.Query("start_time"); v != "" {
		if t, ok := parseQueryTime(v); ok {
			filter.StartTime = t
		} else {
			response.Fail(c, http.StatusBadRequest, "开始时间格式不正确")
			return
		}
	}
	if v := c.Query("end_time"); v != "" {
		t, ok := parseQueryTime(v)
		if !ok {
			response.Fail(c, http.StatusBadRequest, "结束时间格式不正确")
			return
		}
		filter.EndTime = t
		if len(v) == 10 { // 仅传日期（YYYY-MM-DD）时包含当天全天
			filter.EndTime = t.Add(24*time.Hour - time.Second)
		}
	}

	records, total, err := h.billingRepo.ListByUser(c.Request.Context(), userID, filter, page, pageSize)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "获取费用明细失败")
		return
	}
	response.OK(c, gin.H{
		"items":     records,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

// parseQueryTime 兼容「YYYY-MM-DD」与「YYYY-MM-DD HH:mm:ss」两种时间格式
func parseQueryTime(v string) (time.Time, bool) {
	for _, layout := range []string{"2006-01-02 15:04:05", "2006-01-02"} {
		if t, err := time.ParseInLocation(layout, v, time.Local); err == nil {
			return t, true
		}
	}
	return time.Time{}, false
}
