package service

import (
	"context"
	"errors"
	"fmt"

	"libtv/internal/model"
	"libtv/internal/repository"
	"libtv/internal/storage"
)

// ShowService 首页展示服务
type ShowService struct {
	showRepo repository.ShowRepo
	userRepo repository.UserRepo
	storage  storage.Storage
}

// sentinel errors
var (
	ErrShowNotFound          = errors.New("show not found")
	ErrCategoryNotFound     = errors.New("category not found")
	ErrCategoryNameConflict = errors.New("category name already exists")
)

func NewShowService(showRepo repository.ShowRepo, userRepo repository.UserRepo, storage storage.Storage) *ShowService {
	return &ShowService{showRepo: showRepo, userRepo: userRepo, storage: storage}
}

// ========== Show CRUD ==========

func (s *ShowService) CreateShow(ctx context.Context, show *model.Show) error {
	return s.showRepo.CreateShow(ctx, show)
}

func (s *ShowService) GetByID(ctx context.Context, id string) (*model.Show, error) {
	show, err := s.showRepo.FindByID(ctx, id)
	if err != nil {
		if errors.Is(err, repository.ErrShowNotFound) {
			return nil, ErrShowNotFound
		}
		return nil, err
	}
	return show, nil
}

func (s *ShowService) ListShows(ctx context.Context, categoryID string, keyword string, page, pageSize int) ([]*model.Show, int64, error) {
	offset := (page - 1) * pageSize
	return s.showRepo.ListShows(ctx, categoryID, keyword, offset, pageSize)
}

func (s *ShowService) UpdateShow(ctx context.Context, show *model.Show) error {
	return s.showRepo.UpdateShow(ctx, show)
}

// ResolveAuthor 根据 author_id 查询用户，填充 author 和 author_avatar
func (s *ShowService) ResolveAuthor(ctx context.Context, show *model.Show, authorID string) {
	if authorID == "" {
		return
	}
	user, err := s.userRepo.FindByID(ctx, authorID)
	if err != nil || user == nil {
		return
	}
	show.AuthorID = user.ID
	if user.Nickname != "" {
		show.Author = user.Nickname
	} else {
		show.Author = user.Email
	}
}

// UpdateThumbnail 更新视频封面，并清理旧封面文件
func (s *ShowService) UpdateThumbnail(ctx context.Context, showID string, imageURL string) error {
	show, err := s.GetByID(ctx, showID)
	if err != nil {
		return err
	}
	// 删除旧封面（仅当与旧值不同且属于本存储管辖）
	if show.ThumbnailURL != "" && show.ThumbnailURL != imageURL {
		if objectName, ok := s.storage.ParseObjectName(show.ThumbnailURL); ok {
			_ = s.storage.DeleteObject(objectName)
		}
	}
	show.ThumbnailURL = imageURL
	return s.showRepo.UpdateShow(ctx, show)
}

// DeleteShow 删除视频，并清理关联的缩略图与视频文件（视频文件按引用计数判断）
func (s *ShowService) DeleteShow(ctx context.Context, id string) error {
	show, err := s.GetByID(ctx, id)
	if err != nil {
		return err
	}

	if err := s.showRepo.DeleteShow(ctx, id); err != nil {
		return err
	}

	// 清理缩略图
	if show.ThumbnailURL != "" {
		if objectName, ok := s.storage.ParseObjectName(show.ThumbnailURL); ok {
			_ = s.storage.DeleteObject(objectName)
		}
	}

	// 清理视频文件（仅当无其他 show 引用时）
	if show.VideoURL != "" {
		count, _ := s.showRepo.CountOtherShowsByVideoURL(ctx, show.VideoURL, id)
		if count == 0 {
			if objectName, ok := s.storage.ParseObjectName(show.VideoURL); ok {
				_ = s.storage.DeleteObject(objectName)
			}
		}
	}
	return nil
}

// ========== Category CRUD ==========

func (s *ShowService) CreateCategory(ctx context.Context, cat *model.ShowCategory) error {
	return s.showRepo.CreateCategory(ctx, cat)
}

func (s *ShowService) GetCategoryByID(ctx context.Context, id string) (*model.ShowCategory, error) {
	cat, err := s.showRepo.FindCategoryByID(ctx, id)
	if err != nil {
		if errors.Is(err, repository.ErrCategoryNotFound) {
			return nil, ErrCategoryNotFound
		}
		return nil, err
	}
	return cat, nil
}

func (s *ShowService) ListCategories(ctx context.Context) ([]*model.ShowCategory, error) {
	return s.showRepo.ListCategories(ctx)
}

func (s *ShowService) UpdateCategory(ctx context.Context, cat *model.ShowCategory) error {
	err := s.showRepo.UpdateCategory(ctx, cat)
	if err != nil && errors.Is(err, repository.ErrCategoryNameConflict) {
		return ErrCategoryNameConflict
	}
	return err
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
