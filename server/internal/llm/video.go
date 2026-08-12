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

// VideoClient 视频生成客户端（华数TokenHub doubao-seedance）
type VideoClient struct {
	apiKey  string
	baseURL string
	httpCli *http.Client
}

// NewVideoClient 创建视频生成客户端
func NewVideoClient(cfg config.AIConfig, providerName string) *VideoClient {
	p := cfg.Providers[providerName]
	apiKey := p.APIKey
	baseURL := p.BaseURL

	if apiKey == "" {
		apiKey = cfg.LLM.APIKey
	}
	if baseURL == "" {
		baseURL = cfg.LLM.BaseURL
	}

	return &VideoClient{
		apiKey:  apiKey,
		baseURL: baseURL,
		httpCli: &http.Client{
			Timeout: 10 * time.Minute, // 视频生成耗时较长
			Transport: &http.Transport{
				DisableKeepAlives:   true,
				MaxIdleConns:        0,
				MaxIdleConnsPerHost: 0,
			},
		},
	}
}

// VideoContentItem 视频生成的参考资源条目（图片或视频）
// Role 为空时是参考模式，非空时是首尾帧模式（first_frame/last_frame）
type VideoContentItem struct {
	Type     string             `json:"type"`                // "image_url" 或 "video_url"
	ImageURL *VideoContentImage `json:"image_url,omitempty"` // type=image_url 时使用
	VideoURL *VideoContentImage `json:"video_url,omitempty"` // type=video_url 时使用
	Role     string             `json:"role,omitempty"`      // 参考模式留空；首尾帧模式填 first_frame/last_frame
}

// VideoContentImage 图片URL容器
type VideoContentImage struct {
	URL string `json:"url"`
}

// VideoMetadata 视频元数据
type VideoMetadata struct {
	Resolution    string             `json:"resolution"`     // "1080p"
	Ratio         string             `json:"ratio"`          // "16:9"
	GenerateAudio bool               `json:"generate_audio"` // false
	Watermark     bool               `json:"watermark"`      // 去水印（false=无水印）
	Content       []VideoContentItem `json:"content"`        // 参考图列表
}

// VideoRequest 视频生成请求
type VideoRequest struct {
	Model    string        `json:"model"`
	Prompt   string        `json:"prompt"`
	Duration int           `json:"duration"`
	Metadata VideoMetadata `json:"metadata"`
}

// VideoResponse 视频生成响应（创建任务时的响应）
type VideoResponse struct {
	ID     string `json:"id"`
	Status string `json:"status"` // processing/succeeded/failed
	Model  string `json:"model"`
	Output struct {
		URL string `json:"url"` // 视频URL
	} `json:"output"`
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
	} `json:"error"`
	// 兼容直接返回 data 数组的格式
	Data []struct {
		URL string `json:"url"`
	} `json:"data"`
}

// VideoTaskResponse 查询视频任务状态的响应（华数TokenHub格式）
// 注意：查询接口的响应外层是 code/message/data 包裹，与创建接口的 VideoResponse 不同
type VideoTaskResponse struct {
	Code    string `json:"code"`    // "success"
	Message string `json:"message"` // 错误信息
	Data    struct {
		TaskID     string `json:"task_id"`
		Status     string `json:"status"`     // SUCCESS / PROCESSING / FAIL
		Progress   string `json:"progress"`   // "100%"
		ResultURL  string `json:"result_url"` // 视频 URL（SUCCESS 时有值）
		FailReason string `json:"fail_reason"`
	} `json:"data"`
}

// GenerateVideo 调用视频生成API
// imageURLs: 参考图列表。videoURLs: 参考视频列表。
// videoMode 决定 role：first-last-frame=首尾帧(first_frame/last_frame)，其他模式=无role
// generateAudio: 是否生成音频（true=生成声音，false=静音）
func (c *VideoClient) GenerateVideo(ctx context.Context, model string, prompt string, duration int, resolution string, ratio string, imageURLs []string, videoURLs []string, videoMode string, generateAudio bool) (string, error) {
	if resolution == "" {
		resolution = "1080p"
	}
	if ratio == "" {
		ratio = "16:9"
	}
	// doubao-seedance-2.0 支持的 duration 范围：4-15秒（火山引擎官方限制）
	originalDuration := duration
	if duration < 4 {
		duration = 4
	}
	if duration > 15 {
		duration = 15
	}
	if originalDuration != duration {
		log.Printf("[VideoGen] duration 规范化: %d → %d", originalDuration, duration)
	}

	metadata := VideoMetadata{
		Resolution:    resolution,
		Ratio:         ratio,
		GenerateAudio: generateAudio,
		Content:       []VideoContentItem{},
	}

	// 处理参考图
	// 0张 → 纯文生视频
	// 1张 → 参考模式（无 role）
	// 2张 → 首尾帧模式（first_frame + last_frame）
	for i, rawURL := range imageURLs {
		if rawURL == "" {
			continue
		}
		finalURL, err := c.processImageURL(ctx, rawURL)
		if err != nil {
			log.Printf("[VideoGen] ⚠️ 参考图[%d]处理失败，跳过: %v", i, err)
			continue
		}
		item := VideoContentItem{
			Type:     "image_url",
			ImageURL: &VideoContentImage{URL: finalURL},
		}
		// 首尾帧模式: first_frame / last_frame
		// 全能参考模式: reference_image（API 要求必须指定 role）
		// 首帧模式（1张图无 mode）: 不填 role
		if videoMode == "first-last-frame" {
			if i == 0 {
				item.Role = "first_frame"
			} else {
				item.Role = "last_frame"
			}
		} else if videoMode == "universal-ref" {
			item.Role = "reference_image"
		}
		metadata.Content = append(metadata.Content, item)
		log.Printf("[VideoGen] ✅ 参考图[%d]已添加: role=%s urlLen=%d", i, item.Role, len(finalURL))
	}

	// 处理参考视频（视频参考/全能参考模式）
	for i, rawURL := range videoURLs {
		if rawURL == "" {
			continue
		}
		finalURL, err := c.processImageURL(ctx, rawURL) // 复用同一函数处理URL（本地转base64/公网直传）
		if err != nil {
			log.Printf("[VideoGen] ⚠️ 参考视频[%d]处理失败，跳过: %v", i, err)
			continue
		}
		item := VideoContentItem{
			Type:     "video_url",
			VideoURL: &VideoContentImage{URL: finalURL},
			Role:     "reference_video", // 视频参考模式必须设置 role
		}
		metadata.Content = append(metadata.Content, item)
		log.Printf("[VideoGen] ✅ 参考视频[%d]已添加: role=%s urlLen=%d", i, item.Role, len(finalURL))
	}

	// 首尾帧模式限制2张；全能参考最多5张
	if videoMode == "first-last-frame" && len(metadata.Content) > 2 {
		metadata.Content = metadata.Content[:2]
	}

	mode := "文生视频"
	if len(metadata.Content) > 0 {
		switch videoMode {
		case "first-last-frame":
			mode = "首尾帧模式"
		case "video-ref":
			mode = "视频参考模式"
		case "universal-ref":
			mode = "全能参考模式"
		default:
			mode = "参考模式"
		}
	}

	req := VideoRequest{
		Model:    model,
		Prompt:   prompt,
		Duration: duration,
		Metadata: metadata,
	}

	payload, err := json.Marshal(req)
	if err != nil {
		return "", fmt.Errorf("marshal video request: %w", err)
	}

	log.Printf("[VideoGen] 发起请求: model=%s mode=%s duration=%ds resolution=%s ratio=%s imageCount=%d promptLen=%d",
		model, mode, duration, resolution, ratio, len(metadata.Content), len(prompt))

	videoURL, err := c.doRequest(ctx, payload)
	if err != nil {
		return "", err
	}

	log.Printf("[VideoGen] ✅ 视频生成成功: url=%s", videoURL)
	return videoURL, nil
}

// processImageURL 处理图片URL：公网URL直接使用，本地URL转base64
func (c *VideoClient) processImageURL(ctx context.Context, imageURL string) (string, error) {
	isPublicURL := (strings.HasPrefix(imageURL, "http://") || strings.HasPrefix(imageURL, "https://")) &&
		!strings.Contains(imageURL, "localhost") &&
		!strings.Contains(imageURL, "127.0.0.1")

	if isPublicURL {
		log.Printf("[VideoGen] 使用公网URL: %s", imageURL)
		return imageURL, nil
	}

	// 本地图片转base64（复用ImageClient的逻辑）
	log.Printf("[VideoGen] 本地图片转base64: %s", imageURL)
	imgClient := &ImageClient{
		apiKey:  c.apiKey,
		baseURL: c.baseURL,
		httpCli: c.httpCli,
	}
	return imgClient.ConvertLocalImageToBase64(ctx, imageURL)
}

// doRequest 发送视频生成请求，处理同步和异步响应
func (c *VideoClient) doRequest(ctx context.Context, payload []byte) (string, error) {
	url := fmt.Sprintf("%s/video/generations", c.baseURL)

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return "", fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)

	start := time.Now()
	resp, err := c.httpCli.Do(httpReq)
	if err != nil {
		log.Printf("[VideoGen] error after %s: %v", time.Since(start), err)
		return "", fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()
	log.Printf("[VideoGen] got response after %s, status=%d", time.Since(start), resp.StatusCode)

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read response body: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		log.Printf("[VideoGen] API error: status=%d body=%s", resp.StatusCode, string(respBody))
		return "", fmt.Errorf("Video API error (status=%d): %s", resp.StatusCode, string(respBody))
	}

	var videoResp VideoResponse
	if err := json.Unmarshal(respBody, &videoResp); err != nil {
		return "", fmt.Errorf("unmarshal response: %w", err)
	}

	// 检查错误
	if videoResp.Error != nil {
		return "", fmt.Errorf("Video API error: %s", videoResp.Error.Message)
	}

	// 情况1：直接返回视频URL（output.url 或 data[0].url）
	if videoResp.Output.URL != "" {
		log.Printf("[VideoGen] 同步返回视频URL")
		return videoResp.Output.URL, nil
	}
	if len(videoResp.Data) > 0 && videoResp.Data[0].URL != "" {
		log.Printf("[VideoGen] 同步返回视频URL (data数组)")
		return videoResp.Data[0].URL, nil
	}

	// 情况2：返回任务ID，需要轮询
	if videoResp.ID != "" {
		log.Printf("[VideoGen] 异步任务: id=%s, 开始轮询...", videoResp.ID)
		return c.pollVideoTask(ctx, videoResp.ID)
	}

	return "", fmt.Errorf("unexpected response: %s", string(respBody))
}

// pollVideoTask 轮询异步视频生成任务
func (c *VideoClient) pollVideoTask(ctx context.Context, taskID string) (string, error) {
	url := fmt.Sprintf("%s/video/generations/%s", c.baseURL, taskID)
	maxAttempts := 120 // 最多轮询120次（每5秒一次，共10分钟）

	for i := 0; i < maxAttempts; i++ {
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-time.After(5 * time.Second):
		}

		httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			return "", fmt.Errorf("create poll request: %w", err)
		}
		httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)

		resp, err := c.httpCli.Do(httpReq)
		if err != nil {
			log.Printf("[VideoGen] poll error (attempt %d): %v", i+1, err)
			continue
		}

		respBody, err := io.ReadAll(resp.Body)
		resp.Body.Close() // 立即关闭，避免循环内 defer 导致连接泄漏
		if err != nil {
			log.Printf("[VideoGen] poll read body error (attempt %d): %v", i+1, err)
			continue
		}

		var taskResp VideoTaskResponse
		if err := json.Unmarshal(respBody, &taskResp); err != nil {
			preview := string(respBody)
			if len(preview) > 300 {
				preview = preview[:300]
			}
			log.Printf("[VideoGen] poll unmarshal error (attempt %d): %v body=%s", i+1, err, preview)
			continue
		}

		log.Printf("[VideoGen] poll attempt %d: status=%s progress=%s", i+1, taskResp.Data.Status, taskResp.Data.Progress)

		switch strings.ToUpper(taskResp.Data.Status) {
		case "SUCCESS":
			if taskResp.Data.ResultURL != "" {
				return taskResp.Data.ResultURL, nil
			}
			return "", fmt.Errorf("task succeeded but no result_url")
		case "FAIL", "FAILED", "ERROR":
			reason := taskResp.Data.FailReason
			if reason == "" {
				reason = taskResp.Message
			}
			if reason == "" {
				reason = "unknown"
			}
			return "", fmt.Errorf("task failed: %s", reason)
		}
		// PROCESSING → 继续轮询
	}

	return "", fmt.Errorf("poll timeout after %d attempts", maxAttempts)
}
