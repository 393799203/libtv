package repository

import (
	"context"

	"libtv/internal/model"

	"gorm.io/gorm"
)

// ShowRepo 首页展示数据访问
type ShowRepo interface {
	CreateShow(ctx context.Context, show *model.Show) error
	FindByID(ctx context.Context, id string) (*model.Show, error)
	ListShows(ctx context.Context, categoryID string, offset, limit int) ([]*model.Show, int64, error)
	UpdateShow(ctx context.Context, show *model.Show) error
	DeleteShow(ctx context.Context, id string) error

	CreateCategory(ctx context.Context, cat *model.ShowCategory) error
	ListCategories(ctx context.Context) ([]*model.ShowCategory, error)
	UpdateCategory(ctx context.Context, cat *model.ShowCategory) error
	DeleteCategory(ctx context.Context, id string) error
	CategoryHasShows(ctx context.Context, categoryID string) (int64, error)
}

type showRepo struct {
	db *gorm.DB
}

func NewShowRepo(db *gorm.DB) ShowRepo {
	return &showRepo{db: db}
}

// ========== Show CRUD ==========

func (r *showRepo) CreateShow(ctx context.Context, show *model.Show) error {
	return r.db.WithContext(ctx).Create(show).Error
}

func (r *showRepo) FindByID(ctx context.Context, id string) (*model.Show, error) {
	var show model.Show
	if err := r.db.WithContext(ctx).Preload("Category").Where("id = ?", id).First(&show).Error; err != nil {
		return nil, err
	}
	return &show, nil
}

func (r *showRepo) ListShows(ctx context.Context, categoryID string, offset, limit int) ([]*model.Show, int64, error) {
	var shows []*model.Show
	var total int64
	db := r.db.WithContext(ctx).Model(&model.Show{})

	if categoryID != "" && categoryID != "all" {
		db = db.Where("category_id = ?", categoryID)
	}

	if err := db.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err := r.db.WithContext(ctx).
		Preload("Category").
		Where(categoryIDCondition(categoryID)).
		Order("sort_order DESC, created_at DESC").
		Offset(offset).Limit(limit).
		Find(&shows).Error; err != nil {
		return nil, 0, err
	}
	return shows, total, nil
}

func (r *showRepo) UpdateShow(ctx context.Context, show *model.Show) error {
	return r.db.WithContext(ctx).Save(show).Error
}

func (r *showRepo) DeleteShow(ctx context.Context, id string) error {
	return r.db.WithContext(ctx).Where("id = ?", id).Delete(&model.Show{}).Error
}

// ========== Category CRUD ==========

func (r *showRepo) CreateCategory(ctx context.Context, cat *model.ShowCategory) error {
	return r.db.WithContext(ctx).Create(cat).Error
}

func (r *showRepo) ListCategories(ctx context.Context) ([]*model.ShowCategory, error) {
	var cats []*model.ShowCategory
	err := r.db.WithContext(ctx).Order("sort_order DESC, created_at ASC").Find(&cats).Error
	return cats, err
}

func (r *showRepo) UpdateCategory(ctx context.Context, cat *model.ShowCategory) error {
	return r.db.WithContext(ctx).Save(cat).Error
}

func (r *showRepo) DeleteCategory(ctx context.Context, id string) error {
	return r.db.WithContext(ctx).Delete(&model.ShowCategory{}, "id = ?", id).Error
}

func (r *showRepo) CategoryHasShows(ctx context.Context, categoryID string) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&model.Show{}).Where("category_id = ?", categoryID).Count(&count).Error
	return count, err
}

func categoryIDCondition(categoryID string) string {
	if categoryID == "" || categoryID == "all" {
		return "1=1"
	}
	return "category_id = '" + categoryID + "'"
}
