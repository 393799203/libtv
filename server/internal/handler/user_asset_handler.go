package handler

import (
	"net/http"

	"libtv/internal/middleware"
	"libtv/internal/model"
	"libtv/internal/pkg/response"
	"libtv/internal/service"

	"github.com/gin-gonic/gin"
)

type UserAssetHandler struct {
	assetService *service.UserAssetService
}

func NewUserAssetHandler(assetService *service.UserAssetService) *UserAssetHandler {
	return &UserAssetHandler{assetService: assetService}
}

type CreateUserAssetRequest struct {
	Type string `json:"type" binding:"required"` // image / video
	URL  string `json:"url" binding:"required"`
	Name string `json:"name"`
}

// Create 保存资产到个人资产库（需登录）
func (h *UserAssetHandler) Create(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		response.Fail(c, http.StatusUnauthorized, "未登录")
		return
	}

	var req CreateUserAssetRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}

	asset := &model.UserAsset{
		UserID: userID,
		Type:   req.Type,
		URL:    req.URL,
		Name:   req.Name,
	}
	if err := h.assetService.Create(c.Request.Context(), asset); err != nil {
		response.FailWith(c, err)
		return
	}
	response.Created(c, asset)
}

// List 列出当前用户的资产（?type=image|video 过滤，需登录）
func (h *UserAssetHandler) List(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		response.Fail(c, http.StatusUnauthorized, "未登录")
		return
	}

	assets, err := h.assetService.List(c.Request.Context(), userID, c.Query("type"))
	if err != nil {
		response.FailWith(c, err)
		return
	}
	response.OK(c, assets)
}

// Delete 删除资产（仅限本人，需登录）
func (h *UserAssetHandler) Delete(c *gin.Context) {
	userID := middleware.GetUserID(c)
	if userID == "" {
		response.Fail(c, http.StatusUnauthorized, "未登录")
		return
	}

	if err := h.assetService.Delete(c.Request.Context(), userID, c.Param("id")); err != nil {
		response.FailWith(c, err)
		return
	}
	response.OKWithMsg(c, "deleted", nil)
}
