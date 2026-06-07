package repository

import (
	"context"

	"libtv/internal/model"

	"gorm.io/gorm"
)

// ProjectRepo 项目数据访问
type ProjectRepo interface {
	Create(ctx context.Context, project *model.Project) error
	FindByID(ctx context.Context, id string) (*model.Project, error)
	ListByUserID(ctx context.Context, userID int64, offset, limit int) ([]*model.Project, int64, error)
	Update(ctx context.Context, project *model.Project) error
	Delete(ctx context.Context, id string) error
}

type projectRepo struct {
	db *gorm.DB
}

func NewProjectRepo(db *gorm.DB) ProjectRepo {
	return &projectRepo{db: db}
}

func (r *projectRepo) Create(ctx context.Context, project *model.Project) error {
	return r.db.WithContext(ctx).Create(project).Error
}

func (r *projectRepo) FindByID(ctx context.Context, id string) (*model.Project, error) {
	var project model.Project
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&project).Error; err != nil {
		return nil, err
	}
	return &project, nil
}

func (r *projectRepo) ListByUserID(ctx context.Context, userID int64, offset, limit int) ([]*model.Project, int64, error) {
	var projects []*model.Project
	var total int64
	db := r.db.WithContext(ctx).Where("user_id = ?", userID)
	if err := db.Model(&model.Project{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err := db.Order("updated_at DESC").Offset(offset).Limit(limit).Find(&projects).Error; err != nil {
		return nil, 0, err
	}
	return projects, total, nil
}

func (r *projectRepo) Update(ctx context.Context, project *model.Project) error {
	return r.db.WithContext(ctx).Save(project).Error
}

func (r *projectRepo) Delete(ctx context.Context, id string) error {
	return r.db.WithContext(ctx).Where("id = ?", id).Delete(&model.Project{}).Error
}
