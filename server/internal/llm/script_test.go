package llm

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"
	"unicode/utf8"

	"libtv/internal/config"
)

func writeScriptChat(t *testing.T, w http.ResponseWriter, content, finish string) {
	t.Helper()
	w.Header().Set("Content-Type", "application/json")
	err := json.NewEncoder(w).Encode(map[string]any{
		"choices": []any{map[string]any{
			"message": map[string]any{"content": content}, "finish_reason": finish,
		}},
		"usage": map[string]int{"total_tokens": 25000, "completion_tokens": 10000},
	})
	if err != nil {
		t.Error(err)
	}
}

func TestGenerateScriptFractionalDurationsAndJSONOutput(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		var req ChatRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Error(err)
		}
		if req.ResponseFormat == nil || req.ResponseFormat.Type != "json_object" {
			t.Errorf("分镜应请求 JSON 输出: %+v", req.ResponseFormat)
		}
		if req.ReasoningEffort != "" {
			t.Errorf("非 GLM 模型不应被设置推理强度: %q", req.ReasoningEffort)
		}
		writeScriptChat(t, w, "```json\n"+`{"scriptContent":"口播","characters":[{"name":"李（本人）"}],"shots":[{"duration":3.5},{"duration":2.5}]}`+"\n```", "stop")
	}))
	defer srv.Close()
	client := &Client{baseURL: srv.URL, httpCli: srv.Client()}
	ctx := WithUsageRecorder(context.Background())
	result, err := GenerateScript(ctx, client, "全片45秒", "deepseek-v4.1-flash")
	if err != nil {
		t.Fatal(err)
	}
	if result.Shots[0].Duration != 3.5 || result.Shots[1].Duration != 2.5 || result.Shots[0].ID != "shot-1" {
		t.Fatalf("应保留原始小数秒并补全镜头 ID: %+v", result.Shots)
	}
	if result.Characters[0].Name != "李-本人" {
		t.Fatalf("资产名字清理行为发生变化: %q", result.Characters[0].Name)
	}
	total, _, _, recordedCalls := UsageFrom(ctx).Snapshot()
	if total != 25000 || recordedCalls != 1 || calls != 1 {
		t.Fatalf("解析兼容不应重新调用上游或改变成本记录: total=%d calls=%d/%d", total, calls, recordedCalls)
	}
}

func TestGenerateScriptRecoversConcatenatedValuesWithoutRegeneration(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		writeScriptChat(t, w, `{"scriptContent":"开场\n" + "结尾","shots":[{"duration":3.5,"visual":"A+B" + "，他说\"你好\"" + "后退\\前进"}]}`, "stop")
	}))
	defer srv.Close()
	result, err := GenerateScript(context.Background(), &Client{baseURL: srv.URL, httpCli: srv.Client()}, "口播", "deepseek-v4.1-flash")
	if err != nil {
		t.Fatal(err)
	}
	if result.ScriptContent != "开场\n结尾" || result.Shots[0].Visual != `A+B，他说"你好"后退\前进` || calls != 1 {
		t.Fatalf("字符串合并改变了内容或额外调用上游: %+v calls=%d", result, calls)
	}
}

func TestGenerateScriptFallsBackOnlyForExplicitJSONParameterRejection(t *testing.T) {
	for _, status := range []int{400, 500, 429} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			var calls int32
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				n := atomic.AddInt32(&calls, 1)
				var req ChatRequest
				_ = json.NewDecoder(r.Body).Decode(&req)
				if n == 1 {
					w.WriteHeader(status)
					_, _ = w.Write([]byte(`{"error":{"message":"unsupported parameter response_format"}}`))
					return
				}
				if req.ResponseFormat != nil {
					t.Error("回退请求应移除不被支持的参数")
				}
				writeScriptChat(t, w, `{"shots":[{"duration":5}]}`, "stop")
			}))
			defer srv.Close()
			_, err := GenerateScript(context.Background(), &Client{baseURL: srv.URL, httpCli: srv.Client()}, "口播", "glm-5.3-flash")
			if status == 400 {
				if err != nil || calls != 2 {
					t.Fatalf("参数明确被拒绝时应成功回退一次: calls=%d err=%v", calls, err)
				}
			} else if err == nil || calls != 1 {
				t.Fatalf("不确定失败不得重复生成: calls=%d err=%v", calls, err)
			}
		})
	}
}

func TestGenerateScriptInvalidOutputsDoNotTriggerAnotherGeneration(t *testing.T) {
	cases := []struct{ name, content, finish string }{
		{"numeric expression", `{"shots":[{"duration":2+3}]}`, "stop"},
		{"truncated", `{"shots":[{"duration":3.5}]}`, "length"},
		{"malformed", `{"scriptContent":"` + strings.Repeat("分镜", 101) + `"`, "stop"},
		{"empty shots", `{"shots":[]}`, "stop"},
		{"invalid duration", `{"shots":[{"duration":-2}]}`, "stop"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var calls int32
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				atomic.AddInt32(&calls, 1)
				writeScriptChat(t, w, tc.content, tc.finish)
			}))
			defer srv.Close()
			_, err := GenerateScript(context.Background(), &Client{baseURL: srv.URL, httpCli: srv.Client()}, "口播", "deepseek-v4.1-flash")
			if err == nil || !utf8.ValidString(err.Error()) || calls != 1 {
				t.Fatalf("应返回合法中文错误且不重复生成: calls=%d err=%v", calls, err)
			}
		})
	}
}

func TestGLMScriptUsesLowReasoningAndFallsBackOnlyWhenRejected(t *testing.T) {
	for _, reject := range []bool{false, true} {
		t.Run(fmt.Sprint(reject), func(t *testing.T) {
			var calls int32
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				n := atomic.AddInt32(&calls, 1)
				var req ChatRequest
				_ = json.NewDecoder(r.Body).Decode(&req)
				if n == 1 && req.ReasoningEffort != "low" {
					t.Errorf("GLM 分镜应降低推理强度: %q", req.ReasoningEffort)
				}
				if req.ResponseFormat == nil {
					t.Error("推理参数回退不应移除 JSON 输出约束")
				}
				if reject && n == 1 {
					w.WriteHeader(http.StatusBadRequest)
					_, _ = w.Write([]byte(`{"error":{"message":"unsupported parameter reasoning_effort"}}`))
					return
				}
				if n > 1 && req.ReasoningEffort != "" {
					t.Error("不支持的推理参数应被移除")
				}
				writeScriptChat(t, w, `{"shots":[{"duration":3.5}]}`, "stop")
			}))
			defer srv.Close()
			_, err := GenerateScript(context.Background(), &Client{baseURL: srv.URL, httpCli: srv.Client()}, "口播", "glm-5.3-flash")
			wantCalls := int32(1)
			if reject {
				wantCalls = 2
			}
			if err != nil || calls != wantCalls {
				t.Fatalf("GLM 请求/回退失败: calls=%d err=%v", calls, err)
			}
		})
	}
}

func TestScriptTimeoutOverridesBothHTTPBudgetsWithoutChangingSharedClient(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
			return
		case <-time.After(50 * time.Millisecond):
		}
		writeScriptChat(t, w, `{"shots":[{"duration":5}]}`, "stop")
	}))
	defer srv.Close()
	transport := srv.Client().Transport.(*http.Transport).Clone()
	transport.ResponseHeaderTimeout = time.Millisecond
	shared := &http.Client{Timeout: time.Millisecond, Transport: transport}
	defer transport.CloseIdleConnections()
	client := &Client{baseURL: srv.URL, httpCli: shared}
	if _, err := GenerateScript(context.Background(), client, "口播", "glm-5.3-flash"); err != nil {
		t.Fatalf("分镜应覆盖通用 client 和 header 超时: %v", err)
	}
	if shared.Timeout != time.Millisecond || transport.ResponseHeaderTimeout != time.Millisecond {
		t.Fatal("分镜请求修改了共享客户端，影响了其他并发任务")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Millisecond)
	defer cancel()
	if _, err := GenerateScript(ctx, client, "口播", "glm-5.3-flash"); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("分镜预算不得延长调用方的取消期限: %v", err)
	}
	if scriptRequestTimeout <= 5*time.Minute || scriptRequestTimeout >= 30*time.Minute {
		t.Fatal("分镜预算应覆盖原 5 分钟上限，并留在工作流 30 分钟预算之内")
	}
}

func TestJSONStringValueRepairPreservesOrdinaryJSONAndRejectsCode(t *testing.T) {
	for _, raw := range []string{
		`{"a":"C++和A+B","b":"转义引号\" + \"仍在字符串内"}`,
		`{"a":2+3}`,
		`{"a":"文本" + execute()}`,
		`{"a":"文本" + "未结束}`,
	} {
		if got := joinJSONStringValues(raw); got != raw {
			t.Fatalf("不应修复有效字符串或执行其他表达式:\nwant=%s\ngot=%s", raw, got)
		}
	}
}

// 显式开启时才调用真实渠道；只用合成口播，不操作用户画布或扣用户积分。
func TestManualE2E_Script(t *testing.T) {
	if os.Getenv("LIBTV_SCRIPT_E2E") != "1" {
		t.Skip("set LIBTV_SCRIPT_E2E=1 to call the configured upstream")
	}
	if err := config.Load("../../configs/config.yaml"); err != nil {
		t.Fatal(err)
	}
	model := os.Getenv("LIBTV_SCRIPT_MODEL")
	if model == "" {
		model = "deepseek-v4.1-flash"
	}
	ctx, cancel := context.WithTimeout(context.Background(), scriptRequestTimeout+5*time.Second)
	defer cancel()
	ctx = WithUsageRecorder(WithChannel(ctx, ChannelDianxin))
	client := NewClient(config.C.AI, ChannelDianxin)
	if os.Getenv("LIBTV_SCRIPT_HEALTH") == "1" {
		probeCtx, probeCancel := context.WithTimeout(ctx, 45*time.Second)
		defer probeCancel()
		probeOpts := []Option{WithJSONOutput(), WithMaxTokens(256)}
		if strings.HasPrefix(strings.ToLower(model), "glm-5.3") {
			probeOpts = append(probeOpts, WithReasoningEffort("low"))
		}
		response, err := client.ChatWithModel(probeCtx, model, "只输出合法 JSON。", `只输出 {"ok":true}，无需解释。`, probeOpts...)
		if err != nil {
			t.Fatal(err)
		}
		if len(response.Choices) == 0 {
			t.Fatal("上游未返回 choices")
		}
		t.Logf("model=%s finish=%s contentLength=%d", model, response.Choices[0].FinishReason, len(response.Choices[0].Message.Content))
		return
	}
	result, err := GenerateScript(ctx, client, `把以下口播拆成可直接生成画面的分镜表，全片45秒左右，节奏明快。
开头和结尾是本人正面中景口播。中间每条演示要有清楚的画面动作，镜头可以用2.5秒、3.5秒等小数秒，不增删旁白。
口播：我是小李，今天带你看看AI如何帮助创作。
【电脑前修改文案】把一句简单的想法，写成完整故事。
【表格数据变成图形】把枯燥的数字，变成一眼能懂的图表。
【网页展示转为知识动画】把复杂的知识，变成生动的动画。
【办公室变成家中书桌】无论在办公室，还是回到家里，灵感随时都能开始。
【画面中出现几个自己并被线条连接】让不同的自己，协作完成一个作品。
【本人面对镜头】现在就开始，把你的想法变成画面。`, model)
	if err != nil {
		t.Fatal(err)
	}
	totalDuration := 0.0
	for _, shot := range result.Shots {
		totalDuration += shot.Duration
	}
	tokens, completion, _, calls := UsageFrom(ctx).Snapshot()
	t.Logf("model=%s shots=%d totalDuration=%g tokens=%d completion=%d acceptedCalls=%d",
		model, len(result.Shots), totalDuration, tokens, completion, calls)
}
