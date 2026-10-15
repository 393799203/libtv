package engine

import (
	"bytes"
	"context"
	"fmt"
	"image"
	// 只解文件头（DecodeConfig）也要注册解码器；这三个是上传链路会产出的格式
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
)

// imageHeaderMaxBytes 量一张图的长宽只要文件头，别把整张图（可能几 MB）下回来。
const imageHeaderMaxBytes = 128 << 10

// imageHeaderTimeout 量尺寸是「锦上添花」的一步：宁可量不到退回默认，也不能把生成卡住。
const imageHeaderTimeout = 8 * time.Second

// 合理的长宽比区间：极端比例（比如 1:50 的长条图）算出来的尺寸上游一定不收，
// 这种情况直接退回默认比例，别把一个注定失败的尺寸发出去。
const (
	minSourceAspect = 0.25 // 1:4
	maxSourceAspect = 4.0  // 4:1
)

// isAdaptiveAspectRatio 判断「自适应」。
// 空值也算自适应；free 是历史枚举值（前端 normalizeAspectRatio 已统一改成 adaptive）。
func isAdaptiveAspectRatio(ratio string) bool {
	// 大小写不敏感：枚举值历史上换过名（free → adaptive），旧画布里也可能存着别的大小写写法，
	// 认不出来就会静默退回 16:9 —— 那正是这次要修的 bug，所以这里宽进。
	switch strings.ToLower(strings.TrimSpace(ratio)) {
	case "", "adaptive", "free":
		return true
	}
	return false
}

// aspectRatioOfImageHeader 从图片字节里读宽高（只解文件头，不解像素）。
func aspectRatioOfImageHeader(data []byte) (int, int, bool) {
	if len(data) == 0 {
		return 0, 0, false
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || cfg.Width <= 0 || cfg.Height <= 0 {
		return 0, 0, false
	}
	return cfg.Width, cfg.Height, true
}

// fetchImageHeaderBytes 取一张图的前若干 KB。
// 站内相对路径走本机后端（与 llm 包 ConvertLocalImageToBase64、video.go 里取图的约定一致）。
func fetchImageHeaderBytes(ctx context.Context, url string) ([]byte, error) {
	fullURL := url
	if strings.HasPrefix(url, "/") {
		fullURL = fmt.Sprintf("http://localhost:8080%s", url)
	}

	reqCtx, cancel := context.WithTimeout(ctx, imageHeaderTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, fullURL, nil)
	if err != nil {
		return nil, fmt.Errorf("build request: %w", err)
	}
	resp, err := (&http.Client{Timeout: imageHeaderTimeout}).Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status %d", resp.StatusCode)
	}
	return io.ReadAll(io.LimitReader(resp.Body, imageHeaderMaxBytes))
}

// imageAspectRatioOf 量一张图的长宽。
// 量不到就返回 ok=false：调用方保持原行为，绝不因为量不到而让生成失败。
func imageAspectRatioOf(ctx context.Context, url string) (int, int, bool) {
	if strings.TrimSpace(url) == "" {
		return 0, 0, false
	}
	data, err := fetchImageHeaderBytes(ctx, url)
	if err != nil {
		log.Printf("[ImageExecutor] 参考图取文件头失败，长宽比退回默认: url=%s err=%v", url, err)
		return 0, 0, false
	}
	w, h, ok := aspectRatioOfImageHeader(data)
	if !ok {
		log.Printf("[ImageExecutor] 参考图格式认不出长宽比，退回默认: url=%s bytes=%d", url, len(data))
		return 0, 0, false
	}
	if float64(w)/float64(h) < minSourceAspect || float64(w)/float64(h) > maxSourceAspect {
		log.Printf("[ImageExecutor] 参考图长宽比 %dx%d 过于极端，退回默认比例", w, h)
		return 0, 0, false
	}
	return w, h, true
}