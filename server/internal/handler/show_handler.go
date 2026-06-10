package handler

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"libtv/internal/model"
	"libtv/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type ShowHandler struct {
	showService *service.ShowService
	uploadDir   string
	videoDir    string
	db          *gorm.DB
}

func NewShowHandler(showService *service.ShowService, uploadDir string, db *gorm.DB) *ShowHandler {
	return &ShowHandler{showService: showService, uploadDir: uploadDir, videoDir: filepath.Join("..", "public", "videos"), db: db}
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
		_, count, _ = h.showService.ListShows(c.Request.Context(), cat.ID, 1, 1)
		result = append(result, CatWithCount{
			ShowCategory: *cat,
			ShowCount:    count,
		})
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": result})
}

// ListShows 获取视频列表（公开，支持按分类筛选）
func (h *ShowHandler) ListShows(c *gin.Context) {
	categoryID := c.Query("category_id")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "50"))
	if pageSize > 100 {
		pageSize = 100
	}

	shows, total, err := h.showService.ListShows(c.Request.Context(), categoryID, page, pageSize)
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
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "msg": "视频不存在"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": show})
}

// ========== 需登录接口：管理操作 ==========

type CreateShowRequest struct {
	CategoryID   string   `json:"category_id" binding:"required"`
	Title        string   `json:"title" binding:"required"`
	Description  string   `json:"description"`
	VideoURL     string   `json:"video_url"`
	Duration     int      `json:"duration"`
	Author       string   `json:"author"`
	AuthorAvatar string   `json:"author_avatar"`
	Tags         []string `json:"tags"`
	SortOrder    int      `json:"sort_order"`
}

type UpdateShowRequest struct {
	Title        *string  `json:"title"`
	Description  *string  `json:"description"`
	VideoURL     *string  `json:"video_url"`
	Duration     *int     `json:"duration"`
	Author       *string  `json:"author"`
	AuthorAvatar *string  `json:"author_avatar"`
	Tags         []string `json:"tags"`
	SortOrder    *int     `json:"sort_order"`
	CategoryID   *string  `json:"category_id"`
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
		CategoryID:   req.CategoryID,
		Title:        req.Title,
		Description:  req.Description,
		VideoURL:     req.VideoURL,
		Duration:     req.Duration,
		Author:       req.Author,
		AuthorAvatar: req.AuthorAvatar,
		Tags:         tagsJSON,
		SortOrder:    req.SortOrder,
	}

	if err := h.showService.CreateShow(c.Request.Context(), show); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "创建失败"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"code": 0, "data": show})
}

// UploadThumbnail 上传封面图并关联到视频记录
func (h *ShowHandler) UploadThumbnail(c *gin.Context) {
	id := c.Param("id")

	show, err := h.showService.GetByID(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "msg": "视频不存在"})
		return
	}

	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "请选择文件"})
		return
	}

	ext := file.Filename[strings.LastIndex(file.Filename, "."):]
	allowedExts := map[string]bool{".jpg": true, ".jpeg": true, ".png": true, ".webp": true, ".gif": true}
	if !allowedExts[ext] {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "不支持的图片格式"})
		return
	}
	if file.Size > 10*1024*1024 {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "图片大小不能超过 10MB"})
		return
	}

	if err := os.MkdirAll(h.uploadDir, 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "创建目录失败"})
		return
	}

	src, err := file.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "读取文件失败"})
		return
	}
	defer src.Close()

	hasher := sha256.New()
	io.Copy(hasher, src)
	fileHash := hex.EncodeToString(hasher.Sum(nil))

	filename := fileHash[:12] + ext
	savePath := filepath.Join(h.uploadDir, filename)

	if _, err := os.Stat(savePath); err == nil {
		imageURL := "/media/shows/" + filename
		show.ThumbnailURL = imageURL
		h.showService.UpdateShow(c.Request.Context(), show)
		c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"url": imageURL}})
		return
	}

	src2, _ := file.Open()
	defer src2.Close()

	dst, err := os.Create(savePath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "保存失败"})
		return
	}
	defer dst.Close()

	io.Copy(dst, src2)

	imageURL := "/media/shows/" + filename
	show.ThumbnailURL = imageURL
	h.showService.UpdateShow(c.Request.Context(), show)

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"url": imageURL}})
}

// UploadVideo 上传视频文件到 public/videos
func (h *ShowHandler) UploadVideo(c *gin.Context) {
	id := c.Param("id")

	show, err := h.showService.GetByID(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "msg": "视频不存在"})
		return
	}

	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "请选择文件"})
		return
	}

	ext := strings.ToLower(filepath.Ext(file.Filename))
	allowedExts := map[string]bool{".mp4": true, ".webm": true, ".mov": true, ".avi": true, ".mkv": true}
	if !allowedExts[ext] {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "不支持的视频格式，支持 mp4/webm/mov/avi/mkv"})
		return
	}
	// 视频最大 1GB
	if file.Size > 1024*1024*1024 {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "视频大小不能超过 1GB"})
		return
	}

	if err := os.MkdirAll(h.videoDir, 0755); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "创建目录失败"})
		return
	}

	src, err := file.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "读取文件失败"})
		return
	}
	defer src.Close()

	hasher := sha256.New()
	io.Copy(hasher, src)
	fileHash := hex.EncodeToString(hasher.Sum(nil))

	filename := fileHash[:12] + ext
	savePath := filepath.Join(h.videoDir, filename)

	if _, err := os.Stat(savePath); err == nil {
		videoURL := "/media/videos/" + filename
		show.VideoURL = videoURL
		h.showService.UpdateShow(c.Request.Context(), show)
		c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"url": videoURL}})
		return
	}

	src2, _ := file.Open()
	defer src2.Close()

	dst, err := os.Create(savePath)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "保存失败"})
		return
	}
	defer dst.Close()

	io.Copy(dst, src2)

	videoURL := "/media/videos/" + filename
	show.VideoURL = videoURL
	h.showService.UpdateShow(c.Request.Context(), show)

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"url": videoURL}})
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
	if req.Author != nil {
		show.Author = *req.Author
	}
	if req.AuthorAvatar != nil {
		show.AuthorAvatar = *req.AuthorAvatar
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

	// 先获取记录，拿到文件路径再删除
	show, err := h.showService.GetByID(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "msg": "记录不存在"})
		return
	}

	thumbnailURL := show.ThumbnailURL
	videoURL := show.VideoURL

	if err := h.showService.DeleteShow(c.Request.Context(), id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": err.Error()})
		return
	}

	// 清理缩略图文件（存储在 public/shows 目录）
	if thumbnailURL != "" && strings.HasPrefix(thumbnailURL, "/media/shows/") {
		filename := filepath.Base(thumbnailURL)
		os.Remove(filepath.Join(h.uploadDir, filename))
	}

	// 清理视频文件（检查是否还有其他 show 引用）
	if videoURL != "" && strings.HasPrefix(videoURL, "/media/videos/") {
		filename := filepath.Base(videoURL)
		var count int64
		h.db.Model(&model.Show{}).Where("video_url = ? AND id != ?", videoURL, id).Count(&count)
		if count == 0 {
			os.Remove(filepath.Join(h.videoDir, filename))
		}
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
		// 检查是否是唯一约束冲突
		if strings.Contains(err.Error(), "unique") || strings.Contains(err.Error(), "duplicate") {
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

	cat, err := h.showService.ListCategories(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": err.Error()})
		return
	}

	var target *model.ShowCategory
	for _, c := range cat {
		if c.ID == id {
			target = c
			break
		}
	}
	if target == nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "msg": "分类不存在"})
		return
	}

	if req.Name != nil {
		target.Name = *req.Name
	}
	if req.SortOrder != nil {
		target.SortOrder = *req.SortOrder
	}

	if err := h.showService.UpdateCategory(c.Request.Context(), target); err != nil {
		if strings.Contains(err.Error(), "unique") || strings.Contains(err.Error(), "duplicate") {
			c.JSON(http.StatusConflict, gin.H{"code": 409, "msg": "分类名已存在"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "更新失败"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": target})
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
