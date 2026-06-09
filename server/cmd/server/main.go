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
	if err := db.AutoMigrate(&model.User{}, &model.Project{}, &model.Canvas{}, &model.WorkflowExecution{}, &model.AITask{}, &model.Video{}); err != nil {
		log.Fatalf("migrate: %v", err)
	}

	// 初始化 Repository
	userRepo := repository.NewUserRepo(db)
	projectRepo := repository.NewProjectRepo(db)
	canvasRepo := repository.NewCanvasRepo(db)
	execRepo := repository.NewExecutionRepo(db)
	aiTaskRepo := repository.NewAITaskRepo(db)
	videoRepo := repository.NewVideoRepo(db)

	// 初始化 Service
	userService := service.NewUserService(userRepo)
	projectService := service.NewProjectService(projectRepo, canvasRepo)
	canvasService := service.NewCanvasService(canvasRepo)
	videoService := service.NewVideoService(videoRepo)

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
	userHandler := handler.NewUserHandler(userService)
	projectHandler := handler.NewProjectHandler(projectService)
	canvasHandler := handler.NewCanvasHandler(canvasService)
	workflowHandler := handler.NewWorkflowHandler(execRepo, aiTaskRepo, eng, registry)
	videoHandler := handler.NewVideoHandler(videoService)
	uploadHandler := handler.NewUploadHandler(filepath.Join("..", "public", "pic"))

	// 初始化 Gin
	if config.C.Server.Mode == "release" {
		gin.SetMode(gin.ReleaseMode)
	}
	r := gin.Default()

	// 中间件
	r.Use(middleware.CORS())

	// 静态文件
	r.Static("/uploads", config.C.Storage.LocalPath)
	picDir := filepath.Join("..", "public", "pic")
	r.Static("/pic", picDir)
	videosDir := filepath.Join("..", "public", "videos")
	r.Static("/media/videos", videosDir)

	// 公开路由
	auth := r.Group("/api/auth")
	{
		auth.POST("/register", userHandler.Register)
		auth.POST("/login", userHandler.Login)
	}

	// 公开视频接口（无需登录）
	publicVideos := r.Group("/api/videos")
	{
		publicVideos.GET("", videoHandler.List)
		publicVideos.GET("/:id", videoHandler.Get)
	}

	// 图片上传（公开）
	r.POST("/api/upload/image", uploadHandler.UploadImage)

	// 需要认证的路由
	api := r.Group("/api")
	api.Use(middleware.Auth())
	{
		// 用户
		api.GET("/auth/me", userHandler.Me)

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

		// 视频写操作（需登录）
		videos := api.Group("/videos")
		{
			videos.POST("", videoHandler.Create)
			videos.PUT("/:id", videoHandler.Update)
			videos.DELETE("/:id", videoHandler.Delete)
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
