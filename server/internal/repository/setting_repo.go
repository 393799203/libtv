package repository

import (
	"context"

	"libtv/internal/model"

	"gorm.io/gorm"
)

// SettingRepo 系统 KV 配置存取（如渠道策略 channel_policy），后台可动态修改
type SettingRepo interface {
	Get(ctx context.Context, key string) (string, error)
	Set(ctx context.Context, key, value string) error
}

type settingRepo struct {
	db *gorm.DB
}

func NewSettingRepo(db *gorm.DB) SettingRepo {
	return &settingRepo{db: db}
}

// Get 读取配置；key 不存在时返回空串（不报错）
func (r *settingRepo) Get(ctx context.Context, key string) (string, error) {
	var s model.Setting
	err := r.db.WithContext(ctx).First(&s, "key = ?", key).Error
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			return "", nil
		}
		return "", err
	}
	return s.Value, nil
}

// Set 写入配置（upsert，保留 UpdatedAt）
func (r *settingRepo) Set(ctx context.Context, key, value string) error {
	s := model.Setting{Key: key, Value: value}
	return r.db.WithContext(ctx).Save(&s).Error
}