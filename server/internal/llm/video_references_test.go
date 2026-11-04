package llm

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestCollectMediaNeverDropsOrPromotesMissingReferences(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer srv.Close()
	client := &VideoClient{httpCli: srv.Client()}
	for _, images := range [][]string{
		{"", "https://example.test/last.png"},
		{srv.URL + "/missing", "https://example.test/last.png"},
		{"https://example.test/a.png", "https://example.test/b.png", "https://example.test/c.png"},
	} {
		if _, err := client.collectMedia(context.Background(), images, nil, nil, "first-last-frame", "reference_image"); err == nil {
			t.Fatal("空帧、失败帧、超量帧必须报错，不能跳过后把尾帧当首帧")
		}
	}
	if _, err := client.collectMedia(context.Background(), []string{"https://example.test/a.png"},
		[]string{srv.URL + "/missing"}, nil, "universal-ref", "reference_image"); err == nil {
		t.Fatal("失败视频参考不得被跳过")
	}
}

func TestPrepareVideoReferencesConvertsOnceAndPreservesOrder(t *testing.T) {
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		w.Header().Set("Content-Type", "image/png")
		if strings.HasSuffix(r.URL.Path, ".mp4") {
			w.Header().Set("Content-Type", "video/mp4")
		}
		_, _ = w.Write([]byte("sample"))
	}))
	defer srv.Close()
	client := &VideoClient{httpCli: srv.Client()}
	images := []string{srv.URL + "/first.png", "https://example.test/second.png"}
	videos := []string{srv.URL + "/reference.mp4"}
	audios := []string{"https://example.test/voice.mp3"}
	ctx, err := client.PrepareVideoReferences(context.Background(), images, videos, audios)
	if err != nil {
		t.Fatal(err)
	}
	if images[0] != srv.URL+"/first.png" || videos[0] != srv.URL+"/reference.mp4" {
		t.Fatal("原始地址必须保留给时长测量和计费")
	}
	items, err := client.collectMedia(ctx, images, videos, audios, "universal-ref", "reference_image")
	if err != nil || len(items) != 4 || calls != 2 {
		t.Fatalf("已准备的本地素材不应再次下载或消失: items=%v calls=%d err=%v", items, calls, err)
	}
	if !strings.HasPrefix(items[0].url, "data:image/png;base64,") || items[1].url != images[1] ||
		!strings.HasPrefix(items[2].url, "data:video/mp4;base64,") {
		t.Fatalf("最终请求未按原顺序使用转换结果: %v", items)
	}
}

func TestLegacyMultipleImagesUseReferenceRoles(t *testing.T) {
	client := &VideoClient{}
	items, err := client.collectMedia(context.Background(),
		[]string{"https://example.test/face.png", "https://example.test/pose.png"}, nil, nil, "", "")
	if err != nil || len(items) != 2 || items[0].role != "reference_image" || items[1].role != "reference_image" {
		t.Fatalf("旧节点未设置模式时，多图也应明确使用参考角色: %v %v", items, err)
	}
}
