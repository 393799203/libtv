package middleware

import (
	"context"
	"net/http"

	"libtv/internal/pkg/apperror"

	"github.com/gin-gonic/gin"
)

// CreditBiller AI 入口的积分余额校验器
// 由 service 层实现（BillingService.EnsureBalance），中间件仅依赖接口，避免反向依赖
type CreditBiller interface {
	EnsureBalance(ctx context.Context, userID, action string) error
}

// Billing 积分扣费中间件：必须挂载在 Auth 之后（依赖 Auth 写入的 user_id）。
// 只做入口余额校验（不扣费不记账）：余额不足直接拒绝（HTTP 402，code=4002）。
// 真实扣费 + 账单记录在 AI 调用点完成（engine 各执行器 / prompt handler 调 BillingService.Charge），
// 这样才能把调用的模型与场景写进账单明细。
func Billing(biller CreditBiller, action string) gin.HandlerFunc {
	return func(c *gin.Context) {
		userID := GetUserID(c)
		if userID == "" {
			c.JSON(http.StatusUnauthorized, gin.H{"code": 401, "msg": "未登录"})
			c.Abort()
			return
		}

		if err := biller.EnsureBalance(c.Request.Context(), userID, action); err != nil {
			c.JSON(apperror.HTTPStatusFromError(err), gin.H{
				"code": apperror.CodeFromError(err),
				"msg":  apperror.MsgFromError(err),
			})
			c.Abort()
			return
		}

		c.Set("billing_action", action)
		c.Next()
	}
}
