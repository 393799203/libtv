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

// VideoMetadata 视频元数据（doubao-seedance 系列 / 火山引擎格式）
type VideoMetadata struct {
	Resolution    string             `json:"resolution"`     // "1080p"
	Ratio         string             `json:"ratio"`          // "16:9"
	GenerateAudio bool               `json:"generate_audio"` // false
	Watermark     bool               `json:"watermark"`      // 去水印（false=无水印）
	Content       []VideoContentItem `json:"content"`        // 参考图列表
}

// WanMediaItem 阿里万相 wan3.0 媒体素材
// Type: first_frame/last_frame/reference_image/reference_video
// 注意：reference_* 与 first_frame/last_frame 互斥，不能混用
type WanMediaItem struct {
	Type string `json:"type"`
	URL  string `json:"url"`
}

// WanVideoMetadata 阿里万相 wan3.0 元数据。
// 网关（new-api ali 渠道）会把 metadata 按键名合并进 DashScope 请求的
// input/parameters 两个对象，平铺的 resolution/ratio/content 键会被静默丢弃，
// 所以必须使用这个嵌套结构
type WanVideoMetadata struct {
	Input      WanVideoInput      `json:"input"`
	Parameters WanVideoParameters `json:"parameters"`
}

// WanVideoInput wan3.0 输入（media 为空时整个字段省略）
type WanVideoInput struct {
	Media []WanMediaItem `json:"media,omitempty"`
}

// WanVideoParameters wan3.0 参数
type WanVideoParameters struct {
	Resolution string `json:"resolution"` // 480P/720P/1080P
	Ratio      string `json:"ratio"`      // adaptive/16:9/4:3/1:1/3:4/9:16
	Audio      bool   `json:"audio"`      // 是否输出音轨
	Watermark  bool   `json:"watermark"`  // false=无水印
}

// VideoRequest 视频生成请求
type VideoRequest struct {
	Model    string `json:"model"`
	Prompt   string `json:"prompt"`
	Duration int    `json:"duration"`
	Metadata any    `json:"metadata"` // seedance: VideoMetadata；wan3.0: WanVideoMetadata
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

// mediaItem 统一收集的参考素材。
// role 词汇两家 API 相同（first_frame/last_frame/reference_image/reference_video），
// 由各自的模型构建器转换成各自的请求格式
type mediaItem struct {
	url     string
	role    string // 空 = seedance 单图参考（无 role）
	isVideo bool
}

// GenerateVideo 调用视频生成API，按模型分派到对应的请求构建器：
// wan3.0（阿里万相）→ buildWanRequest；其他（doubao-seedance 系列）→ buildSeedanceRequest
// imageURLs: 参考图列表。videoURLs: 参考视频列表。
// videoMode 决定 role：first-last-frame=首尾帧(first_frame/last_frame)，其他模式=参考
// generateAudio: 是否生成音频（true=生成声音，false=静音）
func (c *VideoClient) GenerateVideo(ctx context.Context, model string, prompt string, duration int, resolution string, ratio string, imageURLs []string, videoURLs []string, videoMode string, generateAudio bool) (string, error) {
	if resolution == "" {
		resolution = "1080p"
	}
	if ratio == "" {
		ratio = "16:9"
	}

	var payload []byte
	var err error
	if strings.Contains(model, "wan3.0") {
		payload, err = c.buildWanRequest(ctx, model, prompt, duration, resolution, ratio, imageURLs, videoURLs, videoMode, generateAudio)
	} else {
		payload, err = c.buildSeedanceRequest(ctx, model, prompt, duration, resolution, ratio, imageURLs, videoURLs, videoMode, generateAudio)
	}
	if err != nil {
		return "", err
	}

	videoURL, err := c.doRequest(ctx, payload)
	if err != nil {
		return "", err
	}

	log.Printf("[VideoGen] ✅ 视频生成成功: url=%s", videoURL)
	return videoURL, nil
}

// ==================== 豆包 Seedance 系列（火山引擎）====================

// buildSeedanceRequest 构建豆包 Seedance 请求体：
// 平铺 metadata（resolution/ratio/generate_audio + content[image_url/video_url + role]）
func (c *VideoClient) buildSeedanceRequest(ctx context.Context, model string, prompt string, duration int, resolution string, ratio string, imageURLs []string, videoURLs []string, videoMode string, generateAudio bool) ([]byte, error) {
	origDuration := duration
	duration, err := normalizeSeedanceParams(ctx, model, duration, videoURLs)
	if err != nil {
		return nil, err
	}
	logDurationNormalized(origDuration, duration)

	// seedance 角色规则：首尾帧=first_frame/last_frame；全能参考=reference_image；
	// 单图无 mode=不填 role；参考视频=reference_video
	items := c.collectMedia(ctx, imageURLs, videoURLs, videoMode, "")

	content := make([]VideoContentItem, 0, len(items))
	for _, it := range items {
		entry := VideoContentItem{Role: it.role}
		if it.isVideo {
			entry.Type = "video_url"
			entry.VideoURL = &VideoContentImage{URL: it.url}
		} else {
			entry.Type = "image_url"
			entry.ImageURL = &VideoContentImage{URL: it.url}
		}
		content = append(content, entry)
	}

	payload, err := json.Marshal(VideoRequest{
		Model:    model,
		Prompt:   prompt,
		Duration: duration,
		Metadata: VideoMetadata{
			Resolution:    resolution,
			Ratio:         ratio,
			GenerateAudio: generateAudio,
			Content:       content,
		},
	})
	if err != nil {
		return nil, fmt.Errorf("marshal video request: %w", err)
	}

	log.Printf("[VideoGen] 发起请求: model=%s mode=%s duration=%ds resolution=%s ratio=%s imageCount=%d promptLen=%d",
		model, videoModeLabel(videoMode, len(items) > 0), duration, resolution, ratio, len(items), len(prompt))
	return payload, nil
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

// ==================== 阿里万相 wan3.0 ====================

// buildWanRequest 构建阿里万相 wan3.0 请求体：
// 嵌套 metadata（input.media[type/url] + parameters[resolution/ratio/audio/watermark]）。
// 网关（new-api ali 渠道）会把 metadata 按键名合并进 DashScope 请求的
// input/parameters 两个对象，平铺键会被静默丢弃，不能用 seedance 的格式
func (c *VideoClient) buildWanRequest(ctx context.Context, model string, prompt string, duration int, resolution string, ratio string, imageURLs []string, videoURLs []string, videoMode string, generateAudio bool) ([]byte, error) {
	origDuration := duration
	duration, err := normalizeWanParams(ctx, duration, videoURLs)
	if err != nil {
		return nil, err
	}
	logDurationNormalized(origDuration, duration)

	// wan3.0 角色规则：与 seedance 相同，但单图无 mode 也必须带 type，归为 reference_image
	items := c.collectMedia(ctx, imageURLs, videoURLs, videoMode, "reference_image")

	wanMedia := make([]WanMediaItem, 0, len(items))
	for _, it := range items {
		wanMedia = append(wanMedia, WanMediaItem{Type: it.role, URL: it.url})
	}

	payload, err := json.Marshal(VideoRequest{
		Model:    model,
		Prompt:   prompt,
		Duration: duration,
		Metadata: WanVideoMetadata{
			Input: WanVideoInput{Media: wanMedia},
			Parameters: WanVideoParameters{
				Resolution: wanResolution(resolution),
				Ratio:      wanRatio(ratio),
				Audio:      generateAudio,
				Watermark:  false,
			},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("marshal video request: %w", err)
	}

	log.Printf("[VideoGen] 发起请求: model=%s mode=%s duration=%ds resolution=%s ratio=%s imageCount=%d promptLen=%d",
		model, videoModeLabel(videoMode, len(items) > 0), duration, wanResolution(resolution), wanRatio(ratio), len(items), len(prompt))
	return payload, nil
}

// wanResolution 转为万相大写分辨率档位（480P/720P/1080P），非法值回退 1080P
func wanResolution(resolution string) string {
	switch strings.ToUpper(resolution) {
	case "480P":
		return "480P"
	case "720P":
		return "720P"
	default:
		return "1080P"
	}
}

// wanRatio 万相仅支持 adaptive/16:9/4:3/1:1/3:4/9:16，其余（free/21:9 等）回退 adaptive
func wanRatio(ratio string) string {
	switch ratio {
	case "16:9", "4:3", "1:1", "3:4", "9:16":
		return ratio
	default:
		return "adaptive"
	}
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

// ==================== 共享辅助 ====================

// collectMedia 下载/转码参考素材并分配 role（两家 API 的 role 词汇相同）。
// defaultImageRole：单图无 mode 时的角色（seedance 传 ""；wan3.0 传 "reference_image"）
// 首尾帧模式忽略参考视频：wan3.0 规定 first_frame/last_frame 与 reference_* 互斥，
// 混合会被整单拒绝（且首尾帧模式下参考视频本来也没有意义）
func (c *VideoClient) collectMedia(ctx context.Context, imageURLs []string, videoURLs []string, videoMode string, defaultImageRole string) []mediaItem {
	var items []mediaItem

	// 参考图：0张=文生视频；1张=参考；首尾帧模式=first_frame+last_frame
	for i, rawURL := range imageURLs {
		if rawURL == "" {
			continue
		}
		finalURL, err := c.processImageURL(ctx, rawURL)
		if err != nil {
			log.Printf("[VideoGen] ⚠️ 参考图[%d]处理失败，跳过: %v", i, err)
			continue
		}
		item := mediaItem{url: finalURL, role: defaultImageRole}
		// 首尾帧按实际写入顺序分配 first/last，
		// 不能用 imageURLs 原始下标——前面的图为空或处理失败被跳过时会导致角色错位
		if videoMode == "first-last-frame" {
			if len(items) == 0 {
				item.role = "first_frame"
			} else {
				item.role = "last_frame"
			}
		} else if videoMode == "universal-ref" {
			item.role = "reference_image"
		}
		items = append(items, item)
		log.Printf("[VideoGen] ✅ 参考图[%d]已添加: role=%s urlLen=%d", i, item.role, len(finalURL))
	}

	// 参考视频（视频参考/全能参考模式）
	for i, rawURL := range videoURLs {
		if videoMode == "first-last-frame" {
			log.Printf("[VideoGen] ⚠️ 首尾帧模式忽略参考视频[%d]（首尾帧与参考互斥）", i)
			continue
		}
		if rawURL == "" {
			continue
		}
		finalURL, err := c.processImageURL(ctx, rawURL) // 复用同一函数处理URL（本地转base64/公网直传）
		if err != nil {
			log.Printf("[VideoGen] ⚠️ 参考视频[%d]处理失败，跳过: %v", i, err)
			continue
		}
		items = append(items, mediaItem{url: finalURL, role: "reference_video", isVideo: true})
		log.Printf("[VideoGen] ✅ 参考视频[%d]已添加: role=reference_video urlLen=%d", i, len(finalURL))
	}

	// 首尾帧模式限制2张
	if videoMode == "first-last-frame" && len(items) > 2 {
		items = items[:2]
	}
	return items
}

// videoModeLabel 日志用的模式名称
func videoModeLabel(videoMode string, hasMedia bool) string {
	if !hasMedia {
		return "文生视频"
	}
	switch videoMode {
	case "first-last-frame":
		return "首尾帧模式"
	case "video-ref":
		return "视频参考模式"
	case "universal-ref":
		return "全能参考模式"
	default:
		return "参考模式"
	}
}

// logDurationNormalized 时长被钳制时打日志（expected 为扣费时长，actual 为规范化后时长）
func logDurationNormalized(expected, actual int) {
	if expected != actual {
		log.Printf("[VideoGen] duration 规范化: %d → %d", expected, actual)
	}
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
		case "FAIL", "FAILED", "FAILURE", "ERROR", "CANCELED", "CANCELLED":
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
