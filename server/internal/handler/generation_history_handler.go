package handler

import (
	"net/http"
	"strconv"

	"libtv/internal/pkg/response"
	"libtv/internal/service"

	"github.com/gin-gonic/gin"
)

// GenerationHistoryHandler 生成历史记录处理器
type GenerationHistoryHandler struct {
	service *service.GenerationHistoryService
}

// NewGenerationHistoryHandler 创建生成历史记录处理器
func NewGenerationHistoryHandler(service *service.GenerationHistoryService) *GenerationHistoryHandler {
	return &GenerationHistoryHandler{service: service}
}

// ListByNode 获取某个节点的生成历史
// GET /api/generation-history?node_id=xxx&page=1&page_size=20
func (h *GenerationHistoryHandler) ListByNode(c *gin.Context) {
	nodeID := c.Query("node_id")
	if nodeID == "" {
		response.Fail(c, http.StatusBadRequest, "node_id is required")
		return
	}

	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))

	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	items, total, err := h.service.ListByNode(c.Request.Context(), nodeID, page, pageSize)
	if err != nil {
		response.Fail(c, http.StatusInternalServerError, "获取生成历史失败")
		return
	}

	response.OK(c, gin.H{
		"items":     items,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}
