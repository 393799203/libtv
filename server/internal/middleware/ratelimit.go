package middleware

import (
	"fmt"
	"log"
	"net/http"

	"libtv/internal/cache"
	"libtv/internal/config"

	"github.com/gin-gonic/gin"
)

// RateLimit 生成接口限流：限制**单用户**每分钟可发起的生成次数。
// 必须挂在 Auth 之后（依赖 Auth 写入的 user_id）。
//
// 降级原则：限流是增强能力 —— 关闭开关、Redis 不可用、脚本报错时一律放行，
// 避免限流组件本身成为生成主流程的故障点。
func RateLimit(cfg config.RateLimitConfig) gin.HandlerFunc {
	return RateLimitScoped(cfg, "gen", "生成")
}

// RateLimitScoped 与 RateLimit 行为一致，但用独立的限流键（scope）与提示名词（noun）。
//
// 为什么必须能分开计数：AllowRate 的键里只有 userID，全站共用同一份额度。
// 助手是「对话」而不是「生成」，两者频率特征完全不同 —— 若共用 gen 的 10 次/分钟，
// 用户连着问 10 句话之后，本分钟就再也发不出任何生成任务了，这是个很难查的 bug。
func RateLimitScoped(cfg config.RateLimitConfig, scope, noun string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !cfg.Enabled || cfg.PerMinute <= 0 || !cache.Available() {
			c.Next()
			return
		}
		userID := GetUserID(c)
		if userID == "" {
			c.Next()
			return
		}

		allowed, used, err := cache.AllowRateScoped(c.Request.Context(), scope, userID, cfg.PerMinute)
		if err != nil {
			log.Printf("[RateLimit] 检查失败，放行: %v", err)
			c.Next()
			return
		}
		if !allowed {
			log.Printf("[RateLimit] 用户 %s 触发限流（scope=%s，本分钟第 %d 次，上限 %d）", userID, scope, used, cfg.PerMinute)
			c.Header("Retry-After", "60")
			c.JSON(http.StatusTooManyRequests, gin.H{
				"code": 4029,
				"msg":  fmt.Sprintf("操作过于频繁（每分钟最多 %d 次%s），请稍后再试", cfg.PerMinute, noun),
				"data": gin.H{"limit": cfg.PerMinute, "used": used, "retry_after": 60},
			})
			c.Abort()
			return
		}
		c.Next()
	}
}
