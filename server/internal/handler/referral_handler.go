package handler

import (
	"github.com/gin-gonic/gin"
	"libtv/internal/middleware"
	"libtv/internal/pkg/response"
	"libtv/internal/service"
	"net/http"
	"strconv"
)

type ReferralHandler struct{ svc *service.ReferralService }

func NewReferralHandler(svc *service.ReferralService) *ReferralHandler {
	return &ReferralHandler{svc: svc}
}

func (h *ReferralHandler) Mine(c *gin.Context) {
	result, err := h.svc.Mine(c.Request.Context(), middleware.GetUserID(c))
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "推荐码暂时无法读取，请重试")
		return
	}
	response.OK(c, result)
}
func (h *ReferralHandler) MyStats(c *gin.Context) {
	result, err := h.svc.MyStats(c.Request.Context(), middleware.GetUserID(c))
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "邀请统计暂时无法读取，请重试")
		return
	}
	response.OK(c, result)
}
func (h *ReferralHandler) Dashboard(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	result, err := h.svc.Dashboard(c.Request.Context(), c.Query("keyword"), page, size)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "邀请统计读取失败")
		return
	}
	response.OK(c, result)
}
func (h *ReferralHandler) Invitees(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	size, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	result, err := h.svc.Invitees(c.Request.Context(), c.Param("id"), page, size)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "邀请用户读取失败")
		return
	}
	response.OK(c, result)
}
