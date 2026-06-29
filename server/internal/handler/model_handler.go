package handler

import (
	"libtv/internal/llm"
	"libtv/internal/pkg/response"

	"github.com/gin-gonic/gin"
)

type ModelHandler struct {
	modelManager *llm.ModelManager
}

func NewModelHandler(modelManager *llm.ModelManager) *ModelHandler {
	return &ModelHandler{
		modelManager: modelManager,
	}
}

// ListModels 返回所有可用模型（按类型分组）
func (h *ModelHandler) ListModels(c *gin.Context) {
	// 从 ModelManager 获取模型配置
	models := h.modelManager.ListModels()

	response.OK(c, models)
}