package handler

import (
	"net/http"
	"strconv"

	"libtv/internal/middleware"
	"libtv/internal/pkg/response"
	"libtv/internal/service"

	"github.com/gin-gonic/gin"
)

// ForumHandler 论坛相关 HTTP 请求
// 仅做参数解析与协议转换，业务逻辑（含富文本清洗、权限）全部在 ForumService
type ForumHandler struct {
	forumService *service.ForumService
}

func NewForumHandler(forumService *service.ForumService) *ForumHandler {
	return &ForumHandler{forumService: forumService}
}

// pagination 解析分页参数（与其它列表接口口径一致）
func pagination(c *gin.Context, defSize int) (int, int) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", strconv.Itoa(defSize)))
	if page < 1 {
		page = 1
	}
	if pageSize <= 0 || pageSize > 100 {
		pageSize = defSize
	}
	return page, pageSize
}

// ListPosts 帖子列表（公开，无需登录）：GET /api/forum/posts?page=&page_size=&keyword=
func (h *ForumHandler) ListPosts(c *gin.Context) {
	page, pageSize := pagination(c, 20)
	items, total, err := h.forumService.ListPosts(c.Request.Context(), c.Query("keyword"), page, pageSize)
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

// GetPost 帖子详情（公开，浏览量 +1）：GET /api/forum/posts/:id
func (h *ForumHandler) GetPost(c *gin.Context) {
	item, err := h.forumService.GetPost(c.Request.Context(), c.Param("id"))
	if err != nil {
		response.FailWith(c, err)
		return
	}
	response.OK(c, item)
}

// ListReplies 帖子回复列表（公开）：GET /api/forum/posts/:id/replies
func (h *ForumHandler) ListReplies(c *gin.Context) {
	page, pageSize := pagination(c, 50)
	items, total, err := h.forumService.ListReplies(c.Request.Context(), c.Param("id"), page, pageSize)
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

// CreatePost 发帖（需登录）：POST /api/forum/posts
func (h *ForumHandler) CreatePost(c *gin.Context) {
	var req struct {
		// ID 客户端生成（编辑器打开时就生成，上传的图片/视频按它分目录），
		// 用同一个 id 建帖子，删帖时才能按目录把该帖的媒体一次删干净
		ID      string `json:"id"`
		Title   string `json:"title" binding:"required"`
		Content string `json:"content" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "标题和正文都不能为空")
		return
	}
	post, err := h.forumService.CreatePost(c.Request.Context(), middleware.GetUserID(c), req.ID, req.Title, req.Content)
	if err != nil {
		response.FailWith(c, err)
		return
	}
	response.Created(c, post)
}

// CreateReply 回复帖子（需登录）：POST /api/forum/posts/:id/replies
func (h *ForumHandler) CreateReply(c *gin.Context) {
	var req struct {
		// ID 客户端生成，含义同发帖：定位本条回复自己的媒体目录
		ID      string `json:"id"`
		Content string `json:"content" binding:"required"`
		// ReplyToNickname 可选：回复某条回复时传被回复人昵称，用于展示「回复 @某人」
		ReplyToNickname string `json:"reply_to_nickname"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "回复内容不能为空")
		return
	}
	reply, err := h.forumService.CreateReply(c.Request.Context(), c.Param("id"), middleware.GetUserID(c), req.ID, req.Content, req.ReplyToNickname)
	if err != nil {
		response.FailWith(c, err)
		return
	}
	response.Created(c, reply)
}

// UpdatePost 修改帖子（需登录，本人或管理员）：PUT /api/forum/posts/:id
func (h *ForumHandler) UpdatePost(c *gin.Context) {
	var req struct {
		Title   string `json:"title" binding:"required"`
		Content string `json:"content" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "标题和正文都不能为空")
		return
	}
	post, err := h.forumService.UpdatePost(c.Request.Context(), c.Param("id"), middleware.GetUserID(c), req.Title, req.Content)
	if err != nil {
		response.FailWith(c, err)
		return
	}
	response.OKWithMsg(c, "修改成功", post)
}

// DeletePost 删帖（需登录，本人或管理员）：DELETE /api/forum/posts/:id
func (h *ForumHandler) DeletePost(c *gin.Context) {
	if err := h.forumService.DeletePost(c.Request.Context(), c.Param("id"), middleware.GetUserID(c)); err != nil {
		response.FailWith(c, err)
		return
	}
	response.OK(c, gin.H{"deleted": true})
}

// DeleteReply 删回复（需登录，本人或管理员）：DELETE /api/forum/replies/:replyId
func (h *ForumHandler) DeleteReply(c *gin.Context) {
	if err := h.forumService.DeleteReply(c.Request.Context(), c.Param("replyId"), middleware.GetUserID(c)); err != nil {
		response.FailWith(c, err)
		return
	}
	response.OK(c, gin.H{"deleted": true})
}

// SetPinned 置顶/取消置顶（仅管理员，路由层已用 RequireAdmin 把关）：PUT /api/forum/posts/:id/pin
func (h *ForumHandler) SetPinned(c *gin.Context) {
	var req struct {
		Pinned bool `json:"pinned"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "参数错误")
		return
	}
	if err := h.forumService.SetPinned(c.Request.Context(), c.Param("id"), req.Pinned); err != nil {
		response.FailWith(c, err)
		return
	}
	response.OK(c, gin.H{"pinned": req.Pinned})
}
