package repository

import (
	"context"
	"time"

	"libtv/internal/model"

	"gorm.io/gorm"
)

// PasswordResetRepo 找回密码令牌的数据访问
type PasswordResetRepo interface {
	// Create 写入一枚新令牌（存的是哈希，不是明文）
	Create(ctx context.Context, token *model.PasswordResetToken) error
	// DeleteByUserID 删除该用户的全部令牌：签发新令牌前调用，
	// 使「同一个账号反复点忘记密码」时只有最新一封邮件的链接有效
	DeleteByUserID(ctx context.Context, userID string) error
	// FindValidByHash 按令牌哈希查「尚未使用且未过期」的记录，查不到返回 gorm.ErrRecordNotFound
	FindValidByHash(ctx context.Context, tokenHash string) (*model.PasswordResetToken, error)
	// Consume 原子地把令牌标记为已用，返回是否成功抢占。
	// false 表示该令牌已被别的请求用过（或已不存在）—— 并发下同一个链接
	// 只允许改密一次，靠 UPDATE ... WHERE used_at IS NULL 的条件更新保证
	Consume(ctx context.Context, id string) (bool, error)
	// DeleteExpired 清理过期记录（签发新令牌时顺带调用，避免表无限增长）
	DeleteExpired(ctx context.Context) error
}

type passwordResetRepo struct {
	db *gorm.DB
}

func NewPasswordResetRepo(db *gorm.DB) PasswordResetRepo {
	return &passwordResetRepo{db: db}
}

func (r *passwordResetRepo) Create(ctx context.Context, token *model.PasswordResetToken) error {
	return r.db.WithContext(ctx).Create(token).Error
}

func (r *passwordResetRepo) DeleteByUserID(ctx context.Context, userID string) error {
	return r.db.WithContext(ctx).Where("user_id = ?", userID).
		Delete(&model.PasswordResetToken{}).Error
}

func (r *passwordResetRepo) FindValidByHash(ctx context.Context, tokenHash string) (*model.PasswordResetToken, error) {
	var token model.PasswordResetToken
	// 只认「没用过 + 没到期」的令牌：过期判断放在 SQL 里，避免上层漏判
	err := r.db.WithContext(ctx).
		Where("token_hash = ? AND used_at IS NULL AND expires_at > ?", tokenHash, time.Now()).
		First(&token).Error
	if err != nil {
		return nil, err
	}
	return &token, nil
}

func (r *passwordResetRepo) Consume(ctx context.Context, id string) (bool, error) {
	// used_at IS NULL 是抢占条件：并发请求里只有一个能把行更新掉，
	// 其余的影响行数为 0，从而拿不到改密资格
	res := r.db.WithContext(ctx).Model(&model.PasswordResetToken{}).
		Where("id = ? AND used_at IS NULL", id).
		Update("used_at", time.Now())
	if res.Error != nil {
		return false, res.Error
	}
	return res.RowsAffected > 0, nil
}

func (r *passwordResetRepo) DeleteExpired(ctx context.Context) error {
	return r.db.WithContext(ctx).
		Where("expires_at < ?", time.Now()).
		Delete(&model.PasswordResetToken{}).Error
}
