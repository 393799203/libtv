package handler

import (
	"strconv"

	"libtv/internal/middleware"
	"libtv/internal/pkg/response"
	"libtv/internal/service"

	"github.com/gin-gonic/gin"
)

// CommentHandler 视频评论 HTTP 接口
type CommentHandler struct {
	commentService *service.CommentService
}

func NewCommentHandler(commentService *service.CommentService) *CommentHandler {
	return &CommentHandler{commentService: commentService}
}

// List 分页列出视频评论（公开）：GET /api/shows/:id/comments?page=1&page_size=20
func (h *CommentHandler) List(c *gin.Context) {
	showID := c.Param("id")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	if page < 1 {
		page = 1
	}
	if pageSize <= 0 || pageSize > 100 {
		pageSize = 20
	}
	items, total, err := h.commentService.List(c.Request.Context(), showID, page, pageSize)
	if err != nil {
		response.FailWith(c, err)
		return
	}
	response.OK(c, gin.H{
		"items":     items,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

// Create 发表评论或回复（需登录）：POST /api/shows/:id/comments，parent_id 可选
func (h *CommentHandler) Create(c *gin.Context) {
	showID := c.Param("id")
	var req struct {
		Content  string `json:"content" binding:"required"`
		ParentID string `json:"parent_id"` // 回复时传被回复评论 ID（顶级或回复均可，服务端归一到顶级）
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, 400, "评论内容不能为空")
		return
	}
	item, err := h.commentService.Create(c.Request.Context(), showID, middleware.GetUserID(c), req.Content, req.ParentID)
	if err != nil {
		response.FailWith(c, err)
		return
	}
	response.OK(c, item)
}

// ListReplies 分页列出某顶级评论的回复（公开）：GET /api/shows/comments/:commentId/replies
func (h *CommentHandler) ListReplies(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "50"))
	if page < 1 {
		page = 1
	}
	if pageSize <= 0 || pageSize > 100 {
		pageSize = 50
	}
	items, total, err := h.commentService.ListReplies(c.Request.Context(), c.Param("commentId"), page, pageSize)
	if err != nil {
		response.FailWith(c, err)
		return
	}
	response.OK(c, gin.H{
		"items":     items,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

// Delete 删除评论（需登录，本人或管理员）：DELETE /api/shows/comments/:commentId
func (h *CommentHandler) Delete(c *gin.Context) {
	if err := h.commentService.Delete(c.Request.Context(), c.Param("commentId"), middleware.GetUserID(c)); err != nil {
		response.FailWith(c, err)
		return
	}
	response.OKWithMsg(c, "deleted", nil)
}
