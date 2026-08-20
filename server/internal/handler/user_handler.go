package handler

import (
	"net/http"
	"strconv"

	"libtv/internal/middleware"
	"libtv/internal/model"
	"libtv/internal/pkg/response"
	"libtv/internal/service"

	"github.com/gin-gonic/gin"
)

// UserHandler 处理用户相关 HTTP 请求
// 仅做参数解析与协议转换，业务逻辑全部下放到 UserService
type UserHandler struct {
	userService    *service.UserService
	billingService *service.BillingService
}

func NewUserHandler(userService *service.UserService, billingService *service.BillingService) *UserHandler {
	return &UserHandler{userService: userService, billingService: billingService}
}

type RegisterRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required,min=6"`
	Nickname string `json:"nickname"`
}

type LoginRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required"`
}

type AuthResponse struct {
	Token string     `json:"token"`
	User  model.User `json:"user"`
}

func (h *UserHandler) Register(c *gin.Context) {
	var req RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}

	user, err := h.userService.Register(c.Request.Context(), req.Email, req.Password, req.Nickname)
	if err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}

	response.Created(c, user)
}

func (h *UserHandler) Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}

	token, user, err := h.userService.Login(c.Request.Context(), req.Email, req.Password)
	if err != nil {
		response.Fail(c, http.StatusUnauthorized, err.Error())
		return
	}

	response.OK(c, AuthResponse{Token: token, User: *user})
}

func (h *UserHandler) Me(c *gin.Context) {
	userID := middleware.GetUserID(c)
	user, err := h.userService.GetByID(c.Request.Context(), userID)
	if err != nil {
		response.Fail(c, http.StatusNotFound, "user not found")
		return
	}
	response.OK(c, user)
}

// UpdateProfileRequest 更新个人资料请求（字段可选，不传表示不修改）
type UpdateProfileRequest struct {
	Nickname  *string `json:"nickname"`
	AvatarURL *string `json:"avatar_url"`
}

// UpdateProfile 更新当前用户个人资料（昵称/头像）
func (h *UserHandler) UpdateProfile(c *gin.Context) {
	userID := middleware.GetUserID(c)
	var req UpdateProfileRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}

	user, err := h.userService.UpdateProfile(c.Request.Context(), userID, req.Nickname, req.AvatarURL)
	if err != nil {
		response.FailWith(c, err)
		return
	}
	response.OK(c, user)
}

// ChangePasswordRequest 修改密码请求
type ChangePasswordRequest struct {
	OldPassword string `json:"old_password" binding:"required"`
	NewPassword string `json:"new_password" binding:"required,min=6"`
}

// ChangePassword 修改当前用户密码
func (h *UserHandler) ChangePassword(c *gin.Context) {
	userID := middleware.GetUserID(c)
	var req ChangePasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "新密码至少6位")
		return
	}

	if err := h.userService.ChangePassword(c.Request.Context(), userID, req.OldPassword, req.NewPassword); err != nil {
		response.FailWith(c, err)
		return
	}
	response.OKWithMsg(c, "密码修改成功", nil)
}

// List 获取用户列表（管理员，附带项目数/资产数统计）
// 传 page>=1 时分页返回（管理员排前，同角色按注册时间倒序）；不传 page 保持全量返回（作者选择器等场景）
func (h *UserHandler) List(c *gin.Context) {
	keyword := c.Query("keyword")
	page, _ := strconv.Atoi(c.DefaultQuery("page", "0"))
	if page >= 1 {
		pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "10"))
		if pageSize <= 0 || pageSize > 100 {
			pageSize = 10
		}
		items, total, err := h.userService.ListWithStatsPaged(c.Request.Context(), keyword, page, pageSize)
		if err != nil {
			response.FailWith(c, err)
			return
		}
		response.OK(c, gin.H{
			"items":     items,
			"total":     total,
			"page":      page,
			"page_size": pageSize,
		})
		return
	}

	items, err := h.userService.ListWithStats(c.Request.Context(), keyword)
	if err != nil {
		response.FailWith(c, err)
		return
	}
	response.OK(c, gin.H{
		"items": items,
		"total": len(items),
	})
}

// Delete 删除用户（管理员）
func (h *UserHandler) Delete(c *gin.Context) {
	id := c.Param("id")
	currentUserID := middleware.GetUserID(c)

	if err := h.userService.Delete(c.Request.Context(), id, currentUserID); err != nil {
		response.FailWith(c, err)
		return
	}
	response.OKWithMsg(c, "deleted", nil)
}

// UpdateRole 更新用户角色（管理员）
func (h *UserHandler) UpdateRole(c *gin.Context) {
	id := c.Param("id")
	var req struct {
		Role string `json:"role" binding:"required,oneof=user admin"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "角色必须是 user 或 admin")
		return
	}

	currentUserID := middleware.GetUserID(c)
	user, err := h.userService.UpdateRole(c.Request.Context(), id, req.Role, currentUserID)
	if err != nil {
		response.FailWith(c, err)
		return
	}
	response.OK(c, user)
}

// RechargeRequest 管理员充值请求
type RechargeRequest struct {
	Amount int64  `json:"amount" binding:"required,gt=0"`
	Remark string `json:"remark"`
}

// Recharge 管理员为用户充值积分
func (h *UserHandler) Recharge(c *gin.Context) {
	id := c.Param("id")
	var req RechargeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "充值积分必须大于0")
		return
	}

	// 检查当前用户是否为管理员
	currentUserID := middleware.GetUserID(c)
	role, err := h.userService.GetUserRole(c.Request.Context(), currentUserID)
	if err != nil || role != "admin" {
		response.Fail(c, http.StatusForbidden, "仅管理员可执行充值操作")
		return
	}

	// 检查目标用户是否存在
	_, err = h.userService.GetByID(c.Request.Context(), id)
	if err != nil {
		response.Fail(c, http.StatusNotFound, "用户不存在")
		return
	}

	remark := req.Remark
	if remark == "" {
		remark = "后台充值"
	}

	if err := h.billingService.Recharge(c.Request.Context(), id, req.Amount, "后台充值", remark); err != nil {
		response.FailWith(c, err)
		return
	}

	// 返回充值后的用户信息
	user, _ := h.userService.GetByID(c.Request.Context(), id)
	response.OK(c, user)
}
