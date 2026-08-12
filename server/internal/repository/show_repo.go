package repository

import (
	"context"
	"errors"
	"strings"

	"libtv/internal/model"

	"github.com/jackc/pgx/v5/pgconn"
	"gorm.io/gorm"
)

// ShowRepo 首页展示数据访问
type ShowRepo interface {
	CreateShow(ctx context.Context, show *model.Show) error
	FindByID(ctx context.Context, id string) (*model.Show, error)
	ListShows(ctx context.Context, categoryID string, keyword string, offset, limit int) ([]*model.Show, int64, error)
	ListPendingShows(ctx context.Context, offset, limit int) ([]*model.Show, int64, error)
	GetShowByProjectID(ctx context.Context, projectID string) (*model.Show, error)
	UpdateShow(ctx context.Context, show *model.Show) error
	DeleteShow(ctx context.Context, id string) error
	// CountOtherShowsByVideoURL 统计除 excludeID 外引用同一 videoURL 的记录数
	CountOtherShowsByVideoURL(ctx context.Context, videoURL string, excludeID string) (int64, error)

	// 点赞相关
	CreateShowLike(ctx context.Context, like *model.ShowLike) error
	DeleteShowLike(ctx context.Context, userID, showID string) error
	FindShowLike(ctx context.Context, userID, showID string) (*model.ShowLike, error)
	CountShowLikes(ctx context.Context, showID string) (int64, error)

	CreateCategory(ctx context.Context, cat *model.ShowCategory) error
	FindCategoryByID(ctx context.Context, id string) (*model.ShowCategory, error)
	FindCategoryByName(ctx context.Context, name string, excludeID string) (*model.ShowCategory, error)
	ListCategories(ctx context.Context) ([]*model.ShowCategory, error)
	UpdateCategory(ctx context.Context, cat *model.ShowCategory) error
	DeleteCategory(ctx context.Context, id string) error
	CategoryHasShows(ctx context.Context, categoryID string) (int64, error)
}

// ErrShowNotFound Show 不存在
var ErrShowNotFound = errors.New("show not found")

// ErrCategoryNotFound 分类不存在
var ErrCategoryNotFound = errors.New("category not found")

// ErrCategoryNameConflict 分类名冲突
var ErrCategoryNameConflict = errors.New("category name already exists")

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
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrShowNotFound
		}
		return nil, err
	}
	return &show, nil
}

func (r *showRepo) ListShows(ctx context.Context, categoryID string, keyword string, offset, limit int) ([]*model.Show, int64, error) {
	var shows []*model.Show
	var total int64

	applyFilters := func(q *gorm.DB) *gorm.DB {
		q = q.Where("status = ?", "published")
		if categoryID != "" && categoryID != "all" {
			q = q.Where("category_id = ?", categoryID)
		}
		if keyword != "" {
			q = q.Where("title ILIKE ? OR author ILIKE ? OR tags::text ILIKE ?", "%"+keyword+"%", "%"+keyword+"%", "%"+keyword+"%")
		}
		return q
	}

	if err := applyFilters(r.db.WithContext(ctx).Model(&model.Show{})).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err := applyFilters(r.db.WithContext(ctx).
		Preload("Category").
		Order("sort_order DESC, created_at DESC")).
		Offset(offset).Limit(limit).Find(&shows).Error; err != nil {
		return nil, 0, err
	}
	return shows, total, nil
}

func (r *showRepo) UpdateShow(ctx context.Context, show *model.Show) error {
	return r.db.WithContext(ctx).Save(show).Error
}

func (r *showRepo) ListPendingShows(ctx context.Context, offset, limit int) ([]*model.Show, int64, error) {
	var shows []*model.Show
	var total int64
	q := r.db.WithContext(ctx).Model(&model.Show{}).Where("status IN ?", []string{"pending", "rejected"})
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err := q.Preload("Category").Order("CASE WHEN status = 'pending' THEN 0 ELSE 1 END, created_at DESC").Offset(offset).Limit(limit).Find(&shows).Error; err != nil {
		return nil, 0, err
	}
	return shows, total, nil
}

func (r *showRepo) DeleteShow(ctx context.Context, id string) error {
	return r.db.WithContext(ctx).Where("id = ?", id).Delete(&model.Show{}).Error
}

func (r *showRepo) GetShowByProjectID(ctx context.Context, projectID string) (*model.Show, error) {
	var show model.Show
	if err := r.db.WithContext(ctx).Preload("Category").Where("project_id = ?", projectID).Order("updated_at DESC").First(&show).Error; err != nil {
		return nil, err
	}
	return &show, nil
}

func (r *showRepo) CountOtherShowsByVideoURL(ctx context.Context, videoURL string, excludeID string) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&model.Show{}).
		Where("video_url = ? AND id != ?", videoURL, excludeID).
		Count(&count).Error
	return count, err
}

// ========== Category CRUD ==========

func (r *showRepo) CreateCategory(ctx context.Context, cat *model.ShowCategory) error {
	err := r.db.WithContext(ctx).Create(cat).Error
	if err != nil && isDuplicateKeyErr(err) {
		return ErrCategoryNameConflict
	}
	return err
}

func (r *showRepo) FindCategoryByID(ctx context.Context, id string) (*model.ShowCategory, error) {
	var cat model.ShowCategory
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&cat).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrCategoryNotFound
		}
		return nil, err
	}
	return &cat, nil
}

func (r *showRepo) FindCategoryByName(ctx context.Context, name string, excludeID string) (*model.ShowCategory, error) {
	var cat model.ShowCategory
	q := r.db.WithContext(ctx).Where("name = ?", name)
	if excludeID != "" {
		q = q.Where("id != ?", excludeID)
	}
	err := q.First(&cat).Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &cat, nil
}

// isDuplicateKeyErr 判断是否唯一约束冲突（优先用 pgconn.PgError.Code，降级字符串匹配兼容 SQLite）
func isDuplicateKeyErr(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		// 23505 = unique_violation
		return pgErr.Code == "23505"
	}
	// 降级：SQLite 等不返回 PgError 的驱动
	msg := err.Error()
	return strings.Contains(msg, "unique") || strings.Contains(msg, "duplicate") || strings.Contains(msg, "Duplicate")
}

func (r *showRepo) ListCategories(ctx context.Context) ([]*model.ShowCategory, error) {
	var cats []*model.ShowCategory
	err := r.db.WithContext(ctx).Order("sort_order DESC, created_at ASC").Find(&cats).Error
	return cats, err
}

func (r *showRepo) UpdateCategory(ctx context.Context, cat *model.ShowCategory) error {
	err := r.db.WithContext(ctx).Save(cat).Error
	if err != nil && isDuplicateKeyErr(err) {
		return ErrCategoryNameConflict
	}
	return err
}

func (r *showRepo) DeleteCategory(ctx context.Context, id string) error {
	return r.db.WithContext(ctx).Delete(&model.ShowCategory{}, "id = ?", id).Error
}

func (r *showRepo) CategoryHasShows(ctx context.Context, categoryID string) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&model.Show{}).Where("category_id = ?", categoryID).Count(&count).Error
	return count, err
}

// ========== 点赞 ==========

func (r *showRepo) CreateShowLike(ctx context.Context, like *model.ShowLike) error {
	return r.db.WithContext(ctx).Create(like).Error
}

func (r *showRepo) DeleteShowLike(ctx context.Context, userID, showID string) error {
	return r.db.WithContext(ctx).Where("user_id = ? AND show_id = ?", userID, showID).Delete(&model.ShowLike{}).Error
}

func (r *showRepo) FindShowLike(ctx context.Context, userID, showID string) (*model.ShowLike, error) {
	var like model.ShowLike
	err := r.db.WithContext(ctx).Where("user_id = ? AND show_id = ?", userID, showID).First(&like).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return &like, err
}

func (r *showRepo) CountShowLikes(ctx context.Context, showID string) (int64, error) {
	var count int64
	return count, r.db.WithContext(ctx).Model(&model.ShowLike{}).Where("show_id = ?", showID).Count(&count).Error
}
