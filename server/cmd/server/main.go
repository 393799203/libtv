package main

import (
	"fmt"
	"log"
	"path/filepath"

	"libtv/internal/config"
	"libtv/internal/engine"
	"libtv/internal/handler"
	"libtv/internal/middleware"
	"libtv/internal/model"
	"libtv/internal/repository"
	"libtv/internal/service"

	"github.com/gin-gonic/gin"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func main() {
	// 加载配置
	if err := config.Load("configs/config.yaml"); err != nil {
		log.Fatalf("load config: %v", err)
	}

	// 连接数据库
	db, err := gorm.Open(postgres.Open(config.C.Database.DSN()), &gorm.Config{})
	if err != nil {
		log.Fatalf("connect database: %v", err)
	}

	// 自动迁移
if err := db.AutoMigrate(&model.User{}, &model.Project{}, &model.Canvas{}, &model.WorkflowExecution{}, &model.AITask{}, &model.Style{}, &model.StyleFavorite{}, &model.Category{}, &model.ShowCategory{}, &model.Show{}); err != nil {
		log.Fatalf("migrate: %v", err)
	}

	// 初始化 Repository
	userRepo := repository.NewUserRepo(db)
	projectRepo := repository.NewProjectRepo(db)
	canvasRepo := repository.NewCanvasRepo(db)
	execRepo := repository.NewExecutionRepo(db)
	aiTaskRepo := repository.NewAITaskRepo(db)
	showRepo := repository.NewShowRepo(db)

	// 初始化 Service
	userService := service.NewUserService(userRepo)
	projectService := service.NewProjectService(projectRepo, canvasRepo)
	canvasService := service.NewCanvasService(canvasRepo)
	showService := service.NewShowService(showRepo)

	// 初始化工作流引擎
	registry := engine.NewDefaultRegistry()
	eng := engine.NewWorkflowEngine(registry)

	// 启动事件消费（防止 channel 满阻塞）
	go func() {
		for range eng.Events() {
			// events are consumed in the WebSocket handler
		}
	}()

	// 初始化 Handler
	userHandler := handler.NewUserHandler(userService, db)
	projectHandler := handler.NewProjectHandler(projectService)
	canvasHandler := handler.NewCanvasHandler(canvasService)
	workflowHandler := handler.NewWorkflowHandler(execRepo, aiTaskRepo, eng, registry)
	uploadHandler := handler.NewUploadHandler(filepath.Join("..", "public", "canvas"), filepath.Join("..", "public", "videos"))
	styleHandler := handler.NewStyleHandler(db, filepath.Join("..", "public", "styles"))
	showHandler := handler.NewShowHandler(showService, filepath.Join("..", "public", "shows"), db)

	// 初始化 Gin
	if config.C.Server.Mode == "release" {
		gin.SetMode(gin.ReleaseMode)
	}
	r := gin.Default()

	// 设置 multipart form 内存限制（用于大文件上传）
	r.MaxMultipartMemory = 100 << 20 // 100MB

	// 中间件
	r.Use(middleware.CORS())

	// 静态文件（统一 /media 前缀）
	r.Static("/uploads", config.C.Storage.LocalPath)
	canvasDir := filepath.Join("..", "public", "canvas")
	r.Static("/media/canvas", canvasDir)
	videosDir := filepath.Join("..", "public", "videos")
	r.Static("/media/videos", videosDir)
	stylesDir := filepath.Join("..", "public", "styles")
	r.Static("/media/styles", stylesDir)
	showsDir := filepath.Join("..", "public", "shows")
	r.Static("/media/shows", showsDir)

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

	// 图片上传（公开）
	r.POST("/api/upload/image", uploadHandler.UploadImage)
	// 视频上传（公开，独立接口）
	r.POST("/api/upload/video", uploadHandler.UploadVideo)
	// 视频转码状态查询（公开）
	r.GET("/api/upload/video/status/:taskId", uploadHandler.GetVideoStatus)
	// 删除项目 canvas 文件夹（需认证）
	r.DELETE("/api/upload/canvas/:projectId", middleware.Auth(), uploadHandler.DeleteCanvasDir)

	// 需要认证的路由
	api := r.Group("/api")
	api.Use(middleware.Auth())
	{
		// 用户
		api.GET("/auth/me", userHandler.Me)
		api.GET("/users", userHandler.List) // 管理员：获取所有用户
		api.PUT("/users/:id/role", userHandler.UpdateRole) // 管理员：更新用户角色
		api.DELETE("/users/:id", userHandler.Delete) // 管理员：删除用户

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
		}

		// 工作流
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
			shows.DELETE("/:id", showHandler.DeleteShow)
		}

		// WebSocket
		api.GET("/ws/execution/:id", workflowHandler.WebSocket)
	}

	// 启动服务
	addr := fmt.Sprintf(":%d", config.C.Server.Port)
	log.Printf("LibTV server starting on %s", addr)
	if err := r.Run(addr); err != nil {
		log.Fatalf("start server: %v", err)
	}
}
