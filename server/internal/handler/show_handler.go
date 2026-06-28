package handler

import (
	"encoding/json"
	"net/http"
	"strconv"

	"libtv/internal/model"
	"libtv/internal/pkg/response"
	"libtv/internal/service"

	"github.com/gin-gonic/gin"
)

type ShowHandler struct {
	showService      *service.ShowService
	fileUploadService *service.FileUploadService
}

func NewShowHandler(showService *service.ShowService, fileUploadService *service.FileUploadService) *ShowHandler {
	return &ShowHandler{showService: showService, fileUploadService: fileUploadService}
}

// ========== 公开接口：首页展示 ==========

// ListCategories 获取所有分类（公开）
func (h *ShowHandler) ListCategories(c *gin.Context) {
	cats, err := h.showService.ListCategories(c.Request.Context())
	if err != nil {
		response.FailWith(c, err)
		return
	}

	type CatWithCount struct {
		model.ShowCategory
		ShowCount int64 `json:"show_count"`
	}

	var result []CatWithCount
	for _, cat := range cats {
		var count int64
		// 通过 service 获取每个分类下的视频数
		_, count, _ = h.showService.ListShows(c.Request.Context(), cat.ID, "", 1, 1)
		result = append(result, CatWithCount{
			ShowCategory: *cat,
			ShowCount:    count,
		})
	}

	response.OK(c, result)
}

// ListShows 获取视频列表（公开，支持按分类筛选 + 关键词搜索）
func (h *ShowHandler) ListShows(c *gin.Context) {
	categoryID := c.Query("category_id")
	keyword := c.Query("keyword")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "50"))
	if pageSize > 100 {
		pageSize = 100
	}

	shows, total, err := h.showService.ListShows(c.Request.Context(), categoryID, keyword, page, pageSize)
	if err != nil {
		response.FailWith(c, err)
		return
	}

	response.OK(c, gin.H{
		"items":     shows,
		"total":     total,
		"page":      page,
		"page_size": pageSize,
	})
}

// GetShow 获取单个视频详情（公开）
func (h *ShowHandler) GetShow(c *gin.Context) {
	id := c.Param("id")
	show, err := h.showService.GetByID(c.Request.Context(), id)
	if err != nil {
		response.FailWith(c, err)
		return
	}
	response.OK(c, show)
}

// LikeShow 点赞视频（需登录）
func (h *ShowHandler) LikeShow(c *gin.Context) {
	id := c.Param("id")
	// 从 JWT 获取用户 ID
	userID, exists := c.Get("user_id")
	if !exists {
		response.Fail(c, 401, "请先登录")
		return
	}

	likes, isLiked, err := h.showService.LikeShow(c.Request.Context(), userID.(string), id)
	if err != nil {
		response.FailWith(c, err)
		return
	}
	response.OK(c, gin.H{"likes": likes, "is_liked": isLiked})
}

// UnlikeShow 取消点赞（需登录）
func (h *ShowHandler) UnlikeShow(c *gin.Context) {
	id := c.Param("id")
	// 从 JWT 获取用户 ID
	userID, exists := c.Get("user_id")
	if !exists {
		response.Fail(c, 401, "请先登录")
		return
	}

	likes, isLiked, err := h.showService.UnlikeShow(c.Request.Context(), userID.(string), id)
	if err != nil {
		response.FailWith(c, err)
		return
	}
	response.OK(c, gin.H{"likes": likes, "is_liked": isLiked})
}

// CheckShowLiked 检查用户是否已点赞（需登录）
func (h *ShowHandler) CheckShowLiked(c *gin.Context) {
	id := c.Param("id")
	// 从 JWT 获取用户 ID
	userID, exists := c.Get("user_id")
	if !exists {
		response.Fail(c, 401, "请先登录")
		return
	}

	isLiked, err := h.showService.IsShowLiked(c.Request.Context(), userID.(string), id)
	if err != nil {
		response.FailWith(c, err)
		return
	}
	response.OK(c, gin.H{"is_liked": isLiked})
}

// ========== 需登录接口：管理操作 ==========

type CreateShowRequest struct {
	CategoryID  string   `json:"category_id" binding:"required"`
	Title       string   `json:"title" binding:"required"`
	Description string   `json:"description"`
	VideoURL    string   `json:"video_url"`
	Duration    int      `json:"duration"`
	AuthorID    string   `json:"author_id"`
	Tags        []string `json:"tags"`
	SortOrder   int      `json:"sort_order"`
}

type UpdateShowRequest struct {
	Title       *string  `json:"title"`
	Description *string  `json:"description"`
	VideoURL    *string  `json:"video_url"`
	Duration    *int     `json:"duration"`
	AuthorID    *string  `json:"author_id"`
	Tags        []string `json:"tags"`
	SortOrder   *int     `json:"sort_order"`
	CategoryID  *string  `json:"category_id"`
}

// CreateShow 创建视频条目（需登录）
func (h *ShowHandler) CreateShow(c *gin.Context) {
	var req CreateShowRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}

	tagsJSON, _ := json.Marshal(req.Tags)
	show := &model.Show{
		CategoryID:  req.CategoryID,
		Title:       req.Title,
		Description: req.Description,
		VideoURL:    req.VideoURL,
		Duration:    req.Duration,
		Tags:        tagsJSON,
		SortOrder:   req.SortOrder,
	}
	h.showService.ResolveAuthor(c.Request.Context(), show, req.AuthorID)

	if err := h.showService.CreateShow(c.Request.Context(), show); err != nil {
		response.FailWith(c, err)
		return
	}

	response.Created(c, show)
}

// UploadThumbnail 上传封面图并关联到视频记录
func (h *ShowHandler) UploadThumbnail(c *gin.Context) {
	id := c.Param("id")
	if _, err := h.showService.GetByID(c.Request.Context(), id); err != nil {
		response.FailWith(c, err)
		return
	}

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		response.Fail(c, http.StatusBadRequest, "请选择文件")
		return
	}

	result, err := h.fileUploadService.Upload(file, header, service.UploadOptions{
		Dir:            "shows",
		AllowedExts:    service.ImageExts(),
		MaxSize:        10 * 1024 * 1024,
		ContentTypeFor: service.ContentTypeForImage,
	})
	if err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}

	if err := h.showService.UpdateThumbnail(c.Request.Context(), id, result.URL); err != nil {
		response.FailWith(c, err)
		return
	}

	response.OK(c, gin.H{"url": result.URL})
}

// UploadVideo 上传视频文件到MinIO
func (h *ShowHandler) UploadVideo(c *gin.Context) {
	id := c.Param("id")
	show, err := h.showService.GetByID(c.Request.Context(), id)
	if err != nil {
		response.FailWith(c, err)
		return
	}

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		response.Fail(c, http.StatusBadRequest, "请选择文件")
		return
	}

	// URL 走代理路由 /media/videos/<filename>（与历史路径兼容）
	result, err := h.fileUploadService.Upload(file, header, service.UploadOptions{
		Dir:            "videos",
		AllowedExts:    service.VideoExts(),
		MaxSize:        1024 * 1024 * 1024,
		ContentTypeFor: service.ContentTypeForVideo,
		URLFor: func(objectName string) string {
			// objectName 形如 "videos/<hash>.mp4"
			return "/media/" + objectName
		},
	})
	if err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}

	show.VideoURL = result.URL
	if err := h.showService.UpdateShow(c.Request.Context(), show); err != nil {
		// P2-17 修复：原代码漏掉了 UpdateShow 的错误检查
		response.FailWith(c, err)
		return
	}

	response.OK(c, gin.H{"url": result.URL})
}

// UpdateShow 更新视频信息（需登录）
func (h *ShowHandler) UpdateShow(c *gin.Context) {
	id := c.Param("id")

	show, err := h.showService.GetByID(c.Request.Context(), id)
	if err != nil {
		response.FailWith(c, err)
		return
	}

	var req UpdateShowRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}

	if req.Title != nil {
		show.Title = *req.Title
	}
	if req.Description != nil {
		show.Description = *req.Description
	}
	if req.VideoURL != nil {
		show.VideoURL = *req.VideoURL
	}
	if req.Duration != nil {
		show.Duration = *req.Duration
	}
	if req.AuthorID != nil {
		h.showService.ResolveAuthor(c.Request.Context(), show, *req.AuthorID)
	}
	if req.Tags != nil {
		tagsJSON, _ := json.Marshal(req.Tags)
		show.Tags = tagsJSON
	}
	if req.SortOrder != nil {
		show.SortOrder = *req.SortOrder
	}
	if req.CategoryID != nil {
		show.CategoryID = *req.CategoryID
	}

	if err := h.showService.UpdateShow(c.Request.Context(), show); err != nil {
		response.FailWith(c, err)
		return
	}

	// 刷新关联数据
	show, _ = h.showService.GetByID(c.Request.Context(), id)
	response.OK(c, show)
}

// DeleteShow 删除视频（需登录），同时清理关联的缩略图和视频文件
func (h *ShowHandler) DeleteShow(c *gin.Context) {
	id := c.Param("id")
	if err := h.showService.DeleteShow(c.Request.Context(), id); err != nil {
		response.FailWith(c, err)
		return
	}
	response.OKWithMsg(c, "deleted", nil)
}

// ========== 分类管理（需登录）==========

type CreateShowCategoryRequest struct {
	Name      string `json:"name" binding:"required"`
	SortOrder int    `json:"sort_order"`
}

type UpdateShowCategoryRequest struct {
	Name      *string `json:"name"`
	SortOrder *int    `json:"sort_order"`
}

// CreateCategory 创建分类（需登录）
func (h *ShowHandler) CreateCategory(c *gin.Context) {
	var req CreateShowCategoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}

	cat := &model.ShowCategory{
		Name:      req.Name,
		SortOrder: req.SortOrder,
	}
	if err := h.showService.CreateCategory(c.Request.Context(), cat); err != nil {
		response.FailWith(c, err)
		return
	}
	response.Created(c, cat)
}

// UpdateCategory 更新分类（需登录）
func (h *ShowHandler) UpdateCategory(c *gin.Context) {
	id := c.Param("id")

	var req UpdateShowCategoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}

	cat, err := h.showService.GetCategoryByID(c.Request.Context(), id)
	if err != nil {
		response.FailWith(c, err)
		return
	}

	if req.Name != nil {
		cat.Name = *req.Name
	}
	if req.SortOrder != nil {
		cat.SortOrder = *req.SortOrder
	}

	if err := h.showService.UpdateCategory(c.Request.Context(), cat); err != nil {
		response.FailWith(c, err)
		return
	}
	response.OK(c, cat)
}

// DeleteCategory 删除分类（需登录）
func (h *ShowHandler) DeleteCategory(c *gin.Context) {
	id := c.Param("id")
	if err := h.showService.DeleteCategory(c.Request.Context(), id); err != nil {
		response.FailWith(c, err)
		return
	}
	response.OKWithMsg(c, "deleted", nil)
}
