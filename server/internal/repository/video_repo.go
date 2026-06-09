package repository

import (
	"context"
	"fmt"

	"libtv/internal/model"

	"gorm.io/gorm"
)

// VideoRepo 视频数据访问
type VideoRepo interface {
	Create(ctx context.Context, video *model.Video) error
	FindByID(ctx context.Context, id string) (*model.Video, error)
	List(ctx context.Context, offset, limit int, tag string, keyword string) ([]*model.Video, int64, error)
	Update(ctx context.Context, video *model.Video) error
	Delete(ctx context.Context, id string) error
}

type videoRepo struct {
	db *gorm.DB
}

func NewVideoRepo(db *gorm.DB) VideoRepo {
	return &videoRepo{db: db}
}

func (r *videoRepo) Create(ctx context.Context, video *model.Video) error {
	return r.db.WithContext(ctx).Create(video).Error
}

func (r *videoRepo) FindByID(ctx context.Context, id string) (*model.Video, error) {
	var video model.Video
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&video).Error; err != nil {
		return nil, err
	}
	return &video, nil
}

func (r *videoRepo) List(ctx context.Context, offset, limit int, tag string, keyword string) ([]*model.Video, int64, error) {
	var videos []*model.Video
	var total int64
	db := r.db.WithContext(ctx)
	if tag != "" {
		// tags 是 jsonb 类型，用 @> 包含查询
		db = db.Where("tags @> ?", fmt.Sprintf(`["%s"]`, tag))
	}
	if keyword != "" {
		db = db.Where("title ILIKE ? OR author ILIKE ?", "%"+keyword+"%", "%"+keyword+"%")
	}
	if err := db.Model(&model.Video{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err := db.Order("created_at DESC").Offset(offset).Limit(limit).Find(&videos).Error; err != nil {
		return nil, 0, err
	}
	return videos, total, nil
}

func (r *videoRepo) Update(ctx context.Context, video *model.Video) error {
	return r.db.WithContext(ctx).Save(video).Error
}

func (r *videoRepo) Delete(ctx context.Context, id string) error {
	return r.db.WithContext(ctx).Where("id = ?", id).Delete(&model.Video{}).Error
}
