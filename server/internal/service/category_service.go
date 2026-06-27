package service

import (
	"context"
	"errors"
	"fmt"

	"libtv/internal/model"
	"libtv/internal/repository"

	"gorm.io/gorm"
)

// CategoryWithCount 分类带风格数
type CategoryWithCount struct {
	model.Category
	StyleCount int64 `json:"style_count"`
}

// CategoryService 分类业务逻辑
type CategoryService struct {
	categoryRepo repository.CategoryRepo
}

// NewCategoryService 创建分类服务
func NewCategoryService(categoryRepo repository.CategoryRepo) *CategoryService {
	return &CategoryService{categoryRepo: categoryRepo}
}

// ListWithStyleCount 列出分类并统计每个分类下的风格数
func (s *CategoryService) ListWithStyleCount(ctx context.Context) ([]CategoryWithCount, error) {
	cats, err := s.categoryRepo.List(ctx)
	if err != nil {
		return nil, err
	}
	result := make([]CategoryWithCount, 0, len(cats))
	for _, cat := range cats {
		count, err := s.categoryRepo.CountStyles(ctx, cat.ID)
		if err != nil {
			return nil, err
		}
		result = append(result, CategoryWithCount{Category: cat, StyleCount: count})
	}
	return result, nil
}

// Create 创建分类（名称冲突返回 ErrConflict）
var (
	ErrConflict         = errors.New("conflict")
	ErrCategoryNotEmpty = errors.New("category not empty")
)

func (s *CategoryService) Create(ctx context.Context, name string, sortOrder int) (*model.Category, error) {
	if _, err := s.categoryRepo.FindByName(ctx, name, ""); err == nil {
		return nil, ErrConflict
	}
	category := model.Category{Name: name, SortOrder: sortOrder}
	if err := s.categoryRepo.Create(ctx, &category); err != nil {
		return nil, err
	}
	return &category, nil
}

// Update 更新分类
func (s *CategoryService) Update(ctx context.Context, id string, name *string, sortOrder *int) (*model.Category, error) {
	category, err := s.categoryRepo.FindByID(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("分类不存在: %w", err)
	}
	updates := map[string]interface{}{}
	if name != nil {
		if _, err := s.categoryRepo.FindByName(ctx, *name, id); err == nil {
			return nil, ErrConflict
		}
		updates["name"] = *name
	}
	if sortOrder != nil {
		updates["sort_order"] = *sortOrder
	}
	if len(updates) == 0 {
		return category, nil
	}
	if err := s.categoryRepo.Update(ctx, category, updates); err != nil {
		return nil, err
	}
	return category, nil
}

// Delete 删除分类（若分类下有风格则拒绝）
func (s *CategoryService) Delete(ctx context.Context, id string) error {
	count, err := s.categoryRepo.CountStyles(ctx, id)
	if err != nil {
		return err
	}
	if count > 0 {
		// wrap sentinel error，便于上层用 errors.Is 识别
		return fmt.Errorf("%w: 该分类下还有 %d 个风格，无法删除", ErrCategoryNotEmpty, count)
	}
	rowsAffected, err := s.categoryRepo.Delete(ctx, id)
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}
