package handler

import (
	"errors"
	"net/http"
	"strconv"

	"libtv/internal/middleware"
	"libtv/internal/repository"
	"libtv/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// StyleHandler 处理风格相关的 HTTP 请求
// 只负责参数解析、协议转换、调用 service；不直接持有 DB 或 Storage
type StyleHandler struct {
	styleService      *service.StyleService
	categoryService   *service.CategoryService
	favoriteService   *service.StyleFavoriteService
	fileUploadService *service.FileUploadService
}

// NewStyleHandler 创建风格处理器
func NewStyleHandler(
	styleService *service.StyleService,
	categoryService *service.CategoryService,
	favoriteService *service.StyleFavoriteService,
	fileUploadService *service.FileUploadService,
) *StyleHandler {
	return &StyleHandler{
		styleService:      styleService,
		categoryService:   categoryService,
		favoriteService:   favoriteService,
		fileUploadService: fileUploadService,
	}
}

// ========== 请求结构 ==========

type CreateStyleRequest struct {
	Name       string   `json:"name" binding:"required"`
	Author     string   `json:"author"`
	CategoryID string   `json:"category_id"`
	Tags       []string `json:"tags"`
}

type UpdateStyleRequest struct {
	Name       *string  `json:"name"`
	Author     *string  `json:"author"`
	CategoryID *string  `json:"category_id"`
	Tags       []string `json:"tags"`
}

type CreateCategoryRequest struct {
	Name      string `json:"name" binding:"required"`
	SortOrder int    `json:"sort_order"`
}

type UpdateCategoryRequest struct {
	Name      *string `json:"name"`
	SortOrder *int    `json:"sort_order"`
}

// ========== Style ==========

// List 风格列表（公开）
func (h *StyleHandler) List(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "50"))

	result, err := h.styleService.List(c.Request.Context(), repository.StyleQuery{
		CategoryID: c.Query("category_id"),
		Keyword:    c.Query("keyword"),
		Page:       page,
		PageSize:   pageSize,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{
			"items":     result.Items,
			"total":     result.Total,
			"page":      result.Page,
			"page_size": result.PageSize,
		},
	})
}

// Create 创建风格（需登录）
func (h *StyleHandler) Create(c *gin.Context) {
	var req CreateStyleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": err.Error()})
		return
	}
	style, err := h.styleService.Create(c.Request.Context(), req.Name, req.Author, req.CategoryID, req.Tags)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"code": 0, "data": style})
}

// UploadImage 上传风格图片并关联到风格记录
func (h *StyleHandler) UploadImage(c *gin.Context) {
	id := c.Param("id")
	if _, err := h.styleService.GetByID(c.Request.Context(), id); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "msg": "风格不存在"})
		return
	}

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "请选择文件"})
		return
	}

	result, err := h.fileUploadService.Upload(file, header, service.UploadOptions{
		Dir:            "styles",
		AllowedExts:    service.ImageExts(),
		MaxSize:        10 * 1024 * 1024,
		ContentTypeFor: service.ContentTypeForImage,
	})
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": err.Error()})
		return
	}

	if err := h.styleService.UpdateImage(c.Request.Context(), id, result.URL); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"url": result.URL}})
}

// Update 更新风格（PATCH 语义：tags 为 nil 表示不更新，tags 非 nil 包括空数组表示清空）
func (h *StyleHandler) Update(c *gin.Context) {
	id := c.Param("id")
	var req UpdateStyleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": err.Error()})
		return
	}

	style, err := h.styleService.UpdateStyle(c.Request.Context(), id,
		req.Name, req.Author, req.CategoryID, req.Tags, req.Tags != nil)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"code": 404, "msg": "风格不存在"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": style})
}

// Delete 删除风格（同时清理图片文件）
func (h *StyleHandler) Delete(c *gin.Context) {
	id := c.Param("id")
	if err := h.styleService.Delete(c.Request.Context(), id); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"code": 404, "msg": "风格不存在"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "msg": "deleted"})
}

// ========== Category ==========

// Categories 获取所有分类列表（带风格数）
func (h *StyleHandler) Categories(c *gin.Context) {
	cats, err := h.categoryService.ListWithStyleCount(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": cats})
}

// CreateCategory 创建分类
func (h *StyleHandler) CreateCategory(c *gin.Context) {
	var req CreateCategoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": err.Error()})
		return
	}
	category, err := h.categoryService.Create(c.Request.Context(), req.Name, req.SortOrder)
	if err != nil {
		if errors.Is(err, service.ErrConflict) {
			c.JSON(http.StatusConflict, gin.H{"code": 409, "msg": "分类名已存在"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, gin.H{"code": 0, "data": category})
}

// UpdateCategory 更新分类
func (h *StyleHandler) UpdateCategory(c *gin.Context) {
	id := c.Param("id")
	var req UpdateCategoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": err.Error()})
		return
	}
	category, err := h.categoryService.Update(c.Request.Context(), id, req.Name, req.SortOrder)
	if err != nil {
		if errors.Is(err, service.ErrConflict) {
			c.JSON(http.StatusConflict, gin.H{"code": 409, "msg": "分类名已存在"})
			return
		}
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"code": 404, "msg": "分类不存在"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": category})
}

// DeleteCategory 删除分类（有风格时拒绝）
func (h *StyleHandler) DeleteCategory(c *gin.Context) {
	id := c.Param("id")
	err := h.categoryService.Delete(c.Request.Context(), id)
	if err != nil {
		if errors.Is(err, service.ErrCategoryNotEmpty) {
			c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": err.Error()})
			return
		}
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"code": 404, "msg": "分类不存在"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "msg": "deleted"})
}

// ========== Favorites ==========

// ToggleFavorite 切换收藏
func (h *StyleHandler) ToggleFavorite(c *gin.Context) {
	styleID := c.Param("id")
	userID := middleware.GetUserID(c)

	favorited, err := h.favoriteService.Toggle(c.Request.Context(), userID, styleID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"favorited": favorited}})
}

// ListFavorites 我的收藏列表
func (h *StyleHandler) ListFavorites(c *gin.Context) {
	userID := middleware.GetUserID(c)
	styles, err := h.favoriteService.ListByUser(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{
			"items": styles,
			"total": len(styles),
			"page":  1,
		},
	})
}

// CheckFavorited 批量检查收藏状态
func (h *StyleHandler) CheckFavorited(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{}})
		return
	}
	var ids []string
	if err := c.ShouldBindJSON(&ids); err != nil || len(ids) == 0 {
		c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{}})
		return
	}
	result, err := h.favoriteService.CheckFavorited(c.Request.Context(), userID, ids)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": result})
}
