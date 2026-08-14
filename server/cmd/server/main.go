package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"libtv/internal/config"
	"libtv/internal/engine"
	"libtv/internal/handler"
	"libtv/internal/llm"
	"libtv/internal/middleware"
	"libtv/internal/model"
	"libtv/internal/repository"
	"libtv/internal/service"
	"libtv/internal/storage"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// getPublicDir 根据环境返回 public 目录路径
// Docker 环境：使用绝对路径 /app/public
// 本地开发：使用相对路径 ../public
func getPublicDir(subdir string) string {
	if os.Getenv("RUN_MODE") == "docker" {
		return filepath.Join("/app/public", subdir)
	}
	return filepath.Join("..", "public", subdir)
}

// initStorage 通过 storage.Create 工厂创建存储实例；
// 各存储类型（minio/local/fallback）在 storage 包内 init() 自注册
func initStorage() storage.Storage {
	s, err := storage.Create(config.C.Storage, getPublicDir(""))
	if err != nil {
		log.Fatalf("存储初始化失败: %v", err)
	}
	return s
}

func main() {
	// 加载配置
	if err := config.Load("configs/config.yaml"); err != nil {
		log.Fatalf("load config: %v", err)
	}

	// 加载模型配置
	modelManager, err := llm.NewModelManager("configs/models.yaml")
	if err != nil {
		log.Fatalf("load models config: %v", err)
	}

	// 连接数据库
	db, err := gorm.Open(postgres.Open(config.C.Database.DSN()), &gorm.Config{})
	if err != nil {
		log.Fatalf("connect database: %v", err)
	}

	// 自动迁移
	if err := db.AutoMigrate(&model.User{}, &model.Project{}, &model.Canvas{}, &model.WorkflowExecution{}, &model.AITask{}, &model.Style{}, &model.StyleFavorite{}, &model.Category{}, &model.ShowCategory{}, &model.Show{}, &model.ShowLike{}, &model.Banner{}, &model.UserAsset{}); err != nil {
		log.Fatalf("migrate: %v", err)
	}

	// 初始化 Repository
	userRepo := repository.NewUserRepo(db)
	projectRepo := repository.NewProjectRepo(db)
	canvasRepo := repository.NewCanvasRepo(db)
	execRepo := repository.NewExecutionRepo(db)
	aiTaskRepo := repository.NewAITaskRepo(db)
	showRepo := repository.NewShowRepo(db)
	bannerRepo := repository.NewBannerRepo(db)
	styleRepo := repository.NewStyleRepo(db)
	categoryRepo := repository.NewCategoryRepo(db)
	styleFavoriteRepo := repository.NewStyleFavoriteRepo(db)
	userAssetRepo := repository.NewUserAssetRepo(db)

	// 初始化存储（提前到 service 之前，便于 service 注入 storage）
	appStorage := initStorage()

	// 初始化 Service
	userService := service.NewUserService(userRepo, appStorage)
	projectService := service.NewProjectService(projectRepo, canvasRepo, execRepo, aiTaskRepo, appStorage)
	canvasService := service.NewCanvasService(canvasRepo)
	showService := service.NewShowService(showRepo, userRepo, appStorage)
	bannerService := service.NewBannerService(bannerRepo, appStorage)
	userAssetService := service.NewUserAssetService(userAssetRepo, appStorage)

	// 初始化 LLM 客户端
	llmClient := llm.NewScriptClient(config.C.AI)

	// 初始化图像生成客户端（华数TokenHub）
	imageClient := llm.NewImageClient(config.C.AI, "wasu")

	// 初始化视频生成客户端（华数TokenHub doubao-seedance）
	videoClient := llm.NewVideoClient(config.C.AI, "wasu")

	// 初始化音频生成客户端（TTS）
	audioClient := llm.NewAudioClient(config.C.AI, "wasu")

	// 文件上传服务（Template Method：哈希去重 + StatObject + PutObject）
	fileUploadService := service.NewFileUploadService(appStorage)

	// 初始化工作流引擎
	registry := engine.NewDefaultRegistry(llmClient, imageClient, videoClient, audioClient, modelManager, fileUploadService)
	eng := engine.NewWorkflowEngine(registry)

	// 视频转码服务（独立模块，承载 ffmpeg 调用 + 任务状态注册表）
	transcodeService := service.NewTranscodeService(appStorage)

	// 风格相关 Service
	styleService := service.NewStyleService(styleRepo, appStorage)
	categoryService := service.NewCategoryService(categoryRepo)
	styleFavoriteService := service.NewStyleFavoriteService(styleFavoriteRepo, styleRepo)

	// 初始化 Handler
	userHandler := handler.NewUserHandler(userService)
	projectHandler := handler.NewProjectHandler(projectService)
	canvasHandler := handler.NewCanvasHandler(canvasService)
	workflowHandler := handler.NewWorkflowHandler(execRepo, aiTaskRepo, canvasRepo, eng, registry)
	uploadHandler := handler.NewUploadHandler(appStorage, fileUploadService, transcodeService)
	styleHandler := handler.NewStyleHandler(styleService, categoryService, styleFavoriteService, fileUploadService)
	showHandler := handler.NewShowHandler(showService, fileUploadService, projectRepo)
	bannerHandler := handler.NewBannerHandler(bannerService, fileUploadService)
	modelHandler := handler.NewModelHandler(modelManager)
	promptHandler := handler.NewPromptHandler(llmClient, modelManager)
	userAssetHandler := handler.NewUserAssetHandler(userAssetService)

	// 初始化 Gin
	if config.C.Server.Mode == "release" {
		gin.SetMode(gin.ReleaseMode)
	}
	r := gin.Default()

	// 设置 multipart form 内存限制（用于大文件上传）
	r.MaxMultipartMemory = 100 << 20 // 100MB

	// 中间件
	r.Use(middleware.CORS())

	// 代理路由：统一访问MinIO和本地存储
	r.GET("/media/*filepath", uploadHandler.GetFile)
	r.DELETE("/media/*filepath", uploadHandler.DeleteFile)

	// 保留旧的静态文件路由（兼容）
	r.Static("/uploads", config.C.Storage.Local.BasePath)

	// 公开路由
	auth := r.Group("/api/auth")
	{
		auth.POST("/register", userHandler.Register)
		auth.POST("/login", userHandler.Login)
	}

	// 公开首页展示接口（无需登录）
	publicShows := r.Group("/api/shows")
	{
		publicShows.GET("/categories", showHandler.ListCategories)
		publicShows.GET("", showHandler.ListShows)
		publicShows.GET("/:id", showHandler.GetShow)
	}

	// 公开Banner接口（无需登录）
	publicBanners := r.Group("/api/banners")
	{
		publicBanners.GET("", bannerHandler.ListBanners)
		publicBanners.GET("/:id", bannerHandler.GetBanner)
	}

	// 公开模型配置接口（无需登录）
	r.GET("/api/models", modelHandler.ListModels)

	// 公开上传接口
	publicUpload := r.Group("/api/upload")
	{
		publicUpload.POST("/image", uploadHandler.UploadImage)
		publicUpload.POST("/video", uploadHandler.UploadVideo)
		publicUpload.POST("/audio", uploadHandler.UploadAudio)
		publicUpload.GET("/video/status/:taskId", uploadHandler.GetVideoStatus)
	}

	// 公开存储状态监控
	r.GET("/api/storage/status", uploadHandler.GetStorageStatus)

	// 需要认证的路由（Auth 传入 userService 校验密码版本号，改密码后旧 token 失效）
	api := r.Group("/api")
	api.Use(middleware.Auth(userService))
	{
		// 删除项目 canvas 文件夹（需认证）
		api.DELETE("/upload/canvas/:projectId", uploadHandler.DeleteCanvasDir)
		// 存储同步（管理员专用）
		api.POST("/storage/sync", uploadHandler.SyncStorage)           // 同步本地存储到MinIO
		api.POST("/storage/sync-volume", uploadHandler.SyncFromVolume) // 从Docker volume同步

		// 用户
		api.GET("/auth/me", userHandler.Me)
		api.PUT("/auth/profile", userHandler.UpdateProfile)    // 更新当前用户个人资料（昵称/头像）
		api.PUT("/auth/password", userHandler.ChangePassword)  // 修改当前用户密码
		api.POST("/upload/avatar", uploadHandler.UploadAvatar) // 上传头像（存 users/<userID>/avatar/）
		api.GET("/users", userHandler.List)                    // 管理员：获取所有用户
		api.PUT("/users/:id/role", userHandler.UpdateRole)     // 管理员：更新用户角色
		api.DELETE("/users/:id", userHandler.Delete)           // 管理员：删除用户

		// 项目 + 画布
		projects := api.Group("/projects")
		{
			projects.POST("", projectHandler.Create)
			projects.GET("", projectHandler.List)
			projects.GET("/:id", projectHandler.Get)
			projects.PUT("/:id", projectHandler.Update)
			projects.DELETE("/:id", projectHandler.Delete)
			projects.GET("/:id/canvas", canvasHandler.Get)
			projects.PUT("/:id/canvas", canvasHandler.Save)
			// 工作流（路径对齐前端 api/services/workflowApi.ts）
			projects.POST("/:id/workflows/execute", workflowHandler.Execute)
			projects.GET("/:id/workflows/:execId", workflowHandler.GetExecution)
			// SSE 流式订阅工作流执行进度（必须单独注册在 r 上，不能走 Auth 中间件：
			//   原生 EventSource 不支持自定义 header，token 只能放 query ，
			//   所以鉴权由 StreamExecution 内部处理，见 workflow_handler.go）
		}

		// SSE 工作流流（独立鉴权：query 传 token）
		r.GET("/api/projects/:id/workflows/:execId/stream", workflowHandler.StreamExecution)

		// 工作流（兼容旧路由 /api/workflow/*）
		workflow := api.Group("/workflow")
		{
			workflow.POST("/execute", workflowHandler.Execute)
			workflow.GET("/executions/:id", workflowHandler.GetExecution)
		}

		// 分类管理（需登录）
		categories := api.Group("/styles/categories")
		{
			categories.GET("", styleHandler.Categories)
			categories.POST("", styleHandler.CreateCategory)
			categories.PUT("/:id", styleHandler.UpdateCategory)
			categories.DELETE("/:id", styleHandler.DeleteCategory)
		}

		// 风格管理（需登录）
		styles := api.Group("/styles")
		{
			styles.GET("", styleHandler.List)
			styles.POST("", styleHandler.Create)
			styles.POST("/:id/image", styleHandler.UploadImage)
			styles.PUT("/:id", styleHandler.Update)
			styles.DELETE("/:id", styleHandler.Delete)
			styles.POST("/:id/favorite", styleHandler.ToggleFavorite)
			styles.GET("/favorites", styleHandler.ListFavorites)
			styles.POST("/favorites/check", styleHandler.CheckFavorited)
		}

		// 首页展示分类管理（需登录）
		showCategories := api.Group("/shows/categories")
		{
			showCategories.POST("", showHandler.CreateCategory)
			showCategories.PUT("/:id", showHandler.UpdateCategory)
			showCategories.DELETE("/:id", showHandler.DeleteCategory)
		}

		// 首页展示视频管理（需登录）
		shows := api.Group("/shows")
		{
			shows.POST("", showHandler.CreateShow)
			shows.POST("/:id/thumbnail", showHandler.UploadThumbnail)
			shows.POST("/:id/video", showHandler.UploadVideo)
			shows.PUT("/:id", showHandler.UpdateShow)
			shows.PUT("/:id/approve", showHandler.ApproveShow)
			shows.PUT("/:id/reject", showHandler.RejectShow)
			shows.DELETE("/:id", showHandler.DeleteShow)
			shows.GET("/pending", showHandler.ListPendingShows)
			shows.GET("/by-project/:projectId", showHandler.GetShowByProjectID)
			// 点赞相关
			shows.POST("/:id/like", showHandler.LikeShow)
			shows.DELETE("/:id/like", showHandler.UnlikeShow)
			shows.GET("/:id/liked", showHandler.CheckShowLiked)
		}

		// Banner资源位管理（需登录）
		banners := api.Group("/banners")
		{
			banners.POST("", bannerHandler.CreateBanner)
			banners.POST("/images", bannerHandler.UploadImage) // 上传Banner图片
			banners.PUT("/:id", bannerHandler.UpdateBanner)
			banners.DELETE("/:id", bannerHandler.DeleteBanner)
		}

		// 提示词生成（需登录）
		prompt := api.Group("/prompt")
		{
			prompt.POST("/generate", promptHandler.GeneratePrompt) // 生成提示词（画面 + 运动）
		}

		// 用户个人资产库（需登录）
		userAssets := api.Group("/user-assets")
		{
			userAssets.GET("", userAssetHandler.List)          // 列出当前用户资产（?type=image|video）
			userAssets.POST("", userAssetHandler.Create)       // 保存资产（图片/视频 URL 引用）
			userAssets.DELETE("/:id", userAssetHandler.Delete) // 删除资产（仅限本人）
		}
	}

	// 启动服务
	addr := fmt.Sprintf(":%d", config.C.Server.Port)
	log.Printf("LibTV server starting on %s", addr)

	// 自定义 HTTP Server：SSE 长连接需要禁用读写超时
	srv := &http.Server{
		Addr:           addr,
		Handler:        r,
		ReadTimeout:    0, // 不设读超时（SSE 长连接）
		WriteTimeout:   0, // 不设写超时（SSE 长连接）
		IdleTimeout:    0, // 不设空闲超时
		MaxHeaderBytes: 1 << 20,
	}
	if err := srv.ListenAndServe(); err != nil {
		log.Fatalf("start server: %v", err)
	}
}
