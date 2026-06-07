package repository

import (
	"context"

	"libtv/internal/model"

	"gorm.io/gorm"
)

// CanvasRepo 画布数据访问
type CanvasRepo interface {
	FindByProjectID(ctx context.Context, projectID string) (*model.Canvas, error)
	Save(ctx context.Context, canvas *model.Canvas) error
}

type canvasRepo struct {
	db *gorm.DB
}

func NewCanvasRepo(db *gorm.DB) CanvasRepo {
	return &canvasRepo{db: db}
}

func (r *canvasRepo) FindByProjectID(ctx context.Context, projectID string) (*model.Canvas, error) {
	var canvas model.Canvas
	if err := r.db.WithContext(ctx).Where("project_id = ?", projectID).First(&canvas).Error; err != nil {
		return nil, err
	}
	return &canvas, nil
}

func (r *canvasRepo) Save(ctx context.Context, canvas *model.Canvas) error {
	var existing model.Canvas
	err := r.db.WithContext(ctx).Where("project_id = ?", canvas.ProjectID).First(&existing).Error
	if err == gorm.ErrRecordNotFound {
		return r.db.WithContext(ctx).Create(canvas).Error
	}
	if err != nil {
		return err
	}
	canvas.ID = existing.ID
	canvas.Version = existing.Version + 1
	return r.db.WithContext(ctx).Model(&existing).Updates(map[string]interface{}{
		"content": canvas.Content,
		"version": canvas.Version,
	}).Error
}
