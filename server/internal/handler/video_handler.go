package handler

import (
	"net/http"
	"strconv"

	"libtv/internal/middleware"
	"libtv/internal/service"

	"github.com/gin-gonic/gin"
)

type VideoHandler struct {
	videoService *service.VideoService
}

func NewVideoHandler(videoService *service.VideoService) *VideoHandler {
	return &VideoHandler{videoService: videoService}
}

type CreateVideoRequest struct {
	Title       string `json:"title" binding:"required"`
	Description string `json:"description"`
	VideoURL    string `json:"video_url" binding:"required"`
	Duration    int    `json:"duration"`
}

func (h *VideoHandler) Create(c *gin.Context) {
	var req CreateVideoRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": err.Error()})
		return
	}

	userID := middleware.GetUserID(c)
	video, err := h.videoService.Create(c.Request.Context(), userID, req.Title, req.Description, req.VideoURL, req.Duration)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"code": 0, "data": video})
}

func (h *VideoHandler) Get(c *gin.Context) {
	id := c.Param("id")
	video, err := h.videoService.GetByID(c.Request.Context(), id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "msg": "video not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": video})
}

func (h *VideoHandler) List(c *gin.Context) {
	page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
	pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "20"))
	tag := c.Query("tag")
	keyword := c.Query("keyword")

	videos, total, err := h.videoService.List(c.Request.Context(), page, pageSize, tag, keyword)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{
			"items":     videos,
			"total":     total,
			"page":      page,
			"page_size": pageSize,
			"tag":       tag,
			"keyword":   keyword,
		},
	})
}

type UpdateVideoRequest struct {
	Title       string `json:"title"`
	Description string `json:"description"`
}

func (h *VideoHandler) Update(c *gin.Context) {
	id := c.Param("id")
	var req UpdateVideoRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": err.Error()})
		return
	}

	video, err := h.videoService.Update(c.Request.Context(), id, req.Title, req.Description)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": video})
}

func (h *VideoHandler) Delete(c *gin.Context) {
	id := c.Param("id")
	if err := h.videoService.Delete(c.Request.Context(), id); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "msg": "deleted"})
}
