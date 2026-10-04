package handler

import (
	"libtv/internal/engine"
	"libtv/internal/pkg/response"
	"libtv/internal/service"

	"github.com/gin-gonic/gin"
)

// EnhanceHandler 清晰化相关接口
type EnhanceHandler struct{}

func NewEnhanceHandler() *EnhanceHandler { return &EnhanceHandler{} }

// ListChannels 列出清晰化渠道**及其档位**。
//
// 由后端的「配置 × 实现」注册表驱动（engine.ListEnhanceChannels）：
// 运营改 enhance.yaml（加渠道、改档位、改名、下架）后重启后端即生效，
// 前端不需要跟着发版，也不会出现「前端有选项、后端不认识」或反过来的漂移。
//
// 顺带把本机档的运维旋钮也带出去（并发上限/时长上限）：前端据此把边界说清楚
// （例如"这条片子超过 120s 会被拒绝"），而不是等用户点了才报错。
func (h *EnhanceHandler) ListChannels(c *gin.Context) {
	channels := engine.ListEnhanceChannels()
	out := make([]*engine.EnhanceChannel, 0, len(channels))
	for _, ch := range channels {
		out = append(out, ch)
	}

	concurrency, maxDuration, timeout, crf, preset := service.CurrentLiteEnhanceLimits()

	response.OK(c, gin.H{
		"channels":       out,
		"defaultChannel": engine.DefaultEnhanceChannel,
		"limits": gin.H{
			"max_concurrency":      concurrency,
			"max_duration_seconds": maxDuration,
			"timeout_seconds":      timeout,
			"crf":                  crf,
			"preset":               preset,
		},
	})
}
