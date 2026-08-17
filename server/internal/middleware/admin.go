package middleware

import (
	"context"
	"net/http"

	"github.com/gin-gonic/gin"
)

// UserRoleGetter 查询用户角色（由 service 层实现，中间件仅依赖接口）
type UserRoleGetter interface {
	GetUserRole(ctx context.Context, userID string) (string, error)
}

// RequireAdmin 管理员鉴权中间件：必须挂在 Auth 之后，
// 非 admin 角色返回 403
func RequireAdmin(roleGetter UserRoleGetter) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := GetUserID(c)
		if userID == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"code": 401, "msg": "未登录"})
			c.Abort()
			return
		}

		role, err := roleGetter.GetUserRole(c.Request.Context(), userID)
		if err != nil || role != "admin" {
			c.JSON(http.StatusForbidden, gin.H{"code": 403, "msg": "需要管理员权限"})
			c.Abort()
			return
		}

		c.Next()
	}
}
