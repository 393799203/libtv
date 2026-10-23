package llm

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"libtv/internal/config"
)

// ImageClient 图像生成客户端（按模型协议分派：OpenAI 兼容 / DashScope 多模态）
type ImageClient struct {
	apiKey  string
	baseURL string
	model   string
	httpCli *http.Client
	router  *ChannelRouter // 渠道路由（多渠道 token 切换用）；nil 时退化为单渠道固定凭据
	// modelManager 用于按 (渠道, 模型) 解析接口协议风格（models.yaml 的 api_style）。
	// 可为 nil（测试/降级装配）→ 一律按 OpenAI 兼容协议，即改动前的行为。
	modelManager *ModelManager
}

// SetModelManager 注入模型管理器，供 generate 解析 api_style。
//
// 用 setter 而不是给 NewImageClient 加形参：装配顺序上 modelManager 一定先于
// imageClient 创建，但加必填参数要改所有调用点；未注入时行为与改动前完全一致
// （apiStyleFor 直接退回 OpenAI 兼容）。
func (c *ImageClient) SetModelManager(mm *ModelManager) {
	c.modelManager = mm
}

// NewImageClient 创建图像生成客户端
func NewImageClient(cfg config.AIConfig, providerName string, router ...*ChannelRouter) *ImageClient {
	p := cfg.Providers[providerName]

	var r *ChannelRouter
	if len(router) > 0 {
		r = router[0]
	}

	return &ImageClient{
		apiKey:  p.APIKey,
		baseURL: p.BaseURL,
		router:  r,
		// 兜底默认模型（业务路径由 ImageExecutor 从 data.Model 传入，此值仅在无 model 参数时使用）；
		// 与 models.yaml 注册的图像模型保持一致
		model: "doubao-seedream-5.0-lite",
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
	// Usage 上游用量（有就记进对账的成本侧；没有就留空 —— 华数/部分网关不回带）
	Usage json.RawMessage `json:"usage"`
	Data  []struct {
		URL string `json:"url"`
	} `json:"data"`
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
	} `json:"error,omitempty"`
}

// GenerateImage 生成图像（文生图，使用默认模型）
func (c *ImageClient) GenerateImage(ctx context.Context, prompt string, size string) ([]string, error) {
	return c.GenerateImageWithModel(ctx, c.model, prompt, size, 1)
}

// GenerateImageWithModel 使用指定模型生成图像（文生图，无参考图）
func (c *ImageClient) GenerateImageWithModel(ctx context.Context, model string, prompt string, size string, n int) ([]string, error) {
	size, n = normalizeImageArgs(size, n)
	log.Printf("[ImageGen] 文生图: model=%s size=%s n=%d", model, size, n)
	return c.generate(ctx, model, prompt, nil, size, n)
}

// GenerateImageFromImage 图生图：基于参考图生成新图像（使用默认model）
func (c *ImageClient) GenerateImageFromImage(ctx context.Context, imageURL string, prompt string, size string) ([]string, error) {
	return c.GenerateImageFromImageWithModel(ctx, c.model, []string{imageURL}, prompt, size, 1)
}

// GenerateImageFromImageWithModel 图生图：基于参考图生成新图像，可指定model与张数。
//
// 这里**刻意没有** guidance_scale：
//  1. 它是「硅基流动扩展格式」的遗留物（旧实现里 SiliconFlowImageRequest 才有该字段），
//     迁到 OpenAI 兼容的 /images/generations 后（见下面 doRequest），请求体只剩
//     model/prompt/size/n/image/watermark，形参 guidanceScale 从此再没被引用过 ——
//     留着它等于「以为传了其实没传」，比删掉更容易误导后来的人。
//  2. 实测上游也不接受：2026-10 对默认图像模型 doubao-seedream-5.0-lite 直接打
//     POST https://token.wasu.cn/v1/images/generations 带 guidance_scale=12，返回
//     400 InvalidParameter「the parameter `guidance_scale` is not supported by the
//     current model」（该渠道是 new-api 网关，会把该字段原样转发给火山 Ark）。
//     也就是说一旦真的写进请求体，图生图会**全量失败**。
//
// 将来若某个图像模型确实支持该参数，必须按模型/渠道灰度下发，不能无条件带上。
func (c *ImageClient) GenerateImageFromImageWithModel(ctx context.Context, model string, imageURLs []string, prompt string, size string, n int) ([]string, error) {
	size, n = normalizeImageArgs(size, n)

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

	log.Printf("[ImageGen] 图生图(多图): model=%s size=%s imageCount=%d n=%d", model, size, len(finalImages), n)
	return c.generate(ctx, model, prompt, finalImages, size, n)
}

// ==================== 协议分派 ====================
//
// 图像模型的上游协议不止一种，差异在**请求体结构与图片在响应里的位置**两处：
//   - OpenAI 兼容（默认，api_style 留空）：POST {base}/images/generations，
//     请求 {model,prompt,size,n,image[]}，图片在 data[].url
//   - DashScope 多模态（api_style=dashscope-multimodal）：POST
//     {base}/services/aigc/multimodal-generation/generation，
//     请求 {model,input:{messages:[{role,content:[{image}|{text}]}]},parameters:{...}}，
//     图片在 output.choices[].message.content[].image
//
// 协议由 models.yaml 的 api_style 指定（见 ModelManager.ImageAPIStyle），
// 不在代码里按模型名硬判 —— 新增同类模型只改配置。

// generate 按模型协议分派请求构建与响应解析。
// images 为空即文生图，非空即图生图（参考图，公网 URL 或 data:base64）。
func (c *ImageClient) generate(ctx context.Context, model, prompt string, images []string, size string, n int) ([]string, error) {
	if c.apiStyleFor(ctx, model) == ImageStyleDashScopeMultimodal {
		return c.generateDashScopeMultimodal(ctx, model, prompt, images, size, n)
	}
	return c.generateOpenAI(ctx, model, prompt, images, size, n)
}

// apiStyleFor 解析本次调用的协议风格；未注入 modelManager 时退回 OpenAI 兼容
func (c *ImageClient) apiStyleFor(ctx context.Context, model string) string {
	if c.modelManager == nil {
		return ImageStyleOpenAI
	}
	return c.modelManager.ImageAPIStyle(ChannelFrom(ctx), model)
}

// normalizeImageArgs 尺寸与张数的统一兜底（两条协议共用）
func normalizeImageArgs(size string, n int) (string, int) {
	if size == "" {
		size = "1920x1080"
	}
	if n <= 0 {
		n = 1
	}
	return size, n
}

// previewBody 截断响应体用于日志（前 800 字符）
func previewBody(b []byte) string {
	const max = 800
	if len(b) > max {
		return string(b[:max])
	}
	return string(b)
}

// ==================== OpenAI 兼容协议 ====================

func (c *ImageClient) generateOpenAI(ctx context.Context, model, prompt string, images []string, size string, n int) ([]string, error) {
	req := ImageRequest{
		Model:  model,
		Prompt: prompt,
		Image:  images,
		Size:   size,
		N:      n,
	}
	payload, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal image request: %w", err)
	}

	respBody, err := c.doPost(ctx, "/images/generations", payload)
	if err != nil {
		return nil, err
	}
	return c.parseOpenAIResponse(ctx, respBody)
}

// parseOpenAIResponse 解析 OpenAI 兼容响应（图片在 data[].url）
func (c *ImageClient) parseOpenAIResponse(ctx context.Context, respBody []byte) ([]string, error) {
	// 打印 API 原始响应（截取前800字符），确认返回的 Data 数组长度
	log.Printf("[ImageGen] API 原始响应: %s", previewBody(respBody))

	var imgResp ImageGenerationResponse
	if err := json.Unmarshal(respBody, &imgResp); err != nil {
		return nil, fmt.Errorf("unmarshal response: %w", err)
	}

	if imgResp.Error != nil {
		// 200 但体内带 error：同样是上游明确拒绝（网关把拒绝包在 200 里返回）
		return nil, fmt.Errorf("%w: Image API error: %s", ErrUpstreamRejected, imgResp.Error.Message)
	}

	// 上游用量登记（对账成本侧；图片按张/按 token 的口径都原样落库）
	recordUpstreamUsage(ctx, imgResp.Usage)

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

// doPost 统一发送请求（渠道路由 + 鉴权 + 状态码处理），返回 200 的响应体。
// path 是挂在渠道 base_url 之后的接口路径（如 /images/generations）。
func (c *ImageClient) doPost(ctx context.Context, path string, payload []byte) ([]byte, error) {
	// 多渠道路由：按 ctx 中的用户渠道动态取 apiKey/baseURL；无 router 时用固定凭据
	apiKey, baseURL := c.apiKey, c.baseURL
	if c.router != nil {
		if p, ok := c.router.Provider(ChannelFrom(ctx)); ok && p.APIKey != "" {
			apiKey, baseURL = p.APIKey, p.BaseURL
		}
	}

	url := fmt.Sprintf("%s%s", strings.TrimRight(baseURL, "/"), path)

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)

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
		if UpstreamRejectedStatus(resp.StatusCode) {
			return nil, fmt.Errorf("%w: Image API error (status=%d): %s", ErrUpstreamRejected, resp.StatusCode, string(respBody))
		}
		// 5xx / 408 / 429：网关或限流，上游可能已经受理了这次生成 —— 不当作「明确拒绝」
		return nil, fmt.Errorf("Image API error (status=%d): %s", resp.StatusCode, string(respBody))
	}

	return respBody, nil
}

// ==================== DashScope 多模态生成协议 ====================

// dashScopeImagePath DashScope 多模态生成接口路径（挂在渠道 base_url 之后）
const dashScopeImagePath = "/services/aigc/multimodal-generation/generation"

// 上游对出图尺寸的硬约束（2026-10-22 实测）：
//   - size 必须是「宽*高」的**星号**格式；传 "1920x1080" 会被
//     400 Invalid size format 拒掉（错误码 InvalidParameter）
//   - 单张图面积必须落在 [262144(512x512), 4194304(2048x2048)] 像素之间
//
// 由此推论：**4K 档（3840x2160≈829万像素）超上限，这个模型做不了 4K** ——
// models.yaml 里该模型因此只列 1K/2K。下面 dashScopeSize 仍保留兜底缩放：
// 老画布/缓存里可能残留 4K，宁可降一档出图，也不要发出去被上游拒
// （被拒会走失败退费，用户白等一次还看不到图）。
const (
	dashScopeMinPixels = 262144
	dashScopeMaxPixels = 4194304
)

// dashScopeImageRequest DashScope 多模态生成请求体
type dashScopeImageRequest struct {
	Model      string                   `json:"model"`
	Input      dashScopeImageInput      `json:"input"`
	Parameters dashScopeImageParameters `json:"parameters"`
}

type dashScopeImageInput struct {
	Messages []dashScopeImageMessage `json:"messages"`
}

type dashScopeImageMessage struct {
	Role    string                 `json:"role"`
	Content []dashScopeContentItem `json:"content"`
}

// dashScopeContentItem 一个多模态片段：{image:url} 或 {text:"..."}，二者互斥。
// 参考图在前、文字指令在后（与官方示例一致；文字里的「图1/图2」按参考图顺序称呼）。
type dashScopeContentItem struct {
	Image string `json:"image,omitempty"`
	Text  string `json:"text,omitempty"`
}

type dashScopeImageParameters struct {
	N         int    `json:"n"`
	Size      string `json:"size,omitempty"`
	Watermark bool   `json:"watermark"`
}

// dashScopeImageResponse DashScope 多模态生成响应。
//
// 图片在 output.choices[].message.content[].image —— 与 OpenAI 的 data[].url 完全不同。
// 注意 n>1 时上游返回的是**一个 choice 内含多个 {image}**（实测 n=2 → 1 个 choice、
// content 里 2 个 image），**不是**多个 choice；所以解析必须遍历 choices 与 content 两层。
type dashScopeImageResponse struct {
	Output struct {
		Choices []struct {
			FinishReason string `json:"finish_reason"`
			Message      struct {
				Role    string                 `json:"role"`
				Content []dashScopeContentItem `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	} `json:"output"`
	// Usage 上游用量：DashScope 图片给的是 {width,height,image_count} 的像素/张数口径，
	// **没有 token** —— recordUpstreamUsage 会原样留摘要、tokens 记 0（不猜换算系数）
	Usage     json.RawMessage `json:"usage"`
	RequestID string          `json:"request_id"`
	// 部分网关会把失败包在 200 里返回（{code,message} / {error:{...}}）
	Code    string `json:"code"`
	Message string `json:"message"`
	Error   *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
		Code    string `json:"code"`
	} `json:"error,omitempty"`
}

// generateDashScopeMultimodal 走 DashScope 多模态生成（文生图与图生图同一套报文：
// 有参考图就往 content 里多塞几个 {image}，没有就只剩 {text}）。
func (c *ImageClient) generateDashScopeMultimodal(ctx context.Context, model, prompt string, images []string, size string, n int) ([]string, error) {
	content := make([]dashScopeContentItem, 0, len(images)+1)
	for _, img := range images {
		content = append(content, dashScopeContentItem{Image: img})
	}
	content = append(content, dashScopeContentItem{Text: prompt})

	req := dashScopeImageRequest{
		Model: model,
		Input: dashScopeImageInput{
			Messages: []dashScopeImageMessage{{Role: "user", Content: content}},
		},
		Parameters: dashScopeImageParameters{
			N:    n,
			Size: dashScopeSize(size),
			// 与 OpenAI 路径保持一致：出图不带水印
			Watermark: false,
		},
	}
	payload, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal dashscope image request: %w", err)
	}

	reqSize := req.Parameters.Size
	if reqSize == "" {
		reqSize = "(上游默认)"
	}
	log.Printf("[ImageGen] DashScope多模态: model=%s size=%s->%s refImages=%d n=%d",
		model, size, reqSize, len(images), n)

	respBody, err := c.doPost(ctx, dashScopeImagePath, payload)
	if err != nil {
		return nil, err
	}
	return c.parseDashScopeResponse(ctx, respBody)
}

// parseDashScopeResponse 解析 DashScope 多模态响应（图片在 output.choices[].message.content[].image）
func (c *ImageClient) parseDashScopeResponse(ctx context.Context, respBody []byte) ([]string, error) {
	log.Printf("[ImageGen] API 原始响应: %s", previewBody(respBody))

	var r dashScopeImageResponse
	if err := json.Unmarshal(respBody, &r); err != nil {
		return nil, fmt.Errorf("unmarshal dashscope response: %w", err)
	}

	// 200 但体内带 error/message 且没有 choices：网关把拒绝包在 200 里返回
	if r.Error != nil && r.Error.Message != "" {
		return nil, fmt.Errorf("%w: Image API error: %s", ErrUpstreamRejected, r.Error.Message)
	}
	if len(r.Output.Choices) == 0 && r.Message != "" {
		return nil, fmt.Errorf("%w: Image API error: %s", ErrUpstreamRejected, r.Message)
	}

	// 上游用量登记（对账成本侧）
	recordUpstreamUsage(ctx, r.Usage)

	// 遍历 choices × content 两层收集图片 URL（见 dashScopeImageResponse 的 n>1 说明）
	urls := make([]string, 0, 1)
	for _, choice := range r.Output.Choices {
		for _, item := range choice.Message.Content {
			if item.Image != "" {
				urls = append(urls, item.Image)
			}
		}
	}
	if len(urls) == 0 {
		// 上游 200 却没给图：带上 finish_reason 便于排查（内容审核拦截也走这里）
		reason := ""
		if len(r.Output.Choices) > 0 {
			reason = r.Output.Choices[0].FinishReason
		}
		return nil, fmt.Errorf("no image generated (dashscope, finish_reason=%q, request_id=%s)", reason, r.RequestID)
	}

	log.Printf("[ImageGen] success: imageCount=%d firstURL=%s", len(urls), urls[0])
	return urls, nil
}

// dashScopeSize 把后端内部尺寸（"1920x1080"）转成 DashScope 要求的 "1920*1080"，
// 并在面积越界时等比缩回上限内（见上方常量注释）。
//
// 返回空串 = 不带 size 字段，交由上游用自己的默认尺寸（比发一个注定被拒的尺寸好）。
func dashScopeSize(size string) string {
	w, h, ok := parseSizeWxH(size)
	if !ok {
		// 认不出的尺寸（含空值）：不发 size，让上游决定
		return ""
	}

	// 面积超上限 → 等比缩放。先取浮点比例再 floor 取整：
	// floor(w*s)*floor(h*s) ≤ (w*s)*(h*s) = 上限，所以一次就够，不必反复压。
	if area := w * h; area > dashScopeMaxPixels {
		scale := math.Sqrt(float64(dashScopeMaxPixels) / float64(area))
		w = int(math.Floor(float64(w) * scale))
		h = int(math.Floor(float64(h) * scale))
		log.Printf("[ImageGen] ⚠️ DashScope 尺寸面积超上限(%d)，已缩放: %s -> %d*%d", area, size, w, h)
	}

	// 面积低于下限：上游同样会拒。这里不放大（放大等于替用户改意图），交给上游默认尺寸
	if w <= 0 || h <= 0 || w*h < dashScopeMinPixels {
		log.Printf("[ImageGen] ⚠️ DashScope 尺寸面积低于下限(%d)，改用上游默认尺寸: %s", w*h, size)
		return ""
	}
	return fmt.Sprintf("%d*%d", w, h)
}

// parseSizeWxH 解析后端内部尺寸串（形如 "1920x1080"）
func parseSizeWxH(size string) (int, int, bool) {
	parts := strings.SplitN(strings.ToLower(strings.TrimSpace(size)), "x", 2)
	if len(parts) != 2 {
		return 0, 0, false
	}
	w, err1 := strconv.Atoi(strings.TrimSpace(parts[0]))
	h, err2 := strconv.Atoi(strings.TrimSpace(parts[1]))
	if err1 != nil || err2 != nil || w <= 0 || h <= 0 {
		return 0, 0, false
	}
	return w, h, true
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
