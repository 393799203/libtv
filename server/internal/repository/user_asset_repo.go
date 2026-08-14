package repository

import (
	"context"

	"libtv/internal/model"

	"gorm.io/gorm"
)

// UserAssetRepo 用户个人资产数据访问
type UserAssetRepo interface {
	Create(ctx context.Context, asset *model.UserAsset) error
	FindByID(ctx context.Context, id string) (*model.UserAsset, error)
	// ListByUser 按用户 + 类型查询；assetType 为空表示不过滤
	ListByUser(ctx context.Context, userID, assetType string) ([]*model.UserAsset, error)
	Delete(ctx context.Context, id string) error
}

type userAssetRepo struct {
	db *gorm.DB
}

func NewUserAssetRepo(db *gorm.DB) UserAssetRepo {
	return &userAssetRepo{db: db}
}

func (r *userAssetRepo) Create(ctx context.Context, asset *model.UserAsset) error {
	return r.db.WithContext(ctx).Create(asset).Error
}

func (r *userAssetRepo) FindByID(ctx context.Context, id string) (*model.UserAsset, error) {
	var asset model.UserAsset
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&asset).Error; err != nil {
		return nil, err
	}
	return &asset, nil
}

func (r *userAssetRepo) ListByUser(ctx context.Context, userID, assetType string) ([]*model.UserAsset, error) {
	var assets []*model.UserAsset
	query := r.db.WithContext(ctx).Where("user_id = ?", userID)
	if assetType != "" {
		query = query.Where("type = ?", assetType)
	}
	err := query.Order("created_at DESC").Find(&assets).Error
	return assets, err
}

func (r *userAssetRepo) Delete(ctx context.Context, id string) error {
	return r.db.WithContext(ctx).Delete(&model.UserAsset{}, "id = ?", id).Error
}
