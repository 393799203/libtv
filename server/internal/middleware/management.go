package middleware

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// ManagementAccess protects privileged operations at the authenticated API
// boundary, independently of whether the caller uses the management UI.
func ManagementAccess(roles UserRoleGetter) gin.HandlerFunc {
	admin := RequireAdmin(roles)
	return func(c *gin.Context) {
		if managementOnly(c.Request.Method, c.FullPath()) {
			admin(c)
			return
		}
		c.Next()
	}
}

func managementOnly(method, path string) bool {
	if strings.HasPrefix(path, "/api/admin/") || strings.HasPrefix(path, "/api/users") ||
		strings.HasPrefix(path, "/api/banners") || strings.HasPrefix(path, "/api/storage/sync") ||
		path == "/api/channel/policy" {
		return true
	}
	switch path {
	case "/api/styles", "/api/styles/:id", "/api/styles/:id/image",
		"/api/styles/categories", "/api/styles/categories/:id", "/api/shows/categories", "/api/shows/categories/:id":
		return method != http.MethodGet
	case "/api/shows/pending", "/api/shows/:id/approve", "/api/shows/:id/reject", "/api/shows/:id/video":
		return true
	case "/api/shows/:id":
		return method == http.MethodDelete
	case "/api/pricing":
		return method != http.MethodGet
	}
	return false
}

// OptionalAuth leaves public content readable anonymously, while allowing
// private previews to make decisions using a verified identity.
func OptionalAuth(checker UserTokenChecker, tracker UserActivityTracker) gin.HandlerFunc {
	auth := Auth(checker, tracker)
	return func(c *gin.Context) {
		if c.GetHeader("Authorization") == "" {
			c.Next()
			return
		}
		auth(c)
	}
}
