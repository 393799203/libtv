package middleware

import (
	"context"
	"net/http"
	"strings"

	"libtv/internal/config"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

// UserTokenChecker 校验 token 对应用户的当前状态是否仍有效（如密码版本号是否匹配）
// 由 service 层实现，中间件仅依赖接口，避免反向依赖
type UserTokenChecker interface {
	CheckTokenValid(ctx context.Context, userID string, claims jwt.MapClaims) bool
}

// UserActivityTracker 记录"最后操作时间"。放在接口里而不是直接依赖 service，
// 保持中间件只依赖抽象（同 UserTokenChecker 的理由）。
type UserActivityTracker interface {
	TouchActivity(userID string)
}

func Auth(checker UserTokenChecker, tracker UserActivityTracker) gin.HandlerFunc {
	return func(c *gin.Context) {
		authHeader := c.GetHeader("Authorization")
		if authHeader == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"code": 401, "msg": "missing authorization header"})
			c.Abort()
			return
		}

		tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
		if tokenStr == authHeader {
			c.JSON(http.StatusUnauthorized, gin.H{"code": 401, "msg": "invalid token format"})
			c.Abort()
			return
		}

		token, err := jwt.Parse(tokenStr, func(token *jwt.Token) (interface{}, error) {
			return []byte(config.C.JWT.Secret), nil
		})
		if err != nil || !token.Valid {
			c.JSON(http.StatusUnauthorized, gin.H{"code": 401, "msg": "invalid token"})
			c.Abort()
			return
		}

		claims, ok := token.Claims.(jwt.MapClaims)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"code": 401, "msg": "invalid claims"})
			c.Abort()
			return
		}

		userID, ok := claims["user_id"].(string)
		if !ok {
			c.JSON(http.StatusUnauthorized, gin.H{"code": 401, "msg": "invalid user_id in token"})
			c.Abort()
			return
		}

		// 校验用户当前状态（改密码后旧 token 的版本号不匹配，在此被拒绝）
		if checker != nil && !checker.CheckTokenValid(c.Request.Context(), userID, claims) {
			c.JSON(http.StatusUnauthorized, gin.H{"code": 401, "msg": "登录已失效，请重新登录"})
			c.Abort()
			return
		}

		c.Set("user_id", userID)

		// 打"最后操作"点（内部节流 + 异步，不影响本次请求耗时）
		if tracker != nil {
			tracker.TouchActivity(userID)
		}
		c.Set("email", claims["email"])
		c.Next()
	}
}

func GetUserID(c *gin.Context) string {
	id, _ := c.Get("user_id")
	if id == nil {
		return ""
	}
	return id.(string)
}
