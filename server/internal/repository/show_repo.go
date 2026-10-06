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
	// CategoryHasManagedShows 统计分类下「后台能看到/能管理」的视频数：
	// 只算 published / pending / rejected，不含 status 为空的历史数据 ——
	// 那是 2026-06 之前留下的记录，视频管理处只查 published、待审核处只查 pending/rejected，
	// 两处列表都看不到它们，不该拦住标签删除。
	CategoryHasManagedShows(ctx context.Context, categoryID string) (int64, error)
	// CountUnmanagedShowsByCategory 按分类统计上面那类「后台看不到」的历史视频数，
	// 供前端在删除标签前提示「会一并清掉几条看不到的历史数据」。一次 GROUP BY 查完。
	CountUnmanagedShowsByCategory(ctx context.Context) (map[string]int64, error)
	// BackupAndDeleteUnmanagedShows 清掉该分类下的历史存量行：先整行快照进 shows_cleanup_backup，
	// 再删除这些行，返回清理行数。必须清 —— shows.category_id 上有真实外键
	// （fk_shows_category，NO ACTION），只要还有一行引用这个分类，删分类就会被 Postgres 拒绝。
	BackupAndDeleteUnmanagedShows(ctx context.Context, categoryID string) (int64, error)
}

// ErrShowNotFound Show 不存在
var ErrShowNotFound = errors.New("show not found")

// 后台「能看到/能管理」的视频状态：视频管理列表只列 published，待审核视频列表只列 pending/rejected。
var managedShowStatuses = []string{"published", "pending", "rejected"}

// 上面那组状态的 SQL 字面量（原生 SQL 里写死，不依赖占位符对切片的展开行为）
const unmanagedShowsSQL = "status IS NULL OR status NOT IN ('published', 'pending', 'rejected')"

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
	// Omit("Category") 避免 Preload 的关联数据覆盖 category_id
	return r.db.WithContext(ctx).Omit("Category").Save(show).Error
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

// 注意：status 为空的遗留记录不计入（后台两处列表都看不到它们，见接口注释）
func (r *showRepo) CategoryHasManagedShows(ctx context.Context, categoryID string) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&model.Show{}).
		Where("category_id = ? AND status IN ?", categoryID, managedShowStatuses).
		Count(&count).Error
	return count, err
}

func (r *showRepo) CountUnmanagedShowsByCategory(ctx context.Context) (map[string]int64, error) {
	var rows []struct {
		CategoryID string
		Total      int64
	}
	err := r.db.WithContext(ctx).Model(&model.Show{}).
		Select("category_id, count(*) AS total").
		Where(unmanagedShowsSQL).
		Group("category_id").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	counts := make(map[string]int64, len(rows))
	for _, row := range rows {
		counts[row.CategoryID] = row.Total
	}
	return counts, nil
}

func (r *showRepo) BackupAndDeleteUnmanagedShows(ctx context.Context, categoryID string) (int64, error) {
	var cleaned int64
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// 备份表放整行 jsonb 快照而不是固定列：shows 以后加字段也不影响这里写入
		if err := tx.Exec(`CREATE TABLE IF NOT EXISTS shows_cleanup_backup (
			id text PRIMARY KEY,
			category_id text,
			snapshot jsonb NOT NULL,
			cleaned_at timestamptz NOT NULL DEFAULT now()
		)`).Error; err != nil {
			return err
		}
		if err := tx.Exec(`INSERT INTO shows_cleanup_backup (id, category_id, snapshot)
			SELECT s.id, s.category_id, to_jsonb(s) FROM shows s
			WHERE s.category_id = ? AND (`+unmanagedShowsSQL+`)
			ON CONFLICT (id) DO NOTHING`, categoryID).Error; err != nil {
			return err
		}
		res := tx.Where("category_id = ? AND ("+unmanagedShowsSQL+")", categoryID).Delete(&model.Show{})
		if res.Error != nil {
			return res.Error
		}
		cleaned = res.RowsAffected
		return nil
	})
	return cleaned, err
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
