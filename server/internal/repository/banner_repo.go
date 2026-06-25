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
	ListBanners(ctx context.Context) ([]*model.Banner, error)
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

func (r *bannerRepo) ListBanners(ctx context.Context) ([]*model.Banner, error) {
	var banners []*model.Banner
	err := r.db.WithContext(ctx).Where("is_active = ?", true).Order("sort_order ASC, created_at DESC").Find(&banners).Error
	return banners, err
}

// ListBannersByStatus 根据状态返回Banner
func (r *bannerRepo) ListBannersByStatus(ctx context.Context, isActive bool) ([]*model.Banner, error) {
	var banners []*model.Banner
	err := r.db.WithContext(ctx).Where("is_active = ?", isActive).Order("sort_order ASC, created_at DESC").Find(&banners).Error
	return banners, err
}

// ListAllBanners 返回所有Banner，禁用的排在后面
func (r *bannerRepo) ListAllBanners(ctx context.Context) ([]*model.Banner, error) {
	var banners []*model.Banner
	// 先获取已启用的Banner（按sort_order排序）
	var activeBanners []*model.Banner
	err := r.db.WithContext(ctx).Where("is_active = ?", true).Order("sort_order ASC, created_at DESC").Find(&activeBanners).Error
	if err != nil {
		return nil, err
	}
	
	// 再获取已禁用的Banner（按sort_order排序）
	var inactiveBanners []*model.Banner
	err = r.db.WithContext(ctx).Where("is_active = ?", false).Order("sort_order ASC, created_at DESC").Find(&inactiveBanners).Error
	if err != nil {
		return nil, err
	}
	
	// 合并：已启用的在前，已禁用的在后
	banners = append(activeBanners, inactiveBanners...)
	return banners, nil
}

func (r *bannerRepo) UpdateBanner(ctx context.Context, banner *model.Banner) error {
	return r.db.WithContext(ctx).Save(banner).Error
}

func (r *bannerRepo) DeleteBanner(ctx context.Context, id string) error {
	return r.db.WithContext(ctx).Delete(&model.Banner{}, "id = ?", id).Error
}