package repository

import (
	"context"

	"libtv/internal/model"

	"gorm.io/gorm"
)

// GenerationHistoryRepo 生成历史记录仓库接口
type GenerationHistoryRepo interface {
	Create(ctx context.Context, history *model.GenerationHistory) error
	ListByNode(ctx context.Context, nodeID string, page, pageSize int) ([]model.GenerationHistory, int64, error)
}

type generationHistoryRepo struct {
	db *gorm.DB
}

// NewGenerationHistoryRepo 创建生成历史记录仓库
func NewGenerationHistoryRepo(db *gorm.DB) GenerationHistoryRepo {
	return &generationHistoryRepo{db: db}
}

func (r *generationHistoryRepo) Create(ctx context.Context, history *model.GenerationHistory) error {
	return r.db.WithContext(ctx).Create(history).Error
}

func (r *generationHistoryRepo) ListByNode(ctx context.Context, nodeID string, page, pageSize int) ([]model.GenerationHistory, int64, error) {
	var items []model.GenerationHistory
	var total int64

	query := r.db.WithContext(ctx).Model(&model.GenerationHistory{}).Where("node_id = ?", nodeID)

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	offset := (page - 1) * pageSize
	if err := query.Order("created_at DESC").Offset(offset).Limit(pageSize).Find(&items).Error; err != nil {
		return nil, 0, err
	}

	return items, total, nil
}
