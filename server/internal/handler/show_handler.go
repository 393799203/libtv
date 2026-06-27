package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"libtv/internal/model"
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
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": err.Error()})
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

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": result})
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
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{
			"items":     shows,
			"total":     total,
			"page":      page,
			"page_size": pageSize,
		},
	})
}

// GetShow 获取单个视频详情（公开）
func (h *ShowHandler) GetShow(c *gin.Context) {
	id := c.Param("id")
	show, err := h.showService.GetByID(c.Request.Context(), id)
	if err != nil {
		if errors.Is(err, service.ErrShowNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"code": 404, "msg": "视频不存在"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": show})
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
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": err.Error()})
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
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "创建失败"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"code": 0, "data": show})
}

// UploadThumbnail 上传封面图并关联到视频记录
func (h *ShowHandler) UploadThumbnail(c *gin.Context) {
	id := c.Param("id")
	if _, err := h.showService.GetByID(c.Request.Context(), id); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "msg": "视频不存在"})
		return
	}

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "请选择文件"})
		return
	}

	result, err := h.fileUploadService.Upload(file, header, service.UploadOptions{
		Dir:            "shows",
		AllowedExts:    service.ImageExts(),
		MaxSize:        10 * 1024 * 1024,
		ContentTypeFor: service.ContentTypeForImage,
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": err.Error()})
		return
	}

	if err := h.showService.UpdateThumbnail(c.Request.Context(), id, result.URL); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"url": result.URL}})
}

// UploadVideo 上传视频文件到MinIO
func (h *ShowHandler) UploadVideo(c *gin.Context) {
	id := c.Param("id")
	show, err := h.showService.GetByID(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "msg": "视频不存在"})
		return
	}

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "请选择文件"})
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
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": err.Error()})
		return
	}

	show.VideoURL = result.URL
	h.showService.UpdateShow(c.Request.Context(), show)

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"url": result.URL}})
}

// UpdateShow 更新视频信息（需登录）
func (h *ShowHandler) UpdateShow(c *gin.Context) {
	id := c.Param("id")

	show, err := h.showService.GetByID(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "msg": "视频不存在"})
		return
	}

	var req UpdateShowRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": err.Error()})
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
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "更新失败"})
		return
	}

	// 刷新关联数据
	show, _ = h.showService.GetByID(c.Request.Context(), id)
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": show})
}

// DeleteShow 删除视频（需登录），同时清理关联的缩略图和视频文件
func (h *ShowHandler) DeleteShow(c *gin.Context) {
	id := c.Param("id")
	if err := h.showService.DeleteShow(c.Request.Context(), id); err != nil {
		if errors.Is(err, service.ErrShowNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"code": 404, "msg": "记录不存在"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "msg": "deleted"})
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
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": err.Error()})
		return
	}

	cat := &model.ShowCategory{
		Name:      req.Name,
		SortOrder: req.SortOrder,
	}
	if err := h.showService.CreateCategory(c.Request.Context(), cat); err != nil {
		if errors.Is(err, service.ErrCategoryNameConflict) {
			c.JSON(http.StatusConflict, gin.H{"code": 409, "msg": "分类名已存在"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "创建失败"})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"code": 0, "data": cat})
}

// UpdateCategory 更新分类（需登录）
func (h *ShowHandler) UpdateCategory(c *gin.Context) {
	id := c.Param("id")

	var req UpdateShowCategoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": err.Error()})
		return
	}

	cat, err := h.showService.GetCategoryByID(c.Request.Context(), id)
	if err != nil {
		if errors.Is(err, service.ErrCategoryNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"code": 404, "msg": "分类不存在"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": err.Error()})
		return
	}

	if req.Name != nil {
		cat.Name = *req.Name
	}
	if req.SortOrder != nil {
		cat.SortOrder = *req.SortOrder
	}

	if err := h.showService.UpdateCategory(c.Request.Context(), cat); err != nil {
		if errors.Is(err, service.ErrCategoryNameConflict) {
			c.JSON(http.StatusConflict, gin.H{"code": 409, "msg": "分类名已存在"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "更新失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": cat})
}

// DeleteCategory 删除分类（需登录）
func (h *ShowHandler) DeleteCategory(c *gin.Context) {
	id := c.Param("id")
	if err := h.showService.DeleteCategory(c.Request.Context(), id); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "msg": "deleted"})
}
