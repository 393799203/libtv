package repository

import (
	"context"
	"time"

	"libtv/internal/model"

	"gorm.io/gorm"
)

// BillingFilter 费用明细查询条件（空值/零值表示不过滤）
type BillingFilter struct {
	Type      string    // 账单类型：deduct / refund / recharge
	Scene     string    // 场景（模糊匹配）
	ModelID   string    // 模型（模糊匹配）
	StartTime time.Time // 时间范围起（含）
	EndTime   time.Time // 时间范围止（含）
}

// BillingRepo 积分账单数据访问
type BillingRepo interface {
	Create(ctx context.Context, record *model.BillingRecord) error
	// ListByUser 分页 + 条件筛选返回用户账单（按时间倒序），返回当页记录与总数
	ListByUser(ctx context.Context, userID string, filter BillingFilter, page, pageSize int) ([]model.BillingRecord, int64, error)
}

type billingRepo struct {
	db *gorm.DB
}

func NewBillingRepo(db *gorm.DB) BillingRepo {
	return &billingRepo{db: db}
}

func (r *billingRepo) Create(ctx context.Context, record *model.BillingRecord) error {
	return r.db.WithContext(ctx).Create(record).Error
}

func (r *billingRepo) ListByUser(ctx context.Context, userID string, filter BillingFilter, page, pageSize int) ([]model.BillingRecord, int64, error) {
	if page <= 0 {
		page = 1
	}
	if pageSize <= 0 || pageSize > 100 {
		pageSize = 10
	}

	query := r.db.WithContext(ctx).Model(&model.BillingRecord{}).Where("user_id = ?", userID)
	if filter.Type != "" {
		query = query.Where("type = ?", filter.Type)
	}
	if filter.Scene != "" {
		query = query.Where("scene LIKE ?", "%"+filter.Scene+"%")
	}
	if filter.ModelID != "" {
		query = query.Where("model LIKE ?", "%"+filter.ModelID+"%")
	}
	if !filter.StartTime.IsZero() {
		query = query.Where("created_at >= ?", filter.StartTime)
	}
	if !filter.EndTime.IsZero() {
		query = query.Where("created_at <= ?", filter.EndTime)
	}

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var records []model.BillingRecord
	err := query.Order("id DESC").
		Offset((page - 1) * pageSize).
		Limit(pageSize).
		Find(&records).Error
	if err != nil {
		return nil, 0, err
	}
	return records, total, nil
}
