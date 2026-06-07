package handler

import (
	"encoding/json"
	"net/http"

	"libtv/internal/service"

	"github.com/gin-gonic/gin"
)

type CanvasHandler struct {
	canvasService *service.CanvasService
}

func NewCanvasHandler(canvasService *service.CanvasService) *CanvasHandler {
	return &CanvasHandler{canvasService: canvasService}
}

func (h *CanvasHandler) Get(c *gin.Context) {
	projectID := c.Param("id")
	content, err := h.canvasService.GetByProjectID(c.Request.Context(), projectID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "msg": "canvas not found"})
		return
	}

	// 将 []byte 反序列化为 map，再包装成标准格式
	var data interface{}
	if err := json.Unmarshal(content, &data); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "invalid canvas data"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"msg":  "ok",
		"data": data,
	})
}

type SaveCanvasRequest struct {
	Content interface{} `json:"content" binding:"required"`
}

func (h *CanvasHandler) Save(c *gin.Context) {
	projectID := c.Param("id")

	content, err := c.GetRawData()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "invalid body"})
		return
	}

	if err := h.canvasService.Save(c.Request.Context(), projectID, content); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "msg": "saved"})
}
