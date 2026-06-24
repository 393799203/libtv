package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"libtv/internal/model"
	"gorm.io/gorm"
)

// BannerHandler 资源位管理处理器
type BannerHandler struct {
	db *gorm.DB
}

// NewBannerHandler 创建 BannerHandler
func NewBannerHandler(db *gorm.DB) *BannerHandler {
	return &BannerHandler{db: db}
}

// List 获取资源位列表
func (h *BannerHandler) List(c *gin.Context) {
	var banners []model.Banner
	result := h.db.Order("sort_order ASC, created_at DESC").Find(&banners)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "查询失败：" + result.Error.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": banners})
}

// Get 获取单个资源位
func (h *BannerHandler) Get(c *gin.Context) {
	id := c.Param("id")
	var banner model.Banner
	result := h.db.First(&banner, "id = ?", id)
	if result.Error != nil {
		if result.Error == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"code": 404, "msg": "资源位不存在"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "查询失败：" + result.Error.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": banner})
}

// Create 创建资源位
func (h *BannerHandler) Create(c *gin.Context) {
	var req struct {
		Title     string `json:"title" binding:"required"`
		ImageURL  string `json:"image_url" binding:"required"`
		LinkURL   string `json:"link_url"`
		SortOrder int    `json:"sort_order"`
		IsActive  bool   `json:"is_active"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "参数错误：" + err.Error()})
		return
	}

	banner := model.Banner{
		Title:     req.Title,
		ImageURL:  req.ImageURL,
		LinkURL:   req.LinkURL,
		SortOrder: req.SortOrder,
		IsActive:  req.IsActive,
	}

	if err := h.db.Create(&banner).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "创建失败：" + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": banner})
}

// Update 更新资源位
func (h *BannerHandler) Update(c *gin.Context) {
	id := c.Param("id")

	var req struct {
		Title     string `json:"title"`
		ImageURL  string `json:"image_url"`
		LinkURL   string `json:"link_url"`
		SortOrder int    `json:"sort_order"`
		IsActive  bool   `json:"is_active"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "参数错误：" + err.Error()})
		return
	}

	var banner model.Banner
	result := h.db.First(&banner, "id = ?", id)
	if result.Error != nil {
		if result.Error == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"code": 404, "msg": "资源位不存在"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "查询失败：" + result.Error.Error()})
		return
	}

	// 更新字段
	if req.Title != "" {
		banner.Title = req.Title
	}
	if req.ImageURL != "" {
		banner.ImageURL = req.ImageURL
	}
	if req.LinkURL != "" {
		banner.LinkURL = req.LinkURL
	}
	banner.SortOrder = req.SortOrder
	banner.IsActive = req.IsActive

	if err := h.db.Save(&banner).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "更新失败：" + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": banner})
}

// Delete 删除资源位
func (h *BannerHandler) Delete(c *gin.Context) {
	id := c.Param("id")

	result := h.db.Delete(&model.Banner{}, "id = ?", id)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "删除失败：" + result.Error.Error()})
		return
	}

	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "msg": "资源位不存在"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "msg": "deleted"})
}