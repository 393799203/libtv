package llm

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func newTestModelManager(t *testing.T, body string) *ModelManager {
	t.Helper()
	path := filepath.Join(t.TempDir(), "models.yaml")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write models.yaml: %v", err)
	}
	mm, err := NewModelManager(path)
	if err != nil {
		t.Fatalf("NewModelManager: %v", err)
	}
	return mm
}

// DefaultImageModelID 读 models.yaml 的 default 标记，而不是写死常量
func TestDefaultImageModelID_FromYAML(t *testing.T) {
	mm := newTestModelManager(t, `
models:
  wasu:
    image:
      - id: image-a
      - id: image-b
        default: true
      - id: image-c
        default: true
`)
	if got := mm.DefaultImageModelID("wasu"); got != "image-b" {
		t.Fatalf("应取第一个标了 default 的图像模型：got %q, want %q", got, "image-b")
	}
}

// 允许 nil receiver：执行器里 modelManager 可能是 nil，兜底只有一条路径
func TestDefaultImageModelID_NilManager(t *testing.T) {
	var mm *ModelManager
	if got := mm.DefaultImageModelID("wasu"); got != FallbackImageModelID {
		t.Fatalf("nil manager 应退回 %q，得到 %q", FallbackImageModelID, got)
	}
}

// 兜底常量必须与真实配置一致：models.yaml 里 image 分类下 doubao-seedream-5.0-lite 标了 default
func TestDefaultImageModelID_MatchesRealConfig(t *testing.T) {
	mm, err := NewModelManager(filepath.Join("..", "..", "configs", "models.yaml"))
	if err != nil {
		t.Skipf("跳过：读不到真实 models.yaml (%v)", err)
	}
	for _, channel := range []string{"wasu", "dianxin"} {
		expected := FallbackImageModelID
		if channel == ChannelDianxin {
			expected = DianxinFallbackImageModelID
		}
		if got := mm.DefaultImageModelID(channel); got != expected {
			t.Errorf("渠道 %s 的默认图像模型是 %q，与兜底常量 %q 不一致（改配置时请同步改常量）",
				channel, got, expected)
		}
	}
	if !strings.HasPrefix(FallbackImageModelID, "doubao-seedream") {
		t.Errorf("兜底默认图像模型异常：%q", FallbackImageModelID)
	}
}
