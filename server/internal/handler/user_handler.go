package handler

import (
	"net/http"

	"libtv/internal/middleware"
	"libtv/internal/model"
	"libtv/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type UserHandler struct {
	userService *service.UserService
	db          *gorm.DB
}

func NewUserHandler(userService *service.UserService, db *gorm.DB) *UserHandler {
	return &UserHandler{userService: userService, db: db}
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
	Token string      `json:"token"`
	User  model.User  `json:"user"`
}

func (h *UserHandler) Register(c *gin.Context) {
	var req RegisterRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": err.Error()})
		return
	}

	user, err := h.userService.Register(c.Request.Context(), req.Email, req.Password, req.Nickname)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, gin.H{"code": 0, "data": user})
}

func (h *UserHandler) Login(c *gin.Context) {
	var req LoginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": err.Error()})
		return
	}

	token, user, err := h.userService.Login(c.Request.Context(), req.Email, req.Password)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"code": 401, "msg": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "data": AuthResponse{Token: token, User: *user}})
}

func (h *UserHandler) Me(c *gin.Context) {
	userID := middleware.GetUserID(c)
	user, err := h.userService.GetByID(c.Request.Context(), userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "msg": "user not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"code": 0, "data": user})
}

// List 获取所有用户列表（管理员）
func (h *UserHandler) List(c *gin.Context) {
	var users []model.User
	h.db.Order("created_at DESC").Find(&users)

	c.JSON(http.StatusOK, gin.H{
		"code": 0,
		"data": gin.H{
			"items": users,
			"total": len(users),
		},
	})
}

// Delete 删除用户（管理员）
func (h *UserHandler) Delete(c *gin.Context) {
	id := c.Param("id")

	// 检查是否存在
	var user model.User
	if result := h.db.Where("id = ?", id).First(&user); result.Error != nil {
		c.JSON(http.StatusNotFound, gin.H{"code": 404, "msg": "用户不存在"})
		return
	}

	// 不允许删除自己（通过 context 获取当前用户）
	currentUserID := middleware.GetUserID(c)
	if user.ID == currentUserID {
		c.JSON(http.StatusBadRequest, gin.H{"code": 400, "msg": "不能删除自己的账号"})
		return
	}

	// 删除用户关联的数据（按外键顺序）
	h.db.Where("user_id = ?", user.ID).Delete(&model.Project{})
	h.db.Where("user_id = ?", user.ID).Delete(&model.StyleFavorite{})

	// 最后删除用户
	if err := h.db.Delete(&user).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"code": 500, "msg": "删除失败：" + err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"code": 0, "msg": "deleted"})
}
