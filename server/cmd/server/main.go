package main

import (
	"context"
	"fmt"
	"libtv/internal/audit"
	"libtv/internal/billing"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"libtv/internal/cache"
	"libtv/internal/config"
	"libtv/internal/engine"
	"libtv/internal/handler"
	"libtv/internal/idem"
	"libtv/internal/llm"
	"libtv/internal/middleware"
	"libtv/internal/model"
	"libtv/internal/queue"
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

	// 价格唯一维度新增「是否带参考视频输入」（has_reference_video）后，唯一索引由 4 列扩为 5 列。
	// GORM AutoMigrate 不会改动同名已存在索引的列，若直接迁移，旧 4 列唯一约束会挡住
	// 同一（渠道+节点+模型+分辨率）下「带参考视频」那一档单价，导致价格保存失败。
	// 这里只在该索引定义里还没有新列时删掉它，让下面的 AutoMigrate 按新定义重建
	// （判断索引列而非索引是否存在，避免每次启动都重建索引）
	var priceIndexDef string
	if err := db.Raw("SELECT indexdef FROM pg_indexes WHERE indexname = ?", "idx_price_channel_node_model_res").
		Scan(&priceIndexDef).Error; err == nil && priceIndexDef != "" && !strings.Contains(priceIndexDef, "has_reference_video") {
		log.Printf("检测到旧的模型价格唯一索引（缺 has_reference_video 列），删除后按新维度重建")
		if err := db.Migrator().DropIndex(&model.ModelPrice{}, "idx_price_channel_node_model_res"); err != nil {
			log.Printf("warning: drop old index idx_price_channel_node_model_res failed: %v", err)
		}
	}

	// 自动迁移
	if err := db.AutoMigrate(&model.User{}, &model.Project{}, &model.Canvas{}, &model.WorkflowExecution{}, &model.AITask{}, &model.Style{}, &model.StyleFavorite{}, &model.Category{}, &model.ShowCategory{}, &model.Show{}, &model.ShowLike{}, &model.ShowComment{}, &model.Banner{}, &model.UserAsset{}, &model.BillingRecord{}, &model.ModelPrice{}, &model.GenerationHistory{}, &model.PointsPackage{}, &model.PaymentOrder{}, &model.Setting{}, &model.ForumPost{}, &model.ForumReply{}, &model.ProviderTask{}); err != nil {
		log.Fatalf("migrate: %v", err)
	}

	// 清理旧索引（model_prices 表原唯一索引已被 idx_price_node_model_res 替代）
	if db.Migrator().HasIndex(&model.ModelPrice{}, "idx_price_node_model") {
		if err := db.Migrator().DropIndex(&model.ModelPrice{}, "idx_price_node_model"); err != nil {
			log.Printf("warning: drop old index idx_price_node_model failed: %v", err)
		}
	}

	// ========== 对账表：身份从「任务号」改为「charge_key」 ==========
	//
	// 背景：扣费发生在「调上游创建任务」之前，那一刻还没有上游任务号 —— 于是扣费账单
	// 永远带不上任务号，扣费侧金额过去无法核对。现在给每次扣费生成一把唯一编号
	// （charge_key），账单分录与对账行共用它，且**不可变**（以前行的身份是 task_id，
	// 拿到任务号后会被改写：同一节点在同一次执行里被扣两次费时会挤进同一行、金额互相覆盖）。
	//
	// 两处索引必须改成「仅非空唯一」的部分索引：
	//   1. task_id：扣费后、任务号到手前，多行可以同时没有任务号（空串）；
	//      旧的 not null + 全量唯一约束会让第二行直接写不进去；
	//   2. charge_key：历史行留空，同样只能对非空值唯一（否则历史行之间互相冲突）。
	// AutoMigrate 只会新增索引、不会把已有同名唯一索引改成部分索引，所以在这里手工处理。
	if db.Migrator().HasIndex(&model.ProviderTask{}, "idx_provider_tasks_task_id") {
		var indexDef string
		if err := db.Raw("SELECT indexdef FROM pg_indexes WHERE indexname = ?", "idx_provider_tasks_task_id").
			Scan(&indexDef).Error; err == nil && strings.Contains(indexDef, "UNIQUE") {
			log.Printf("对账表：把 task_id 的全量唯一索引换成「仅非空唯一」的部分索引（为 charge_key 身份让路）")
			if err := db.Migrator().DropIndex(&model.ProviderTask{}, "idx_provider_tasks_task_id"); err != nil {
				log.Printf("warning: drop old unique index idx_provider_tasks_task_id failed: %v", err)
			}
		}
	}
	for _, stmt := range []string{
		// 任务号只对非空值唯一（同一个任务号仍然不许出现两行）
		`CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_tasks_task_id_alive ON provider_tasks (task_id) WHERE task_id <> ''`,
		// 扣费编号只对非空值唯一：一次扣费只能有一行对账（重复登记从此在数据库层面被挡住）
		`CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_tasks_charge_key_alive ON provider_tasks (charge_key) WHERE charge_key <> ''`,
		// 两个键都要能当查询条件（对账行 ↔ 账单流水的精确认领）
		`CREATE INDEX IF NOT EXISTS idx_provider_tasks_task_id ON provider_tasks (task_id)`,
		`CREATE INDEX IF NOT EXISTS idx_billing_records_charge_key ON billing_records (charge_key)`,
		// 列宽 64 → 128：GORM AutoMigrate 不会替我们放大 varchar（实测：模型改成 size:128 后
		// 线上列宽仍是 64），而编号长度由调用方决定 —— 曾经因为 72 字符的编号写不进 64 的列，
		// 出现「钱扣了、账单和对账行都没写进去」。这里显式放大，纯为防再犯。
		`ALTER TABLE provider_tasks ALTER COLUMN charge_key TYPE varchar(128)`,
		`ALTER TABLE billing_records ALTER COLUMN charge_key TYPE varchar(128)`,
		// 备注放大：上游拒绝的原始报错很长，255 会切掉真正有用的后半句
		`ALTER TABLE provider_tasks ALTER COLUMN note TYPE varchar(1200)`,
		`ALTER TABLE billing_records ALTER COLUMN remark TYPE varchar(1000)`,
	} {
		if err := db.Exec(stmt).Error; err != nil {
			log.Printf("warning: migrate index failed (%s): %v", stmt, err)
		}
	}

	// 初始化 Repository
	userRepo := repository.NewUserRepo(db)
	projectRepo := repository.NewProjectRepo(db)
	canvasRepo := repository.NewCanvasRepo(db)
	execRepo := repository.NewExecutionRepo(db)
	aiTaskRepo := repository.NewAITaskRepo(db)
	showRepo := repository.NewShowRepo(db)
	commentRepo := repository.NewCommentRepo(db)
	bannerRepo := repository.NewBannerRepo(db)
	styleRepo := repository.NewStyleRepo(db)
	categoryRepo := repository.NewCategoryRepo(db)
	styleFavoriteRepo := repository.NewStyleFavoriteRepo(db)
	userAssetRepo := repository.NewUserAssetRepo(db)
	billingRepo := repository.NewBillingRepo(db)
	modelPriceRepo := repository.NewModelPriceRepo(db)
	generationHistoryRepo := repository.NewGenerationHistoryRepo(db)
	providerTaskRepo := repository.NewProviderTaskRepo(db)
	pointsPackageRepo := repository.NewPointsPackageRepo(db)
	forumRepo := repository.NewForumRepo(db)

	// 初始化存储（提前到 service 之前，便于 service 注入 storage）
	appStorage := initStorage()

	// 初始化 Service
	userService := service.NewUserService(userRepo, appStorage)
	projectService := service.NewProjectService(projectRepo, canvasRepo, execRepo, aiTaskRepo, appStorage)
	canvasService := service.NewCanvasService(canvasRepo)
	showService := service.NewShowService(showRepo, userRepo, commentRepo, appStorage)
	commentService := service.NewCommentService(commentRepo, showRepo, userRepo)
	forumService := service.NewForumService(forumRepo, userRepo, appStorage)
	bannerService := service.NewBannerService(bannerRepo, appStorage)
	userAssetService := service.NewUserAssetService(userAssetRepo, appStorage)
	// 模型价格配置服务（运营后台价格管理；模型清单来自 models.yaml，价格存 model_prices 表）
	pricingService := billing.NewPricingService(modelManager, modelPriceRepo)
	// 积分扣费服务（AI 调用前置校验；真实单价来自 model_prices 表，运营后台价格管理维护）
	billingService := billing.NewService(userRepo, billingRepo, modelPriceRepo, modelManager)
	// 积分套餐服务（积分超市卡片，运营后台「套餐管理」维护）
	pointsPackageService := service.NewPointsPackageService(pointsPackageRepo)
	// 首次启动时写入默认套餐
	if err := pointsPackageService.SeedDefaults(context.Background()); err != nil {
		log.Printf("warning: seed default points packages failed: %v", err)
	}
	// 补齐「带参考视频」档默认价 = 无参考视频单价 6 折：
	// 价格管理页打开时这一档就是配好的价，运营直接改；已有配置不覆盖
	if err := pricingService.SeedRefVideoPrices(context.Background()); err != nil {
		log.Printf("warning: seed ref video prices failed: %v", err)
	}

	// 支付宝支付服务（积分超市充值；configs/config.yaml payment.alipay 未配置时支付功能关闭）
	paymentService, err := service.NewPaymentService(db, billingService, config.C.Payment.Alipay)
	if err != nil {
		log.Fatalf("init payment service: %v", err)
	}

	// 初始化 LLM 客户端（多渠道 token 路由：wasu=华数 / dianxin=电信，后台三档切换）
	settingRepo := repository.NewSettingRepo(db)

	// 微信支付（APIv3）配置与业务服务：与支付宝平级并存
	// 配置来源**只有服务器一处**：config.yaml 的 payment.wxpay 段 + WXPAY_* 环境变量
	// （含 WXPAY_PRIVATE_KEY_FILE / WXPAY_PLATFORM_CERT_FILE 读 PEM），不读 settings 表、后台无配置页；
	// 未配置时（默认）走优雅降级：下单返回「微信支付暂未开通」，前台置灰，绝不影响支付宝
	wechatPayConfigService := service.NewWechatPayConfigService(
		config.C.Payment.Wxpay, config.C.Payment.Alipay.Enabled, os.Getenv("FRONTEND_BASE"))
	wechatPayService := service.NewWechatPayService(db, billingService, wechatPayConfigService)
	channelRouter := llm.NewChannelRouter(nil, config.C.AI.Providers)
	channelService := service.NewChannelService(settingRepo, userRepo, channelRouter)
	// 渠道路由读取全局策略（带 5s 缓存：后台切换后最多 5s 生效）
	channelRouter.SetPolicyFunc(llm.CachedPolicyFunc(channelService.GetPolicy, 5*time.Second))

	llmClient := llm.NewScriptClient(config.C.AI, channelRouter)
	imageClient := llm.NewImageClient(config.C.AI, "wasu", channelRouter)
	// 上游视频任务轮询预算（config.yaml 的 video 段）：必须显著小于执行超时，
	// 否则执行 ctx 先到期，失败退费与收尾会被 deadline 掐掉
	videoClient := llm.NewVideoClient(config.C.AI, "wasu", llm.VideoPollConfig{
		Interval: time.Duration(config.C.Video.PollIntervalSec) * time.Second,
		Timeout:  time.Duration(config.C.Video.PollTimeoutSec) * time.Second,
	}, channelRouter)
	audioClient := llm.NewAudioClient(config.C.AI, "wasu", channelRouter)

	// 文件上传服务（Template Method：哈希去重 + StatObject + PutObject）
	fileUploadService := service.NewFileUploadService(appStorage)

	// 生成历史记录
	generationHistoryService := service.NewGenerationHistoryService(generationHistoryRepo)
	providerTaskService := billing.NewLedger(providerTaskRepo)
	// 对账一致性自检：四份数据交叉核对，异常行自动标记 + 写备注（只读+标记，不动钱）
	auditChecker := audit.NewChecker(db, providerTaskRepo)
	providerTaskHandler := handler.NewProviderTaskHandler(providerTaskService, auditChecker)

	// 初始化工作流引擎
	registry := engine.NewDefaultRegistry(llmClient, imageClient, videoClient, audioClient, modelManager, fileUploadService, billingService, generationHistoryService, providerTaskService)
	eng := engine.NewWorkflowEngine(registry)

	// 余额变动 → 顺着正在执行的那条事件流实时推给前端：
	// 后端一扣费，画布右上角立刻变（不用等生成结束，更不用刷新页面）。
	// 分工：计费层只负责通知「钱变了」，引擎只负责转发，都不关心对方的存在。
	billingService.SetBalanceListener(func(ev billing.BalanceEvent) {
		if ev.ExecutionID <= 0 {
			return // 前端直连的计费接口（提示词/白模）没有执行流，由前端在响应返回后自行同步
		}
		eng.Publish(ev.ExecutionID, "credits_changed", map[string]interface{}{
			"kind":    ev.Kind,    // deduct / refund / recharge
			"action":  ev.Action,  // 计费动作（如 ai.image）
			"scene":   ev.Scene,   // 场景文案（如「图片生成」）
			"amount":  ev.Amount,  // 本次变动金额（正数）
			"balance": ev.Balance, // 变动后的余额快照（同一个扣费流程里读到的值）
		})
	})
	// 执行时按全局策略 + 用户渠道解析最终 AI 渠道（wasu/dianxin）
	eng.SetChannelResolver(func(ctx context.Context, userID string) string {
		return channelService.ResolveUserChannel(ctx, userID)
	})

	// 视频转码服务（独立模块，承载 ffmpeg 调用 + 任务状态注册表）
	transcodeService := service.NewTranscodeService(appStorage)

	// 风格相关 Service
	styleService := service.NewStyleService(styleRepo, appStorage)
	categoryService := service.NewCategoryService(categoryRepo)
	styleFavoriteService := service.NewStyleFavoriteService(styleFavoriteRepo, styleRepo)

	// 初始化 Handler
	userHandler := handler.NewUserHandler(userService, billingService)
	projectHandler := handler.NewProjectHandler(projectService)
	canvasHandler := handler.NewCanvasHandler(canvasService)
	workflowHandler := handler.NewWorkflowHandler(execRepo, aiTaskRepo, canvasRepo, projectRepo, eng, registry)
	uploadHandler := handler.NewUploadHandler(appStorage, fileUploadService, transcodeService, projectRepo, userRepo)
	styleHandler := handler.NewStyleHandler(styleService, categoryService, styleFavoriteService, fileUploadService)
	showHandler := handler.NewShowHandler(showService, fileUploadService, projectRepo)
	commentHandler := handler.NewCommentHandler(commentService)
	forumHandler := handler.NewForumHandler(forumService)
	bannerHandler := handler.NewBannerHandler(bannerService, fileUploadService)
	// 清晰化渠道配置（configs/enhance.yaml）：渠道/档位/运维旋钮。
	// 读不到或读坏了都**不阻塞启动** —— 退回内置默认配置（本机 FFmpeg 两档），
	// 理由：清晰化是增强项，配置故障不该让整个服务起不来；但日志会明确喊出来
	enhanceCfg, enhanceErr := service.LoadEnhanceConfig("configs/enhance.yaml")
	if enhanceErr != nil {
		log.Printf("⚠️  清晰化配置加载失败，使用内置默认配置: %v", enhanceErr)
		enhanceCfg = engine.DefaultEnhanceConfig()
	}
	service.ApplyEnhanceLimits(enhanceCfg.Limits)
	engine.ApplyEnhanceConfig(enhanceCfg)

	modelHandler := handler.NewModelHandler(modelManager, channelService)
	enhanceHandler := handler.NewEnhanceHandler()
	channelHandler := handler.NewChannelHandler(channelService, userService)
	// 幂等存储的内容在 cache.Init 之后装配（见下方）：这里先给一个「延迟取 Redis」的实例，
	// 它没有 Redis 时会自动降级为不拦截，不会因为顺序问题静默失效
	idemStore := idem.New(nil, "idem:")
	promptHandler := handler.NewPromptHandler(llmClient, modelManager, billingService, providerTaskService, idemStore, channelService)
	previzHandler := handler.NewPrevizHandler(llmClient, imageClient, modelManager, billingService, providerTaskService, idemStore, channelService)
	userAssetHandler := handler.NewUserAssetHandler(userAssetService)
	billingHandler := handler.NewBillingHandler(billingRepo, userService)
	pricingHandler := handler.NewPricingHandler(pricingService, channelService)
	generationHistoryHandler := handler.NewGenerationHistoryHandler(generationHistoryService)
	pointsPackageHandler := handler.NewPointsPackageHandler(pointsPackageService)
	// 支付回调完成后同步跳转回的前端地址（可用环境变量 FRONTEND_BASE 覆盖）
	frontendBase := os.Getenv("FRONTEND_BASE")
	if frontendBase == "" {
		frontendBase = "http://192.168.110.115:8880"
	}
	paymentHandler := handler.NewPaymentHandler(paymentService, wechatPayService, frontendBase)
	wechatPayHandler := handler.NewWechatPayHandler(wechatPayService)

	// 启动时预取微信平台证书（配置就绪才有动作）：让第一笔回调不必现拉证书，
	// 稳稳落在微信要求的 5 秒 ACK 预算内；未配置时只记一行日志，不阻断启动
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		wechatPayService.Prefetch(ctx)
	}()

	// ==================== Redis 增强能力：限流 / 并发闸门 / 生成任务队列 ====================
	// Redis 是增强而非硬依赖：连接失败时自动降级（限流关闭、生成任务回到进程内执行），
	// 不影响生成主流程。
	if err := cache.Init(config.C.Redis); err != nil {
		log.Printf("⚠️  Redis 不可用，限流/任务队列将降级为原逻辑: %v", err)
	} else {
		log.Printf("✅ Redis 已连接: %s (db=%d)", config.C.Redis.Addr(), config.C.Redis.DB)
		defer func() { _ = cache.Close() }()
	}

	// Redis 就绪后把客户端交给幂等存储（直连 AI 接口防双击/防重复扣费）
	idemStore.SetClient(cache.Client())

	// 一致性自检定时跑：启动 2 分钟后一次，之后每 10 分钟一次（只读+标记）
	auditChecker.Start(context.Background(), 10*time.Minute, 2*time.Minute)

	// 生成任务队列：任务入 Redis Stream，由 worker 池消费。
	// worker 数即全局并发闸门；未确认的消息在进程重启后由 XAUTOCLAIM 认领续跑。
	var genQueue *queue.Queue
	if config.C.Queue.Enabled && cache.Available() {
		genQueue = queue.New(config.C.Queue, cache.Client(), workflowHandler.HandleQueuedTask)
		workflowHandler.SetQueue(genQueue)
		if err := genQueue.Start(context.Background()); err != nil {
			log.Printf("⚠️  队列启动失败，降级为进程内执行: %v", err)
			genQueue = nil
			workflowHandler.SetQueue(nil)
		}
	} else if config.C.Queue.Enabled {
		log.Printf("⚠️  队列已配置开启但 Redis 不可用，生成任务走进程内执行")
	}
	if genQueue == nil {
		log.Printf("ℹ️  生成任务队列未启用：任务在进程内直接执行（重启会中断）")
	}

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
		publicShows.GET("/:id/comments", commentHandler.List)                       // 顶级评论列表（公开）
		publicShows.GET("/comments/:commentId/replies", commentHandler.ListReplies) // 评论的回复列表（公开）
	}

	// 公开Banner接口（无需登录）
	publicBanners := r.Group("/api/banners")
	{
		publicBanners.GET("", bannerHandler.ListBanners)
		publicBanners.GET("/:id", bannerHandler.GetBanner)
	}

	// 公开论坛路由（无需登录：未登录也能浏览帖子与回复，
	// 论坛要能当首页 banner 的活动落地页，必须让没登录的访客也能看）
	publicForum := r.Group("/api/forum")
	{
		publicForum.GET("/posts", forumHandler.ListPosts)
		publicForum.GET("/posts/:id", forumHandler.GetPost)
		publicForum.GET("/posts/:id/replies", forumHandler.ListReplies)
	}

	// 积分超市套餐列表（无需登录，仅启用中的套餐）
	r.GET("/api/points-packages", pointsPackageHandler.ListPublic)

	// 支付宝支付（公网接口，无需登录；异步通知 + 同步跳转）
	r.POST("/api/payment/alipay/notify", paymentHandler.AlipayNotify)
	r.GET("/api/payment/alipay/return", paymentHandler.AlipayReturn)

	// 微信支付异步通知（APIv3：验签 + 解密 + 幂等到账；成功回微信要求的 SUCCESS 体）
	r.POST("/api/payment/wechat/notify", wechatPayHandler.Notify)

	// 收银台支付方式能力查询（公开：不含敏感信息；用于「微信支付」置灰与 H5 可用性标注）
	r.GET("/api/payment/methods", paymentHandler.Methods)

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
	api.Use(middleware.Auth(userService, userService))
	{
		// 删除项目 canvas 文件夹（需认证）
		api.DELETE("/upload/canvas/:projectId", uploadHandler.DeleteCanvasDir)
		// 存储同步（管理员专用）
		api.POST("/storage/sync", uploadHandler.SyncStorage)           // 同步本地存储到MinIO
		api.POST("/storage/sync-volume", uploadHandler.SyncFromVolume) // 从Docker volume同步

		// 用户
		api.GET("/auth/me", userHandler.Me)
		api.POST("/auth/refresh", userHandler.Refresh)                  // 滑动续期：剩余寿命不足时换新 token
		api.PUT("/auth/profile", userHandler.UpdateProfile)             // 更新当前用户个人资料（昵称/头像）
		api.PUT("/auth/password", userHandler.ChangePassword)           // 修改当前用户密码
		api.POST("/upload/avatar", uploadHandler.UploadAvatar)          // 上传头像（存 users/<userID>/avatar/）
		api.POST("/upload/forum-image", uploadHandler.UploadForumImage) // 论坛图片（存 forum/<帖子id>/）
		api.POST("/upload/forum-video", uploadHandler.UploadForumVideo) // 论坛视频（存 forum/<帖子id>/）
		api.GET("/users", userHandler.List)                             // 管理员：获取所有用户

		// 论坛：发帖/回复/删除（需登录；删帖删回复本人或管理员皆可）
		api.POST("/forum/posts", forumHandler.CreatePost)
		api.POST("/forum/posts/:id/replies", forumHandler.CreateReply)
		api.PUT("/forum/posts/:id", forumHandler.UpdatePost)
		api.DELETE("/forum/posts/:id", forumHandler.DeletePost)
		api.DELETE("/forum/replies/:replyId", forumHandler.DeleteReply)
		// 论坛置顶（仅管理员）
		api.PUT("/forum/posts/:id/pin", middleware.RequireAdmin(userService), forumHandler.SetPinned)
		api.PUT("/users/:id/role", userHandler.UpdateRole)    // 管理员：更新用户角色
		api.DELETE("/users/:id", userHandler.Delete)          // 管理员：删除用户
		api.POST("/users/:id/recharge", userHandler.Recharge) // 管理员：为用户充值积分
		api.GET("/models", modelHandler.ListModels)           // 模型清单（按登录用户渠道返回各自渠道模型）
		// 清晰化渠道 + 档位清单（配置 × 实现注册表驱动：改 enhance.yaml 重启即生效，前端不用发版）
		// 路径沿用 providers（P0 首版就叫这个），少一次旧前端 404
		api.GET("/enhance/providers", enhanceHandler.ListChannels)

		// AI 渠道管理（多渠道 token 路由：华数/电信）
		api.GET("/channel/my", channelHandler.GetMyChannel)                                                   // 当前用户自己的渠道
		api.GET("/channel/policy", channelHandler.GetPolicy)                                                  // 管理员：查询全局渠道策略
		api.PUT("/channel/policy", middleware.RequireAdmin(userService), channelHandler.SetPolicy)            // 管理员：切换全局策略（全A/全B/按用户）
		api.PUT("/users/:id/channel", middleware.RequireAdmin(userService), channelHandler.UpdateUserChannel) // 管理员：修改用户渠道

		// 支付订单（积分超市充值，需登录）
		payment := api.Group("/payment")
		{
			payment.POST("/orders", paymentHandler.CreateOrder)      // 下单，返回支付宝收银台支付 URL
			payment.GET("/orders/:orderNo", paymentHandler.GetOrder) // 查单（前端轮询支付结果）
		}

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
			// 工作流（路径对齐前端 api/services/workflowApi.ts）；AI 调用入口，先过扣费中间件
			projects.POST("/:id/workflows/execute", middleware.RateLimit(config.C.RateLimit), middleware.Billing(billingService, billing.ActionWorkflowExecute), workflowHandler.Execute)
			projects.GET("/:id/workflows/:execId", workflowHandler.GetExecution)
			// 项目进行中的执行（前端重进项目时恢复"生成中"状态用；路径挂在 workflows 之外避免与 :execId 冲突）
			projects.GET("/:id/active-executions", workflowHandler.GetActiveExecutions)
			// SSE 流式订阅工作流执行进度（必须单独注册在 r 上，不能走 Auth 中间件：
			//   原生 EventSource 不支持自定义 header，token 只能放 query ，
			//   所以鉴权由 StreamExecution 内部处理，见 workflow_handler.go）
		}

		// SSE 工作流流（独立鉴权：query 传 token）
		r.GET("/api/projects/:id/workflows/:execId/stream", workflowHandler.StreamExecution)

		// 工作流（兼容旧路由 /api/workflow/*）；AI 调用入口，先过扣费中间件
		workflow := api.Group("/workflow")
		{
			workflow.POST("/execute", middleware.RateLimit(config.C.RateLimit), middleware.Billing(billingService, billing.ActionWorkflowExecute), workflowHandler.Execute)
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
			// 服务端抽帧生成封面（对象存储无 CORS 时浏览器截不了帧，见 handler 注释）
			shows.POST("/capture-cover", showHandler.CaptureCoverFromVideo)
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
			// 评论相关
			shows.POST("/:id/comments", commentHandler.Create)          // 发表评论
			shows.DELETE("/comments/:commentId", commentHandler.Delete) // 删除评论（本人或管理员）
		}

		// Banner资源位管理（需登录）
		banners := api.Group("/banners")
		{
			banners.POST("", bannerHandler.CreateBanner)
			banners.POST("/images", bannerHandler.UploadImage) // 上传Banner图片
			banners.PUT("/:id", bannerHandler.UpdateBanner)
			banners.DELETE("/:id", bannerHandler.DeleteBanner)
		}

		// 提示词生成（需登录）；AI 调用入口，先过扣费中间件
		prompt := api.Group("/prompt")
		{
			prompt.POST("/generate", middleware.Billing(billingService, billing.ActionPromptGenerate), promptHandler.GeneratePrompt) // 生成提示词（画面 + 运动）
		}

		// 白模预演（需登录）；AI 场景解析入口，先过扣费中间件
		previz := api.Group("/previz")
		{
			previz.POST("/analyze-scene", middleware.Billing(billingService, billing.ActionPrevizAnalyze), previzHandler.AnalyzeScene) // AI 建白模：参考图 → 几何体布局
		}

		// 用户个人资产库（需登录）
		userAssets := api.Group("/user-assets")
		{
			userAssets.GET("", userAssetHandler.List)          // 列出当前用户资产（?type=image|video）
			userAssets.POST("", userAssetHandler.Create)       // 保存资产（图片/视频 URL 引用）
			userAssets.DELETE("/:id", userAssetHandler.Delete) // 删除资产（仅限本人）
		}

		// 积分费用明细（需登录）
		api.GET("/billing/records", billingHandler.List) // 当前用户的扣费/退款/充值明细

		// 生成历史记录（需登录）
		api.GET("/generation-history", generationHistoryHandler.ListByNode) // 获取节点的生成历史

		// 模型价格配置（查询需登录；保存仅管理员）
		api.GET("/pricing", pricingHandler.List)
		api.PUT("/pricing", middleware.RequireAdmin(userService), pricingHandler.Save)

		// 上游任务对账（仅管理员）：每一次下发到上游的视频任务，含任务号与最终结局。
		// 「已退费」的行 = 用户拿回了积分、但上游按生成后计费仍然收了我们钱 —— 成本留痕。
		providerTasks := api.Group("/admin/provider-tasks", middleware.RequireAdmin(userService))
		{
			providerTasks.GET("", providerTaskHandler.List)
			providerTasks.GET("/stats", providerTaskHandler.Stats)
			// 手动退费：只有「上游明确报错」才自动退，其余失败一律在这里由管理员决定
			providerTasks.POST("/:id/refund", providerTaskHandler.Refund)
			providerTasks.POST("/audit", providerTaskHandler.RunAudit) // 立即跑一次一致性自检
			// 交付产物在线查看/下载：存储对 mp4 返回 attachment（点链接只能下载），
			// 这里代理转发并改成 inline，视频可以直接看、进度条能拖；下载功能保留（?dl=1）
		}

		// 媒体维护：给缺失缩略图的图片补图（仅管理员）
		// 缩略图只在图片上传成功那一刻生成，漏了就没人补，这个接口用来扫一遍补齐
		api.POST("/admin/media/backfill-thumbnails", middleware.RequireAdmin(userService), uploadHandler.BackfillThumbnails)

		// 积分套餐管理（仅管理员；积分超市公开列表见上方公共路由）
		pointsPackages := api.Group("/admin/points-packages", middleware.RequireAdmin(userService))
		{
			pointsPackages.GET("", pointsPackageHandler.ListAll)
			pointsPackages.POST("", pointsPackageHandler.Create)
			pointsPackages.PUT("/:id", pointsPackageHandler.Update)
			pointsPackages.DELETE("/:id", pointsPackageHandler.Delete)
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
	// ==================== 无进展看门狗 ====================
	// 执行卡死（进程被杀/收尾没跑成）时把执行收口：退积分 + 画布节点标失败 + 执行落 failed。
	// 没有它，卡死的执行会永久停在 running：前端永久显示「生成中」、重复提交闸门永久 409、
	// 扣掉的钱没人退。退出时随 ctx 一起停。
	watchdogCtx, stopWatchdog := context.WithCancel(context.Background())
	defer stopWatchdog()
	// 交付证据来源：节点产物上传成功后写入的生成历史，看门狗据此区分
	//「结果已交付、只是状态没写」与「真失败」，避免误判已生成的视频
	workflowHandler.SetGenerationHistoryService(generationHistoryService)
	// 看门狗不再自动退费：把「已扣但没交付」的任务标成待人工退费（见 handler 说明）
	providerTaskService.SetBillingService(billingService)
	workflowHandler.SetProviderTaskService(providerTaskService)
	workflowHandler.StartExecutionWatchdog(watchdogCtx, 0)

	// 优雅退出：先停止接收新请求，再停止队列 worker。
	// 未确认的队列消息留给下次启动的 XAUTOCLAIM 认领续跑（这正是队列化的核心收益）
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-quit
		log.Printf("收到退出信号，开始优雅停止…")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			log.Printf("HTTP 关闭异常: %v", err)
		}
		stopWatchdog() // 看门狗先停：避免关停期间还去改库
		if genQueue != nil {
			genQueue.Stop(8 * time.Second)
		}
		_ = cache.Close()
		log.Printf("已停止")
	}()

	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("start server: %v", err)
	}
}
