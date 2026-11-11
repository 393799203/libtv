package handler

import (
	"libtv/internal/billing"
	"net/http"
	"strconv"
	"strings"

	"libtv/internal/middleware"
	"libtv/internal/pkg/response"
	"libtv/internal/service"

	"github.com/gin-gonic/gin"
)

// UserHandler 处理用户相关 HTTP 请求
// 仅做参数解析与协议转换，业务逻辑全部下放到 UserService
type UserHandler struct {
	userService    *service.UserService
	billingService *billing.Service
}

func NewUserHandler(userService *service.UserService, billingService *billing.Service) *UserHandler {
	return &UserHandler{userService: userService, billingService: billingService}
}

type RegisterRequest struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required"`
	Nickname string `json:"nickname"`
	Code     string `json:"code" binding:"required,len=6,numeric"`
	// Channel 注册来源渠道（wasu=华数 / dianxin=电信）；缺省 wasu。
	// 由前端从注册链接的 ?source= 参数或其他投放渠道标记带入。
	Channel      string `json:"channel"`
	ReferralCode string `json:"referralCode"`
}

type LoginRequest struct {
	Email      string `json:"email" binding:"required,email"`
	Password   string `json:"password" binding:"required"`
	RememberMe bool   `json:"remember_me"`
}

func (h *UserHandler) Register(c *gin.Context) {
	var req RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "请填写有效的邮箱、密码和 6 位验证码")
		return
	}

	user, err := h.userService.RegisterVerified(c.Request.Context(), req.Email, req.Password, req.Nickname, req.Channel, req.ReferralCode, req.Code)
	if err != nil {
		response.FailWith(c, err)
		return
	}

	session, err := h.userService.StartSession(c.Request.Context(), user.Email, req.Password, false)
	if err != nil {
		response.OK(c, gin.H{"registered": true, "login_required": true})
		return
	}
	setSessionCookie(c, session.RefreshToken, session.Session)
	response.Created(c, session)
}

func (h *UserHandler) Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "请输入有效的邮箱和密码")
		return
	}

	if err := h.userService.CheckLoginRate(c.Request.Context(), req.Email); err != nil {
		c.Header("Retry-After", "900")
		response.FailWith(c, err)
		return
	}
	session, err := h.userService.StartSession(c.Request.Context(), req.Email, req.Password, req.RememberMe)
	if err != nil {
		response.FailWith(c, err)
		return
	}
	setSessionCookie(c, session.RefreshToken, session.Session)
	response.OK(c, session)
}

// Refresh exchanges an HttpOnly refresh cookie for a short-lived access token.
// The server session and its absolute deadline remain unchanged.
func (h *UserHandler) Refresh(c *gin.Context) {
	raw, _ := c.Cookie(sessionCookieName)
	session, err := h.userService.RefreshSession(c.Request.Context(), raw)
	if err != nil {
		response.FailWith(c, err)
		return
	}
	c.Header("Cache-Control", "no-store")
	response.OK(c, session)
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
	NewPassword string `json:"new_password" binding:"required"`
}

// ChangePassword 修改当前用户密码
func (h *UserHandler) ChangePassword(c *gin.Context) {
	userID := middleware.GetUserID(c)
	var req ChangePasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, "请填写原密码和新密码")
		return
	}

	if err := h.userService.ChangePassword(c.Request.Context(), userID, req.OldPassword, req.NewPassword); err != nil {
		response.FailWith(c, err)
		return
	}
	setSessionCookie(c, "", nil)
	response.OKWithMsg(c, "密码修改成功", nil)
}

// List 获取用户列表（管理员，附带项目数/资产数统计）
// 传 page>=1 时分页返回（管理员排前，同角色按注册时间倒序）；不传 page 保持全量返回（作者选择器等场景）
func (h *UserHandler) List(c *gin.Context) {
	keyword := c.Query("keyword")
	// 角色 / 渠道筛选：都是可选参数，空值（不传）表示不限，保持原有全量分页行为
	role := strings.TrimSpace(c.Query("role"))
	channel := strings.TrimSpace(c.Query("channel"))
	page, _ := strconv.Atoi(c.DefaultQuery("page", "0"))
	if page >= 1 {
		pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "10"))
		if pageSize <= 0 || pageSize > 100 {
			pageSize = 10
		}
		items, total, err := h.userService.ListWithStatsPaged(c.Request.Context(), keyword, role, channel, page, pageSize, middleware.GetUserID(c))
		if err != nil {
			response.FailWith(c, err)
			return
		}
		h.protectReferralMetadata(c, items)
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
	h.protectReferralMetadata(c, items)
	response.OK(c, gin.H{
		"items": items,
		"total": len(items),
	})
}

// Existing author selectors use /users too. Referral attribution is admin-only.
func (h *UserHandler) protectReferralMetadata(c *gin.Context, items []service.UserListItem) {
	role, err := h.userService.GetUserRole(c.Request.Context(), middleware.GetUserID(c))
	if err == nil && role == "admin" {
		return
	}
	for i := range items {
		items[i].ReferralCode, items[i].InviterID = nil, nil
		items[i].InviterNickname, items[i].InviterEmail = "", ""
	}
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

	// 后台手工充值没有支付宝订单，订单号传零值（真实充值走支付宝回调，那里会带上订单号）
	if err := h.billingService.Recharge(c.Request.Context(), id, req.Amount, "后台充值", remark, billing.RechargeOrder{}); err != nil {
		response.FailWith(c, err)
		return
	}

	// 返回充值后的用户信息
	user, _ := h.userService.GetByID(c.Request.Context(), id)
	response.OK(c, user)
}
