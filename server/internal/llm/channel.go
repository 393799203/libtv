package llm

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"libtv/internal/config"
)

// 渠道常量
const (
	ChannelWasu    = "wasu"    // 华数渠道
	ChannelDianxin = "dianxin" // 电信渠道
)

// 全局渠道策略（后台三档切换）
const (
	// PolicyAllWasu 全部用户走华数渠道
	PolicyAllWasu = "all_wasu"
	// PolicyAllDianxin 全部用户走电信渠道
	PolicyAllDianxin = "all_dianxin"
	// PolicyPerUser 按用户各自渠道（默认）
	PolicyPerUser = "per_user"
)

// SettingsRepo 渠道策略存取接口（由 service 层实现，避免 llm 依赖 repository）
type SettingsRepo interface {
	GetSetting(ctx context.Context, key string) (string, error)
	SetSetting(ctx context.Context, key, value string) error
}

// SettingKeyChannelPolicy 全局渠道策略的 settings key
const SettingKeyChannelPolicy = "channel_policy"

// ChannelPolicyFunc 读取当前全局渠道策略（后台可动态切换；由 service 注入，带缓存）
type ChannelPolicyFunc func(ctx context.Context) (string, error)

// ChannelRouter 渠道路由：根据全局策略 + 用户渠道，解析出最终使用的渠道
type ChannelRouter struct {
	policyFunc ChannelPolicyFunc
	providers  map[string]config.ProviderConfig // 全部渠道的凭据（来自 config.AI.Providers）
	mu         sync.RWMutex
}

// NewChannelRouter 创建渠道路由器
// providers 为 config.AI.Providers（wasu/dianxin 等渠道的 api_key/base_url）
func NewChannelRouter(policyFunc ChannelPolicyFunc, providers map[string]config.ProviderConfig) *ChannelRouter {
	if policyFunc == nil {
		// 默认：按用户渠道（per_user）
		policyFunc = func(ctx context.Context) (string, error) { return PolicyPerUser, nil }
	}
	return &ChannelRouter{
		policyFunc: policyFunc,
		providers:  providers,
	}
}

// SetPolicyFunc 设置/更新策略读取函数（main.go 组装后注入带缓存版本）
func (r *ChannelRouter) SetPolicyFunc(fn ChannelPolicyFunc) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.policyFunc = fn
}

// Resolve 根据全局策略与用户渠道，返回最终实际使用的渠道名
//   - all_wasu    → 一律 wasu
//   - all_dianxin → 一律 dianxin
//   - per_user    → 按用户 channel；用户渠道非法/为空时回退 wasu
func (r *ChannelRouter) Resolve(ctx context.Context, userChannel string) string {
	policy, err := r.getPolicyFunc()(ctx)
	if err != nil {
		log.Printf("[ChannelRouter] 读取渠道策略失败，按 per_user 处理: %v", err)
		policy = PolicyPerUser
	}

	switch policy {
	case PolicyAllWasu:
		return ChannelWasu
	case PolicyAllDianxin:
		return ChannelDianxin
	default: // per_user
		if userChannel == ChannelDianxin {
			return ChannelDianxin
		}
		return ChannelWasu
	}
}

// getPolicyFunc 安全读取策略函数引用（SetPolicyFunc 与 Resolve 并发安全）
func (r *ChannelRouter) getPolicyFunc() ChannelPolicyFunc {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.policyFunc
}

// Provider 返回某渠道的凭据（api_key/base_url）；渠道不存在时返回 false
func (r *ChannelRouter) Provider(channel string) (config.ProviderConfig, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	p, ok := r.providers[channel]
	return p, ok
}

// GetChannelProviders 返回全部渠道凭据（构造客户端用）
func (r *ChannelRouter) GetChannelProviders() map[string]config.ProviderConfig {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make(map[string]config.ProviderConfig, len(r.providers))
	for k, v := range r.providers {
		out[k] = v
	}
	return out
}

// IsChannelAvailable 渠道是否有可用凭据
func (r *ChannelRouter) IsChannelAvailable(channel string) bool {
	_, ok := r.Provider(channel)
	return ok
}

// ChannelKey context 中携带用户渠道的 key
type channelCtxKey struct{}

// WithChannel 把渠道写入 context（供客户端按渠道取凭据）
func WithChannel(ctx context.Context, channel string) context.Context {
	return context.WithValue(ctx, channelCtxKey{}, channel)
}

// ChannelFrom 从 context 读取渠道；为空时回退 wasu
func ChannelFrom(ctx context.Context) string {
	if v, ok := ctx.Value(channelCtxKey{}).(string); ok && v != "" {
		return v
	}
	return ChannelWasu
}

// ---------- 内存缓存版策略读取（避免每次请求都查库） ----------

// CachedPolicyFunc 包装策略读取函数，带 TTL 缓存（后台切换后最多 N 秒生效）
func CachedPolicyFunc(read func(ctx context.Context) (string, error), ttl time.Duration) ChannelPolicyFunc {
	var mu sync.RWMutex
	var cached string
	var cachedAt time.Time

	return func(ctx context.Context) (string, error) {
		mu.RLock()
		if cached != "" && time.Since(cachedAt) < ttl {
			v := cached
			mu.RUnlock()
			return v, nil
		}
		mu.RUnlock()

		v, err := read(ctx)
		if err != nil {
			return "", err
		}
		mu.Lock()
		cached = v
		cachedAt = time.Now()
		mu.Unlock()
		return v, nil
	}
}

// ---------- 辅助 ----------

// ValidatePolicy 校验策略值合法
func ValidatePolicy(policy string) error {
	switch policy {
	case PolicyAllWasu, PolicyAllDianxin, PolicyPerUser:
		return nil
	}
	return fmt.Errorf("非法渠道策略: %s（可选 all_wasu / all_dianxin / per_user）", policy)
}
