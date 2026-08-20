package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
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
	// 按模型分派参数规范化：每个模型独立处理自己的时长范围与参考视频限制
	originalDuration := duration
	var err error
	switch {
	case strings.Contains(model, "wan3.0"):
		duration, err = normalizeWanParams(ctx, duration, videoURLs)
	default: // doubao-seedance 系列（火山引擎）
		duration, err = normalizeSeedanceParams(ctx, model, duration, videoURLs)
	}
	if err != nil {
		return "", err
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
		// 首尾帧模式: first_frame / last_frame（按实际写入 content 的顺序分配，
		// 不能用 imageURLs 原始下标——前面的图为空或处理失败被跳过时会导致角色错位）
		// 全能参考模式: reference_image（API 要求必须指定 role）
		// 首帧模式（1张图无 mode）: 不填 role
		if videoMode == "first-last-frame" {
			if len(metadata.Content) == 0 {
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

// NormalizeVideoDuration 按模型钳制视频时长（秒）：
// wan3.0-video（阿里万相）：2-30 秒；doubao-seedance 系列（火山引擎）：4-15 秒
// 供 executor 在扣费前调用，保证扣费时长与实际生成时长一致
func NormalizeVideoDuration(model string, duration int) int {
	if strings.Contains(model, "wan3.0") {
		return clampDuration(duration, 2, 30)
	}
	return clampDuration(duration, 4, 15)
}

// clampDuration 将时长钳制到 [min, max]
func clampDuration(duration, min, max int) int {
	if duration < min {
		return min
	}
	if duration > max {
		return max
	}
	return duration
}

// normalizeSeedanceParams 豆包 Seedance 系列（火山引擎）参数规范化：
// 时长范围 4-15 秒；fast 版本额外要求「参考视频时长 + 生成时长 <= 15.2 秒」
func normalizeSeedanceParams(ctx context.Context, model string, duration int, videoURLs []string) (int, error) {
	duration = clampDuration(duration, 4, 15)

	// 有参考视频时，seedance-2.0-fast 模型要求「参考视频时长 + 生成视频时长 <= 15.2秒」
	// 超限时提示用户切换到 seedance 2.0（非 fast 版本）
	if len(videoURLs) > 0 && strings.Contains(model, "fast") {
		if totalRefDuration := sumRefVideoDuration(ctx, videoURLs); totalRefDuration > 0 {
			totalDuration := totalRefDuration + float64(duration)
			if totalDuration > 15.2 {
				return 0, fmt.Errorf("参考视频时长(%.1f秒) + 生成时长(%d秒) = %.1f秒，超过 seedance-2.0-fast 模型的15秒限制。请将视频模型切换为 seedance 2.0（非 fast 版本）后重试", totalRefDuration, duration, totalDuration)
			}
		}
	}
	return duration, nil
}

// normalizeWanParams 阿里万相 wan3.0-video 参数规范化：
// 时长范围 2-30 秒；有参考视频时要求「参考视频总时长 + 生成时长 <= 30 秒」（阿里云官方限制）
func normalizeWanParams(ctx context.Context, duration int, videoURLs []string) (int, error) {
	duration = clampDuration(duration, 2, 30)

	if len(videoURLs) > 0 {
		if totalRefDuration := sumRefVideoDuration(ctx, videoURLs); totalRefDuration > 0 {
			totalDuration := totalRefDuration + float64(duration)
			if totalDuration > 30 {
				return 0, fmt.Errorf("参考视频时长(%.1f秒) + 生成时长(%d秒) = %.1f秒，超过 wan3.0-video 模型的30秒限制。请缩短参考视频或生成时长后重试", totalRefDuration, duration, totalDuration)
			}
		}
	}
	return duration, nil
}

// sumRefVideoDuration 汇总参考视频总时长（秒），获取失败的跳过
func sumRefVideoDuration(ctx context.Context, videoURLs []string) float64 {
	var total float64
	for _, vURL := range videoURLs {
		if vURL == "" {
			continue
		}
		refDur, err := getVideoDurationFromURL(ctx, vURL)
		if err != nil {
			log.Printf("[VideoGen] ⚠️ 获取参考视频时长失败，跳过检测: %v", err)
			continue
		}
		log.Printf("[VideoGen] 参考视频时长: %.1fs url=%s", refDur, vURL)
		total += refDur
	}
	return total
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

// findFFprobe 返回 ffprobe 路径
func findFFprobe() string {
	localPath := "/usr/local/Cellar/ffmpeg/8.1.1/bin/ffprobe"
	if _, err := os.Stat(localPath); err == nil {
		return localPath
	}
	return "ffprobe"
}

// getVideoDurationFromURL 下载视频到临时文件并用 ffprobe 获取时长（秒）
func getVideoDurationFromURL(ctx context.Context, videoURL string) (float64, error) {
	// 构造完整 URL
	fullURL := videoURL
	if strings.HasPrefix(fullURL, "/") {
		fullURL = fmt.Sprintf("http://localhost:8080%s", fullURL)
	}

	// 下载到临时文件
	tmpFile, err := os.CreateTemp("", "refvideo_*.mp4")
	if err != nil {
		return 0, fmt.Errorf("create temp file: %w", err)
	}
	tmpPath := tmpFile.Name()
	defer os.Remove(tmpPath)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, fullURL, nil)
	if err != nil {
		tmpFile.Close()
		return 0, fmt.Errorf("create request: %w", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		tmpFile.Close()
		return 0, fmt.Errorf("download video: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		tmpFile.Close()
		return 0, fmt.Errorf("download failed (status=%d)", resp.StatusCode)
	}
	_, err = io.Copy(tmpFile, resp.Body)
	tmpFile.Close()
	if err != nil {
		return 0, fmt.Errorf("save video: %w", err)
	}

	// 用 ffprobe 获取时长
	cmd := exec.CommandContext(ctx, findFFprobe(),
		"-v", "error",
		"-show_entries", "format=duration",
		"-of", "default=noprint_wrappers=1:nokey=1",
		tmpPath,
	)
	output, err := cmd.Output()
	if err != nil {
		return 0, fmt.Errorf("ffprobe: %w", err)
	}

	var duration float64
	if _, err := fmt.Sscanf(strings.TrimSpace(string(output)), "%f", &duration); err != nil {
		return 0, fmt.Errorf("parse duration: %w", err)
	}
	return duration, nil
}
