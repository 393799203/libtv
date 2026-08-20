package service

import (
	"context"
	"net/http"
	"strings"

	"libtv/internal/model"
	"libtv/internal/pkg/apperror"
	"libtv/internal/repository"
)

// ErrInvalidPointsPackage 套餐参数非法（HTTP 400）
var ErrInvalidPointsPackage = apperror.New(400, http.StatusBadRequest, "套餐参数非法：名称必填，售价与积分必须大于 0")

// PointsPackageService 积分套餐服务（积分超市卡片，运营后台「套餐管理」维护）
type PointsPackageService struct {
	repo repository.PointsPackageRepo
}

func NewPointsPackageService(repo repository.PointsPackageRepo) *PointsPackageService {
	return &PointsPackageService{repo: repo}
}

// ListPublic 积分超市展示：仅启用中的套餐
func (s *PointsPackageService) ListPublic(ctx context.Context) ([]model.PointsPackage, error) {
	return s.repo.ListEnabled(ctx)
}

// ListAll 运营后台列表：全部套餐
func (s *PointsPackageService) ListAll(ctx context.Context) ([]model.PointsPackage, error) {
	return s.repo.ListAll(ctx)
}

// Create 新建套餐
func (s *PointsPackageService) Create(ctx context.Context, pkg *model.PointsPackage) error {
	if err := validatePointsPackage(pkg); err != nil {
		return err
	}
	pkg.ID = 0
	pkg.Name = strings.TrimSpace(pkg.Name)
	pkg.Badge = strings.TrimSpace(pkg.Badge)
	return s.repo.Create(ctx, pkg)
}

// Update 更新套餐（整体覆盖）
func (s *PointsPackageService) Update(ctx context.Context, pkg *model.PointsPackage) error {
	if pkg.ID <= 0 {
		return ErrInvalidPointsPackage
	}
	if err := validatePointsPackage(pkg); err != nil {
		return err
	}
	pkg.Name = strings.TrimSpace(pkg.Name)
	pkg.Badge = strings.TrimSpace(pkg.Badge)
	return s.repo.Update(ctx, pkg)
}

// Delete 删除套餐
func (s *PointsPackageService) Delete(ctx context.Context, id int64) error {
	if id <= 0 {
		return ErrInvalidPointsPackage
	}
	return s.repo.Delete(ctx, id)
}

// SeedDefaults 表为空时写入默认套餐（首次部署兜底，之后以后台维护为准）
func (s *PointsPackageService) SeedDefaults(ctx context.Context) error {
	count, err := s.repo.Count(ctx)
	if err != nil {
		return err
	}
	if count > 0 {
		return nil
	}
	defaults := []model.PointsPackage{
		{
			Name:   "尝鲜包",
			Price:  99,
			Points: 10000,
			Features: strings.Join([]string{
				"约 101 积分 / 元",
				"轻量体验全部功能",
				"适合新手入门试用",
				"积分永久有效",
			}, "\n"),
			SortOrder: 0,
			Enabled:   true,
		},
		{
			Name:        "创作者包",
			Price:       699,
			Points:      73500,
			Badge:       "最受欢迎",
			Recommended: true,
			Features: strings.Join([]string{
				"约 105 积分 / 元，多送 5%",
				"满足日常高频创作",
				"图片 / 视频 / 音频全覆盖",
				"积分永久有效",
			}, "\n"),
			SortOrder: 1,
			Enabled:   true,
		},
		{
			Name:   "旗舰包",
			Price:  1399,
			Points: 150000,
			Badge:  "超值之选",
			Features: strings.Join([]string{
				"约 107 积分 / 元，加量不加价",
				"团队级大用量首选",
				"长视频项目无忧创作",
				"积分永久有效",
			}, "\n"),
			SortOrder: 2,
			Enabled:   true,
		},
	}
	for i := range defaults {
		if err := s.repo.Create(ctx, &defaults[i]); err != nil {
			return err
		}
	}
	return nil
}

func validatePointsPackage(pkg *model.PointsPackage) error {
	if strings.TrimSpace(pkg.Name) == "" || pkg.Price <= 0 || pkg.Points <= 0 {
		return ErrInvalidPointsPackage
	}
	return nil
}
