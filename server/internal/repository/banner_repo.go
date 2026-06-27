package repository

import (
	"context"

	"libtv/internal/model"

	"gorm.io/gorm"
)

// BannerRepo Banner数据访问
type BannerRepo interface {
	CreateBanner(ctx context.Context, banner *model.Banner) error
	FindByID(ctx context.Context, id string) (*model.Banner, error)
	ListBannersByStatus(ctx context.Context, isActive bool) ([]*model.Banner, error)
	ListAllBanners(ctx context.Context) ([]*model.Banner, error)
	UpdateBanner(ctx context.Context, banner *model.Banner) error
	DeleteBanner(ctx context.Context, id string) error
}

type bannerRepo struct {
	db *gorm.DB
}

func NewBannerRepo(db *gorm.DB) BannerRepo {
	return &bannerRepo{db: db}
}

// ========== Banner CRUD ==========

func (r *bannerRepo) CreateBanner(ctx context.Context, banner *model.Banner) error {
	return r.db.WithContext(ctx).Create(banner).Error
}

func (r *bannerRepo) FindByID(ctx context.Context, id string) (*model.Banner, error) {
	var banner model.Banner
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&banner).Error; err != nil {
		return nil, err
	}
	return &banner, nil
}

// ListBannersByStatus 根据状态返回Banner
func (r *bannerRepo) ListBannersByStatus(ctx context.Context, isActive bool) ([]*model.Banner, error) {
	var banners []*model.Banner
	err := r.db.WithContext(ctx).Where("is_active = ?", isActive).Order("sort_order ASC, created_at DESC").Find(&banners).Error
	return banners, err
}

// ListAllBanners 返回所有Banner，启用在前禁用在后（单 SQL 查询）
func (r *bannerRepo) ListAllBanners(ctx context.Context) ([]*model.Banner, error) {
	var banners []*model.Banner
	err := r.db.WithContext(ctx).
		Order("is_active DESC, sort_order ASC, created_at DESC").
		Find(&banners).Error
	return banners, err
}

func (r *bannerRepo) UpdateBanner(ctx context.Context, banner *model.Banner) error {
	return r.db.WithContext(ctx).Save(banner).Error
}

func (r *bannerRepo) DeleteBanner(ctx context.Context, id string) error {
	return r.db.WithContext(ctx).Delete(&model.Banner{}, "id = ?", id).Error
}