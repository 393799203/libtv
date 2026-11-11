package repository

import (
	"context"
	"time"

	"libtv/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type AuthRepo interface {
	CreateSession(context.Context, *model.AuthSession) error
	FindSession(context.Context, string) (*model.AuthSession, error)
	FindRefreshSession(context.Context, string) (*model.AuthSession, error)
	RevokeSession(context.Context, string) error
	SaveCode(context.Context, *model.RegistrationCode) (bool, error)
	DeleteCode(context.Context, string, string) error
	ConsumeCode(context.Context, string, string) (bool, error)
	AllowAttempt(context.Context, string, int, time.Duration) (bool, error)
	DeleteExpired(context.Context) error
}

type authRepo struct{ db *gorm.DB }

func NewAuthRepo(db *gorm.DB) AuthRepo { return &authRepo{db: db} }

func (r *authRepo) CreateSession(ctx context.Context, session *model.AuthSession) error {
	return r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Serialize logins for one account so simultaneous requests cannot both
		// leave active sessions behind.
		var user model.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Select("id").
			Where("id = ?", session.UserID).First(&user).Error; err != nil {
			return err
		}
		if err := tx.Model(&model.AuthSession{}).Where("user_id = ? AND revoked_at IS NULL", session.UserID).
			Updates(map[string]interface{}{"revoked_at": time.Now(), "revoked_reason": "replaced"}).Error; err != nil {
			return err
		}
		if err := tx.Where("user_id = ? AND expires_at <= ?", session.UserID, time.Now()).
			Delete(&model.AuthSession{}).Error; err != nil {
			return err
		}
		return tx.Create(session).Error
	})
}

func (r *authRepo) FindSession(ctx context.Context, id string) (*model.AuthSession, error) {
	var session model.AuthSession
	err := r.db.WithContext(ctx).Where("id = ? AND revoked_at IS NULL AND expires_at > ?", id, time.Now()).
		First(&session).Error
	return &session, err
}

func (r *authRepo) FindRefreshSession(ctx context.Context, hash string) (*model.AuthSession, error) {
	var session model.AuthSession
	err := r.db.WithContext(ctx).Where("refresh_hash = ? AND expires_at > ?", hash, time.Now()).
		First(&session).Error
	return &session, err
}

func (r *authRepo) RevokeSession(ctx context.Context, id string) error {
	return r.db.WithContext(ctx).Model(&model.AuthSession{}).
		Where("id = ? AND revoked_at IS NULL", id).Update("revoked_at", time.Now()).Error
}

func (r *authRepo) SaveCode(ctx context.Context, code *model.RegistrationCode) (bool, error) {
	// One atomic upsert enforces the resend cooldown across all server instances.
	res := r.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "email"}},
		DoUpdates: clause.AssignmentColumns([]string{"code_hash", "attempts", "expires_at", "created_at"}),
		Where: clause.Where{Exprs: []clause.Expression{
			clause.Lt{Column: clause.Column{Table: "registration_codes", Name: "created_at"}, Value: time.Now().Add(-time.Minute)},
		}},
	}).Create(code)
	return res.RowsAffected == 1, res.Error
}

func (r *authRepo) DeleteCode(ctx context.Context, email, hash string) error {
	return r.db.WithContext(ctx).Where("email = ? AND code_hash = ?", email, hash).Delete(&model.RegistrationCode{}).Error
}

func (r *authRepo) ConsumeCode(ctx context.Context, email, hash string) (bool, error) {
	valid := false
	err := r.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var code model.RegistrationCode
		err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("email = ?", email).First(&code).Error
		if err == gorm.ErrRecordNotFound {
			return nil
		}
		if err != nil {
			return err
		}
		if !code.ExpiresAt.After(time.Now()) || code.Attempts >= 5 {
			return nil
		}
		if code.CodeHash != hash {
			return tx.Model(&code).UpdateColumn("attempts", gorm.Expr("attempts + 1")).Error
		}
		valid = true
		return tx.Delete(&code).Error
	})
	return valid, err
}

func (r *authRepo) AllowAttempt(ctx context.Context, key string, limit int, window time.Duration) (bool, error) {
	now := time.Now()
	// Atomic across replicas, including the first request after a window expires.
	var attempts int
	err := r.db.WithContext(ctx).Raw(`
		INSERT INTO auth_rate_buckets (key, attempts, expires_at) VALUES (?, 1, ?)
		ON CONFLICT (key) DO UPDATE SET
			attempts = CASE WHEN auth_rate_buckets.expires_at <= ? THEN 1 ELSE auth_rate_buckets.attempts + 1 END,
			expires_at = CASE WHEN auth_rate_buckets.expires_at <= ? THEN EXCLUDED.expires_at ELSE auth_rate_buckets.expires_at END
		RETURNING attempts`, key, now.Add(window), now, now).Scan(&attempts).Error
	return err == nil && attempts <= limit, err
}

func (r *authRepo) DeleteExpired(ctx context.Context) error {
	for _, record := range []interface{}{&model.AuthSession{}, &model.RegistrationCode{}, &model.AuthRateBucket{}} {
		if err := r.db.WithContext(ctx).Where("expires_at <= ?", time.Now()).Delete(record).Error; err != nil {
			return err
		}
	}
	return nil
}
