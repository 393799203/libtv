package repository

import (
	"context"

	"libtv/internal/model"

	"gorm.io/gorm"
)

// UserStats 单个用户的聚合统计（项目数 + 分类型资产数）
type UserStats struct {
	ProjectCount    int64
	AssetImageCount int64
	AssetVideoCount int64
}

// UserRepo 用户数据访问
type UserRepo interface {
	Create(ctx context.Context, user *model.User) error
	FindByEmail(ctx context.Context, email string) (*model.User, error)
	FindByID(ctx context.Context, id string) (*model.User, error)
	List(ctx context.Context, keyword string) ([]model.User, error)
	// StatsByUserIDs 批量统计指定用户的项目数与分类型资产数（管理员列表展示用）
	StatsByUserIDs(ctx context.Context, userIDs []string) (map[string]UserStats, error)
	UpdateRole(ctx context.Context, id, role string) error
	// UpdateProfile 更新用户昵称/头像（零值字段不更新）
	UpdateProfile(ctx context.Context, id string, fields map[string]interface{}) error
	// UpdatePasswordHash 更新密码哈希并将密码版本号 +1（使旧 JWT 全部失效）
	UpdatePasswordHash(ctx context.Context, id, passwordHash string) error
	// GetCredits 查询用户剩余积分
	GetCredits(ctx context.Context, userID string) (int64, error)
	// DeductCredits 条件原子扣减积分（仅当 credits >= amount 时扣减），
	// 返回是否扣减成功（false = 积分不足），避免并发下扣成负数
	DeductCredits(ctx context.Context, userID string, amount int64) (bool, error)
	// AddCredits 增加积分（退款 / 充值）
	AddCredits(ctx context.Context, userID string, amount int64) error
	// CascadeDelete 级联删除用户及其关联数据（项目/画布/工作流执行/AI任务/风格收藏）
	// 在一个事务内完成
	CascadeDelete(ctx context.Context, userID string) error
}

type userRepo struct {
	db *gorm.DB
}

func NewUserRepo(db *gorm.DB) UserRepo {
	return &userRepo{db: db}
}

func (r *userRepo) Create(ctx context.Context, user *model.User) error {
	return r.db.WithContext(ctx).Create(user).Error
}

func (r *userRepo) FindByEmail(ctx context.Context, email string) (*model.User, error) {
	var user model.User
	if err := r.db.WithContext(ctx).Where("email = ?", email).First(&user).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *userRepo) FindByID(ctx context.Context, id string) (*model.User, error) {
	var user model.User
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&user).Error; err != nil {
		return nil, err
	}
	return &user, nil
}

func (r *userRepo) List(ctx context.Context, keyword string) ([]model.User, error) {
	var users []model.User
	q := r.db.WithContext(ctx).Order("created_at DESC")
	if keyword != "" {
		q = q.Where("nickname LIKE ? OR email LIKE ?", "%"+keyword+"%", "%"+keyword+"%")
	}
	err := q.Find(&users).Error
	return users, err
}

// StatsByUserIDs 批量统计：两条 GROUP BY 查询，避免逐用户查询的 N+1 问题
func (r *userRepo) StatsByUserIDs(ctx context.Context, userIDs []string) (map[string]UserStats, error) {
	stats := make(map[string]UserStats, len(userIDs))
	if len(userIDs) == 0 {
		return stats, nil
	}

	// 项目数
	var projectRows []struct {
		UserID string
		Count  int64
	}
	if err := r.db.WithContext(ctx).Model(&model.Project{}).
		Select("user_id, COUNT(*) AS count").
		Where("user_id IN ?", userIDs).
		Group("user_id").
		Scan(&projectRows).Error; err != nil {
		return nil, err
	}
	for _, row := range projectRows {
		s := stats[row.UserID]
		s.ProjectCount = row.Count
		stats[row.UserID] = s
	}

	// 资产数（按类型分组：image / video）
	var assetRows []struct {
		UserID string
		Type   string
		Count  int64
	}
	if err := r.db.WithContext(ctx).Model(&model.UserAsset{}).
		Select("user_id, type, COUNT(*) AS count").
		Where("user_id IN ?", userIDs).
		Group("user_id, type").
		Scan(&assetRows).Error; err != nil {
		return nil, err
	}
	for _, row := range assetRows {
		s := stats[row.UserID]
		if row.Type == "image" {
			s.AssetImageCount = row.Count
		} else if row.Type == "video" {
			s.AssetVideoCount = row.Count
		}
		stats[row.UserID] = s
	}

	return stats, nil
}

func (r *userRepo) UpdateRole(ctx context.Context, id, role string) error {
	return r.db.WithContext(ctx).Model(&model.User{}).Where("id = ?", id).Update("role", role).Error
}

func (r *userRepo) UpdateProfile(ctx context.Context, id string, fields map[string]interface{}) error {
	return r.db.WithContext(ctx).Model(&model.User{}).Where("id = ?", id).Updates(fields).Error
}

func (r *userRepo) UpdatePasswordHash(ctx context.Context, id, passwordHash string) error {
	return r.db.WithContext(ctx).Model(&model.User{}).Where("id = ?", id).Updates(map[string]interface{}{
		"password_hash":    passwordHash,
		"password_version": gorm.Expr("password_version + 1"),
	}).Error
}

func (r *userRepo) GetCredits(ctx context.Context, userID string) (int64, error) {
	var user model.User
	if err := r.db.WithContext(ctx).Select("credits").Where("id = ?", userID).First(&user).Error; err != nil {
		return 0, err
	}
	return user.Credits, nil
}

// DeductCredits 条件更新：WHERE credits >= amount 保证不会扣成负数，
// RowsAffected == 0 即积分不足（或用户不存在）
func (r *userRepo) DeductCredits(ctx context.Context, userID string, amount int64) (bool, error) {
	res := r.db.WithContext(ctx).Model(&model.User{}).
		Where("id = ? AND credits >= ?", userID, amount).
		UpdateColumn("credits", gorm.Expr("credits - ?", amount))
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected > 0, nil
}

func (r *userRepo) AddCredits(ctx context.Context, userID string, amount int64) error {
	return r.db.WithContext(ctx).Model(&model.User{}).
		Where("id = ?", userID).
		UpdateColumn("credits", gorm.Expr("credits + ?", amount)).Error
}

// CascadeDelete 在一个事务内级联删除用户关联数据
// 删除顺序遵循外键依赖：
//  1. ai_tasks（依赖 workflow_executions.execution_id）
//  2. workflow_executions（依赖 projects.id）
//  3. canvases（依赖 projects.id）
//  4. projects（依赖 users.id）
//  5. style_favorites（依赖 users.id）
//  6. user
func (r *userRepo) CascadeDelete(ctx context.Context, userID string) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// 1. 查出该用户的所有 project ID
		var projectIDs []string
		if err := tx.Model(&model.Project{}).Where("user_id = ?", userID).Pluck("id", &projectIDs).Error; err != nil {
			return err
		}

		if len(projectIDs) > 0 {
			// 2. 删除 ai_tasks（通过 workflow_executions 的 execution_id）
			var execIDs []int64
			if err := tx.Model(&model.WorkflowExecution{}).Where("project_id IN ?", projectIDs).Pluck("id", &execIDs).Error; err != nil {
				return err
			}
			if len(execIDs) > 0 {
				if err := tx.Where("execution_id IN ?", execIDs).Delete(&model.AITask{}).Error; err != nil {
					return err
				}
			}
			// 3. 删除 workflow_executions
			if err := tx.Where("project_id IN ?", projectIDs).Delete(&model.WorkflowExecution{}).Error; err != nil {
				return err
			}
			// 4. 删除 canvases
			if err := tx.Where("project_id IN ?", projectIDs).Delete(&model.Canvas{}).Error; err != nil {
				return err
			}
		}
		// 5. 删除 projects
		if err := tx.Where("user_id = ?", userID).Delete(&model.Project{}).Error; err != nil {
			return err
		}
		// 6. 删除 style_favorites
		if err := tx.Where("user_id = ?", userID).Delete(&model.StyleFavorite{}).Error; err != nil {
			return err
		}
		// 6.5 删除 user_assets（个人资产库记录；文件已随 users/<userID>/ 目录一并清理）
		if err := tx.Where("user_id = ?", userID).Delete(&model.UserAsset{}).Error; err != nil {
			return err
		}
		// 7. 删除 user
		return tx.Delete(&model.User{}, "id = ?", userID).Error
	})
}
