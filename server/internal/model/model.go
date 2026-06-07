package model

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

// User 用户模型
type User struct {
	ID           int64          `gorm:"primaryKey;autoIncrement" json:"id"`
	Email        string         `gorm:"uniqueIndex;size:255;not null" json:"email"`
	PasswordHash string         `gorm:"size:255;not null" json:"-"`
	Nickname     string         `gorm:"size:100" json:"nickname"`
	AvatarURL    string         `gorm:"size:500" json:"avatar_url"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
}

func (User) TableName() string { return "users" }

// Project 项目模型
type Project struct {
	ID          string         `gorm:"primaryKey;size:36" json:"id"`
	UserID      int64          `gorm:"index;not null" json:"user_id"`
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

// Video 视频模型
type Video struct {
	ID           string         `gorm:"primaryKey;size:36" json:"id"`
	UserID       int64          `gorm:"index;not null" json:"user_id"`
	Title        string         `gorm:"size:255;not null" json:"title"`
	Description  string         `gorm:"size:1000" json:"description"`
	ThumbnailURL string         `gorm:"size:500" json:"thumbnail_url"`
	VideoURL     string         `gorm:"size:500;not null" json:"video_url"`
	Duration     int            `gorm:"default:0" json:"duration"` // 秒
	Author       string         `gorm:"size:100" json:"author"`
	AuthorAvatar string         `gorm:"size:500" json:"author_avatar"`
	Tags         datatypes.JSON `gorm:"type:jsonb" json:"tags"`
	Views        int            `gorm:"default:0" json:"views"`
	Likes        int            `gorm:"default:0" json:"likes"`
	Comments     int            `gorm:"default:0" json:"comments"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at"`
	User         User           `gorm:"foreignKey:UserID" json:"-"`
}

func (Video) TableName() string { return "videos" }

// BeforeCreate 生成 UUID
func (v *Video) BeforeCreate(tx *gorm.DB) error {
	if v.ID == "" {
		v.ID = uuid.New().String()
	}
	return nil
}
