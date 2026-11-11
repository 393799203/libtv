package middleware

import (
	"context"
	"net/http"
	"time"

	"libtv/internal/config"
	"libtv/internal/pkg/response"

	"github.com/gin-gonic/gin"
)

type AuthRateChecker interface {
	CheckAuthRate(context.Context, string, string, int, time.Duration) error
}

func AuthRateLimit(checker AuthRateChecker, scope string, limit int) gin.HandlerFunc {
	return func(c *gin.Context) {
		if err := checker.CheckAuthRate(c.Request.Context(), scope, c.ClientIP(), limit, time.Minute); err != nil {
			c.Header("Retry-After", "60")
			response.FailWith(c, err)
			c.Abort()
			return
		}
		c.Next()
	}
}

// Refresh and logout use ambient cookies: require a non-simple request header
// and a trusted Origin, even when invoked without an access token.
func AuthCookieGuard() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.GetHeader("X-Requested-With") != "libtv" {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"code": 403, "msg": "请求来源无效，请刷新页面重试"})
			return
		}
		origin := c.GetHeader("Origin")
		if origin != "" {
			scheme := "http"
			if c.Request.TLS != nil || c.GetHeader("X-Forwarded-Proto") == "https" {
				scheme = "https"
			}
			valid := origin == scheme+"://"+c.Request.Host
			origins := config.C.CORS.Origins
			if len(origins) == 0 {
				origins = defaultOrigins
			}
			for _, allowed := range origins {
				if origin == allowed {
					valid = true
				}
			}
			if !valid {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"code": 403, "msg": "请求来源无效，请刷新页面重试"})
				return
			}
		}
		c.Next()
	}
}
