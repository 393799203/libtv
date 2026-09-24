package repository

import (
	"context"
	"errors"

	"libtv/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// 价格渠道回退值：调用方未指定渠道时按华数（wasu）处理，与 model_prices.channel 默认值一致
const defaultPriceChannel = "wasu"

// normalizePriceChannel 渠道归一：空值回退 wasu
func normalizePriceChannel(channel string) string {
	if channel == "" {
		return defaultPriceChannel
	}
	return channel
}

// ModelPriceRepo 模型价格配置数据访问（价格以「渠道 + 节点 + 模型 + 分辨率」为唯一维度）
type ModelPriceRepo interface {
	// ListAll 返回指定渠道的全部已配置价格记录（channel 为空时按 wasu）
	ListAll(ctx context.Context, channel string) ([]model.ModelPrice, error)
	// GetByNodeModel 按（渠道 + 节点 + 模型）查价格（不存在时返回 gorm.ErrRecordNotFound），非视频节点使用
	GetByNodeModel(ctx context.Context, channel, nodeType, modelID string) (*model.ModelPrice, error)
	// GetByNodeModelResolution 按（渠道 + 节点 + 模型 + 分辨率）查价格，视频节点使用
	GetByNodeModelResolution(ctx context.Context, channel, nodeType, modelID, resolution string) (*model.ModelPrice, error)
	// BatchUpsert 按 (channel, node_type, model_id, resolution) 批量新增或更新价格
	BatchUpsert(ctx context.Context, prices []model.ModelPrice) error
}

type modelPriceRepo struct {
	db *gorm.DB
}

func NewModelPriceRepo(db *gorm.DB) ModelPriceRepo {
	return &modelPriceRepo{db: db}
}

func (r *modelPriceRepo) ListAll(ctx context.Context, channel string) ([]model.ModelPrice, error) {
	var prices []model.ModelPrice
	err := r.db.WithContext(ctx).
		Where("channel = ?", normalizePriceChannel(channel)).
		Order("model_id ASC").
		Find(&prices).Error
	return prices, err
}

func (r *modelPriceRepo) GetByNodeModel(ctx context.Context, channel, nodeType, modelID string) (*model.ModelPrice, error) {
	var price model.ModelPrice
	if err := r.db.WithContext(ctx).
		Where("channel = ? AND node_type = ? AND model_id = ?", normalizePriceChannel(channel), nodeType, modelID).
		First(&price).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, gorm.ErrRecordNotFound
		}
		return nil, err
	}
	return &price, nil
}

func (r *modelPriceRepo) GetByNodeModelResolution(ctx context.Context, channel, nodeType, modelID, resolution string) (*model.ModelPrice, error) {
	var price model.ModelPrice
	if err := r.db.WithContext(ctx).
		Where("channel = ? AND node_type = ? AND model_id = ? AND resolution = ?", normalizePriceChannel(channel), nodeType, modelID, resolution).
		First(&price).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, gorm.ErrRecordNotFound
		}
		return nil, err
	}
	return &price, nil
}

// BatchUpsert (channel, node_type, model_id, resolution) 冲突时更新 price（PostgreSQL ON CONFLICT）
func (r *modelPriceRepo) BatchUpsert(ctx context.Context, prices []model.ModelPrice) error {
	if len(prices) == 0 {
		return nil
	}
	// 渠道归一，避免写入空渠道导致唯一键不一致
	for i := range prices {
		prices[i].Channel = normalizePriceChannel(prices[i].Channel)
	}
	return r.db.WithContext(ctx).
		Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "channel"}, {Name: "node_type"}, {Name: "model_id"}, {Name: "resolution"}},
			DoUpdates: clause.AssignmentColumns([]string{"price", "updated_at"}),
		}).
		Create(&prices).Error
}