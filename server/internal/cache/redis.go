// Package cache 提供 Redis 连接与通用原语（限流、并发闸门、任务队列）。
//
// 设计原则：Redis 是**增强**而非硬依赖。初始化失败或配置关闭时 Available()
// 返回 false，调用方据此降级回原有逻辑（直接起 goroutine、不做限流），
// 保证 Redis 故障不会阻塞生成主流程。
package cache

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"

	"libtv/internal/config"
)

var client *redis.Client

// Init 建立 Redis 连接并 Ping 校验；失败返回 error 供调用方降级处理（不 panic）
func Init(cfg config.RedisConfig) error {
	c := redis.NewClient(&redis.Options{
		Addr:         cfg.Addr(),
		Password:     cfg.Password,
		DB:           cfg.DB,
		DialTimeout:  3 * time.Second,
		ReadTimeout:  3 * time.Second,
		WriteTimeout: 3 * time.Second,
		PoolSize:     20,
		MinIdleConns: 2,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := c.Ping(ctx).Err(); err != nil {
		_ = c.Close()
		return fmt.Errorf("redis 连接失败 (%s): %w", cfg.Addr(), err)
	}

	client = c
	return nil
}

// Client 返回 Redis 客户端；未成功初始化时为 nil
func Client() *redis.Client { return client }

// Available 报告 Redis 是否可用（调用方据此决定是否降级）
func Available() bool { return client != nil }

// Close 关闭连接（进程退出时调用）
func Close() error {
	if client == nil {
		return nil
	}
	err := client.Close()
	client = nil
	return err
}
