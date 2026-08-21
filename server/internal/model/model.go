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
	// Credits 剩余积分：AI 调用前由扣费中间件校验并原子扣减（见 service/billing_service.go）
	Credits   int64     `gorm:"not null;default:0" json:"credits"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
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
	ID          string    `gorm:"primaryKey;size:36" json:"id"`
	UserID      string    `gorm:"index;size:36;not null" json:"user_id"`
	Name        string    `gorm:"size:255;not null" json:"name"`
	Description string    `gorm:"size:1000" json:"description"`
	CoverURL    string    `gorm:"size:500" json:"cover_url"`
	// ShowStatus 关联发布视频的状态（pending/published/rejected），无关联为空；不存库，列表查询时补充
	ShowStatus string    `gorm:"-" json:"show_status"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
	User        User      `gorm:"foreignKey:UserID" json:"-"`
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
	Project        Project        `gorm:"foreignKey:ProjectID" json:"-"`
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
	CommentCount int64          `gorm:"-" json:"comment_count"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
	Category     ShowCategory   `gorm:"foreignKey:CategoryID" json:"category"`
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
	ID        string    `gorm:"primaryKey;size:36" json:"id"`
	ShowID    string    `gorm:"size:36;not null;index" json:"show_id"`
	UserID    string    `gorm:"size:36;not null;index" json:"user_id"`
	Content   string    `gorm:"size:1000;not null" json:"content"`
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
	// Scene 扣费场景（如 图片生成 / 视频生成 / 提示词生成）
	Scene string `gorm:"size:50" json:"scene"`
	// Remark 描述（展示给用户看的文案）
	Remark string `gorm:"size:255" json:"remark"`
	// BalanceAfter 本次变动后的剩余积分
	BalanceAfter int64     `gorm:"not null;default:0" json:"balance_after"`
	CreatedAt    time.Time `json:"created_at"`
}

func (BillingRecord) TableName() string { return "billing_records" }

// ========== 模型计费价格配置 ==========

// ModelPrice 模型价格配置（运营后台「价格管理」维护）
// 以（节点 + 模型 + 分辨率）为维度存储单价：
//   - 文本/剧本/图片/语音节点：resolution 为空，按次或按字计费
//   - 视频节点：resolution 为 480p/720p/1080p/4k，同一模型不同分辨率可配置不同价格
type ModelPrice struct {
	ID         int64   `gorm:"primaryKey;autoIncrement" json:"id"`
	NodeType   string  `gorm:"size:20;not null;uniqueIndex:idx_price_node_model_res,priority:1" json:"node_type"`    // 节点类型：text/script/image/video/audio
	ModelID    string  `gorm:"size:100;not null;uniqueIndex:idx_price_node_model_res,priority:2" json:"model_id"`    // 模型 ID（对应 models.yaml 的 id）
	Resolution string  `gorm:"size:10;default:'';uniqueIndex:idx_price_node_model_res,priority:3" json:"resolution"` // 分辨率（视频节点：480p/720p/1080p/4k，其他节点为空）
	Price      float64 `gorm:"not null;default:0" json:"price"`                                                     // 单价：按次=积分/次，按秒=积分/秒；0 表示暂不扣费

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (ModelPrice) TableName() string { return "model_prices" }

// ========== 积分套餐（积分超市） ==========

// PointsPackage 积分套餐（积分超市卡片，运营后台「套餐管理」维护）
type PointsPackage struct {
	ID          int64     `gorm:"primaryKey;autoIncrement" json:"id"`
	Name        string    `gorm:"size:50;not null" json:"name"`              // 套餐名称，如「尝鲜包」
	Price       float64   `gorm:"not null;default:0" json:"price"`           // 售价（元）
	Points      int64     `gorm:"not null;default:0" json:"points"`          // 积分数量
	Badge       string    `gorm:"size:20;default:''" json:"badge"`           // 角标文案（空表示无角标）
	Recommended bool      `gorm:"not null;default:false" json:"recommended"` // 是否推荐（卡片高亮展示）
	Features    string    `gorm:"type:text;default:''" json:"features"`      // 套餐特点，每行一条
	SortOrder   int       `gorm:"not null;default:0" json:"sort_order"`      // 排序，越小越靠前
	Enabled     bool      `gorm:"not null;default:true" json:"enabled"`      // 是否在积分超市展示

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (PointsPackage) TableName() string { return "points_packages" }

// ========== 生成历史记录 ==========

// GenerationHistory 节点生成历史（图片/视频）
type GenerationHistory struct {
	ID        string    `gorm:"size:36;primaryKey" json:"id"`
	UserID    string    `gorm:"size:36;not null;index" json:"user_id"`
	ProjectID string    `gorm:"size:36;not null;index" json:"project_id"`
	NodeID    string    `gorm:"size:36;not null;index" json:"node_id"`
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
