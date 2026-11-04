package engine

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"

	"libtv/internal/billing"
	"libtv/internal/config"
	"libtv/internal/llm"
	"libtv/internal/model"
	"libtv/internal/repository"
)

func imageReferenceContext() *ExecutionContext {
	return &ExecutionContext{
		channel: llm.ChannelWasu,
		nodeDataByID: map[string]json.RawMessage{
			"face":  json.RawMessage(`{"type":"image","label":"人像","imageUrl":"https://example.test/face.png"}`),
			"pose":  json.RawMessage(`{"type":"image","label":"动作","imageUrl":"https://example.test/pose.png"}`),
			"style": json.RawMessage(`{"type":"image","label":"画风","imageUrl":"https://example.test/style.png","styleId":"style-a"}`),
			"view":  json.RawMessage(`{"type":"previz","label":"姿态预演","stillUrl":"https://example.test/view.png"}`),
			"text":  json.RawMessage(`{"type":"text","content":"口播文本"}`),
			"empty": json.RawMessage(`{"type":"image","label":"未完成的图片"}`),
		},
		upstreamByTarget: map[string][]string{"target": {"style", "face", "pose", "text"}},
	}
}

func TestImageReferencesFollowPromptAndKeepRepeatedAliases(t *testing.T) {
	ctx := imageReferenceContext()
	prompt := "用[[m:f1]]的人脸，[[m:p]]的动作，再保持[[m:f2]]的身份。"
	raw := json.RawMessage(`[
		{"id":"p","nodeId":"pose","nodeType":"image"},
		{"id":"f2","nodeId":"face","nodeType":"image"},
		{"id":"old","nodeId":"empty","nodeType":"image"},
		{"id":"f1","nodeId":"face","nodeType":"image"}
	]`)
	original := string(raw)
	refs, err := resolveImageReferences("target", prompt, raw, ctx)
	if err != nil {
		t.Fatal(err)
	}
	all, styles, content := refs.urls()
	if !reflect.DeepEqual(all, []string{"https://example.test/face.png", "https://example.test/pose.png", "https://example.test/style.png"}) {
		t.Fatalf("人像、动作应先于隐式风格图: %v", all)
	}
	if len(styles) != 1 || len(content) != 2 {
		t.Fatalf("参考图分类不正确: styles=%v content=%v", styles, content)
	}
	if got := refs.rewritePrompt(prompt); got != "用图1的人脸，图2的动作，再保持图1的身份。" {
		t.Fatalf("重复引用应保持同一图号: %q", got)
	}
	if string(raw) != original {
		t.Fatal("不得修改保存的引用数据")
	}
	described := refs.describePrompt(refs.rewritePrompt(prompt))
	for _, want := range []string{"图1（名称：\"人像\"）", "图2（名称：\"动作\"）", "图3（名称：\"画风\"）", "不得从该图替换人物身份"} {
		if !strings.Contains(described, want) {
			t.Fatalf("缺少图号或身份约束 %q: %s", want, described)
		}
	}
}

func TestImageReferencesFallbackKeepsContentOrderAndAppendsStyle(t *testing.T) {
	ctx := imageReferenceContext()
	ctx.upstreamByTarget["target"] = []string{"style", "face", "empty", "pose", "face", "text"}
	refs, err := resolveImageReferences("target", "用图1的人脸和图2的动作", nil, ctx)
	if err != nil {
		t.Fatal(err)
	}
	all, _, _ := refs.urls()
	if !reflect.DeepEqual(all, []string{"https://example.test/face.png", "https://example.test/pose.png", "https://example.test/style.png"}) {
		t.Fatalf("连线兜底不得让风格图或重复边改变图号: %v", all)
	}
}

func TestImageReferencesRespectExplicitSelectionAndExplicitStylePosition(t *testing.T) {
	ctx := imageReferenceContext()
	refs, err := resolveImageReferences("target", "[[m:p]]动作", json.RawMessage(`[
		{"id":"p","nodeId":"pose","nodeType":"image"}
	]`), ctx)
	if err != nil {
		t.Fatal(err)
	}
	all, _, _ := refs.urls()
	if !reflect.DeepEqual(all, []string{"https://example.test/pose.png", "https://example.test/style.png"}) {
		t.Fatalf("显式引用后不应补入未被选中的内容图: %v", all)
	}
	refs, err = resolveImageReferences("target", "[[m:s]]风格，[[m:f]]主体", json.RawMessage(`[
		{"id":"f","nodeId":"face","nodeType":"image"},
		{"id":"s","nodeId":"style","nodeType":"image"}
	]`), ctx)
	if err != nil || refs.rewritePrompt("[[m:s]]风格，[[m:f]]主体") != "图1风格，图2主体" {
		t.Fatalf("显式风格引用应保留用户的出现顺序: refs=%+v err=%v", refs, err)
	}
}

func TestImageReferencesSupportPrevizLegacyAndLatestNodeData(t *testing.T) {
	ctx := imageReferenceContext()
	ctx.nodeDataByID["face"] = json.RawMessage(`{"type":"image","imageUrl":"https://example.test/new-face.png"}`)
	refs, err := resolveImageReferences("target", "[[m:v]]动作，[[m:f]]脸", json.RawMessage(`[
		{"id":"f","nodeId":"face","nodeType":"image","imageUrl":"https://example.test/old-face.png"},
		{"id":"","nodeId":"face","nodeType":"image"},
		{"id":"v","nodeId":"view","nodeType":"previz"}
	]`), ctx)
	if err != nil {
		t.Fatal(err)
	}
	all, _, _ := refs.urls()
	if !reflect.DeepEqual(all, []string{"https://example.test/view.png", "https://example.test/new-face.png", "https://example.test/style.png"}) {
		t.Fatalf("预演、历史引用和最新生成 URL 不兼容: %v", all)
	}
}

func TestImageReferencesMissingExplicitImageFailsBeforeGeneration(t *testing.T) {
	for _, raw := range []string{
		`[{"id":"x","nodeId":"empty","nodeType":"image"}]`,
		`[{"id":"x","nodeId":"missing","nodeType":"image"}]`,
		`[{"id":"x","nodeId":"empty","nodeType":"previz"}]`,
		`{"invalid":"mentions"}`,
		`[]`,
		`null`,
	} {
		data, _ := json.Marshal(map[string]any{"prompt": "参考[[m:x]]生成画面", "mentions": json.RawMessage(raw)})
		// 所有依赖均为空：若误进入扣费或生成路径，这条测试会直接失败。
		out, err := NewImageExecutor(nil, nil, nil, nil, nil, nil, nil).Execute(
			context.Background(), WorkflowNode{ID: "target", Data: data}, imageReferenceContext())
		if err != nil || out == nil || out.Status != "failed" {
			t.Fatalf("无效引用应在扣费前失败: out=%+v err=%v", out, err)
		}
	}
}

type imageReferenceFreeUser struct{ repository.UserRepo }

func (imageReferenceFreeUser) GetCredits(context.Context, string) (int64, error) { return 100, nil }

type imageReferenceFakeBills struct{ repository.BillingRepo }

func (imageReferenceFakeBills) Create(context.Context, *model.BillingRecord) error { return nil }

// 从真实 ImageExecutor 一直执行到两种上游协议的 HTTP 请求，检查最后的图序和提示词。
// 模拟上游在收到请求后返回错误，停止在图片下载/存储之前，不产生真实调用或扣费。
func TestImageReferenceMappingMatchesActualWirePayload(t *testing.T) {
	for _, apiStyle := range []string{"", llm.ImageStyleDashScopeMultimodal} {
		t.Run("api="+apiStyle, func(t *testing.T) {
			var calls int32
			var sentImages []string
			var sentPrompt string
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				atomic.AddInt32(&calls, 1)
				var payload struct {
					Image  []string `json:"image"`
					Prompt string   `json:"prompt"`
					Input  struct {
						Messages []struct {
							Content []struct {
								Image string `json:"image"`
								Text  string `json:"text"`
							} `json:"content"`
						} `json:"messages"`
					} `json:"input"`
				}
				if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
					t.Error(err)
				}
				sentImages, sentPrompt = payload.Image, payload.Prompt
				if apiStyle != "" {
					for _, message := range payload.Input.Messages {
						for _, item := range message.Content {
							if item.Image != "" {
								sentImages = append(sentImages, item.Image)
							}
							if item.Text != "" {
								sentPrompt = item.Text
							}
						}
					}
				}
				w.WriteHeader(http.StatusInternalServerError)
				_, _ = w.Write([]byte(`{"error":{"message":"end of mock request"}}`))
			}))
			defer srv.Close()
			client := llm.NewImageClient(config.AIConfig{Providers: map[string]config.ProviderConfig{
				llm.ChannelWasu: {BaseURL: srv.URL, APIKey: "test"},
			}}, llm.ChannelWasu)
			modelsPath := filepath.Join(t.TempDir(), "models.yaml")
			models := "models:\n  wasu:\n    image:\n      - id: test-image\n        api_style: " + apiStyle + "\n"
			if err := os.WriteFile(modelsPath, []byte(models), 0600); err != nil {
				t.Fatal(err)
			}
			manager, err := llm.NewModelManager(modelsPath)
			if err != nil {
				t.Fatal(err)
			}
			client.SetModelManager(manager)
			biller := billing.NewService(imageReferenceFreeUser{}, imageReferenceFakeBills{}, nil, nil)
			executor := NewImageExecutor(client, manager, nil, biller, nil, nil, nil)
			node := WorkflowNode{ID: "target", Type: "image", Data: json.RawMessage(`{
				"prompt":"用[[m:f1]]的人脸和背景，[[m:p]]的动作，再保持[[m:f2]]的身份",
				"model":"test-image","resolution":"1K","aspectRatio":"16:9",
				"mentions":[
					{"id":"p","nodeId":"pose","nodeType":"image"},
					{"id":"f2","nodeId":"face","nodeType":"image"},
					{"id":"f1","nodeId":"face","nodeType":"image"}
				]
			}`)}
			_, err = executor.Execute(context.Background(), node, imageReferenceContext())
			if err == nil || atomic.LoadInt32(&calls) != 1 {
				t.Fatalf("应只向模拟上游请求一次后停止: calls=%d err=%v", calls, err)
			}
			if !reflect.DeepEqual(sentImages, []string{"https://example.test/face.png", "https://example.test/pose.png", "https://example.test/style.png"}) {
				t.Fatalf("实际 HTTP 图片顺序错误: %v", sentImages)
			}
			for _, want := range []string{"图1的人脸和背景，图2的动作，再保持图1的身份", "图3（名称：\"画风\"）", "不得混入其他图的人脸"} {
				if !strings.Contains(sentPrompt, want) {
					t.Fatalf("实际 HTTP 提示词缺少对应关系 %q: %s", want, sentPrompt)
				}
			}
			if strings.Contains(sentPrompt, "[[m:") || strings.Contains(sentPrompt, "请保持参考图中的主体结构、细节特征和整体风格") {
				t.Fatalf("实际请求仍带未解析标记或冲突的多图通用约束: %s", sentPrompt)
			}
		})
	}
}
