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
	if err := h.db.Order("sort_order asc, created_at desc").Find(&banners).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "获取列表失败"})
		return
	}
	c.JSON(http.StatusOK, banners)
}

// Get 获取单个资源位
func (h *BannerHandler) Get(c *gin.Context) {
	id := c.Param("id")
	var banner model.Banner
	if err := h.db.First(&banner, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "资源位不存在"})
		return
	}
	c.JSON(http.StatusOK, banner)
}

// Create 创建资源位
func (h *BannerHandler) Create(c *gin.Context) {
	var req model.Banner
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}

	// ID 由 BeforeCreate 自动生成
	if err := h.db.Create(&req).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建失败"})
		return
	}
	c.JSON(http.StatusOK, req)
}

// Update 更新资源位
func (h *BannerHandler) Update(c *gin.Context) {
	id := c.Param("id")
	var banner model.Banner
	if err := h.db.First(&banner, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "资源位不存在"})
		return
	}

	var req model.Banner
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误"})
		return
	}

	// 更新字段
	h.db.Model(&banner).Updates(map[string]interface{}{
		"title":      req.Title,
		"image_url":  req.ImageURL,
		"link_url":   req.LinkURL,
		"sort_order": req.SortOrder,
		"is_active":  req.IsActive,
	})

	c.JSON(http.StatusOK, banner)
}

// Delete 删除资源位
func (h *BannerHandler) Delete(c *gin.Context) {
	id := c.Param("id")
	if err := h.db.Delete(&model.Banner{}, "id = ?", id).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "删除失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "删除成功"})
}