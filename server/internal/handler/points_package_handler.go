package handler

import (
	"net/http"
	"strconv"

	"libtv/internal/model"
	"libtv/internal/pkg/response"
	"libtv/internal/service"

	"github.com/gin-gonic/gin"
)

// PointsPackageHandler 积分套餐（积分超市卡片 + 运营后台「套餐管理」页签）
type PointsPackageHandler struct {
	pointsPackageService *service.PointsPackageService
}

func NewPointsPackageHandler(pointsPackageService *service.PointsPackageService) *PointsPackageHandler {
	return &PointsPackageHandler{pointsPackageService: pointsPackageService}
}

// ListPublic 积分超市展示：启用中的套餐（无需登录）
func (h *PointsPackageHandler) ListPublic(c *gin.Context) {
	packages, err := h.pointsPackageService.ListPublic(c.Request.Context())
	if err != nil {
		response.FailWith(c, err)
		return
	}
	response.OK(c, gin.H{"items": packages})
}

// ListAll 全部套餐（仅管理员，路由层由 RequireAdmin 中间件保护）
func (h *PointsPackageHandler) ListAll(c *gin.Context) {
	packages, err := h.pointsPackageService.ListAll(c.Request.Context())
	if err != nil {
		response.FailWith(c, err)
		return
	}
	response.OK(c, gin.H{"items": packages})
}

// Create 新建套餐（仅管理员）
func (h *PointsPackageHandler) Create(c *gin.Context) {
	var pkg model.PointsPackage
	if err := c.ShouldBindJSON(&pkg); err != nil {
		response.Fail(c, http.StatusBadRequest, "套餐参数非法")
		return
	}
	if err := h.pointsPackageService.Create(c.Request.Context(), &pkg); err != nil {
		response.FailWith(c, err)
		return
	}
	response.OK(c, pkg)
}

// Update 更新套餐（仅管理员）
func (h *PointsPackageHandler) Update(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		response.Fail(c, http.StatusBadRequest, "套餐 ID 非法")
		return
	}
	var pkg model.PointsPackage
	if err := c.ShouldBindJSON(&pkg); err != nil {
		response.Fail(c, http.StatusBadRequest, "套餐参数非法")
		return
	}
	pkg.ID = id
	if err := h.pointsPackageService.Update(c.Request.Context(), &pkg); err != nil {
		response.FailWith(c, err)
		return
	}
	response.OK(c, pkg)
}

// Delete 删除套餐（仅管理员）
func (h *PointsPackageHandler) Delete(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil || id <= 0 {
		response.Fail(c, http.StatusBadRequest, "套餐 ID 非法")
		return
	}
	if err := h.pointsPackageService.Delete(c.Request.Context(), id); err != nil {
		response.FailWith(c, err)
		return
	}
	response.OKWithMsg(c, "deleted", nil)
}
