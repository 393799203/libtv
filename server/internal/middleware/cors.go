package middleware

import (
	"time"

	"libtv/internal/config"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
)

// defaultOrigins 本地开发默认白名单
var defaultOrigins = []string{
	"http://localhost:5173",
	"http://localhost:3000",
	"http://192.168.110.115:8880",
	"http://39.171.58.10:38880",
	"http://yunqueai.cloud:38880",
}

// CORS 根据 config.C.CORS.Origins 构造跨域中间件
//   优先使用配置文件/环境变量；为空则回退到 defaultOrigins
func CORS() gin.HandlerFunc {
	origins := config.C.CORS.Origins
	if len(origins) == 0 {
		origins = defaultOrigins
	}
	return cors.New(cors.Config{
		AllowOrigins:     origins,
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	})
}
