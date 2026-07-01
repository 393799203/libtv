package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"time"

	"libtv/internal/config"
)

// Client OpenAI 兼容协议 LLM 客户端
// 支持 SiliconFlow、OpenAI、通义千问等所有兼容 /v1/chat/completions 的 Provider
type Client struct {
	apiKey  string
	baseURL string
	model   string
	httpCli *http.Client
}

// NewClient 创建 LLM 客户端
// 优先从 provider 配置取凭据，fallback 到 llm 字段
func NewClient(cfg config.AIConfig, providerName string) *Client {
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

	return &Client{
		apiKey:  apiKey,
		baseURL: baseURL,
		model:   cfg.LLM.Model,
		httpCli: &http.Client{
			// 整体客户端超时：放宽到 5 分钟，脚本/图像生成长 prompt + 大输出需要更久
				Timeout: 5 * time.Minute,
				// 禁用连接池 keep-alive，避免长跑进程下 IdleConn 被某中间链路污染/死链
				// 每次 Chat 都新建连接
				Transport: &http.Transport{
					DisableKeepAlives:   true,
					MaxIdleConns:        0,
					MaxIdleConnsPerHost: 0,
					IdleConnTimeout:     1 * time.Second,
					// 显式较短 dial 超时，避免依赖 Client.Timeout 等死
					DialContext: (&net.Dialer{
						Timeout:   10 * time.Second,
						KeepAlive: 30 * time.Second,
					}).DialContext,
					TLSHandshakeTimeout: 15 * time.Second,
					// ResponseHeaderTimeout：服务器开始返回 headers 之前的等待上限。
					// 硅基流动的长 prompt/分镜生成经常要 2-3 分钟才开始返回首字节，
					// 90s 远远不够；这里直接对齐 Client.Timeout=5min。
					ResponseHeaderTimeout: 5 * time.Minute,
					ExpectContinueTimeout: 1 * time.Second,
				},
		},
	}
}

// ChatMessage 聊天消息
type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// ChatRequest 聊天补全请求
type ChatRequest struct {
	Model       string        `json:"model"`
	Messages    []ChatMessage `json:"messages"`
	Temperature float64       `json:"temperature,omitempty"`
	MaxTokens   int           `json:"max_tokens,omitempty"`
}

// ChatResponse 聊天补全响应
type ChatResponse struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	Created int64  `json:"created"`
	Model   string `json:"model"`
	Choices []struct {
		Index   int `json:"index"`
		Message struct {
			Role    string `json:"role"`
			Content string `json:"content"`
		} `json:"message"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
	} `json:"error,omitempty"`
}

// Chat 发起聊天补全请求（使用客户端默认模型）
func (c *Client) Chat(ctx context.Context, systemPrompt, userMessage string, opts ...Option) (*ChatResponse, error) {
	return c.ChatWithModel(ctx, c.model, systemPrompt, userMessage, opts...)
}

// ChatWithModel 发起聊天补全请求（指定模型）
func (c *Client) ChatWithModel(ctx context.Context, model, systemPrompt, userMessage string, opts ...Option) (*ChatResponse, error) {
	reqOpts := &chatOptions{
		Temperature: 0.7,
		MaxTokens:   4096,
	}
	for _, opt := range opts {
		opt(reqOpts)
	}

	body := ChatRequest{
		Model: model,
		Messages: []ChatMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userMessage},
		},
		Temperature: reqOpts.Temperature,
		MaxTokens:   reqOpts.MaxTokens,
	}

	payload, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("marshal chat request: %w", err)
	}

	url := fmt.Sprintf("%s/chat/completions", c.baseURL)
	log.Printf("[LLM] request: model=%s url=%s userMsgLen=%d", model, url, len(userMessage))

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)

	log.Printf("[LLM] sending request...")
	start := time.Now()
	resp, err := c.httpCli.Do(httpReq)
	if err != nil {
		log.Printf("[LLM] error after %s: %v", time.Since(start), err)
		return nil, fmt.Errorf("http request: %w", err)
	}
	defer resp.Body.Close()
	log.Printf("[LLM] got response headers after %s, status=%d", time.Since(start), resp.StatusCode)

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response body: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		log.Printf("[LLM] http error: status=%d body=%s", resp.StatusCode, string(respBody))
		return nil, fmt.Errorf("LLM API error (status=%d): %s", resp.StatusCode, string(respBody))
	}

	var chatResp ChatResponse
	if err := json.Unmarshal(respBody, &chatResp); err != nil {
		return nil, fmt.Errorf("unmarshal response: %w", err)
	}

	if chatResp.Error != nil {
		log.Printf("[LLM] api error: %s", chatResp.Error.Message)
		return nil, fmt.Errorf("LLM error: %s", chatResp.Error.Message)
	}

	if len(chatResp.Choices) == 0 {
		log.Printf("[LLM] empty choices, body=%s", string(respBody))
	} else {
		log.Printf("[LLM] ok: model=%s contentLen=%d usage.total=%d", chatResp.Model, len(chatResp.Choices[0].Message.Content), chatResp.Usage.TotalTokens)
	}

	return &chatResp, nil
}

// ---- 可选参数 ----

type chatOptions struct {
	Temperature float64
	MaxTokens   int
}

type Option func(*chatOptions)

func WithTemperature(t float64) Option {
	return func(o *chatOptions) { o.Temperature = t }
}

func WithMaxTokens(n int) Option {
	return func(o *chatOptions) { o.MaxTokens = n }
}

// ---- 提示词生成方法 ----

// GeneratePrompt 生成提示词（画面 + 运动一起生成）
// 返回：画面提示词、运动提示词、错误
func (c *Client) GeneratePrompt(
	ctx context.Context,
	model string,
	shotData ShotDataForGeneration,
	characters []AssetReference,
	scenes []AssetReference,
	props []AssetReference,
) (string, string, error) {
	// 构建系统提示词和用户消息（从 prompt.go 获取）
	systemPrompt := PromptGenerationSystemPrompt
	userMessage := BuildPromptGenerationUserMessage(shotData, characters, scenes, props)

	// 调用 LLM
	resp, err := c.ChatWithModel(ctx, model, systemPrompt, userMessage, WithTemperature(0.7), WithMaxTokens(2048))
	if err != nil {
		return "", "", err
	}

	if len(resp.Choices) == 0 {
		return "", "", fmt.Errorf("LLM 返回空响应")
	}

	// 解析响应，提取画面提示词和运动提示词（从 prompt.go 获取）
	content := resp.Choices[0].Message.Content
	storyboardPrompt, motionPrompt := parsePromptResponse(content)

	return storyboardPrompt, motionPrompt, nil
}
