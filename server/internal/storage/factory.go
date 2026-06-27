package storage

import (
	"fmt"
	"log"
	"time"

	"libtv/internal/config"
)

// Factory 存储工厂函数类型
// 接收 config.StorageConfig 与 publicDir（环境相关的 public 目录路径），
// 返回一个已初始化的 Storage 实例
type Factory func(cfg config.StorageConfig, publicDir string) (Storage, error)

var registry = map[string]Factory{}

// Register 注册存储工厂（由各 storage 实现的 init() 调用）
func Register(name string, f Factory) {
	registry[name] = f
}

// Create 根据配置类型创建 Storage；未指定时默认 local
func Create(cfg config.StorageConfig, publicDir string) (Storage, error) {
	name := cfg.Type
	if name == "" {
		name = "local"
	}
	f, ok := registry[name]
	if !ok {
		return nil, fmt.Errorf("unknown storage type: %s", name)
	}
	s, err := f(cfg, publicDir)
	if err != nil {
		return nil, fmt.Errorf("create storage %s: %w", name, err)
	}
	log.Printf("✅ 存储初始化成功: type=%s", name)
	return s, nil
}

// parseCheckInterval 解析 minio check_interval 字符串，0/失败时返回默认值
func parseCheckInterval(s string) time.Duration {
	d, err := time.ParseDuration(s)
	if err != nil || d == 0 {
		return 30 * time.Second
	}
	return d
}
