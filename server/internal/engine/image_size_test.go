package engine

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"net/http"
	"net/http/httptest"
	"testing"
)

// makePNG 造一张纯色 PNG（只用来量尺寸）
func makePNG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	img.Set(0, 0, color.RGBA{R: 1, G: 2, B: 3, A: 255})
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("encode png: %v", err)
	}
	return buf.Bytes()
}

func makeJPEG(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, nil); err != nil {
		t.Fatalf("encode jpeg: %v", err)
	}
	return buf.Bytes()
}

func TestIsAdaptiveAspectRatio(t *testing.T) {
	for _, ratio := range []string{"", "adaptive", "free", " adaptive ", "FREE"} {
		if !isAdaptiveAspectRatio(ratio) {
			t.Errorf("isAdaptiveAspectRatio(%q) = false, want true", ratio)
		}
	}
	for _, ratio := range []string{"16:9", "1:1", "9:16", "4:3"} {
		if isAdaptiveAspectRatio(ratio) {
			t.Errorf("isAdaptiveAspectRatio(%q) = true, want false", ratio)
		}
	}
}

func TestAspectRatioOfImageHeader(t *testing.T) {
	cases := []struct {
		name   string
		data   []byte
		w, h   int
		wantOK bool
	}{
		{"png 300x200", makePNG(t, 300, 200), 300, 200, true},
		{"png 1024x1024", makePNG(t, 1024, 1024), 1024, 1024, true},
		{"jpeg 640x480", makeJPEG(t, 640, 480), 640, 480, true},
		{"空字节", nil, 0, 0, false},
		{"不是图片", []byte("这不是图片，只是一段文字"), 0, 0, false},
	}
	for _, c := range cases {
		w, h, ok := aspectRatioOfImageHeader(c.data)
		if ok != c.wantOK || (ok && (w != c.w || h != c.h)) {
			t.Errorf("%s: got (%d,%d,%v), want (%d,%d,%v)", c.name, w, h, ok, c.w, c.h, c.wantOK)
		}
	}
}

// 图生图 + 自适应最终用的尺寸：必须体现原图比例，同时保持用户选的分辨率档位的像素量
func TestSourceRatioDrivesSizeWhenAdaptive(t *testing.T) {
	const resolution = "2K"
	budget := 1920 * 1080

	for _, src := range []struct{ w, h int }{{300, 200}, {1024, 1024}, {1080, 1920}, {1600, 900}} {
		w, h := calculateSizeFromResolutionAndRatio(resolution, ratioString(src.w, src.h))
		wantRatio := float64(src.w) / float64(src.h)
		gotRatio := float64(w) / float64(h)
		if diff := gotRatio - wantRatio; diff > 0.01 || diff < -0.01 {
			t.Errorf("原图 %dx%d: 出图 %dx%d 的比例 %.4f 与原图 %.4f 不符", src.w, src.h, w, h, gotRatio, wantRatio)
		}
		if w%8 != 0 || h%8 != 0 {
			t.Errorf("原图 %dx%d: 出图 %dx%d 不是 8 的倍数", src.w, src.h, w, h)
		}
		// 像素量应与档位同量级（不因为换比例而掉档）
		if pixels := w * h; pixels < budget*9/10 || pixels > budget*11/10 {
			t.Errorf("原图 %dx%d: 出图 %dx%d = %d 像素，偏离 %d 档位太多", src.w, src.h, w, h, pixels, budget)
		}
	}

	// 自适应原来的行为（16:9）与 3:2 必须不同，否则这条修复没意义
	w16, h16 := calculateSizeFromResolutionAndRatio(resolution, "16:9")
	w32, h32 := calculateSizeFromResolutionAndRatio(resolution, "3:2")
	if w16 == w32 && h16 == h32 {
		t.Errorf("16:9 与 3:2 算出来的尺寸相同（%dx%d），比例没有被采纳", w16, h16)
	}
}

// ratioString 与 executor 里构造比例字符串的写法保持一致
func ratioString(w, h int) string {
	return itoa(w) + ":" + itoa(h)
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

func TestImageAspectRatioOfOverHTTP(t *testing.T) {
	cases := []struct {
		name   string
		body   []byte
		w, h   int
		wantOK bool
	}{
		{"正常 3:2", makePNG(t, 600, 400), 600, 400, true},
		{"极端长条 1:100 应被拒", makePNG(t, 4, 400), 0, 0, false},
	}
	for _, c := range cases {
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(c.body)
		}))
		w, h, ok := imageAspectRatioOf(context.Background(), srv.URL+"/pic.png")
		srv.Close()
		if ok != c.wantOK || (ok && (w != c.w || h != c.h)) {
			t.Errorf("%s: got (%d,%d,%v), want (%d,%d,%v)", c.name, w, h, ok, c.w, c.h, c.wantOK)
		}
	}
}

func TestImageAspectRatioOfBadURL(t *testing.T) {
	// 取不到就返回 false（调用方退回默认比例），且不能 panic
	if _, _, ok := imageAspectRatioOf(context.Background(), "http://127.0.0.1:1/nope.png"); ok {
		t.Error("取不到图片时应返回 ok=false")
	}
	if _, _, ok := imageAspectRatioOf(context.Background(), ""); ok {
		t.Error("空 URL 应返回 ok=false")
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "not found", http.StatusNotFound)
	}))
	defer srv.Close()
	if _, _, ok := imageAspectRatioOf(context.Background(), srv.URL+"/404.png"); ok {
		t.Error("404 时应返回 ok=false")
	}
}