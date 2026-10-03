// Package idem 给「前端直连的 AI 调用」做请求幂等。
//
// 为什么需要它：提示词生成、AI 建白模这两个接口是同步接口，用户在弹窗里点一次
// 就是一次真实 AI 调用（真扣费）。双击、前端超时后重试、网络重发都会变成两次调用、
// 两笔扣费，而服务端在此之前没有任何办法识别「这是同一次点击」——
// 走队列的节点生成有 ListActiveByProject 这类防重，直连接口没有对应物。
//
// 幂等键用**请求内容的自然身份**（提示词 = 镜头 + 模型 + 份数；白模 = 参考图 + 模型），
// 而不是客户端生成的 requestId：客户端每次点击都会生成新 id，反而挡不住双击；
// 内容指纹天然把「同一个动作」归到一起，才真正防重。
//
// 三个状态：
//
//	Free     —— 认领成功，正常往下走（调用上游 + 扣费）
//	Done     —— 这个请求刚刚成功过，直接回放上次的结果，不再调用上游、不再扣费
//	InFlight —— 同一个请求正在处理中（双击/重发），直接拒绝，同样不扣费
//
// Redis 不可用时一律当作 Free：宁可少一层保护，也不能让 Redis 抖动把生成功能拖垮。
package idem

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log"
	"sync"
	"time"

	"libtv/internal/cache"

	"github.com/redis/go-redis/v9"
)

type State int

const (
	Free State = iota
	Done
	InFlight
)

// Store 幂等存储（Redis 支撑，多实例安全）
type Store struct {
	rdb    *redis.Client
	prefix string
	// warned 只在第一次「没有 Redis 可用」时提醒一次，避免每次请求刷日志
	warned sync.Once
}

func New(rdb *redis.Client, prefix string) *Store {
	if prefix == "" {
		prefix = "idem:"
	}
	return &Store{rdb: rdb, prefix: prefix}
}

// client 取 Redis 客户端：构造时传了就用它，没传（或构造早于 cache.Init）则延迟到用时再取。
//
// 为什么必须延迟取：main.go 里 cache.Init 在建 handler 之后才执行，构造时抓到的是 nil，
// 结果是「幂等静默失效」—— 双击照样扣两次费，而且一点日志都没有（真实踩过）。
func (s *Store) client() *redis.Client {
	if s.rdb != nil {
		return s.rdb
	}
	if c := cache.Client(); c != nil {
		s.rdb = c // 拿到就记住，后续请求不再查
		return c
	}
	s.warned.Do(func() {
		log.Printf("[Idem] ⚠️ Redis 不可用，请求幂等（防双击/防重复扣费）当前处于关闭状态")
	})
	return nil
}

type record struct {
	State  string          `json:"s"` // inflight / done
	Result json.RawMessage `json:"r,omitempty"`
}

// Fingerprint 用「这次调用的自然身份」算幂等键（对 map 的 key 排序后哈希，稳定）
func Fingerprint(parts ...string) string {
	h := sha256.New()
	for _, p := range parts {
		h.Write([]byte(p))
		h.Write([]byte{0})
	}
	return hex.EncodeToString(h.Sum(nil))[:32]
}

// Begin 认领一次请求。
//   - Done：返回上次成功的结果（result 为该请求的响应 JSON），调用方直接回放，不要再扣费
//   - InFlight：同一请求正在跑，调用方应直接告诉用户「正在处理中」
//   - Free：认领成功，继续往下走（调用上游 + 扣费）
func (s *Store) Begin(ctx context.Context, key string, ttl time.Duration) (State, json.RawMessage, error) {
	rdb := s.client()
	if rdb == nil {
		return Free, nil, nil
	}
	full := s.prefix + key
	payload, err := json.Marshal(record{State: "inflight"})
	if err != nil {
		return Free, nil, err
	}
	// SET NX 一步完成「检查 + 认领」：并发双击只有一个能认领成功
	ok, err := rdb.SetNX(ctx, full, payload, ttl).Result()
	if err != nil {
		log.Printf("[Idem] ⚠️ 幂等检查失败（按未重复处理）: key=%s err=%v", key, err)
		return Free, nil, err
	}
	if ok {
		return Free, nil, nil
	}
	raw, err := rdb.Get(ctx, full).Result()
	if err != nil {
		// 认领失败但读不到内容：可能是刚好过期，按未重复处理（宁可重复也不阻塞用户）
		return Free, nil, err
	}
	var rec record
	if err := json.Unmarshal([]byte(raw), &rec); err != nil {
		return Free, nil, err
	}
	if rec.State == "done" && len(rec.Result) > 0 {
		return Done, rec.Result, nil
	}
	return InFlight, nil, nil
}

// Finish 成功：把结果存下来，窗口内同一个请求再来就直接回放（不再扣费）
func (s *Store) Finish(ctx context.Context, key string, result interface{}, ttl time.Duration) {
	rdb := s.client()
	if rdb == nil {
		return
	}
	body, err := json.Marshal(result)
	if err != nil {
		return
	}
	payload, err := json.Marshal(record{State: "done", Result: body})
	if err != nil {
		return
	}
	if err := rdb.Set(ctx, s.prefix+key, payload, ttl).Err(); err != nil {
		log.Printf("[Idem] ⚠️ 幂等结果落库失败: key=%s err=%v", key, err)
	}
}

// Release 失败：撤掉认领，让用户真正重试时能重新走一遍（否则会一直显示「处理中」）
func (s *Store) Release(ctx context.Context, key string) {
	rdb := s.client()
	if rdb == nil {
		return
	}
	if err := rdb.Del(ctx, s.prefix+key).Err(); err != nil {
		log.Printf("[Idem] ⚠️ 幂等认领释放失败: key=%s err=%v", key, err)
	}
}

// SetClient 注入 Redis 客户端（cache.Init 之后调用）。
// 有了延迟获取其实不调也行，但显式注入让「什么时候生效」一目了然，也方便测试。
func (s *Store) SetClient(rdb *redis.Client) {
	if s != nil && rdb != nil {
		s.rdb = rdb
	}
}
