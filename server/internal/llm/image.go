package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"libtv/internal/config"
)

// ImageClient 图像生成客户端(支持硅基流动等 OpenAI 兼容 API)
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
		model:   "Kwai-Kolors/Kolors", // 默认使用 Kolors 模型
		httpCli: &http.Client{
			Timeout: 120 * time.Second, // 图像生成通常需要更长时间
			Transport: &http.Transport{
				DisableKeepAlives:   true,
				MaxIdleConns:        0,
				MaxIdleConnsPerHost: 0,
				IdleConnTimeout:     1 * time.Second,
			},
		},
	}
}

// ImageGenerationRequest 图像生成请求（OpenAI 格式）
type ImageGenerationRequest struct {
	Model  string `json:"model"`
	Prompt string `json:"prompt"`
	Size   string `json:"size,omitempty"` // OpenAI 格式：例如 "1024x1024"
	N      int    `json:"n,omitempty"`    // OpenAI 格式：生成图片数量
}

// SiliconFlowImageRequest 硅基流动图像生成请求（特殊格式）
type SiliconFlowImageRequest struct {
	Model             string  `json:"model"`
	Prompt            string  `json:"prompt"`
	ImageSize         string  `json:"image_size"`              // 硅基流动格式：例如 "1024x1024"
	BatchSize         int     `json:"batch_size"`              // 硅基流动格式：生成图片数量
	NumInferenceSteps int     `json:"num_inference_steps"`     // 必需：控制生成步长（1-50）
	GuidanceScale     float64 `json:"guidance_scale"`          // 必需：匹配程度（0-20）
	NegativePrompt    string  `json:"negative_prompt,omitempty"` // 可选：负面提示词
	Seed              int     `json:"seed,omitempty"`          // 可选：固定种子值
}

// ImageGenerationResponse 图像生成响应
type ImageGenerationResponse struct {
	Created int64 `json:"created"`
	Data    []struct {
		URL string `json:"url"` // 图片 URL
	} `json:"data"`
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
	} `json:"error,omitempty"`
}

// GenerateImage 生成图像
// 调用硅基流动的图像生成 API (支持 OpenAI 和硅基流动两种格式)
func (c *ImageClient) GenerateImage(ctx context.Context, prompt string, size string) (string, error) {
	// 默认尺寸
	if size == "" {
		size = "1024x1024"
	}

	// 判断是否使用硅基流动特殊格式（Kolors 需要）
	var payload []byte
	var err error

	if strings.HasPrefix(c.model, "Kwai-Kolors/") {
		// 硅基流动 Kolors 特殊格式
		req := SiliconFlowImageRequest{
			Model:             c.model,
			Prompt:            prompt,
			ImageSize:         size,
			BatchSize:         1,
			NumInferenceSteps: 50,       // 默认步长
			GuidanceScale:     7.5,      // 默认匹配程度
			NegativePrompt:    "低质量, 模糊, 变形, 文字, 水印", // 默认负面提示词
		}
		payload, err = json.Marshal(req)
		if err != nil {
			return "", fmt.Errorf("marshal siliconflow image request: %w", err)
		}
		log.Printf("[ImageGen] Using SiliconFlow format for Kolors: model=%s", c.model)
	} else {
		// OpenAI 标准格式
		req := ImageGenerationRequest{
			Model:  c.model,
			Prompt: prompt,
			Size:   size,
			N:      1,
		}
		payload, err = json.Marshal(req)
		if err != nil {
			return "", fmt.Errorf("marshal image request: %w", err)
		}
		log.Printf("[ImageGen] Using OpenAI format: model=%s", c.model)
	}

	// 硅基流动的图像生成 API endpoint
	url := fmt.Sprintf("%s/images/generations", c.baseURL)
	log.Printf("[ImageGen] request: model=%s url=%s promptLen=%d", c.model, url, len(prompt))

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return "", fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)

	start := time.Now()
	resp, err := c.httpCli.Do(httpReq)
	if err != nil {
		log.Printf("[ImageGen] error after %s: %v", time.Since(start), err)
		return "", fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()
	log.Printf("[ImageGen] got response after %s, status=%d", time.Since(start), resp.StatusCode)

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read response body: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		log.Printf("[ImageGen] http error: status=%d body=%s", resp.StatusCode, string(respBody))
		return "", fmt.Errorf("Image API error (status=%d): %s", resp.StatusCode, string(respBody))
	}

	var imgResp ImageGenerationResponse
	if err := json.Unmarshal(respBody, &imgResp); err != nil {
		return "", fmt.Errorf("unmarshal response: %w", err)
	}

	if imgResp.Error != nil {
		log.Printf("[ImageGen] api error: %s", imgResp.Error.Message)
		return "", fmt.Errorf("Image API error: %s", imgResp.Error.Message)
	}

	if len(imgResp.Data) == 0 {
		log.Printf("[ImageGen] empty data, body=%s", string(respBody))
		return "", fmt.Errorf("no image generated")
	}

	imageURL := imgResp.Data[0].URL
	log.Printf("[ImageGen] ok: imageURL=%s", imageURL)

	return imageURL, nil
}

// GenerateImageWithModel 使用指定模型生成图像
func (c *ImageClient) GenerateImageWithModel(ctx context.Context, model string, prompt string, size string) (string, error) {
	// 临时切换模型
	originalModel := c.model
	c.model = model
	defer func() { c.model = originalModel }()

	return c.GenerateImage(ctx, prompt, size)
}