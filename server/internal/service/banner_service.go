package service

import (
	"context"
	"errors"
	"log"
	"net/http"

	"libtv/internal/model"
	"libtv/internal/pkg/apperror"
	"libtv/internal/repository"
	"libtv/internal/storage"

	"gorm.io/gorm"
)

// sentinel errors
var (
	ErrBannerNotFound = apperror.New(4001, http.StatusNotFound, "Banner不存在")
)

// BannerService Banner服务
type BannerService struct {
	bannerRepo repository.BannerRepo
	storage    storage.Storage
}

func NewBannerService(bannerRepo repository.BannerRepo, storage storage.Storage) *BannerService {
	return &BannerService{bannerRepo: bannerRepo, storage: storage}
}

// ========== Banner CRUD ==========

func (s *BannerService) CreateBanner(ctx context.Context, banner *model.Banner) error {
	return s.bannerRepo.CreateBanner(ctx, banner)
}

func (s *BannerService) GetByID(ctx context.Context, id string) (*model.Banner, error) {
	banner, err := s.bannerRepo.FindByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrBannerNotFound
		}
		return nil, err
	}
	return banner, nil
}

// ListBannersByStatus 根据状态返回Banner
func (s *BannerService) ListBannersByStatus(ctx context.Context, isActive bool) ([]*model.Banner, error) {
	return s.bannerRepo.ListBannersByStatus(ctx, isActive)
}

// ListAllBanners 返回所有Banner，禁用的排在后面
func (s *BannerService) ListAllBanners(ctx context.Context) ([]*model.Banner, error) {
	return s.bannerRepo.ListAllBanners(ctx)
}

// UpdateBanner 更新 Banner；若 image_url 变更则清理旧图片
func (s *BannerService) UpdateBanner(ctx context.Context, banner *model.Banner) error {
	old, err := s.bannerRepo.FindByID(ctx, banner.ID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrBannerNotFound
		}
		return err
	}
	if err := s.bannerRepo.UpdateBanner(ctx, banner); err != nil {
		return err
	}
	// 图片变更 → 删除旧图（仅删除老图片，新图片由上传接口持有）
	if old.ImageURL != "" && old.ImageURL != banner.ImageURL {
		s.deleteImage(old.ImageURL)
	}
	return nil
}

// DeleteBanner 删除 Banner 并清理图片
func (s *BannerService) DeleteBanner(ctx context.Context, id string) error {
	banner, err := s.bannerRepo.FindByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrBannerNotFound
		}
		return err
	}
	if err := s.bannerRepo.DeleteBanner(ctx, id); err != nil {
		return err
	}
	s.deleteImage(banner.ImageURL)
	return nil
}

// deleteImage 解析 URL 并删除存储对象；失败仅记录日志，不阻断主流程
func (s *BannerService) deleteImage(imageURL string) {
	if imageURL == "" {
		return
	}
	objectName, ok := s.storage.ParseObjectName(imageURL)
	if !ok {
		return
	}
	if err := s.storage.DeleteObject(objectName); err != nil {
		log.Printf("[banner] delete image failed: object=%s err=%v", objectName, err)
	}
}