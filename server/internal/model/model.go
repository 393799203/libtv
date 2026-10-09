package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

// User 用户模型
type User struct {
	ID           string `gorm:"primaryKey;size:36" json:"id"`
	Email        string `gorm:"uniqueIndex;size:255;not null" json:"email"`
	PasswordHash string `gorm:"size:255;not null" json:"-"`
	Nickname     string `gorm:"size:100" json:"nickname"`
	AvatarURL    string `gorm:"size:500" json:"avatar_url"`
	// PasswordVersion 密码版本号：每次改密码 +1，写入 JWT，使旧 token 全部失效
	PasswordVersion int    `gorm:"not null;default:0" json:"-"`
	Role            string `gorm:"size:20;default:'user';not null" json:"role"` // user / admin
	// Channel 用户所属 AI Token 渠道：wasu=华数 / dianxin=电信（默认 wasu，后台可改）
	Channel string `gorm:"size:20;default:'wasu';not null;index" json:"channel"`
	// Credits 剩余积分：AI 调用前由扣费中间件校验并原子扣减（见 service/billing_service.go）
	Credits   int64     `gorm:"not null;default:0" json:"credits"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	// 指针类型：为空表示改版前注册、或注册后从未登录过，前端显示「—」；
	// 该列由 AutoMigrate 自动添加，历史用户不回填（无历史登录记录可查）。

	// LastActiveAt 最后一次"操作"（带 token 调任意接口）的时间，后台用户列表展示用。
	// 可能几天才登录一次 —— "最后登录"反映不出是否还在用，"最后操作"才能。
	// 写入在鉴权中间件里做，并做了节流（同一用户最少间隔 5 分钟才写一次库），不会放大写压力。
	LastActiveAt *time.Time `json:"last_active_at"`
}

func (User) TableName() string { return "users" }

// BeforeCreate 生成 UUID
func (u *User) BeforeCreate(tx *gorm.DB) error {
	if u.ID == "" {
		u.ID = uuid.New().String()
	}
	return nil
}

// Project 项目模型
type Project struct {
	ID          string `gorm:"primaryKey;size:36" json:"id"`
	UserID      string `gorm:"index;size:36;not null" json:"user_id"`
	Name        string `gorm:"size:255;not null" json:"name"`
	Description string `gorm:"size:1000" json:"description"`
	CoverURL    string `gorm:"size:500" json:"cover_url"`
	// ShowStatus 关联发布视频的状态（pending/published/rejected），无关联为空；不存库，列表查询时补充
	ShowStatus string    `gorm:"-" json:"show_status"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
	User       User      `gorm:"foreignKey:UserID" json:"-"`
}

func (Project) TableName() string { return "projects" }

// BeforeCreate 生成 UUID
func (p *Project) BeforeCreate(tx *gorm.DB) error {
	if p.ID == "" {
		p.ID = uuid.New().String()
	}
	return nil
}

// Canvas 画布模型
type Canvas struct {
	ID        int64          `gorm:"primaryKey;autoIncrement" json:"id"`
	ProjectID string         `gorm:"uniqueIndex;size:36;not null" json:"project_id"`
	Content   datatypes.JSON `gorm:"type:jsonb;not null" json:"content"`
	Version   int            `gorm:"default:1" json:"version"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
	Project   Project        `gorm:"foreignKey:ProjectID" json:"-"`
}

func (Canvas) TableName() string { return "canvases" }

// WorkflowExecution 工作流执行记录
type WorkflowExecution struct {
	ID             int64          `gorm:"primaryKey;autoIncrement" json:"id"`
	ProjectID      string         `gorm:"index;size:36;not null" json:"project_id"`
	CanvasSnapshot datatypes.JSON `gorm:"type:jsonb" json:"canvas_snapshot"`
	Status         string         `gorm:"size:20;default:pending;index" json:"status"` // pending/running/done/failed
	StartedAt      *time.Time     `json:"started_at"`
	FinishedAt     *time.Time     `json:"finished_at"`
	ErrorMsg       string         `gorm:"size:1000" json:"error_msg"`
	CreatedAt      time.Time      `json:"created_at"`
	// NodeIDs 本次执行实际涉及的节点 ID 列表（JSON 数组）。
	// 用途：用户发起生成后关掉页面再回来时，前端据此把仍在跑的节点恢复为「生成中」
	// 并重建进度订阅，避免误以为没在生成而重复点击（重复生成、重复扣费）。
	NodeIDs datatypes.JSON `gorm:"type:jsonb" json:"node_ids"`
	Project Project        `gorm:"foreignKey:ProjectID" json:"-"`
}

func (WorkflowExecution) TableName() string { return "workflow_executions" }

// AITask AI 任务记录
type AITask struct {
	ID          int64             `gorm:"primaryKey;autoIncrement" json:"id"`
	ExecutionID int64             `gorm:"index;not null" json:"execution_id"`
	NodeID      string            `gorm:"size:100;not null" json:"node_id"`
	NodeType    string            `gorm:"size:20;not null" json:"node_type"` // text/image/video/audio/script
	ModelName   string            `gorm:"size:100" json:"model_name"`
	Status      string            `gorm:"size:20;default:pending;index" json:"status"` // pending/running/done/failed
	Input       datatypes.JSON    `gorm:"type:jsonb" json:"input"`
	Output      datatypes.JSON    `gorm:"type:jsonb" json:"output"`
	CostCredits float64           `gorm:"default:0" json:"cost_credits"`
	StartedAt   *time.Time        `json:"started_at"`
	FinishedAt  *time.Time        `json:"finished_at"`
	ErrorMsg    string            `gorm:"size:1000" json:"error_msg"`
	CreatedAt   time.Time         `json:"created_at"`
	Execution   WorkflowExecution `gorm:"foreignKey:ExecutionID" json:"-"`
}

func (AITask) TableName() string { return "ai_tasks" }

// Style 风格模型（风格市场）
type Style struct {
	ID         string         `gorm:"primaryKey;size:36" json:"id"`
	Name       string         `gorm:"size:255;not null" json:"name"`
	Author     string         `gorm:"size:100" json:"author"`
	ImageURL   string         `gorm:"size:500;not null" json:"image_url"`
	Likes      int            `gorm:"default:0" json:"likes"`
	CategoryID string         `gorm:"size:36;index" json:"category_id"` // 关联分类 ID
	Tags       datatypes.JSON `gorm:"type:jsonb" json:"tags"`           // []string
	CreatedAt  time.Time      `json:"created_at"`
	UpdatedAt  time.Time      `json:"updated_at"`
	Category   Category       `gorm:"foreignKey:CategoryID" json:"category"` // 关联查询时返回分类信息
}

func (Style) TableName() string { return "styles" }

// StyleFavorite 风格收藏
type StyleFavorite struct {
	ID        string    `gorm:"primaryKey;size:36" json:"id"`
	UserID    string    `gorm:"size:36;not null;index:idx_user_style" json:"user_id"`
	StyleID   string    `gorm:"size:36;not null;index:idx_user_style" json:"style_id"`
	CreatedAt time.Time `json:"created_at"`
}

func (StyleFavorite) TableName() string { return "style_favorites" }

// Category 风格分类模型
type Category struct {
	ID        string    `gorm:"primaryKey;size:36" json:"id"`
	Name      string    `gorm:"size:100;uniqueIndex;not null" json:"name"`
	SortOrder int       `gorm:"default:0" json:"sort_order"` // 排序权重，越大越靠前
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (Category) TableName() string { return "style_categories" }

func (c *Category) BeforeCreate(tx *gorm.DB) error {
	if c.ID == "" {
		c.ID = uuid.New().String()
	}
	return nil
}

// BeforeCreate 生成 UUID
func (f *StyleFavorite) BeforeCreate(tx *gorm.DB) error {
	if f.ID == "" {
		f.ID = uuid.New().String()
	}
	return nil
}

// BeforeCreate 生成 UUID
func (s *Style) BeforeCreate(tx *gorm.DB) error {
	if s.ID == "" {
		s.ID = uuid.New().String()
	}
	return nil
}

// ========== 首页 TV Show 管理 ==========

// ShowCategory 首页展示分类（标签）
type ShowCategory struct {
	ID        string    `gorm:"primaryKey;size:36" json:"id"`
	Name      string    `gorm:"size:100;uniqueIndex;not null" json:"name"`
	SortOrder int       `gorm:"default:0" json:"sort_order"` // 排序权重，越大越靠前
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (ShowCategory) TableName() string { return "show_categories" }

func (c *ShowCategory) BeforeCreate(tx *gorm.DB) error {
	if c.ID == "" {
		c.ID = uuid.New().String()
	}
	return nil
}

// Show 首页展示的视频条目
type Show struct {
	ID           string         `gorm:"primaryKey;size:36" json:"id"`
	CategoryID   string         `gorm:"index;size:36;not null" json:"category_id"` // 关联分类 ID
	Title        string         `gorm:"size:255;not null" json:"title"`
	Description  string         `gorm:"size:1000" json:"description"`
	ThumbnailURL string         `gorm:"size:500" json:"thumbnail_url"`
	VideoURL     string         `gorm:"size:500;not null" json:"video_url"`
	Duration     int            `gorm:"default:0" json:"duration"`       // 秒
	AuthorID     string         `gorm:"index;size:36" json:"author_id"`  // 关联用户 ID
	Author       string         `gorm:"size:100" json:"author"`          // 冗余：作者昵称
	AuthorAvatar string         `gorm:"size:500" json:"author_avatar"`   // 冗余：作者头像
	Tags         datatypes.JSON `gorm:"type:jsonb" json:"tags"`          // []string
	SortOrder    int            `gorm:"default:0" json:"sort_order"`     // 同分类内排序
	ProjectID    string         `gorm:"size:36;index" json:"project_id"` // 关联画布项目ID
	Status       string         `gorm:"size:20;index" json:"status"`     // pending / published / rejected
	Views        int            `gorm:"default:0" json:"views"`
	Likes        int            `gorm:"default:0" json:"likes"`
	// CommentCount 评论数（含回复）；不存库，详情/列表查询时补充
	CommentCount int64        `gorm:"-" json:"comment_count"`
	CreatedAt    time.Time    `json:"created_at"`
	UpdatedAt    time.Time    `json:"updated_at"`
	Category     ShowCategory `gorm:"foreignKey:CategoryID" json:"category"`
}

func (Show) TableName() string { return "shows" }

func (s *Show) BeforeCreate(tx *gorm.DB) error {
	if s.ID == "" {
		s.ID = uuid.New().String()
	}
	if s.Status == "" {
		s.Status = "published"
	}
	return nil
}

// ShowLike 视频点赞记录
type ShowLike struct {
	ID        string    `gorm:"primaryKey;size:36" json:"id"`
	UserID    string    `gorm:"size:36;not null;uniqueIndex:idx_user_show" json:"user_id"`
	ShowID    string    `gorm:"size:36;not null;uniqueIndex:idx_user_show" json:"show_id"`
	CreatedAt time.Time `json:"created_at"`
}

func (ShowLike) TableName() string { return "show_likes" }

func (s *ShowLike) BeforeCreate(tx *gorm.DB) error {
	if s.ID == "" {
		s.ID = uuid.New().String()
	}
	return nil
}

// ShowComment 视频评论（一层楼中楼：回复挂顶级评论，不再嵌套）
type ShowComment struct {
	ID      string `gorm:"primaryKey;size:36" json:"id"`
	ShowID  string `gorm:"size:36;not null;index" json:"show_id"`
	UserID  string `gorm:"size:36;not null;index" json:"user_id"`
	Content string `gorm:"size:1000;not null" json:"content"`
	// ParentID 为空=顶级评论；非空=回复，指向顶级评论 ID（回复的回复也归到顶级下）
	ParentID string `gorm:"size:36;index" json:"parent_id"`
	// ReplyToNickname 冗余展示用：回复某条回复时为被回复人昵称（回复顶级评论时为空）
	ReplyToNickname string    `gorm:"size:100" json:"reply_to_nickname"`
	CreatedAt       time.Time `json:"created_at"`
}

func (ShowComment) TableName() string { return "show_comments" }

func (s *ShowComment) BeforeCreate(tx *gorm.DB) error {
	if s.ID == "" {
		s.ID = uuid.New().String()
	}
	return nil
}

// ========== Banner 资源位管理 ==========

// Banner 首页轮播Banner资源位
type Banner struct {
	ID          string     `gorm:"primaryKey;size:36" json:"id"`
	Title       string     `gorm:"size:255;not null" json:"title"`
	Description string     `gorm:"size:1000" json:"description"`
	ImageURL    string     `gorm:"size:500;not null" json:"image_url"`
	LinkURL     string     `gorm:"size:500" json:"link_url"`
	SortOrder   int        `gorm:"default:0" json:"sort_order"`
	IsActive    bool       `gorm:"default:true" json:"is_active"`
	StartTime   *time.Time `json:"start_time"`
	EndTime     *time.Time `json:"end_time"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

func (Banner) TableName() string { return "banners" }

func (b *Banner) BeforeCreate(tx *gorm.DB) error {
	if b.ID == "" {
		b.ID = uuid.New().String()
	}
	return nil
}

// ========== 论坛 ==========

// ForumPost 论坛帖子
type ForumPost struct {
	ID     string `gorm:"primaryKey;size:36" json:"id"`
	UserID string `gorm:"size:36;not null;index" json:"user_id"`
	Title  string `gorm:"size:200;not null" json:"title"`
	// Content 富文本正文（HTML）。写入前已由 service 用 bluemonday 白名单清洗，
	// 前端用 dangerouslySetInnerHTML 渲染，切勿跳过清洗直接展示。
	Content    string `gorm:"type:text;not null" json:"content"`
	ViewCount  int64  `gorm:"not null;default:0" json:"view_count"`
	ReplyCount int64  `gorm:"not null;default:0" json:"reply_count"`
	// IsPinned 置顶：仅管理员可设，列表里排在最前
	IsPinned  bool      `gorm:"not null;default:false;index" json:"is_pinned"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (ForumPost) TableName() string { return "forum_posts" }

func (p *ForumPost) BeforeCreate(tx *gorm.DB) error {
	if p.ID == "" {
		p.ID = uuid.New().String()
	}
	return nil
}

// ForumReply 论坛回复（平铺一层；回复某条回复时用 ReplyToNickname 展示「回复 @某人」，
// 不建父子树——与 show_comments 的展示口径一致，读起来更接近普通论坛）
type ForumReply struct {
	ID     string `gorm:"primaryKey;size:36" json:"id"`
	PostID string `gorm:"size:36;not null;index" json:"post_id"`
	UserID string `gorm:"size:36;not null;index" json:"user_id"`
	// Content 富文本回复（HTML，同样经过 bluemonday 清洗）
	Content string `gorm:"type:text;not null" json:"content"`
	// ReplyToNickname 冗余展示用：被回复人昵称（直接回复帖子时为空）
	ReplyToNickname string    `gorm:"size:100" json:"reply_to_nickname"`
	CreatedAt       time.Time `json:"created_at"`
}

func (ForumReply) TableName() string { return "forum_replies" }

func (r *ForumReply) BeforeCreate(tx *gorm.DB) error {
	if r.ID == "" {
		r.ID = uuid.New().String()
	}
	return nil
}

// ========== 用户个人资产库 ==========

// UserAsset 用户个人资产（从画布节点收藏进来的图片/视频，
// 文件副本存于存储的 users/<userID>/assets/ 目录）
type UserAsset struct {
	ID        string    `gorm:"primaryKey;size:36" json:"id"`
	UserID    string    `gorm:"size:36;not null;index:idx_user_asset_type,priority:1" json:"user_id"`
	Type      string    `gorm:"size:20;not null;index:idx_user_asset_type,priority:2" json:"type"` // image / video
	URL       string    `gorm:"size:500;not null" json:"url"`
	Name      string    `gorm:"size:255" json:"name"`
	CreatedAt time.Time `json:"created_at"`
}

func (UserAsset) TableName() string { return "user_assets" }

// BillingRecord 积分账单明细（扣费 / 退款 / 充值）
type BillingRecord struct {
	ID     int64  `gorm:"primaryKey;autoIncrement" json:"id"`
	UserID string `gorm:"size:36;not null;index" json:"user_id"`
	// Type 账单类型：deduct 扣费 / refund 退款 / recharge 充值
	Type string `gorm:"size:20;not null" json:"type"`
	// Amount 变动积分数（正数，方向由 Type 决定）
	Amount int64 `gorm:"not null" json:"amount"`
	// Action 计费动作（prompt.generate / workflow.execute 等，充值时为空）
	Action string `gorm:"size:50" json:"action"`
	// Model 调用的模型 ID（如 doubao-seedance-2.0-fast，非模型调用时为空）
	Model string `gorm:"size:100" json:"model"`
	// Channel 实际调用的 AI 渠道（wasu=华数 / dianxin=电信）。
	//
	// 以前渠道是拼进 Model 的（wasu-cdance2.5-0807）：那串值既不是模型 ID 也不是渠道，
	// 前端只能整串显示，筛选/对账还得反解析。现在渠道独立成列，Model 只存纯模型 ID。
	// 本次改动之前的历史账单这一列为空 —— 读取时按 Model 里的渠道前缀回填（见
	// billing.NormalizeChannel），数据库里的原始文本保持不变。
	Channel string `gorm:"size:20;default:''" json:"channel"`
	// Scene 扣费场景（如 图片生成 / 视频生成 / 提示词生成）
	Scene string `gorm:"size:50" json:"scene"`
	// Resolution 视频节点的分辨率（480p/720p/1080p/4k）。
	// 视频按「分辨率档位」定价，账单里必须能看出这笔是按哪一档算的，否则事后无法复核。
	// 非视频节点为空；本次改动之前的历史账单也为空（那时没有存这一列）。
	Resolution string `gorm:"size:10;default:''" json:"resolution"`
	// Duration 视频节点的**计费时长**（秒）：与 Resolution 一起构成「单价 × 秒数」的复核依据。
	// 带参考视频输入时，计费时长 = 输入（参考）视频时长 + 输出视频时长，故本列是两者之和。
	// 非视频节点、或按次/按字数计费的记录为 0；历史账单同样为 0。
	Duration int `gorm:"default:0" json:"duration"`
	// RefVideoDuration 计费时长中「参考视频（输入视频）」那一部分（秒）：
	// Duration - RefVideoDuration 即输出视频时长。无参考视频输入、非视频节点与历史账单均为 0。
	RefVideoDuration int `gorm:"not null;default:0" json:"ref_video_duration"`
	// OrderNo 充值对应的商户订单号（payment_orders.order_no）。
	// 支付宝/微信充值都有（两条支付线共用一套订单表）；后台手工充值为空。
	OrderNo string `gorm:"size:64;default:''" json:"order_no"`
	// AlipayTradeNo 支付宝交易号（支付宝侧 trade_no）：退款与对账的唯一凭据，仅支付宝充值有。
	AlipayTradeNo string `gorm:"size:64;default:''" json:"alipay_trade_no"`
	// WxpayTradeNo 微信支付交易号（微信侧 transaction_id）：与 AlipayTradeNo 同职，仅微信充值有。
	// 两条线共用本表与 OrderNo，「订单号 + 对应渠道交易号」即可对上渠道流水。
	WxpayTradeNo string `gorm:"size:64;default:''" json:"wxpay_trade_no"`
	// TaskID 上游异步任务号（视频生成才有）。
	// 账单行是永久记录，而异步任务登记（Redis，24h）在退费成功后就被消费掉了 ——
	// 少了这一列，事后既无法向渠道核对「这笔失败有没有让上游真的接单并计费」，
	// 也找不回上游可能已经产出的结果。线上实例：10-03 00:04 那次超时中断。
	TaskID string `gorm:"size:64;default:''" json:"task_id"`
	// ChargeKey 这一笔扣费的唯一编号，与 provider_tasks.charge_key **同一个值**。
	//
	// 扣费分录与它的退费分录带**同一把** charge_key（一笔生成可以有扣费+退费多条分录，
	// 所以这一列在账单表里同一值可能出现在 1~2 行上，不能设唯一索引）。
	// 有了它，「上游对账行 ↔ 账单流水」才能精确对上：金额对不对、有没有缺行、
	// 是不是重复扣费，全部可判 —— 在此之前扣费分录不带任何编号，两边无法关联。
	ChargeKey string `gorm:"size:128;default:'';index" json:"charge_key"`
	// Remark 描述（展示给用户看的文案）
	// Remark 展示给用户看的文案（失败退还原因也写在这里，同 note 一样要放开长度）
	Remark string `gorm:"size:1000" json:"remark"`
	// BalanceAfter 本次变动后的剩余积分
	BalanceAfter int64     `gorm:"not null;default:0" json:"balance_after"`
	CreatedAt    time.Time `json:"created_at"`
}

func (BillingRecord) TableName() string { return "billing_records" }

// ========== 模型计费价格配置 ==========

// ModelPrice 模型价格配置（运营后台「价格管理」维护）
// 以（渠道 + 节点 + 模型 + 分辨率 + 是否带参考视频输入）为维度存储单价：
//   - Channel：AI Token 渠道（wasu=华数 / dianxin=电信），两渠道价格完全独立配置，
//     同名模型（如 deepseek-v4.1-flash）在不同渠道可有不同价格
//   - 文本/剧本/图片/语音节点：resolution 为空、has_reference_video 恒为 false，按次或按字计费
//   - 视频节点：resolution 为 480p/720p/1080p/4k，同一模型不同分辨率可配置不同价格；
//     带参考视频输入时单价单独配置一档（has_reference_video=true，运营后台预设为无参考视频单价的 6 折）
type ModelPrice struct {
	ID int64 `gorm:"primaryKey;autoIncrement" json:"id"`
	// Channel AI Token 渠道：wasu=华数 / dianxin=电信
	Channel  string `gorm:"size:20;not null;default:'wasu';uniqueIndex:idx_price_channel_node_model_res,priority:1" json:"channel"`
	NodeType string `gorm:"size:20;not null;uniqueIndex:idx_price_channel_node_model_res,priority:2" json:"node_type"` // 节点类型：text/script/image/video/audio
	ModelID  string `gorm:"size:100;not null;uniqueIndex:idx_price_channel_node_model_res,priority:3" json:"model_id"` // 模型 ID（对应 models.yaml 的 id）
	// Resolution 分辨率（视频节点：480p/720p/1080p/4k，其他节点为空）
	Resolution string `gorm:"size:10;default:'';uniqueIndex:idx_price_channel_node_model_res,priority:4" json:"resolution"`
	// HasReferenceVideo 是否「带参考视频输入」档单价：仅视频节点会置 true。
	// false 档 = 无参考视频输入的常规单价，true 档 = 带参考视频输入的单价（可查不到，见计费侧 6 折预设兜底）
	HasReferenceVideo bool `gorm:"not null;default:false;uniqueIndex:idx_price_channel_node_model_res,priority:5" json:"has_reference_video"`
	// Price 单价：按次=积分/次，按秒=积分/秒；0 表示暂不扣费
	Price float64 `gorm:"not null;default:0" json:"price"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (ModelPrice) TableName() string { return "model_prices" }

// ========== 积分套餐（积分超市） ==========

// PointsPackage 积分套餐（积分超市卡片，运营后台「套餐管理」维护）
type PointsPackage struct {
	ID          int64   `gorm:"primaryKey;autoIncrement" json:"id"`
	Name        string  `gorm:"size:50;not null" json:"name"`              // 套餐名称，如「尝鲜包」
	Price       float64 `gorm:"not null;default:0" json:"price"`           // 售价（元）
	Points      int64   `gorm:"not null;default:0" json:"points"`          // 积分数量
	Badge       string  `gorm:"size:20;default:''" json:"badge"`           // 角标文案（空表示无角标）
	Recommended bool    `gorm:"not null;default:false" json:"recommended"` // 是否推荐（卡片高亮展示）
	Features    string  `gorm:"type:text;default:''" json:"features"`      // 套餐特点，每行一条
	SortOrder   int     `gorm:"not null;default:0" json:"sort_order"`      // 排序，越小越靠前
	Enabled     bool    `gorm:"not null;default:true" json:"enabled"`      // 是否在积分超市展示

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (PointsPackage) TableName() string { return "points_packages" }

// ========== 生成历史记录 ==========

// GenerationHistory 节点生成历史（图片/视频）
// ProviderTask 上游任务对账表：每一次「下发到上游的视频任务」一行。
//
// 为什么需要它：任务号是跟渠道对账的唯一凭据，但它原本只存在 Redis 任务登记里
// （gen:task:<执行ID>:<节点ID>，TTL 24 小时，退费成功后立刻被消费掉）——
// 既留不下来、也查不了。线上教训（10-03 00:04 那次创建请求超时中断）：
// 事后完全无法回答「上游到底有没有接单、有没有计费」，也找不回上游可能已产出的成片。
//
// 这张表按任务号（TaskID）去重：同一任务被续查/复用多次只留一行、状态取最新，
// 于是「钱（billing_records）↔ 上游任务（本表）↔ 成品（generation_history）」
// 三方可以按 TaskID / (执行, 节点) 对齐。
type ProviderTask struct {
	ID int64 `gorm:"primaryKey;autoIncrement" json:"id"`
	// ChargeKey 这一笔扣费的唯一编号（**行身份**，扣费那一刻生成，永不改变）。
	//
	// 为什么需要它（这是本表最重要的一列）：
	//   - 扣费发生在「调上游创建任务」之前，那一刻还没有上游任务号 → 账单流水里根本
	//     记不下任务号，扣费侧金额过去**永远无法核对**（只能靠同用户+同金额±3分钟猜）；
	//   - 以前行的身份是 TaskID：同步调用用 `sync:执行:节点` 当编号，拿到上游任务号后
	//     又把它改成任务号 —— 身份会「变身」。一旦同一个节点在同一次执行里被扣了两次费
	//     （线上真的发生过：exec 1289 的 video-1791037098340，第一次上游拒绝退款后重试），
	//     第一次还没改名时第二次写入就会**挤进同一行、金额互相覆盖**。
	// 现在身份固定为 charge_key：扣费时同时写账单分录和本行，任务号到手后只是往这一行
	// 补一个属性（task_id），行不再易主。唯一索引只对非空值生效（历史行留空，见 main.go）。
	// 列宽 128（而不是 64）：编号由各调用方生成，宽一点是给自己留余量 ——
	// 线上教训：提示词/白模解析那两个直连接口曾用过 72 字符的编号，写进 64 的列直接报
	// "value too long"，导致**钱扣了、账单和对账行都没写进去**（余额少了 15 分，账上查无此事）。
	ChargeKey string `gorm:"size:128;default:'';index" json:"charge_key"`
	// TaskID 上游返回的任务号（视频等异步任务才有；同步调用永远为空）。
	//
	// 以前是 not null + 全量唯一，且被当成行身份 —— 现在只是行上一个属性：
	// 唯一约束改成「仅非空唯一」（部分索引，见 main.go），因为多行可以同时处于
	// 「已扣费、还没拿到任务号」的状态。
	TaskID string `gorm:"size:128;default:'';index" json:"task_id"`
	// Provider 渠道：wasu=华数 / dianxin=电信
	Provider string `gorm:"size:20;default:'';index" json:"provider"`
	Model    string `gorm:"size:100;default:''" json:"model"`
	// ExecID / NodeID 这次任务属于哪次执行、哪个画布节点
	ExecID int64  `gorm:"index" json:"exec_id"`
	NodeID string `gorm:"size:64;index" json:"node_id"`
	// UserID / ProjectID 归属（对账时按人、按项目筛）
	UserID    string `gorm:"size:36;index" json:"user_id"`
	ProjectID string `gorm:"size:36;index" json:"project_id"`
	// Status 该上游任务的最终去向：submitted 已下发 / delivered 已交付 /
	// failed 失败未交付 / refunded 失败且已退费
	Status string `gorm:"size:20;default:'submitted';index" json:"status"`
	// ChargedAmount 下发该任务时扣掉的积分（复用旧任务续查时为当初那笔）
	ChargedAmount int64 `gorm:"default:0" json:"charged_amount"`
	// RefundedAmount 已退还给用户的积分
	RefundedAmount int64 `gorm:"default:0" json:"refunded_amount"`
	// ProjectName 写入这一行时项目叫什么名字（**快照**，不是外键）。
	//
	// 为什么快照一份：项目可以被用户删掉，而对账行是永久记录 —— 删掉之后
	// 界面只能显示「（项目已删除）」，管理员既看不出是哪个项目、也无法判断这行该不该退。
	// 展示时优先用**实时**项目名（项目改名要跟着变），实时查不到时才回落到这份快照。
	// 线上实例：10-03 14:40 另一用户的「故事生成」行，项目被删后整行认不出来。
	ProjectName string `gorm:"size:255;default:''" json:"-"`
	// Alert 一致性自检发现的异常代码（空=正常）。
	//
	// 说明：这是**自动核对**打的标记，只表示「这行数据自相矛盾/缺凭据，需要人看一眼」，
	// 不代表钱的状态被改动 —— 自检只读+标记，绝不自动改金额或改状态。
	Alert string `gorm:"size:32;default:''" json:"alert"`
	// AlertAt 最近一次被标记的时间（异常排除后会被清空）
	AlertAt *time.Time `json:"alert_at"`
	// ChargeResolution / ChargeSeconds / ChargeRefSeconds 当初扣费的计费口径
	// （分辨率 / 计费总时长 / 其中参考视频时长）。人工退费要按同一口径写退费账单，
	// 否则退费记录和扣费记录对不上（视频按分辨率档位定价，口径就是复核依据）。
	ChargeResolution string `gorm:"size:32;default:''" json:"charge_resolution"`
	ChargeSeconds    int    `gorm:"default:0" json:"charge_seconds"`
	ChargeRefSeconds int    `gorm:"default:0" json:"charge_ref_seconds"`
	// TaskKind 任务类型（对账页可筛选）：视频是异步任务（有上游任务号），
	// 图片/文本/剧本/故事/音频是同步调用（没有任务号，用本地编号当 key）。
	// 取值用计费动作，如 ai.video / ai.image / ai.story
	TaskKind string `gorm:"size:32;default:'';index" json:"task_kind"`
	// RefundSource 退费来源：auto=上游明确拒绝后自动退（上游不会计费，我们没有成本）；
	// manual=管理员人工判断后退（上游没明确拒绝，很可能已生成并计费，是真实成本）。
	// 两者在「已退费」里含义完全不同，必须分开统计，不能笼统说「退了」
	RefundSource string `gorm:"size:16;default:''" json:"refund_source"`
	// ResultURL 交付给用户的产物地址（我们自己的存储/CDN）；未交付为空
	ResultURL string `gorm:"size:1000;default:''" json:"result_url"`
	// ProviderURL 上游返回的原始产物地址：转存失败时它仍然有效，
	// 留着它才能证明「上游确实出了片」，也才有机会人工把片子捞回来
	ProviderURL string `gorm:"size:1000;default:''" json:"provider_url"`
	// ========== 上游真实消耗（对账的「成本侧」）==========
	//
	// 为什么要有：对账页原先只有「扣了用户多少积分」是**收入**口径，
	// 而跟渠道对账要的是**成本**口径 —— 上游按什么计费？消耗了多少？
	// 火山（cdance）在任务结果里直接给 usage.total_tokens，DashScope 给的是时长类口径，
	// 采集到就落库，采不到就是 0（绝不用估算值冒充真实消耗：对账表上出现假数比空着更危险）。
	//
	// 线上实例：cdance2.0-fast-0807 设 480p 却交付 720p 时，
	// 一笔 9 秒任务的 token 是 195,300（720p 档），修好后同样请求降到 90,814（480p 档）——
	// 这种「钱没变、成本翻倍」的偏差，只有把上游消耗记下来才看得见。
	ProviderTokens int64 `gorm:"default:0" json:"provider_tokens"`
	// ProviderUsage 上游 usage 原文快照（按 token 计费之外的渠道口径，
	// 如 DashScope 的 video_duration/video_count 就放在这里，不硬塞进 tokens）
	ProviderUsage string `gorm:"size:255;default:''" json:"provider_usage"`

	// Note 失败原因或处理说明（供人工核对时快速定位）。
	// 1200 而不是 255：上游拒绝时会带一大段原始报错（例如「生成内容可能涉及版权限制…」后面
	// 还有接口返回的原文），255 会让真正有用的后半句被切掉，管理员还得去翻服务器日志。
	// 注意 Postgres 的 varchar(n) 按**字符**计，不是字节，所以这里留得比较宽裕。
	Note      string    `gorm:"size:1200;default:''" json:"note"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type GenerationHistory struct {
	ID        string `gorm:"size:36;primaryKey" json:"id"`
	UserID    string `gorm:"size:36;not null;index" json:"user_id"`
	ProjectID string `gorm:"size:36;not null;index" json:"project_id"`
	// node_id 不是 uuid 而是画布节点 ID：分镜类节点是 "shot-video-shot-1-script-1790607874837"
	// 这种拼接 ID（41+ 字符），36 位会把插入直接打回 —— 以前每张分镜图/分镜视频都
	// 静默写不进生成历史（日志里只有一句 "value too long for type character varying(36)"）。
	NodeID    string    `gorm:"size:64;not null;index" json:"node_id"`
	NodeType  string    `gorm:"size:20;not null" json:"node_type"` // image / video
	Prompt    string    `gorm:"type:text" json:"prompt"`
	Model     string    `gorm:"size:100" json:"model"`
	ResultURL string    `gorm:"size:500;not null" json:"result_url"`
	CreatedAt time.Time `json:"created_at"`
}

func (GenerationHistory) TableName() string { return "generation_history" }

func (h *GenerationHistory) BeforeCreate(tx *gorm.DB) error {
	if h.ID == "" {
		h.ID = uuid.New().String()
	}
	return nil
}

func (a *UserAsset) BeforeCreate(tx *gorm.DB) error {
	if a.ID == "" {
		a.ID = uuid.New().String()
	}
	return nil
}

// ========== 系统设置（KV）==========

// Setting 系统键值配置（如 AI 渠道策略 channel_policy），后台可动态修改，无需重启
type Setting struct {
	Key       string    `gorm:"primaryKey;size:100" json:"key"`
	Value     string    `gorm:"size:1000;not null;default:''" json:"value"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (Setting) TableName() string { return "settings" }
