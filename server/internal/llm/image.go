package llm

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
	"time"

	"libtv/internal/config"
)

// ImageClient 图像生成客户端（OpenAI 兼容 API，华数TokenHub）
type ImageClient struct {
	apiKey  string
	baseURL string
	model   string
	httpCli *http.Client
}

// NewImageClient 创建图像生成客户端
func NewImageClient(cfg config.AIConfig, providerName string) *ImageClient {
	p := cfg.Providers[providerName]
	apiKey := p.APIKey
	baseURL := p.BaseURL

	// fallback
	if apiKey == "" {
		apiKey = cfg.LLM.APIKey
	}
	if baseURL == "" {
		baseURL = cfg.LLM.BaseURL
	}

	return &ImageClient{
		apiKey:  apiKey,
		baseURL: baseURL,
		model:   "qwen-image-2.0",
		httpCli: &http.Client{
			Timeout: 180 * time.Second,
			Transport: &http.Transport{
				DisableKeepAlives:   true,
				MaxIdleConns:        0,
				MaxIdleConnsPerHost: 0,
				IdleConnTimeout:     1 * time.Second,
				DialContext: (&net.Dialer{
					Timeout:   10 * time.Second,
					KeepAlive: 30 * time.Second,
				}).DialContext,
				TLSHandshakeTimeout:   15 * time.Second,
				ResponseHeaderTimeout: 120 * time.Second,
			},
		},
	}
}

// ImageRequest 图像生成请求（OpenAI 标准格式）
type ImageRequest struct {
	Model     string   `json:"model"`
	Prompt    string   `json:"prompt"`
	Size      string   `json:"size,omitempty"`  // 例如 "1920x1080"
	N         int      `json:"n,omitempty"`     // 生成图片数量
	Image     []string `json:"image,omitempty"` // 参考图数组（公网URL或base64），图生图时传入
	Watermark bool     `json:"watermark"`       // 去水印（false=无水印）
}

// ImageGenerationResponse 图像生成响应
type ImageGenerationResponse struct {
	Created int64 `json:"created"`
	Data    []struct {
		URL string `json:"url"`
	} `json:"data"`
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
	} `json:"error,omitempty"`
}

// GenerateImage 生成图像（文生图）
func (c *ImageClient) GenerateImage(ctx context.Context, prompt string, size string) ([]string, error) {
	if size == "" {
		size = "1920x1080"
	}

	req := ImageRequest{
		Model:  c.model,
		Prompt: prompt,
		Size:   size,
		N:      1,
	}
	payload, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal image request: %w", err)
	}
	log.Printf("[ImageGen] 文生图: model=%s size=%s", c.model, size)

	return c.doRequest(ctx, payload)
}

// GenerateImageWithModel 使用指定模型生成图像
func (c *ImageClient) GenerateImageWithModel(ctx context.Context, model string, prompt string, size string, n int) ([]string, error) {
	if size == "" {
		size = "1920x1080"
	}
	if n <= 0 {
		n = 1
	}

	req := ImageRequest{
		Model:  model,
		Prompt: prompt,
		Size:   size,
		N:      n,
	}
	payload, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal image request: %w", err)
	}
	log.Printf("[ImageGen] 文生图: model=%s size=%s n=%d", model, size, n)

	return c.doRequest(ctx, payload)
}

// GenerateImageFromImage 图生图：基于参考图生成新图像（使用默认model）
func (c *ImageClient) GenerateImageFromImage(ctx context.Context, imageURL string, prompt string, size string) ([]string, error) {
	return c.GenerateImageFromImageWithGuidance(ctx, c.model, []string{imageURL}, prompt, size, 7.5, 1)
}

// GenerateImageFromImageWithGuidance 图生图：基于参考图生成新图像，可指定model和guidance_scale
func (c *ImageClient) GenerateImageFromImageWithGuidance(ctx context.Context, model string, imageURLs []string, prompt string, size string, guidanceScale float64, n int) ([]string, error) {
	if size == "" {
		size = "1920x1080"
	}
	if n <= 0 {
		n = 1
	}

	// 逐个处理参考图：本地URL转base64，公网URL直接使用
	var finalImages []string
	for _, imageURL := range imageURLs {
		isPublicURL := (strings.HasPrefix(imageURL, "http://") || strings.HasPrefix(imageURL, "https://")) &&
			!strings.Contains(imageURL, "localhost") &&
			!strings.Contains(imageURL, "127.0.0.1")

		if isPublicURL {
			finalImages = append(finalImages, imageURL)
			log.Printf("[ImageGen] 使用公网URL: imageURL=%s", imageURL)
		} else {
			log.Printf("[ImageGen] 检测到本地URL，转换为base64: originalURL=%s", imageURL)
			base64Data, err := c.ConvertLocalImageToBase64(ctx, imageURL)
			if err != nil {
				return nil, fmt.Errorf("convert local image to base64: %w", err)
			}
			finalImages = append(finalImages, base64Data)
			log.Printf("[ImageGen] 本地图片转换成功: base64Len=%d", len(base64Data))
		}
	}

	req := ImageRequest{
		Model:  model,
		Prompt: prompt,
		Image:  finalImages,
		Size:   size,
		N:      n,
	}
	payload, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal image request: %w", err)
	}
	log.Printf("[ImageGen] 图生图(多图): model=%s size=%s imageCount=%d n=%d", model, size, len(finalImages), n)

	return c.doRequest(ctx, payload)
}

// doRequest 统一发送图像生成请求，返回所有生成图片的 URL 列表
func (c *ImageClient) doRequest(ctx context.Context, payload []byte) ([]string, error) {
	url := fmt.Sprintf("%s/images/generations", c.baseURL)

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)

	start := time.Now()
	resp, err := c.httpCli.Do(httpReq)
	if err != nil {
		log.Printf("[ImageGen] error after %s: %v", time.Since(start), err)
		return nil, fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()
	log.Printf("[ImageGen] got response after %s, status=%d", time.Since(start), resp.StatusCode)

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response body: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		log.Printf("[ImageGen] API error: status=%d body=%s", resp.StatusCode, string(respBody))
		return nil, fmt.Errorf("Image API error (status=%d): %s", resp.StatusCode, string(respBody))
	}

	// 打印 API 原始响应（截取前800字符），确认返回的 Data 数组长度
	bodyPreview := string(respBody)
	if len(bodyPreview) > 800 {
		bodyPreview = bodyPreview[:800]
	}
	log.Printf("[ImageGen] API 原始响应: %s", bodyPreview)

	var imgResp ImageGenerationResponse
	if err := json.Unmarshal(respBody, &imgResp); err != nil {
		return nil, fmt.Errorf("unmarshal response: %w", err)
	}

	if imgResp.Error != nil {
		return nil, fmt.Errorf("Image API error: %s", imgResp.Error.Message)
	}

	if len(imgResp.Data) == 0 {
		return nil, fmt.Errorf("no image generated")
	}

	// 收集所有生成图片的 URL（N>1 时返回多个）
	urls := make([]string, 0, len(imgResp.Data))
	for _, d := range imgResp.Data {
		if d.URL != "" {
			urls = append(urls, d.URL)
		}
	}
	if len(urls) == 0 {
		return nil, fmt.Errorf("no image generated")
	}

	log.Printf("[ImageGen] success: imageCount=%d firstURL=%s", len(urls), urls[0])
	return urls, nil
}

// convertLocalImageToBase64 将本地图片转换为base64格式
func (c *ImageClient) ConvertLocalImageToBase64(ctx context.Context, imageURL string) (string, error) {
	var fullURL string
	if strings.HasPrefix(imageURL, "/") {
		fullURL = fmt.Sprintf("http://localhost:8080%s", imageURL)
	} else {
		fullURL = imageURL
	}

	log.Printf("[ImageGen] 从本地URL下载图片: fullURL=%s", fullURL)

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, fullURL, nil)
	if err != nil {
		return "", fmt.Errorf("create request: %w", err)
	}

	resp, err := c.httpCli.Do(httpReq)
	if err != nil {
		return "", fmt.Errorf("download image: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download image failed (status=%d)", resp.StatusCode)
	}

	imageData, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read image data: %w", err)
	}

	log.Printf("[ImageGen] 图片下载成功: size=%d bytes", len(imageData))

	contentType := resp.Header.Get("Content-Type")
	mimeType := contentType
	if mimeType == "" {
		mimeType = "image/jpeg"
	}

	base64Data := base64.StdEncoding.EncodeToString(imageData)
	return fmt.Sprintf("data:%s;base64,%s", mimeType, base64Data), nil
}
