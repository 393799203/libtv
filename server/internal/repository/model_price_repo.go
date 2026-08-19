package repository

import (
	"context"
	"errors"

	"libtv/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// ModelPriceRepo 模型价格配置数据访问
type ModelPriceRepo interface {
	// ListAll 返回全部已配置的价格记录
	ListAll(ctx context.Context) ([]model.ModelPrice, error)
	// GetByNodeModel 按（节点 + 模型）查价格（不存在时返回 gorm.ErrRecordNotFound），非视频节点使用
	GetByNodeModel(ctx context.Context, nodeType, modelID string) (*model.ModelPrice, error)
	// GetByNodeModelResolution 按（节点 + 模型 + 分辨率）查价格，视频节点使用
	GetByNodeModelResolution(ctx context.Context, nodeType, modelID, resolution string) (*model.ModelPrice, error)
	// BatchUpsert 按 (node_type, model_id, resolution) 批量新增或更新价格
	BatchUpsert(ctx context.Context, prices []model.ModelPrice) error
}

type modelPriceRepo struct {
	db *gorm.DB
}

func NewModelPriceRepo(db *gorm.DB) ModelPriceRepo {
	return &modelPriceRepo{db: db}
}

func (r *modelPriceRepo) ListAll(ctx context.Context) ([]model.ModelPrice, error) {
	var prices []model.ModelPrice
	err := r.db.WithContext(ctx).Order("model_id ASC").Find(&prices).Error
	return prices, err
}

func (r *modelPriceRepo) GetByNodeModel(ctx context.Context, nodeType, modelID string) (*model.ModelPrice, error) {
	var price model.ModelPrice
	if err := r.db.WithContext(ctx).Where("node_type = ? AND model_id = ?", nodeType, modelID).First(&price).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, gorm.ErrRecordNotFound
		}
		return nil, err
	}
	return &price, nil
}

func (r *modelPriceRepo) GetByNodeModelResolution(ctx context.Context, nodeType, modelID, resolution string) (*model.ModelPrice, error) {
	var price model.ModelPrice
	if err := r.db.WithContext(ctx).Where("node_type = ? AND model_id = ? AND resolution = ?", nodeType, modelID, resolution).First(&price).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, gorm.ErrRecordNotFound
		}
		return nil, err
	}
	return &price, nil
}

// BatchUpsert (node_type, model_id, resolution) 冲突时更新 price（PostgreSQL ON CONFLICT）
func (r *modelPriceRepo) BatchUpsert(ctx context.Context, prices []model.ModelPrice) error {
	if len(prices) == 0 {
		return nil
	}
	return r.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "node_type"}, {Name: "model_id"}, {Name: "resolution"}},
			DoUpdates: clause.AssignmentColumns([]string{"price", "updated_at"}),
		}).
		Create(&prices).Error
}
