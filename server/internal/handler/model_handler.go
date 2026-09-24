package handler

import (
	"libtv/internal/llm"
	"libtv/internal/middleware"
	"libtv/internal/pkg/response"
	"libtv/internal/service"

	"github.com/gin-gonic/gin"
)

type ModelHandler struct {
	modelManager   *llm.ModelManager
	channelService *service.ChannelService
}

func NewModelHandler(modelManager *llm.ModelManager, channelService ...*service.ChannelService) *ModelHandler {
	h := &ModelHandler{modelManager: modelManager}
	if len(channelService) > 0 {
		h.channelService = channelService[0]
	}
	return h
}

// ListModels 返回当前用户渠道的模型清单（按类型分组）
// 渠道与执行链路一致：全局策略(all_wasu/all_dianxin) 优先，否则按用户 channel
func (h *ModelHandler) ListModels(c *gin.Context) {
	// 默认：未登录或无渠道服务时返回全部（华数/默认渠道）
	channel := "wasu"
	if h.channelService != nil {
		userID := middleware.GetUserID(c)
		channel = h.channelService.ResolveUserChannel(c.Request.Context(), userID)
	}

	models := h.modelManager.ListModelsForChannel(channel)
	response.OK(c, models)
}
