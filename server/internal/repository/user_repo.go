package repository

import (
	"context"

	"libtv/internal/model"

	"gorm.io/gorm"
)

// UserRepo 用户数据访问
type UserRepo interface {
	Create(ctx context.Context, user *model.User) error
	FindByEmail(ctx context.Context, email string) (*model.User, error)
	FindByID(ctx context.Context, id string) (*model.User, error)
	List(ctx context.Context, keyword string) ([]model.User, error)
	UpdateRole(ctx context.Context, id, role string) error
	// UpdateProfile 更新用户昵称/头像（零值字段不更新）
	UpdateProfile(ctx context.Context, id string, fields map[string]interface{}) error
	// UpdatePasswordHash 更新密码哈希并将密码版本号 +1（使旧 JWT 全部失效）
	UpdatePasswordHash(ctx context.Context, id, passwordHash string) error
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
