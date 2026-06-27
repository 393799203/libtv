package repository

import (
	"context"

	"libtv/internal/model"

	"gorm.io/gorm"
)

// ============ StyleRepo ============

// StyleRepo 风格数据访问
type StyleRepo interface {
	Create(ctx context.Context, style *model.Style) error
	FindByID(ctx context.Context, id string) (*model.Style, error)
	List(ctx context.Context, q StyleQuery) ([]model.Style, int64, error)
	Update(ctx context.Context, style *model.Style, updates map[string]interface{}) error
	UpdateImage(ctx context.Context, id, imageURL string) error
	Delete(ctx context.Context, id string) error
	IncrementLikes(ctx context.Context, id string, delta int) error
}

// StyleQuery 风格列表查询参数
type StyleQuery struct {
	CategoryID string
	Keyword    string
	Page       int
	PageSize   int
}

type styleRepo struct {
	db *gorm.DB
}

// NewStyleRepo 创建风格 repo
func NewStyleRepo(db *gorm.DB) StyleRepo {
	return &styleRepo{db: db}
}

func (r *styleRepo) Create(ctx context.Context, style *model.Style) error {
	return r.db.WithContext(ctx).Create(style).Error
}

func (r *styleRepo) FindByID(ctx context.Context, id string) (*model.Style, error) {
	var style model.Style
	if err := r.db.WithContext(ctx).Preload("Category").First(&style, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &style, nil
}

func (r *styleRepo) List(ctx context.Context, q StyleQuery) ([]model.Style, int64, error) {
	query := r.db.WithContext(ctx).Model(&model.Style{})
	if q.CategoryID != "" {
		query = query.Where("category_id = ?", q.CategoryID)
	}
	if q.Keyword != "" {
		query = query.Where("name ILIKE ? OR author ILIKE ?", "%"+q.Keyword+"%", "%"+q.Keyword+"%")
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var styles []model.Style
	err := query.Preload("Category").
		Order("created_at DESC").
		Limit(q.PageSize).
		Offset((q.Page - 1) * q.PageSize).
		Find(&styles).Error
	return styles, total, err
}

func (r *styleRepo) Update(ctx context.Context, style *model.Style, updates map[string]interface{}) error {
	if err := r.db.WithContext(ctx).Model(style).Updates(updates).Error; err != nil {
		return err
	}
	// 刷新对象
	return r.db.WithContext(ctx).Preload("Category").First(style, "id = ?", style.ID).Error
}

func (r *styleRepo) UpdateImage(ctx context.Context, id, imageURL string) error {
	return r.db.WithContext(ctx).Model(&model.Style{}).Where("id = ?", id).Update("image_url", imageURL).Error
}

func (r *styleRepo) Delete(ctx context.Context, id string) error {
	return r.db.WithContext(ctx).Delete(&model.Style{}, "id = ?", id).Error
}

func (r *styleRepo) IncrementLikes(ctx context.Context, id string, delta int) error {
	expr := gorm.Expr("likes + ?", delta)
	if delta < 0 {
		expr = gorm.Expr("likes - ?", -delta)
	}
	return r.db.WithContext(ctx).Model(&model.Style{}).Where("id = ?", id).UpdateColumn("likes", expr).Error
}

// ============ CategoryRepo ============

// CategoryRepo 分类数据访问
type CategoryRepo interface {
	List(ctx context.Context) ([]model.Category, error)
	FindByID(ctx context.Context, id string) (*model.Category, error)
	FindByName(ctx context.Context, name string, excludeID string) (*model.Category, error)
	Create(ctx context.Context, c *model.Category) error
	Update(ctx context.Context, c *model.Category, updates map[string]interface{}) error
	Delete(ctx context.Context, id string) (int64, error)
	CountStyles(ctx context.Context, categoryID string) (int64, error)
}

type categoryRepo struct {
	db *gorm.DB
}

// NewCategoryRepo 创建分类 repo
func NewCategoryRepo(db *gorm.DB) CategoryRepo {
	return &categoryRepo{db: db}
}

func (r *categoryRepo) List(ctx context.Context) ([]model.Category, error) {
	var cats []model.Category
	err := r.db.WithContext(ctx).Order("sort_order DESC, created_at ASC").Find(&cats).Error
	return cats, err
}

func (r *categoryRepo) FindByID(ctx context.Context, id string) (*model.Category, error) {
	var c model.Category
	if err := r.db.WithContext(ctx).First(&c, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &c, nil
}

func (r *categoryRepo) FindByName(ctx context.Context, name string, excludeID string) (*model.Category, error) {
	var c model.Category
	q := r.db.WithContext(ctx).Where("name = ?", name)
	if excludeID != "" {
		q = q.Where("id != ?", excludeID)
	}
	if err := q.First(&c).Error; err != nil {
		return nil, err
	}
	return &c, nil
}

func (r *categoryRepo) Create(ctx context.Context, c *model.Category) error {
	return r.db.WithContext(ctx).Create(c).Error
}

func (r *categoryRepo) Update(ctx context.Context, c *model.Category, updates map[string]interface{}) error {
	if err := r.db.WithContext(ctx).Model(c).Updates(updates).Error; err != nil {
		return err
	}
	return r.db.WithContext(ctx).First(c, "id = ?", c.ID).Error
}

func (r *categoryRepo) Delete(ctx context.Context, id string) (int64, error) {
	result := r.db.WithContext(ctx).Delete(&model.Category{}, "id = ?", id)
	return result.RowsAffected, result.Error
}

func (r *categoryRepo) CountStyles(ctx context.Context, categoryID string) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&model.Style{}).Where("category_id = ?", categoryID).Count(&count).Error
	return count, err
}

// ============ StyleFavoriteRepo ============

// StyleFavoriteRepo 收藏数据访问
type StyleFavoriteRepo interface {
	Find(ctx context.Context, userID, styleID string) (*model.StyleFavorite, error)
	Create(ctx context.Context, fav *model.StyleFavorite) error
	Delete(ctx context.Context, fav *model.StyleFavorite) error
	DeleteByStyleID(ctx context.Context, styleID string) error
	ListFavoriteStyleIDs(ctx context.Context, userID string) ([]string, error)
	ListFavoritedStyleIDs(ctx context.Context, userID string, styleIDs []string) ([]model.StyleFavorite, error)
	ListStylesByIDs(ctx context.Context, ids []string) ([]model.Style, error)
}

type styleFavoriteRepo struct {
	db *gorm.DB
}

// NewStyleFavoriteRepo 创建风格收藏 repo
func NewStyleFavoriteRepo(db *gorm.DB) StyleFavoriteRepo {
	return &styleFavoriteRepo{db: db}
}

func (r *styleFavoriteRepo) Find(ctx context.Context, userID, styleID string) (*model.StyleFavorite, error) {
	var fav model.StyleFavorite
	if err := r.db.WithContext(ctx).Where("user_id = ? AND style_id = ?", userID, styleID).First(&fav).Error; err != nil {
		return nil, err
	}
	return &fav, nil
}

func (r *styleFavoriteRepo) Create(ctx context.Context, fav *model.StyleFavorite) error {
	return r.db.WithContext(ctx).Create(fav).Error
}

func (r *styleFavoriteRepo) Delete(ctx context.Context, fav *model.StyleFavorite) error {
	return r.db.WithContext(ctx).Delete(fav).Error
}

func (r *styleFavoriteRepo) DeleteByStyleID(ctx context.Context, styleID string) error {
	return r.db.WithContext(ctx).Where("style_id = ?", styleID).Delete(&model.StyleFavorite{}).Error
}

func (r *styleFavoriteRepo) ListFavoriteStyleIDs(ctx context.Context, userID string) ([]string, error) {
	var ids []string
	err := r.db.WithContext(ctx).Model(&model.StyleFavorite{}).
		Where("user_id = ?", userID).
		Order("created_at DESC").
		Pluck("style_id", &ids).Error
	return ids, err
}

func (r *styleFavoriteRepo) ListFavoritedStyleIDs(ctx context.Context, userID string, styleIDs []string) ([]model.StyleFavorite, error) {
	var favs []model.StyleFavorite
	q := r.db.WithContext(ctx).Select("style_id").Where("user_id = ?", userID)
	if len(styleIDs) > 0 {
		q = q.Where("style_id IN ?", styleIDs)
	}
	err := q.Find(&favs).Error
	return favs, err
}

func (r *styleFavoriteRepo) ListStylesByIDs(ctx context.Context, ids []string) ([]model.Style, error) {
	var styles []model.Style
	err := r.db.WithContext(ctx).Where("id IN ?", ids).Find(&styles).Error
	return styles, err
}
