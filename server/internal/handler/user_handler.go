package handler

import (
	"net/http"

	"libtv/internal/middleware"
	"libtv/internal/model"
	"libtv/internal/pkg/response"
	"libtv/internal/service"

	"github.com/gin-gonic/gin"
)

// UserHandler 处理用户相关 HTTP 请求
// 仅做参数解析与协议转换，业务逻辑全部下放到 UserService
type UserHandler struct {
	userService *service.UserService
}

func NewUserHandler(userService *service.UserService) *UserHandler {
	return &UserHandler{userService: userService}
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

// List 获取所有用户列表（管理员）
func (h *UserHandler) List(c *gin.Context) {
	users, err := h.userService.List(c.Request.Context(), c.Query("keyword"))
	if err != nil {
		response.FailWith(c, err)
		return
	}
	response.OK(c, gin.H{
		"items": users,
		"total": len(users),
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
