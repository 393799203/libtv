package middleware

import (
	"context"
	"net/http"

	"libtv/internal/model"

	"github.com/gin-gonic/gin"
)

type ProjectOwnerLookup interface {
	FindByID(ctx context.Context, id string) (*model.Project, error)
}

// RequireProjectOwner keeps projects and their canvases private to their owner.
// Collection routes have no :id and already scope their lists to the current user.
// This middleware must run after Auth and before any billing or workflow work.
func RequireProjectOwner(projects ProjectOwnerLookup) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := GetUserID(c)
		if userID == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"code": 401, "msg": "请先登录"})
			return
		}
		id := c.Param("id")
		if id == "" {
			c.Next()
			return
		}
		project, err := projects.FindByID(c.Request.Context(), id)
		if err != nil || project == nil || project.UserID != userID {
			c.AbortWithStatusJSON(http.StatusNotFound, gin.H{"code": 404, "msg": "项目不存在或无权访问"})
			return
		}
		c.Next()
	}
}
