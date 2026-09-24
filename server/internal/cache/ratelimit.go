package cache

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

// ErrUnavailable Redis 未启用/未连接：调用方应降级到原有逻辑
var ErrUnavailable = errors.New("redis 不可用")

// ==================== 限流（每用户生成频率）====================
//
// 固定窗口计数：INCR 首次写入时设过期。窗口按自然分钟切分，
// 实现简单、无内存膨胀，对"防狂点"这类场景足够。
// Lua 保证 INCR+EXPIRE 原子，避免极端情况下 key 永不过期。

var rateScript = redis.NewScript(`
local c = redis.call('INCR', KEYS[1])
if c == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return c
`)

// AllowRate 判断用户本分钟内的生成次数是否超限。
// 返回：是否放行、本窗口已用次数、错误。
// Redis 不可用或脚本报错时**放行**（限流属增强能力，不应阻断生成主流程）。
func AllowRate(ctx context.Context, userID string, perMinute int) (bool, int, error) {
	if client == nil {
		return true, 0, ErrUnavailable
	}
	if perMinute <= 0 {
		return true, 0, nil
	}
	window := time.Now().Unix() / 60
	key := fmt.Sprintf("rl:gen:%s:%d", userID, window)
	n, err := rateScript.Run(ctx, client, []string{key}, 120).Int()
	if err != nil {
		return true, 0, err
	}
	return n <= perMinute, n, nil
}

// RateKeyTTL 返回限流窗口残留时间（供测试/观测）
func RateWindowSeconds() int { return 60 }

// ==================== 并发闸门（全局同时进行的生成数）====================
//
// 用有序集合按时间戳登记进行中的任务：score = 开始时间，member = 任务标识。
// 每次获取前先剔除超过 ttl 的旧条目 —— 这样即使 worker 崩溃来不及释放，
// 计数也会自动滑出，不会永久泄漏（比 INCR/DECR 信号量更健壮）。

var gateScript = redis.NewScript(`
local key = KEYS[1]
local now = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local max = tonumber(ARGV[3])
local id = ARGV[4]
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - ttl)
local n = redis.call('ZCARD', key)
if max > 0 and n >= max then
  return 0
end
redis.call('ZADD', key, now, id)
redis.call('EXPIRE', key, ttl * 2)
return 1
`)

// gateKey 全局闸门 key
const gateKey = "gate:gen:inflight"

// GateAcquire 申请一个并发名额。max<=0 表示不限制（仅登记用于观测）。
// 返回 false 表示已达上限（调用方应排队或拒绝）。Redis 不可用时返回 (true, ErrUnavailable)。
func GateAcquire(ctx context.Context, taskID string, max, ttlSec int) (bool, error) {
	if client == nil {
		return true, ErrUnavailable
	}
	if ttlSec <= 0 {
		ttlSec = 900
	}
	ok, err := gateScript.Run(ctx, client, []string{gateKey},
		time.Now().Unix(), ttlSec, max, taskID).Int()
	if err != nil {
		return true, err
	}
	return ok == 1, nil
}

// GateRelease 释放名额（生成结束/失败后调用，幂等）
func GateRelease(ctx context.Context, taskID string) error {
	if client == nil {
		return ErrUnavailable
	}
	return client.ZRem(ctx, gateKey, taskID).Err()
}

// GateCount 当前进行中的任务数（先按 ttl 清理过期条目）
func GateCount(ctx context.Context, ttlSec int) (int, error) {
	if client == nil {
		return 0, ErrUnavailable
	}
	if ttlSec <= 0 {
		ttlSec = 900
	}
	pipe := client.Pipeline()
	pipe.ZRemRangeByScore(ctx, gateKey, "-inf", fmt.Sprint(time.Now().Unix()-int64(ttlSec)))
	cardCmd := pipe.ZCard(ctx, gateKey)
	if _, err := pipe.Exec(ctx); err != nil {
		return 0, err
	}
	return int(cardCmd.Val()), nil
}

// ==================== 队列深度 ====================

// StreamLen 返回流中待处理条目数（用于入口防堆积）
func StreamLen(ctx context.Context, stream string) (int64, error) {
	if client == nil {
		return 0, ErrUnavailable
	}
	return client.XLen(ctx, stream).Result()
}
