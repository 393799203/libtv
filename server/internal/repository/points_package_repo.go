package repository

import (
	"context"

	"libtv/internal/model"

	"gorm.io/gorm"
)

// PointsPackageRepo 积分套餐数据访问
type PointsPackageRepo interface {
	// ListAll 返回全部套餐（按 sort_order、id 升序），运营后台用
	ListAll(ctx context.Context) ([]model.PointsPackage, error)
	// ListEnabled 返回启用中的套餐（按 sort_order、id 升序），积分超市展示用
	ListEnabled(ctx context.Context) ([]model.PointsPackage, error)
	Create(ctx context.Context, pkg *model.PointsPackage) error
	Update(ctx context.Context, pkg *model.PointsPackage) error
	Delete(ctx context.Context, id int64) error
	Count(ctx context.Context) (int64, error)
}

type pointsPackageRepo struct {
	db *gorm.DB
}

func NewPointsPackageRepo(db *gorm.DB) PointsPackageRepo {
	return &pointsPackageRepo{db: db}
}

func (r *pointsPackageRepo) ListAll(ctx context.Context) ([]model.PointsPackage, error) {
	var packages []model.PointsPackage
	err := r.db.WithContext(ctx).Order("sort_order ASC, id ASC").Find(&packages).Error
	return packages, err
}

func (r *pointsPackageRepo) ListEnabled(ctx context.Context) ([]model.PointsPackage, error) {
	var packages []model.PointsPackage
	err := r.db.WithContext(ctx).Where("enabled = ?", true).Order("sort_order ASC, id ASC").Find(&packages).Error
	return packages, err
}

func (r *pointsPackageRepo) Create(ctx context.Context, pkg *model.PointsPackage) error {
	return r.db.WithContext(ctx).Create(pkg).Error
}

func (r *pointsPackageRepo) Update(ctx context.Context, pkg *model.PointsPackage) error {
	return r.db.WithContext(ctx).Save(pkg).Error
}

func (r *pointsPackageRepo) Delete(ctx context.Context, id int64) error {
	return r.db.WithContext(ctx).Delete(&model.PointsPackage{}, id).Error
}

func (r *pointsPackageRepo) Count(ctx context.Context) (int64, error) {
	var count int64
	err := r.db.WithContext(ctx).Model(&model.PointsPackage{}).Count(&count).Error
	return count, err
}
