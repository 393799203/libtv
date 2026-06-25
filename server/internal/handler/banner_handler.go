package handler

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"path/filepath"
	"strings"

	"libtv/internal/model"
	"libtv/internal/service"
	"libtv/internal/storage"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type BannerHandler struct {
	bannerService *service.BannerService
	storage       storage.Storage
	db            *gorm.DB
}

func NewBannerHandler(bannerService *service.BannerService, storage storage.Storage, db *gorm.DB) *BannerHandler {
	return &BannerHandler{bannerService: bannerService, storage: storage, db: db}
}

// ========== 公开接口 ==========

// ListBanners 获取所有Banner列表（公开）
func (h *BannerHandler) ListBanners(c *gin.Context) {
	// 获取查询参数
	isActiveStr := c.Query("is_active")
	
	var banners []*model.Banner
	var err error
	
	// 如果指定了is_active参数，只返回对应状态的Banner
	if isActiveStr != "" {
		isActive := isActiveStr == "true"
		banners, err = h.bannerService.ListBannersByStatus(c.Request.Context(), isActive)
	} else {
		// 后台管理：返回所有Banner，禁用的排在后面
		banners, err = h.bannerService.ListAllBanners(c.Request.Context())
	}
	
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": banners})
}

// GetBanner 获取单个Banner详情（公开）
func (h *BannerHandler) GetBanner(c *gin.Context) {
	id := c.Param("id")
	banner, err := h.bannerService.GetByID(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "msg": "Banner不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": banner})
}

// ========== 需登录接口：管理操作 ==========

type CreateBannerRequest struct {
	Title       string `json:"title" binding:"required"`
	Description string `json:"description"`
	ImageURL    string `json:"image_url"`
	LinkURL     string `json:"link_url"`
	SortOrder   int    `json:"sort_order"`
	IsActive    bool   `json:"is_active"`
}

type UpdateBannerRequest struct {
	Title       *string `json:"title"`
	Description *string `json:"description"`
	ImageURL    *string `json:"image_url"`
	LinkURL     *string `json:"link_url"`
	SortOrder   *int    `json:"sort_order"`
	IsActive    *bool   `json:"is_active"`
}

// CreateBanner 创建Banner（需登录）
func (h *BannerHandler) CreateBanner(c *gin.Context) {
	var req CreateBannerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": err.Error()})
		return
	}

	banner := &model.Banner{
		Title:       req.Title,
		Description: req.Description,
		ImageURL:    req.ImageURL,
		LinkURL:     req.LinkURL,
		SortOrder:   req.SortOrder,
		IsActive:    req.IsActive,
	}

	if err := h.bannerService.CreateBanner(c.Request.Context(), banner); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "创建失败"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"code": 0, "data": banner})
}

// UploadImage 上传Banner图片（不需要Banner ID）
func (h *BannerHandler) UploadImage(c *gin.Context) {
	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "请选择文件"})
		return
	}

	ext := strings.ToLower(filepath.Ext(file.Filename))
	allowedExts := map[string]bool{".jpg": true, ".jpeg": true, ".png": true, ".webp": true, ".gif": true}
	if !allowedExts[ext] {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "不支持的图片格式，支持 jpg/jpeg/png/webp/gif"})
		return
	}

	if file.Size > 50*1024*1024 {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "图片大小不能超过 50MB"})
		return
	}

	src, err := file.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "读取文件失败"})
		return
	}
	defer src.Close()

	// 计算哈希用于去重
	hasher := sha256.New()
	io.Copy(hasher, src)
	fileHash := hex.EncodeToString(hasher.Sum(nil))

	filename := fileHash[:12] + ext
	objectName := "banners/" + filename

	// 检查文件是否已存在
	_, err = h.storage.StatObject(objectName)
	if err != nil {
		// 文件不存在，上传新文件
		src.Seek(0, 0)
		contentType := "image/" + strings.TrimPrefix(ext, ".")
		if err := h.storage.PutObject(objectName, src, file.Size, contentType); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "上传失败: " + err.Error()})
			return
		}
	}

	imageURL := h.storage.GetURL(objectName)
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"url": imageURL}})
}

// UpdateBanner 更新Banner信息（需登录）
func (h *BannerHandler) UpdateBanner(c *gin.Context) {
	id := c.Param("id")

	banner, err := h.bannerService.GetByID(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "msg": "Banner不存在"})
		return
	}

	var req UpdateBannerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": err.Error()})
		return
	}

	if req.Title != nil {
		banner.Title = *req.Title
	}
	if req.Description != nil {
		banner.Description = *req.Description
	}
	if req.ImageURL != nil {
		banner.ImageURL = *req.ImageURL
	}
	if req.LinkURL != nil {
		banner.LinkURL = *req.LinkURL
	}
	if req.SortOrder != nil {
		banner.SortOrder = *req.SortOrder
	}
	if req.IsActive != nil {
		banner.IsActive = *req.IsActive
	}

	if err := h.bannerService.UpdateBanner(c.Request.Context(), banner); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "更新失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": banner})
}

// DeleteBanner 删除Banner（需登录）
func (h *BannerHandler) DeleteBanner(c *gin.Context) {
	id := c.Param("id")

	// 先获取记录，拿到图片路径再删除
	banner, err := h.bannerService.GetByID(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "msg": "Banner不存在"})
		return
	}

	imageURL := banner.ImageURL

	if err := h.bannerService.DeleteBanner(c.Request.Context(), id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": err.Error()})
		return
	}

	// 清理图片文件
	if imageURL != "" && strings.HasPrefix(imageURL, "/media/banners/") {
		objectName := "banners/" + filepath.Base(imageURL)
		h.storage.DeleteObject(objectName)
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "msg": "deleted"})
}