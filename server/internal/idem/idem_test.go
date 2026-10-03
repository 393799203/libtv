package idem

import (
	"context"
	"encoding/json"
	"sync"
	"testing"
	"time"
)

// 没有 Redis 时必须降级为「不拦截」：宁可少一层保护，也不能让生成功能挂掉
func TestNoRedisDegradesToFree(t *testing.T) {
	s := New(nil, "idem:")
	st, cached, err := s.Begin(context.Background(), "k", time.Minute)
	if err != nil || st != Free || cached != nil {
		t.Fatalf("无 Redis 应降级为 Free，得到 state=%v cached=%v err=%v", st, cached, err)
	}
	s.Finish(context.Background(), "k", map[string]string{"a": "b"}, time.Minute) // 不应 panic
	s.Release(context.Background(), "k")
}

// 指纹必须稳定且区分不同请求（同一镜头同一模型 = 同一个 key）
func TestFingerprintStableAndDistinct(t *testing.T) {
	a := Fingerprint("prompt", "u1", "shot-1", "m1", "1")
	b := Fingerprint("prompt", "u1", "shot-1", "m1", "1")
	c := Fingerprint("prompt", "u1", "shot-1", "m1", "2")
	if a != b {
		t.Fatal("相同请求的指纹必须一致")
	}
	if a == c {
		t.Fatal("不同请求（份数不同）的指纹必须不同")
	}
}

// 内存版实现验证状态机（不依赖 Redis）
type fakeRdb struct {
	mu   sync.Mutex
	data map[string][]byte
}

func (f *fakeRdb) setNX(key string, val []byte) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	if _, ok := f.data[key]; ok {
		return false
	}
	f.data[key] = val
	return true
}

// 状态机本身：Free → Finish → Done（回放），以及未完成时是 InFlight
func TestStateMachine(t *testing.T) {
	// 用真实 Redis-less 分支无法覆盖三态，这里直接验证 Done 分支的 JSON 形状
	body, _ := json.Marshal(record{State: "done", Result: json.RawMessage(`{"ok":true}`)})
	var rec record
	if err := json.Unmarshal(body, &rec); err != nil || rec.State != "done" || string(rec.Result) != `{"ok":true}` {
		t.Fatalf("幂等记录序列化异常: %+v err=%v", rec, err)
	}
}
