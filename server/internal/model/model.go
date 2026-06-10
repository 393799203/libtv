package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

// User 用户模型
type User struct {
	ID           string         `gorm:"primaryKey;size:36" json:"id"`
	Email        string         `gorm:"uniqueIndex;size:255;not null" json:"email"`
	PasswordHash string         `gorm:"size:255;not null" json:"-"`
	Nickname     string         `gorm:"size:100" json:"nickname"`
	AvatarURL    string         `gorm:"size:500" json:"avatar_url"`
	Role         string         `gorm:"size:20;default:'user';not null" json:"role"` // user / admin
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
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
	ID          string         `gorm:"primaryKey;size:36" json:"id"`
	UserID      string         `gorm:"index;size:36;not null" json:"user_id"`
	Name        string         `gorm:"size:255;not null" json:"name"`
	Description string         `gorm:"size:1000" json:"description"`
	CoverURL    string         `gorm:"size:500" json:"cover_url"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
	User        User           `gorm:"foreignKey:UserID" json:"-"`
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
	ID          int64          `gorm:"primaryKey;autoIncrement" json:"id"`
	ExecutionID int64          `gorm:"index;not null" json:"execution_id"`
	NodeID      string         `gorm:"size:100;not null" json:"node_id"`
	NodeType    string         `gorm:"size:20;not null" json:"node_type"` // text/image/video/audio/script
	ModelName   string         `gorm:"size:100" json:"model_name"`
	Status      string         `gorm:"size:20;default:pending;index" json:"status"` // pending/running/done/failed
	Input       datatypes.JSON `gorm:"type:jsonb" json:"input"`
	Output      datatypes.JSON `gorm:"type:jsonb" json:"output"`
	CostCredits float64        `gorm:"default:0" json:"cost_credits"`
	StartedAt   *time.Time     `json:"started_at"`
	FinishedAt  *time.Time     `json:"finished_at"`
	ErrorMsg    string         `gorm:"size:1000" json:"error_msg"`
	CreatedAt   time.Time      `json:"created_at"`
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
	Duration     int            `gorm:"default:0" json:"duration"` // 秒
	AuthorID     string         `gorm:"index;size:36" json:"author_id"`       // 关联用户 ID
	Author       string         `gorm:"size:100" json:"author"`               // 冗余：作者昵称
	AuthorAvatar string         `gorm:"size:500" json:"author_avatar"`        // 冗余：作者头像
	Tags         datatypes.JSON `gorm:"type:jsonb" json:"tags"`              // []string
	SortOrder    int            `gorm:"default:0" json:"sort_order"`          // 同分类内排序
	Views        int            `gorm:"default:0" json:"views"`
	Likes        int            `gorm:"default:0" json:"likes"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
	Category     ShowCategory   `gorm:"foreignKey:CategoryID" json:"category"`
}

func (Show) TableName() string { return "shows" }

func (s *Show) BeforeCreate(tx *gorm.DB) error {
	if s.ID == "" {
		s.ID = uuid.New().String()
	}
	return nil
}
