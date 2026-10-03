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
	// LastLoginAt 最后一次登录成功的时间（后台用户列表展示）。
	// 指针类型：为空表示改版前注册、或注册后从未登录过，前端显示「—」；
	// 该列由 AutoMigrate 自动添加，历史用户不回填（无历史登录记录可查）。
	LastLoginAt *time.Time `json:"last_login_at"`
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
	// service.NormalizeBillingChannel），数据库里的原始文本保持不变。
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
	// 仅支付宝充值有；后台手工充值为空。与支付宝对账时靠它对上流水。
	OrderNo string `gorm:"size:64;default:''" json:"order_no"`
	// AlipayTradeNo 支付宝交易号（支付宝侧 trade_no）：退款与对账的唯一凭据，仅支付宝充值有。
	AlipayTradeNo string `gorm:"size:64;default:''" json:"alipay_trade_no"`
	// Remark 描述（展示给用户看的文案）
	Remark string `gorm:"size:255" json:"remark"`
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
