package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"

	"libtv/internal/billing"
	"libtv/internal/config"
	"libtv/internal/llm"
)

func videoReferenceContext() *ExecutionContext {
	ctx := imageReferenceContext()
	ctx.nodeDataByID["clip"] = json.RawMessage(`{"type":"video","label":"动作视频","videoUrl":"data:video/mp4;base64,AAAA"}`)
	ctx.nodeDataByID["sound"] = json.RawMessage(`{"type":"audio","label":"声音","audioUrl":"https://example.test/voice.mp3"}`)
	ctx.nodeDataByID["view"] = json.RawMessage(`{"type":"previz","label":"预演","stillUrl":"https://example.test/view.png","videoUrl":"data:video/mp4;base64,BBBB"}`)
	ctx.upstreamByTarget["target"] = []string{"style", "face", "pose", "clip", "sound", "text"}
	return ctx
}

func TestVideoReferencesKeepIndependentNumbersAndAllAliases(t *testing.T) {
	prompt := "用[[m:f]]的人脸，[[m:p]]的动作，[[m:v]]的运镜，[[m:a]]的声音，再保持[[m:f2]]的身份。"
	raw := json.RawMessage(`[
		{"id":"a","nodeId":"sound","nodeType":"audio"},
		{"id":"v","nodeId":"clip","nodeType":"video"},
		{"id":"f2","nodeId":"face","nodeType":"image"},
		{"id":"p","nodeId":"pose","nodeType":"image"},
		{"id":"f","nodeId":"face","nodeType":"image"}
	]`)
	refs, err := resolveVideoReferences("target", prompt, "universal-ref", raw, videoReferenceContext())
	if err != nil {
		t.Fatal(err)
	}
	images, videos, audios := refs.urls()
	if !reflect.DeepEqual(images, []string{"https://example.test/face.png", "https://example.test/pose.png", "https://example.test/style.png"}) ||
		len(videos) != 1 || len(audios) != 1 {
		t.Fatalf("参考数组顺序不正确: %v %v %v", images, videos, audios)
	}
	want := "用图1的人脸，图2的动作，视频1的运镜，音频1的声音，再保持图1的身份。"
	if got := refs.rewritePrompt(prompt); got != want {
		t.Fatalf("类型独立编号或重复别名丢失: %q", got)
	}
	described := refs.describePrompt(want)
	for _, part := range []string{"图3（名称：\"画风\"）", "视频1（名称：\"动作视频\"）", "音频1（名称：\"声音\"）", "不得混入其他参考素材中的人脸"} {
		if !strings.Contains(described, part) {
			t.Fatalf("缺少参考关系 %q: %s", part, described)
		}
	}
}

func TestVideoPrevizReferenceIdentifiesBothMedia(t *testing.T) {
	refs, err := resolveVideoReferences("target", "参考[[m:v]]走位", "universal-ref",
		json.RawMessage(`[{"id":"v","nodeId":"view","nodeType":"previz"}]`), videoReferenceContext())
	if err != nil || refs.rewritePrompt("参考[[m:v]]走位") != "参考图1、视频1走位" {
		t.Fatalf("预演应绑定静帧和视频各自图号: refs=%+v err=%v", refs, err)
	}
}

func TestVideoFramesRespectSlotMetadataAndAllowSameImage(t *testing.T) {
	ctx := videoReferenceContext()
	ctx.nodeDataByID["target"] = json.RawMessage(`{"type":"video","scriptNodeId":"script","shotId":"shot"}`)
	ctx.nodeDataByID["face"] = json.RawMessage(`{"type":"image","imageUrl":"https://example.test/first.png","scriptNodeId":"script","shotId":"shot","refIndex":1}`)
	ctx.nodeDataByID["pose"] = json.RawMessage(`{"type":"image","imageUrl":"https://example.test/last.png","scriptNodeId":"script","shotId":"shot","refIndex":2}`)
	prompt := "最终到[[m:last]]，从[[m:first]]开始。"
	refs, err := resolveVideoReferences("target", prompt, "first-last-frame", json.RawMessage(`[
		{"id":"last","nodeId":"pose","nodeType":"image"},
		{"id":"first","nodeId":"face","nodeType":"image"}
	]`), ctx)
	if err != nil {
		t.Fatal(err)
	}
	images, videos, audios := refs.urls()
	if !reflect.DeepEqual(images, []string{"https://example.test/first.png", "https://example.test/last.png"}) || len(videos)+len(audios) != 0 {
		t.Fatalf("首尾槽位或模式隔离错误: %v %v %v", images, videos, audios)
	}
	if got := refs.rewritePrompt(prompt); got != "最终到尾帧（图2），从首帧（图1）开始。" {
		t.Fatalf("文字出现顺序不应交换声明的首尾帧: %q", got)
	}
	refs, err = resolveVideoReferences("target", "[[m:f]]到[[m:l]]", "first-last-frame", json.RawMessage(`[
		{"id":"f","nodeId":"face","nodeType":"image"},
		{"id":"l","nodeId":"face","nodeType":"image"}
	]`), ctx)
	images, _, _ = refs.urls()
	if err != nil || len(images) != 2 || images[0] != images[1] || refs.rewritePrompt("[[m:f]]到[[m:l]]") != "首帧（图1）到尾帧（图2）" {
		t.Fatalf("同一图片应能分别绑定首尾帧: refs=%+v err=%v", refs, err)
	}
	if _, err := resolveVideoReferences("target", "[[m:l]]", "first-last-frame",
		json.RawMessage(`[{"id":"l","nodeId":"pose","nodeType":"image"}]`), ctx); err == nil {
		t.Fatal("只有声明为尾帧的槽位时，不得将它提升为首帧")
	}
	ctx.nodeDataByID["face"] = json.RawMessage(`{"type":"image","label":"未完成的首帧"}`)
	ctx.upstreamByTarget["target"] = []string{"face", "pose"}
	if _, err := resolveVideoReferences("target", "平滑过渡", "first-last-frame", nil, ctx); err == nil {
		t.Fatal("连线兜底同样不得跳过未准备好的首帧")
	}
}

func TestVideoReferenceValidationFailsBeforeBilling(t *testing.T) {
	for _, tc := range []struct {
		name, prompt, mode, mentions string
	}{
		{"missing", "[[m:x]]动作", "universal-ref", `[{"id":"x","nodeId":"empty","nodeType":"image"}]`},
		{"orphan", "[[m:x]]动作", "universal-ref", `[]`},
		{"frame-video-conflict", "[[m:x]]动作", "first-last-frame", `[{"id":"x","nodeId":"clip","nodeType":"video"}]`},
		{"frame-audio-conflict", "[[m:x]]声音", "first-last-frame", `[{"id":"x","nodeId":"sound","nodeType":"audio"}]`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			data, _ := json.Marshal(map[string]any{"prompt": tc.prompt, "videoMode": tc.mode, "mentions": json.RawMessage(tc.mentions)})
			out, err := NewVideoExecutor(nil, nil, nil, nil, nil, nil, nil).Execute(
				context.Background(), WorkflowNode{ID: "target", Data: data}, videoReferenceContext())
			if err != nil || out == nil || out.Status != "failed" {
				t.Fatalf("引用错误应在扣费/模型调用前失败: out=%+v err=%v", out, err)
			}
		})
	}
	ctx := videoReferenceContext()
	ctx.upstreamByTarget["target"] = nil
	for i := 0; i < 10; i++ {
		id := fmt.Sprintf("img-%d", i)
		ctx.nodeDataByID[id] = json.RawMessage(fmt.Sprintf(`{"type":"image","imageUrl":"https://example.test/%d.png"}`, i))
		ctx.upstreamByTarget["target"] = append(ctx.upstreamByTarget["target"], id)
	}
	if _, err := resolveVideoReferences("target", "参考图1", "universal-ref", nil, ctx); err == nil {
		t.Fatal("超过图片上限不得静默截断")
	}
	if _, err := resolveVideoReferences("target", "首尾帧", "first-last-frame", nil, ctx); err == nil {
		t.Fatal("超过首尾帧数量不得静默截断")
	}
}

func TestVideoUnreadableFirstFrameFailsBeforeBilling(t *testing.T) {
	var requests int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&requests, 1)
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()
	ctx := videoReferenceContext()
	ctx.nodeDataByID["face"] = json.RawMessage(fmt.Sprintf(`{"type":"image","imageUrl":%q}`, srv.URL+"/missing.png"))
	data := json.RawMessage(`{"prompt":"[[m:f]]过渡到[[m:l]]","videoMode":"first-last-frame","mentions":[
		{"id":"f","nodeId":"face","nodeType":"image"},{"id":"l","nodeId":"pose","nodeType":"image"}]}`)
	client := llm.NewVideoClient(config.AIConfig{Providers: map[string]config.ProviderConfig{
		llm.ChannelWasu: {BaseURL: srv.URL},
	}}, llm.ChannelWasu, llm.VideoPollConfig{})
	out, err := NewVideoExecutor(client, nil, nil, nil, nil, nil, nil).Execute(
		context.Background(), WorkflowNode{ID: "target", Data: data}, ctx)
	if err != nil || out == nil || out.Status != "failed" || atomic.LoadInt32(&requests) != 1 {
		t.Fatalf("应只读取一次首帧，然后在扣费前终止: out=%+v err=%v requests=%d", out, err, requests)
	}
	if msg, _ := out.Data["error"].(string); !strings.Contains(msg, "参考图1无法读取") {
		t.Fatalf("不应把尾帧提升为首帧: %+v", out)
	}
}

func TestVideoReferenceMappingMatchesFourWireProtocols(t *testing.T) {
	for _, tc := range []struct{ channel, model string }{
		{llm.ChannelWasu, "seedance-test"},
		{llm.ChannelWasu, "wan3.0-video"},
		{llm.ChannelDianxin, "cdance-test"},
		{llm.ChannelDianxin, "wan3.0-video"},
	} {
		for _, frameMode := range []bool{false, true} {
			t.Run(tc.channel+"/"+tc.model+fmt.Sprint(frameMode), func(t *testing.T) {
				var calls int32
				var prompt string
				var urls, roles []string
				srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					atomic.AddInt32(&calls, 1)
					var payload struct {
						Prompt  string `json:"prompt"`
						Content []struct {
							Type     string               `json:"type"`
							Text     string               `json:"text"`
							Role     string               `json:"role"`
							ImageURL struct{ URL string } `json:"image_url"`
							VideoURL struct{ URL string } `json:"video_url"`
							AudioURL struct{ URL string } `json:"audio_url"`
						} `json:"content"`
						Input struct {
							Prompt string                       `json:"prompt"`
							Media  []struct{ Type, URL string } `json:"media"`
						} `json:"input"`
						Metadata struct {
							Content []struct {
								Role     string               `json:"role"`
								ImageURL struct{ URL string } `json:"image_url"`
								VideoURL struct{ URL string } `json:"video_url"`
								AudioURL struct{ URL string } `json:"audio_url"`
							} `json:"content"`
							Input struct {
								Media []struct{ Type, URL string } `json:"media"`
							} `json:"input"`
						} `json:"metadata"`
					}
					if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
						t.Error(err)
					}
					prompt = payload.Prompt
					for _, item := range payload.Content {
						if item.Type == "text" {
							prompt = item.Text
							continue
						}
						urls = append(urls, item.ImageURL.URL+item.VideoURL.URL+item.AudioURL.URL)
						roles = append(roles, item.Role)
					}
					for _, item := range payload.Metadata.Content {
						urls = append(urls, item.ImageURL.URL+item.VideoURL.URL+item.AudioURL.URL)
						roles = append(roles, item.Role)
					}
					if payload.Input.Prompt != "" {
						prompt = payload.Input.Prompt
					}
					for _, group := range [][]struct{ Type, URL string }{payload.Input.Media, payload.Metadata.Input.Media} {
						for _, item := range group {
							urls = append(urls, item.URL)
							roles = append(roles, item.Type)
						}
					}
					w.WriteHeader(http.StatusBadRequest)
					_, _ = w.Write([]byte(`{"error":{"message":"mock complete"}}`))
				}))
				defer srv.Close()
				client := llm.NewVideoClient(config.AIConfig{Providers: map[string]config.ProviderConfig{
					tc.channel: {APIKey: "test", BaseURL: srv.URL},
				}}, tc.channel, llm.VideoPollConfig{})
				ctx := videoReferenceContext()
				ctx.channel = tc.channel
				mode := "universal-ref"
				userPrompt := "用[[m:f]]的人脸，[[m:p]]的动作，[[m:v]]的运镜，[[m:a]]的声音"
				mentions := json.RawMessage(`[{"id":"v","nodeId":"clip","nodeType":"video"},
					{"id":"a","nodeId":"sound","nodeType":"audio"},{"id":"p","nodeId":"pose","nodeType":"image"},
					{"id":"f","nodeId":"face","nodeType":"image"}]`)
				if frameMode {
					mode = "first-last-frame"
					userPrompt = "[[m:f]]平滑过渡到[[m:l]]"
					mentions = json.RawMessage(`[{"id":"l","nodeId":"face","nodeType":"image"},{"id":"f","nodeId":"face","nodeType":"image"}]`)
				}
				data, _ := json.Marshal(map[string]any{"prompt": userPrompt, "videoMode": mode, "model": tc.model,
					"duration": 5, "resolution": "720p", "mentions": mentions})
				biller := billing.NewService(imageReferenceFreeUser{}, imageReferenceFakeBills{}, nil, nil)
				_, _ = NewVideoExecutor(client, nil, biller, nil, nil, nil, nil).Execute(
					context.Background(), WorkflowNode{ID: "target", Data: data}, ctx)
				if calls != 1 {
					t.Fatalf("应只下发一次模拟请求: %d", calls)
				}
				if strings.Contains(prompt, "[[m:") {
					t.Fatalf("引用标记不应泄漏给模型: %s", prompt)
				}
				if frameMode {
					if !reflect.DeepEqual(roles, []string{"first_frame", "last_frame"}) ||
						len(urls) != 2 || urls[0] != urls[1] || !strings.Contains(prompt, "首帧（图1）平滑过渡到尾帧（图2）") {
						t.Fatalf("首尾帧角色或引用不一致: roles=%v urls=%v prompt=%s", roles, urls, prompt)
					}
				} else {
					wantURLs := []string{"https://example.test/face.png", "https://example.test/pose.png",
						"https://example.test/style.png", "data:video/mp4;base64,AAAA", "https://example.test/voice.mp3"}
					if !reflect.DeepEqual(urls, wantURLs) || !strings.Contains(prompt, "用图1的人脸，图2的动作，视频1的运镜，音频1的声音") {
						t.Fatalf("最终协议数据不匹配: urls=%v prompt=%s", urls, prompt)
					}
					if !reflect.DeepEqual(roles, []string{"reference_image", "reference_image", "reference_image", "reference_video", "reference_audio"}) {
						t.Fatalf("参考角色不匹配: %v", roles)
					}
				}
			})
		}
	}
}
