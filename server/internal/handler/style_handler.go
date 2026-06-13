package handler

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"libtv/internal/middleware"
	"libtv/internal/model"
	"libtv/internal/storage"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type StyleHandler struct {
	db      *gorm.DB
	storage storage.Storage
}

func NewStyleHandler(db *gorm.DB, storage storage.Storage) *StyleHandler {
	return &StyleHandler{db: db, storage: storage}
}

// CreateRequest 创建风格请求
type CreateStyleRequest struct {
	Name       string   `json:"name" binding:"required"`
	Author     string   `json:"author"`
	CategoryID string   `json:"category_id"` // 关联分类 ID
	Tags       []string `json:"tags"`
}

// UpdateRequest 更新风格请求
type UpdateStyleRequest struct {
	Name       *string  `json:"name"`
	Author     *string  `json:"author"`
	CategoryID *string  `json:"category_id"`
	Tags       []string `json:"tags"`
}

// CreateCategoryRequest 创建分类请求
type CreateCategoryRequest struct {
	Name      string `json:"name" binding:"required"`
	SortOrder int    `json:"sort_order"`
}

// UpdateCategoryRequest 更新分类请求
type UpdateCategoryRequest struct {
	Name      *string `json:"name"`
	SortOrder *int    `json:"sort_order"`
}

// List 获取风格列表（公开）
func (h *StyleHandler) List(c *gin.Context) {
	categoryID := c.Query("category_id")
	keyword := c.Query("keyword")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "50"))
	if pageSize > 100 {
		pageSize = 100
	}

	query := h.db.Model(&model.Style{})

	if categoryID != "" {
		query = query.Where("category_id = ?", categoryID)
	}
	if keyword != "" {
		query = query.Where("name ILIKE ? OR author ILIKE ?", "%"+keyword+"%", "%"+keyword+"%")
	}

	var total int64
	query.Count(&total)

	var styles []model.Style
	query.Preload("Category"). // 预加载分类信息
			Order("created_at DESC").
			Limit(pageSize).
			Offset((page - 1) * pageSize).
			Find(&styles)

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{
			"items":     styles,
			"total":     total,
			"page":      page,
			"page_size": pageSize,
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

	userID := middleware.GetUserID(c)
	_ = userID // 后续可用于权限校验
	tagsJSON, _ := json.Marshal(req.Tags)

	style := model.Style{
		Name:       req.Name,
		Author:     req.Author,
		ImageURL:   "", // 先创建，再上传图片后更新
		CategoryID: req.CategoryID,
		Tags:       tagsJSON,
	}

	if result := h.db.Create(&style); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "创建失败"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"code": 0, "data": style})
}

// UploadImage 上传风格图片并关联到风格记录（哈希去重）
func (h *StyleHandler) UploadImage(c *gin.Context) {
	id := c.Param("id")

	var style model.Style
	if result := h.db.First(&style, "id = ?", id); result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "msg": "风格不存在"})
		return
	}

	file, err := c.FormFile("file")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "请选择文件"})
		return
	}

	// 校验文件类型
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

	// 计算内容哈希用于去重
	src, err := file.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "读取文件失败"})
		return
	}
	defer src.Close()

	hasher := sha256.New()
	if _, err := io.Copy(hasher, src); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "计算哈希失败"})
		return
	}
	fileHash := hex.EncodeToString(hasher.Sum(nil))

	// 用哈希前12位 + 原始扩展名作为存储文件名，同内容不重复存储
	filename := fileHash[:12] + ext
	objectName := "styles/" + filename

	// 检查文件是否已存在（通过StatObject）
	_, err = h.storage.StatObject(objectName)
	if err == nil {
		// 文件已存在，直接返回已有路径
		imageURL := h.storage.GetURL(objectName)
		h.db.Model(&style).Update("image_url", imageURL)
		c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"url": imageURL}})
		return
	}

	// 需要重新打开文件来上传（io.Copy 后已读到末尾）
	src2, err := file.Open()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "读取文件失败"})
		return
	}
	defer src2.Close()

	// 上传到存储（MinIO优先，降级本地）
	contentType := "image/" + strings.TrimPrefix(ext, ".")
	if err := h.storage.PutObject(objectName, src2, file.Size, contentType); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "上传失败: " + err.Error()})
		return
	}

	imageURL := h.storage.GetURL(objectName)

	// 更新风格记录的图片地址
	h.db.Model(&style).Update("image_url", imageURL)

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"url": imageURL}})
}

// Categories 获取所有分类列表（需登录）
func (h *StyleHandler) Categories(c *gin.Context) {
	var categories []model.Category
	h.db.Order("sort_order DESC, created_at ASC").Find(&categories)

	// 统计每个分类下的风格数量
	type CatWithCount struct {
		model.Category
		StyleCount int64 `json:"style_count"`
	}

	var result []CatWithCount
	for _, cat := range categories {
		var count int64
		h.db.Model(&model.Style{}).Where("category_id = ?", cat.ID).Count(&count)
		result = append(result, CatWithCount{
			Category:   cat,
			StyleCount: count,
		})
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": result,
	})
}

// CreateCategory 创建分类（需登录）
func (h *StyleHandler) CreateCategory(c *gin.Context) {
	var req CreateCategoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": err.Error()})
		return
	}

	// 检查分类名是否已存在
	var existing model.Category
	if h.db.Where("name = ?", req.Name).First(&existing).Error == nil {
		c.JSON(http.StatusConflict, gin.H{"code": 409, "msg": "分类名已存在"})
		return
	}

	category := model.Category{
		Name:      req.Name,
		SortOrder: req.SortOrder,
	}

	if result := h.db.Create(&category); result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "创建失败"})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"code": 0, "data": category})
}

// UpdateCategory 更新分类（需登录）
func (h *StyleHandler) UpdateCategory(c *gin.Context) {
	id := c.Param("id")

	var category model.Category
	if result := h.db.First(&category, "id = ?", id); result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "msg": "分类不存在"})
		return
	}

	var req UpdateCategoryRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": err.Error()})
		return
	}

	updates := map[string]interface{}{}
	if req.Name != nil {
		// 检查新名称是否已存在
		var existing model.Category
		if h.db.Where("name = ? AND id != ?", *req.Name, id).First(&existing).Error == nil {
			c.JSON(http.StatusConflict, gin.H{"code": 409, "msg": "分类名已存在"})
			return
		}
		updates["name"] = *req.Name
	}
	if req.SortOrder != nil {
		updates["sort_order"] = *req.SortOrder
	}

	h.db.Model(&category).Updates(updates)
	h.db.First(&category, "id = ", id) // 刷新数据

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": category})
}

// DeleteCategory 删除分类（需登录）
func (h *StyleHandler) DeleteCategory(c *gin.Context) {
	id := c.Param("id")

	// 检查分类下是否有风格
	var styleCount int64
	h.db.Model(&model.Style{}).Where("category_id = ?", id).Count(&styleCount)
	if styleCount > 0 {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": fmt.Sprintf("该分类下还有 %d 个风格，无法删除", styleCount)})
		return
	}

	result := h.db.Delete(&model.Category{}, "id = ?", id)
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "msg": "分类不存在"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "msg": "deleted"})
}

// Update 更新风格信息（需登录）
func (h *StyleHandler) Update(c *gin.Context) {
	id := c.Param("id")

	var style model.Style
	if result := h.db.First(&style, "id = ?", id); result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "msg": "风格不存在"})
		return
	}

	var req UpdateStyleRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": err.Error()})
		return
	}

	updates := map[string]interface{}{}
	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.Author != nil {
		updates["author"] = *req.Author
	}
	if req.CategoryID != nil {
		updates["category_id"] = *req.CategoryID
	}
	if req.Tags != nil {
		tagsJSON, _ := json.Marshal(req.Tags)
		updates["tags"] = tagsJSON
	}

	h.db.Model(&style).Updates(updates)
	h.db.Preload("Category").First(&style, "id = ?", id) // 刷新数据

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": style})
}

// Delete 删除风格（需登录）
func (h *StyleHandler) Delete(c *gin.Context) {
	id := c.Param("id")

	// 先获取风格记录，拿到图片URL
	var style model.Style
	if result := h.db.First(&style, "id = ?", id); result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "msg": "风格不存在"})
		return
	}

	// 删除MinIO文件（如果有图片）
	if style.ImageURL != "" && strings.HasPrefix(style.ImageURL, "/media/styles/") {
		objectName := "styles/" + strings.TrimPrefix(style.ImageURL, "/media/styles/")
		h.storage.DeleteObject(objectName)
	}

	// 删除数据库记录
	h.db.Delete(&model.Style{}, "id = ?", id)

	// 同时删除关联的收藏记录
	h.db.Where("style_id = ?", id).Delete(&model.StyleFavorite{})

	c.JSON(http.StatusOK, gin.H{"code": 0, "msg": "deleted"})
}

// ToggleFavorite 切换收藏状态（需登录）
func (h *StyleHandler) ToggleFavorite(c *gin.Context) {
	styleID := c.Param("id")
	userID := middleware.GetUserID(c)

	var existing model.StyleFavorite
	result := h.db.Where("user_id = ? AND style_id = ?", userID, styleID).First(&existing)

	if result.Error == nil {
		// 已收藏 → 取消收藏
		h.db.Delete(&existing)
		// 点赞数 -1
		h.db.Model(&model.Style{}).Where("id = ?", styleID).UpdateColumn("likes", gorm.Expr("likes - 1"))
		c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"favorited": false}})
		return
	}

	// 未收藏 → 添加收藏
	fav := model.StyleFavorite{UserID: userID, StyleID: styleID}
	h.db.Create(&fav)
	// 点赞数 +1
	h.db.Model(&model.Style{}).Where("id = ?", styleID).UpdateColumn("likes", gorm.Expr("likes + 1"))
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": gin.H{"favorited": true}})
}

// ListFavorites 获取我的收藏列表（需登录）
func (h *StyleHandler) ListFavorites(c *gin.Context) {
	userID := middleware.GetUserID(c)

	var favIDs []string
	h.db.Model(&model.StyleFavorite{}).Where("user_id = ?", userID).
		Order("created_at DESC").Pluck("style_id", &favIDs)

	if len(favIDs) == 0 {
		c.JSON(http.StatusOK, gin.H{
			"code": 0,
			"data": gin.H{
				"items": []model.Style{},
				"total": 0,
				"page":  1,
			},
		})
		return
	}

	var styles []model.Style
	h.db.Where("id IN ?", favIDs).Find(&styles)

	// 按 favIDs 顺序排列（最新收藏在前）
	styleMap := make(map[string]model.Style)
	for _, s := range styles {
		styleMap[s.ID] = s
	}
	var ordered []model.Style
	for _, id := range favIDs {
		if s, ok := styleMap[id]; ok {
			ordered = append(ordered, s)
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{
			"items": ordered,
			"total": len(ordered),
			"page":  1,
		},
	})
}

// CheckFavorited 批量检查收藏状态（需登录）
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

	var favs []model.StyleFavorite
	h.db.Select("style_id").Where("user_id = ? AND style_id IN ?", userID, ids).Find(&favs)

	result := make(map[string]bool)
	for _, f := range favs {
		result[f.StyleID] = true
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": result})
}
