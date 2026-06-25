package service

import (
	"context"

	"libtv/internal/model"
	"libtv/internal/repository"
)

// BannerService Banner服务
type BannerService struct {
	bannerRepo repository.BannerRepo
}

func NewBannerService(bannerRepo repository.BannerRepo) *BannerService {
	return &BannerService{bannerRepo: bannerRepo}
}

// ========== Banner CRUD ==========

func (s *BannerService) CreateBanner(ctx context.Context, banner *model.Banner) error {
	return s.bannerRepo.CreateBanner(ctx, banner)
}

func (s *BannerService) GetByID(ctx context.Context, id string) (*model.Banner, error) {
	return s.bannerRepo.FindByID(ctx, id)
}

func (s *BannerService) ListBanners(ctx context.Context) ([]*model.Banner, error) {
	return s.bannerRepo.ListBanners(ctx)
}

// ListBannersByStatus 根据状态返回Banner
func (s *BannerService) ListBannersByStatus(ctx context.Context, isActive bool) ([]*model.Banner, error) {
	return s.bannerRepo.ListBannersByStatus(ctx, isActive)
}

// ListAllBanners 返回所有Banner，禁用的排在后面
func (s *BannerService) ListAllBanners(ctx context.Context) ([]*model.Banner, error) {
	return s.bannerRepo.ListAllBanners(ctx)
}

func (s *BannerService) UpdateBanner(ctx context.Context, banner *model.Banner) error {
	return s.bannerRepo.UpdateBanner(ctx, banner)
}

func (s *BannerService) DeleteBanner(ctx context.Context, id string) error {
	return s.bannerRepo.DeleteBanner(ctx, id)
}