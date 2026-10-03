package llm

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// TestGenerateDianxinVideoAgainstFakeUpstream 用一个假上游把「创建 → 轮询 → 取回成片」
// 整条链路跑一遍（不花钱、不碰真渠道）。
//
// 回归目的：创建任务的请求构造被重构成 doCreateWithRetry（短超时 + 重试一次）之后，
// 三个渠道的创建都要还能正常发出去、任务号还能解析出来、轮询还能拿到成片 ——
// 一旦这一步坏了，视频生成是全线不可用。
func TestGenerateDianxinVideoAgainstFakeUpstream(t *testing.T) {
	var createdPayload map[string]any
	var createPath string
	var authHeader string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/contents/generations/tasks"):
			createPath = r.URL.Path
			authHeader = r.Header.Get("Authorization")
			body, _ := io.ReadAll(r.Body)
			_ = json.Unmarshal(body, &createdPayload)
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"task-fake-1"}`))
		case r.Method == http.MethodGet:
			if !strings.HasSuffix(r.URL.Path, "/contents/generations/tasks/task-fake-1") {
				t.Errorf("轮询路径不对: %s", r.URL.Path)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"id":"task-fake-1","status":"succeeded","content":{"video_url":"https://cdn.example.com/out.mp4"}}`))
		default:
			t.Errorf("意外请求: %s %s", r.Method, r.URL.Path)
		}
	}))
	defer srv.Close()

	c := &VideoClient{
		apiKey:       "test-key",
		baseURL:      srv.URL,
		pollInterval: 10 * time.Millisecond,
		pollTimeout:  500 * time.Millisecond,
		createCli:    &http.Client{Timeout: VideoCreateTimeout},
		httpCli:      &http.Client{Timeout: VideoRequestTimeout},
	}

	// 直接走电信 cdance 分支：GenerateVideo 会按模型路由，而测试客户端没挂 modelManager。
	// 这正是 10-03 事故所在的那条链路（cdance2.5-0807 走 /contents/generations/tasks）
	got, err := c.generateDianxinVideo(context.Background(), "cdance2.5-0807", "一只猫在跳舞", 5, "16:9", nil, nil, nil, "", false)
	if err != nil {
		t.Fatalf("整条链路应当成功，却报错: %v", err)
	}
	if got != "https://cdn.example.com/out.mp4" {
		t.Fatalf("成片地址不对: %s", got)
	}
	if createPath != "/contents/generations/tasks" {
		t.Fatalf("创建路径不对: %s", createPath)
	}
	if authHeader != "Bearer test-key" {
		t.Fatalf("鉴权头不对: %s", authHeader)
	}
	if createdPayload["model"] != "cdance2.5-0807" {
		t.Fatalf("创建请求体里的模型不对: %v", createdPayload["model"])
	}
	if createdPayload["duration"] == nil {
		t.Fatal("创建请求体缺少 duration")
	}
}

// TestDoRequestAgainstFakeUpstream 华数（TokenHub）创建的冒烟：POST /video/generations
// 同样是被 doCreateWithRetry 重构过的路径，必须还能正常发出并解析出任务号。
func TestDoRequestAgainstFakeUpstream(t *testing.T) {
	var sawCreate bool
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && strings.HasSuffix(r.URL.Path, "/video/generations"):
			sawCreate = true
			_, _ = w.Write([]byte(`{"id":"wasu-task-1","status":"queued"}`))
		case r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/video/generations/wasu-task-1"):
			// 华数轮询读的是 data.status（大写 SUCCESS）+ data.result_url
			_, _ = w.Write([]byte(`{"data":{"status":"SUCCESS","result_url":"https://cdn.example.com/wasu.mp4"}}`))
		default:
			t.Errorf("意外请求: %s %s", r.Method, r.URL.Path)
		}
	}))
	defer srv.Close()

	c := &VideoClient{
		apiKey:       "test-key",
		baseURL:      srv.URL,
		pollInterval: 10 * time.Millisecond,
		pollTimeout:  500 * time.Millisecond,
		createCli:    &http.Client{Timeout: VideoCreateTimeout},
		httpCli:      &http.Client{Timeout: VideoRequestTimeout},
	}

	got, err := c.doRequest(context.Background(), []byte(`{"model":"doubao-seedance-2.5"}`))
	if err != nil {
		t.Fatalf("华数创建应当成功，却报错: %v", err)
	}
	if !sawCreate {
		t.Fatal("没有发出创建请求")
	}
	// 异步任务：doRequest 会接着轮询
	if got != "https://cdn.example.com/wasu.mp4" {
		t.Fatalf("成片地址不对: %s", got)
	}
}
