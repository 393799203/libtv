package repository

import (
	"context"

	"libtv/internal/model"

	"gorm.io/gorm"
)

// BillingRepo 积分账单数据访问
type BillingRepo interface {
	Create(ctx context.Context, record *model.BillingRecord) error
	// ListByUser 按时间倒序返回用户最近的账单明细
	ListByUser(ctx context.Context, userID string, limit int) ([]model.BillingRecord, error)
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

func (r *billingRepo) ListByUser(ctx context.Context, userID string, limit int) ([]model.BillingRecord, error) {
	if limit <= 0 || limit > 1000 {
		limit = 200
	}
	var records []model.BillingRecord
	err := r.db.WithContext(ctx).
		Where("user_id = ?", userID).
		Order("id DESC").
		Limit(limit).
		Find(&records).Error
	return records, err
}
