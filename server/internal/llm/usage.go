package llm

import (
	"context"
	"encoding/json"
	"sort"
	"strings"
	"sync"
)

// ========== 上游用量采集 ==========
//
// 目的：把「上游这次调用实际消耗了多少」记进对账表（provider_tasks）。
//
// 为什么做成 ctx 上的采集器，而不是改各函数的返回值：
// 上游用量出现在**响应体**里，而我们各条调用路径的返回值五花八门
// （视频返回 URL、文本返回字符串、图片返回列表），把它们全部改签名去带回用量，
// 改动面大且容易漏；采集器挂在 ctx 上，谁拿到响应谁登记，执行器结算时统一取一次。
//
// 采集规则（宁可空着，也不要假数）：
//   - 上游报了 total_tokens → 记 tokens
//   - 上游报的是别的口径（DashScope 的 video_duration 等）→ 原文快照进 usage，
//     **不**换算成 tokens：换算系数是我们猜的，猜出来的「真实消耗」比空着更有害
//   - 上游什么都没报 → 留 0，对账页显示「-」

// UsageRecorder 一次调用链上的用量累加器（并发安全：轮询与调用可能并发登记）
type UsageRecorder struct {
	mu         sync.Mutex
	total      int64
	completion int64
	raw        string
	calls      int
}

// Add 登记一次上游调用的用量。total/completion 为 0 时只记原文快照。
func (u *UsageRecorder) Add(total, completion int64, raw string) {
	if u == nil {
		return
	}
	u.mu.Lock()
	defer u.mu.Unlock()
	u.total += total
	u.completion += completion
	u.calls++
	if raw != "" {
		u.raw = raw
	}
}

// Snapshot 取当前累计值（total, completion, rawUsage, 调用次数）
func (u *UsageRecorder) Snapshot() (int64, int64, string, int) {
	if u == nil {
		return 0, 0, "", 0
	}
	u.mu.Lock()
	defer u.mu.Unlock()
	return u.total, u.completion, u.raw, u.calls
}

type usageRecorderKey struct{}

// WithUsageRecorder 在执行器调用上游之前挂上采集器
func WithUsageRecorder(ctx context.Context) context.Context {
	return context.WithValue(ctx, usageRecorderKey{}, &UsageRecorder{})
}

// UsageFrom 取本次调用链的采集器（可能为 nil：老路径或未挂）
func UsageFrom(ctx context.Context) *UsageRecorder {
	if r, ok := ctx.Value(usageRecorderKey{}).(*UsageRecorder); ok {
		return r
	}
	return nil
}

// RecordUsage 登记一次上游用量（没有采集器时静默忽略，绝不因为「记不了账」影响出片）。
// rawUsage 传上游 usage 对象里除 token 之外的字段快照，便于人工核对口径。
func RecordUsage(ctx context.Context, total, completion int64, rawUsage string) {
	UsageFrom(ctx).Add(total, completion, rawUsage)
}

// upstreamUsage 上游响应里 usage 的通用形状（火山 / new-api 系）
type upstreamUsage struct {
	TotalTokens      int64 `json:"total_tokens"`
	CompletionTokens int64 `json:"completion_tokens"`
	PromptTokens     int64 `json:"prompt_tokens"`
}

// recordUpstreamUsage 从响应体的 usage 字段登记用量。
//
// 兼容两种形状：
//   - {"usage":{"total_tokens":90814,"completion_tokens":90814}}  ← 火山 seedance / 天翼网关
//   - {"usage":{"video_duration":9,"video_count":1}}              ← DashScope（无 token 口径）
//
// 第二种不带 total_tokens 时，把 usage 原文（截断）记进 rawUsage，供对账页人工核对。
func recordUpstreamUsage(ctx context.Context, raw json.RawMessage) {
	if len(raw) == 0 {
		return
	}
	var u upstreamUsage
	if err := json.Unmarshal(raw, &u); err == nil && u.TotalTokens > 0 {
		RecordUsage(ctx, u.TotalTokens, u.CompletionTokens, "")
		return
	}
	// 没有 token 口径：保留字段摘要（不是完整 JSON —— 列宽 255，且只要能看出计费口径）
	var m map[string]interface{}
	if err := json.Unmarshal(raw, &m); err != nil || len(m) == 0 {
		return
	}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, k+"="+formatUsageValue(m[k]))
	}
	RecordUsage(ctx, 0, 0, strings.Join(parts, " "))
}

func formatUsageValue(v interface{}) string {
	switch n := v.(type) {
	case float64:
		// 上游的时长/计数都是整数语义，避免输出 9.000000
		if n == float64(int64(n)) {
			return strconvItoa(int64(n))
		}
		return strings.TrimRight(strings.TrimRight(formatFloat(n), "0"), ".")
	case string:
		return n
	default:
		b, _ := json.Marshal(v)
		return truncateUsage(string(b))
	}
}

func strconvItoa(n int64) string {
	b, _ := json.Marshal(n)
	return string(b)
}

func formatFloat(f float64) string {
	b, _ := json.Marshal(f)
	return string(b)
}

func truncateUsage(s string) string {
	const max = 60
	if len(s) <= max {
		return s
	}
	return s[:max] + "…"
}
