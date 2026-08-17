package handler

import (
	"net/http"

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

// List 当前用户的费用明细（扣费/退款/充值，按时间倒序，需登录）
func (h *BillingHandler) List(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		response.Fail(c, http.StatusUnauthorized, "未登录")
		return
	}
	records, err := h.billingRepo.ListByUser(c.Request.Context(), userID, 200)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "获取费用明细失败")
		return
	}
	response.OK(c, records)
}
