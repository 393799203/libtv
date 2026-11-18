package engine

import (
	"os"
	"path/filepath"
	"testing"

	"libtv/internal/llm"
)

// writeModelsYAML 造一份最小 models.yaml，用来验证「默认图像模型读配置」
func writeModelsYAML(t *testing.T, body string) *llm.ModelManager {
	t.Helper()
	path := filepath.Join(t.TempDir(), "models.yaml")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write models.yaml: %v", err)
	}
	mm, err := llm.NewModelManager(path)
	if err != nil {
		t.Fatalf("NewModelManager: %v", err)
	}
	return mm
}

// 节点有模型时原样使用，绝不改写（用户选的渠道模型必须被尊重）
func TestResolveImageModel_KeepsNodeModel(t *testing.T) {
	mm := writeModelsYAML(t, `
models:
  wasu:
    image:
      - id: doubao-seedream-5.0-lite
        default: true
`)
	if got := resolveImageModel("doubao-seedream-5.0-pro", "wasu", mm); got != "doubao-seedream-5.0-pro" {
		t.Fatalf("节点填了模型就不该被兜底覆盖：got %q", got)
	}
}

// 空模型 → 取 models.yaml 里 default: true 的图像模型（换默认模型只改配置）
func TestResolveImageModel_EmptyUsesYAMLDefault(t *testing.T) {
	mm := writeModelsYAML(t, `
models:
  wasu:
    image:
      - id: some-other-image-model
      - id: wasu-default-image
        default: true
`)
	if got := resolveImageModel("", "wasu", mm); got != "wasu-default-image" {
		t.Fatalf("空模型应兜底到 models.yaml 的 default 图像模型：got %q, want %q", got, "wasu-default-image")
	}
}

// 默认模型按渠道取：电信渠道的 default 与华数可以不同，不能串
func TestResolveImageModel_DefaultIsPerChannel(t *testing.T) {
	mm := writeModelsYAML(t, `
models:
  wasu:
    image:
      - id: wasu-image
        default: true
  dianxin:
    image:
      - id: dianxin-image
        default: true
`)
	if got := resolveImageModel("", "dianxin", mm); got != "dianxin-image" {
		t.Fatalf("应按渠道取默认模型：got %q, want %q", got, "dianxin-image")
	}
	// 空渠道按华数处理（与 ListModelsForChannel 的约定一致）
	if got := resolveImageModel("", "", mm); got != "dianxin-image" {
		t.Fatalf("空渠道应退回电信清单：got %q, want %q", got, "dianxin-image")
	}
}

// 配置缺失的兜底：modelManager 为 nil（降级装配/单测）、渠道没有 image 分类、没人标 default
// —— 三条路径都必须落到同一个常量上，绝不能返回空串（返回空串等于退回「静默免费 + 上游报错」）
func TestResolveImageModel_FallbacksNeverEmpty(t *testing.T) {
	noImage := writeModelsYAML(t, `
models:
  wasu:
    llm:
      - id: deepseek-v4-flash
`)
	noDefault := writeModelsYAML(t, `
models:
  wasu:
    image:
      - id: image-without-default-flag
`)

	cases := []struct {
		name    string
		mm      *llm.ModelManager
		channel string
	}{
		{name: "modelManager 为 nil", mm: nil, channel: "wasu"},
		{name: "渠道没有 image 分类", mm: noImage, channel: "wasu"},
		{name: "有图像模型但没人标 default", mm: noDefault, channel: "wasu"},
		{name: "渠道不存在", mm: noDefault, channel: "unknown-channel"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := resolveImageModel("", tc.channel, tc.mm)
			if got != llm.FallbackImageModelID {
				t.Fatalf("兜底模型应为 %q，得到 %q", llm.FallbackImageModelID, got)
			}
			if got != "doubao-seedream-5.0-flash" {
				t.Fatalf("兜底模型必须为 doubao-seedream-5.0-flash，得到 %q", got)
			}
		})
	}
}

func TestResolveImageModelReplacesRetiredLiteBeforeBilling(t *testing.T) {
	for _, channel := range []string{"wasu", "dianxin"} {
		want := "doubao-seedream-5.0-lite"
		if channel == "dianxin" {
			want = "doubao-seedream-5.0-flash"
		}
		if got := resolveImageModel("doubao-seedream-5.0-lite", channel, nil); got != want {
			t.Fatalf("历史 Lite 应在扣费和调用前统一替换为 Flash，得到 %q", got)
		}
		for _, selected := range []string{"doubao-seedream-5.5", "doubao-seedream-5.0-flash", "doubao-seedream-5.0-pro", "future-image"} {
			if got := resolveImageModel(selected, channel, nil); got != selected {
				t.Fatalf("用户选择的非退役模型被改写: %s -> %s", selected, got)
			}
		}
	}
	if got := resolveImageModel("", "dianxin", nil); got != llm.DianxinFallbackImageModelID {
		t.Fatalf("electric fallback=%s", got)
	}
}
