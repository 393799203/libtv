package handler

import (
	"net/http"

	"libtv/internal/pkg/response"
	"libtv/internal/service"

	"github.com/gin-gonic/gin"
)

// PricingHandler 模型价格配置（运营后台「价格管理」页签）
type PricingHandler struct {
	pricingService *service.PricingService
}

func NewPricingHandler(pricingService *service.PricingService) *PricingHandler {
	return &PricingHandler{pricingService: pricingService}
}

// List 返回各节点下模型的价格配置（按次 / 按秒，见 billing_type）
func (h *PricingHandler) List(c *gin.Context) {
	result, err := h.pricingService.ListPrices(c.Request.Context())
	if err != nil {
		response.FailWith(c, err)
		return
	}
	response.OK(c, result)
}

// Save 批量保存价格配置（仅管理员，路由层由 RequireAdmin 中间件保护）
func (h *PricingHandler) Save(c *gin.Context) {
	var req struct {
		Items []service.PriceSaveItem `json:"items" binding:"required,dive"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "价格配置参数非法")
		return
	}
	if err := h.pricingService.SavePrices(c.Request.Context(), req.Items); err != nil {
		response.FailWith(c, err)
		return
	}
	response.OKWithMsg(c, "saved", nil)
}
