package handler

import (
	"net/http"

	"libtv/internal/middleware"
	"libtv/internal/pkg/response"
	"libtv/internal/service"

	"github.com/gin-gonic/gin"
)

// PricingHandler 模型价格配置（运营后台「价格管理」页签）
type PricingHandler struct {
	pricingService *service.PricingService
	channelService *service.ChannelService
}

func NewPricingHandler(pricingService *service.PricingService, channelService ...*service.ChannelService) *PricingHandler {
	h := &PricingHandler{pricingService: pricingService}
	if len(channelService) > 0 {
		h.channelService = channelService[0]
	}
	return h
}

// List 返回各节点下模型的价格配置（按次 / 按秒，见 billing_type）
//   - 显式传 ?channel=wasu|dianxin（后台价格管理页按渠道 tab 查看）→ 用指定渠道
//   - 未传 channel（前端提示词面板算扣费）→ 按登录用户最终渠道（全局策略 + 用户 channel）
//     这样电信用户看到的扣费金额按电信模型价格计算，华数用户按华数价格
func (h *PricingHandler) List(c *gin.Context) {
	channel := c.Query("channel")
	if channel == "" && h.channelService != nil {
		userID := middleware.GetUserID(c)
		channel = h.channelService.ResolveUserChannel(c.Request.Context(), userID)
	}
	result, err := h.pricingService.ListPrices(c.Request.Context(), channel)
	if err != nil {
		response.FailWith(c, err)
		return
	}
	response.OK(c, result)
}

// Save 批量保存指定渠道的价格配置（仅管理员，路由层由 RequireAdmin 中间件保护）
//   - 显式传 channel（后台价格管理页在对应渠道 tab 保存）→ 保存到该渠道
//   - 未传 channel → 按管理员自己的最终渠道
func (h *PricingHandler) Save(c *gin.Context) {
	var req struct {
		Channel string                  `json:"channel"`
		Items   []service.PriceSaveItem `json:"items" binding:"required,dive"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "价格配置参数非法")
		return
	}
	channel := req.Channel
	if channel == "" && h.channelService != nil {
		channel = h.channelService.ResolveUserChannel(c.Request.Context(), middleware.GetUserID(c))
	}
	if err := h.pricingService.SavePrices(c.Request.Context(), channel, req.Items); err != nil {
		response.FailWith(c, err)
		return
	}
	response.OKWithMsg(c, "saved", nil)
}