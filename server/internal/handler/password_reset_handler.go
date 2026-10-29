package handler

import (
	"net/http"

	"libtv/internal/pkg/response"
	"libtv/internal/service"

	"github.com/gin-gonic/gin"
)

// PasswordResetHandler 「忘记密码」相关 HTTP 请求。
// 仅做参数解析与协议转换，业务逻辑全部下放到 PasswordResetService。
//
// 独立于 UserHandler 而不并进去：找回密码是**未登录**流程，与 UserHandler 那套
// 「当前登录用户」语义不是一回事，分开也让这里的两个路由更容易一眼看清是公开接口。
type PasswordResetHandler struct {
	svc *service.PasswordResetService
}

func NewPasswordResetHandler(svc *service.PasswordResetService) *PasswordResetHandler {
	return &PasswordResetHandler{svc: svc}
}

// ForgotPasswordRequest 申请重置。邮箱格式在这里先挡一道，非法邮箱不进业务层。
type ForgotPasswordRequest struct {
	Email string `json:"email" binding:"required,email"`
}

// ResetPasswordRequest 凭令牌设置新密码。密码长度同样先由 binding 挡一道，
// service 层再校验一次（不依赖调用方是否记得校验）。
type ResetPasswordRequest struct {
	Token    string `json:"token" binding:"required"`
	Password string `json:"password" binding:"required,min=6"`
}

// ForgotPassword 申请发送重置邮件 POST /api/auth/forgot-password
//
// 邮箱未注册时明确报错（ErrResetEmailNotFound → 404 + code 2010），
// 不再为「防枚举」而返回与发送成功一致的话术——取舍理由见 service.RequestReset。
func (h *PasswordResetHandler) ForgotPassword(c *gin.Context) {
	var req ForgotPasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}

	if err := h.svc.RequestReset(c.Request.Context(), req.Email, c.ClientIP()); err != nil {
		response.FailWith(c, err)
		return
	}

	// 能走到这里说明邮箱确实已注册，话术直接陈述「已发送」即可，不必再用条件句
	response.OKWithMsg(c, "重置邮件已发送，请查收邮件", nil)
}

// ResetPassword 凭令牌重置密码 POST /api/auth/reset-password
func (h *PasswordResetHandler) ResetPassword(c *gin.Context) {
	var req ResetPasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		response.Fail(c, http.StatusBadRequest, err.Error())
		return
	}

	if err := h.svc.ResetPassword(c.Request.Context(), req.Token, req.Password); err != nil {
		response.FailWith(c, err)
		return
	}

	response.OKWithMsg(c, "密码已重置，请用新密码登录", nil)
}
