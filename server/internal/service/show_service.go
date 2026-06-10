package service

import (
	"context"
	"fmt"

	"libtv/internal/model"
	"libtv/internal/repository"
)

// ShowService 首页展示服务
type ShowService struct {
	showRepo repository.ShowRepo
}

func NewShowService(showRepo repository.ShowRepo) *ShowService {
	return &ShowService{showRepo: showRepo}
}

// ========== Show CRUD ==========

func (s *ShowService) CreateShow(ctx context.Context, show *model.Show) error {
	return s.showRepo.CreateShow(ctx, show)
}

func (s *ShowService) GetByID(ctx context.Context, id string) (*model.Show, error) {
	return s.showRepo.FindByID(ctx, id)
}

func (s *ShowService) ListShows(ctx context.Context, categoryID string, page, pageSize int) ([]*model.Show, int64, error) {
	offset := (page - 1) * pageSize
	return s.showRepo.ListShows(ctx, categoryID, offset, pageSize)
}

func (s *ShowService) UpdateShow(ctx context.Context, show *model.Show) error {
	return s.showRepo.UpdateShow(ctx, show)
}

func (s *ShowService) DeleteShow(ctx context.Context, id string) error {
	return s.showRepo.DeleteShow(ctx, id)
}

// ========== Category CRUD ==========

func (s *ShowService) CreateCategory(ctx context.Context, cat *model.ShowCategory) error {
	return s.showRepo.CreateCategory(ctx, cat)
}

func (s *ShowService) ListCategories(ctx context.Context) ([]*model.ShowCategory, error) {
	cats, err := s.showRepo.ListCategories(ctx)
	if err != nil {
		return nil, err
	}
	return cats, nil
}

func (s *ShowService) UpdateCategory(ctx context.Context, cat *model.ShowCategory) error {
	return s.showRepo.UpdateCategory(ctx, cat)
}

func (s *ShowService) DeleteCategory(ctx context.Context, id string) error {
	count, err := s.showRepo.CategoryHasShows(ctx, id)
	if err != nil {
		return err
	}
	if count > 0 {
		return fmt.Errorf("该分类下还有 %d 个视频，无法删除", count)
	}
	return s.showRepo.DeleteCategory(ctx, id)
}
