package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	"libtv/internal/config"
)

// AudioClient 音频生成客户端（TTS，/v1/audio/speech）
type AudioClient struct {
	apiKey  string
	baseURL string
	httpCli *http.Client
}

// NewAudioClient 创建音频生成客户端
func NewAudioClient(cfg config.AIConfig, providerName string) *AudioClient {
	p := cfg.Providers[providerName]
	apiKey := p.APIKey
	baseURL := p.BaseURL

	if apiKey == "" {
		apiKey = cfg.LLM.APIKey
	}
	if baseURL == "" {
		baseURL = cfg.LLM.BaseURL
	}

	return &AudioClient{
		apiKey:  apiKey,
		baseURL: baseURL,
		httpCli: &http.Client{
			Timeout: 5 * time.Minute,
			Transport: &http.Transport{
				DisableKeepAlives:     true,
				IdleConnTimeout:       1 * time.Second,
				ResponseHeaderTimeout: 5 * time.Minute,
			},
		},
	}
}

// TTSRequest TTS 请求体
type TTSRequest struct {
	Model          string         `json:"model"`
	Voice          string         `json:"voice"`
	Input          string         `json:"input"`
	Instructions   string         `json:"instructions"`
	ResponseFormat string         `json:"response_format"`
	AudioOptions   TTSAudioOption `json:"audio_options"`
}

// TTSAudioOption TTS 音频选项
type TTSAudioOption struct {
	LanguageHints []string `json:"language_hints"`
}

// GenerateSpeech 调用 /v1/audio/speech API 生成语音，返回二进制音频数据
// speed: 语速倍率（1.0 为正常）；style: 风格描述；tone: 语气词（如"兴奋"）
func (c *AudioClient) GenerateSpeech(ctx context.Context, model, input, voice string, speed float64, style string, tone string) ([]byte, error) {
	// 清理前端自定义标签，构建 instructions（含语速/风格/语气词）
	processedInput, instructions := convertTTSTags(input, speed, style, tone)

	req := TTSRequest{
		Model:          model,
		Voice:          voice,
		Input:          processedInput,
		Instructions:   instructions,
		ResponseFormat: "wav",
		AudioOptions: TTSAudioOption{
			LanguageHints: []string{"zh"},
		},
	}

	payload, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal tts request: %w", err)
	}

	url := fmt.Sprintf("%s/audio/speech", c.baseURL)
	log.Printf("[AudioGen] TTS请求: model=%s voice=%s url=%s inputLen=%d processedLen=%d", model, voice, url, len(input), len(processedInput))
	log.Printf("[AudioGen] TTS payload: %s", string(payload))

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("create tts request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+c.apiKey)

	start := time.Now()
	resp, err := c.httpCli.Do(httpReq)
	if err != nil {
		log.Printf("[AudioGen] error after %s: %v", time.Since(start), err)
		return nil, fmt.Errorf("tts http request: %w", err)
	}
	defer resp.Body.Close()
	log.Printf("[AudioGen] got response after %s, status=%d", time.Since(start), resp.StatusCode)

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("TTS API error (status=%d): %s", resp.StatusCode, string(body))
	}

	audioData, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read tts audio data: %w", err)
	}

	if len(audioData) == 0 {
		return nil, fmt.Errorf("TTS API 返回空音频数据")
	}

	return audioData, nil
}

// convertTTSTags 清理前端自定义标签，返回纯文本 + instructions
//   - 停顿标签 <#1.2#>：直接移除
//   - 语气词（咳嗽）/（笑声）等：从文本移除，收集到 instructions（兼容旧数据）
//   - tone（语气词字段）、speed（语速倍率）和 style（风格描述）：写入 instructions，由 Qwen3-TTS Instruct 模型解析
func convertTTSTags(input string, speed float64, style string, tone string) (string, string) {
	text := input

	// 1. 移除停顿标签 <#1.2#>
	pauseRegex := regexp.MustCompile(`<#[\d.]+#>`)
	text = pauseRegex.ReplaceAllString(text, "")

	// 2. 提取语气词（中文全角括号或英文半角括号），从文本移除
	var toneHints []string
	cnParenRe := regexp.MustCompile(`（([^（）]+)）`)
	text = cnParenRe.ReplaceAllStringFunc(text, func(match string) string {
		if sub := cnParenRe.FindStringSubmatch(match); len(sub) >= 2 {
			toneHints = append(toneHints, sub[1])
		}
		return ""
	})
	enParenRe := regexp.MustCompile(`\(([^()]+)\)`)
	text = enParenRe.ReplaceAllStringFunc(text, func(match string) string {
		if sub := enParenRe.FindStringSubmatch(match); len(sub) >= 2 {
			toneHints = append(toneHints, sub[1])
		}
		return ""
	})

	// 清理多余空格
	text = strings.TrimSpace(text)
	text = regexp.MustCompile(`\s+`).ReplaceAllString(text, " ")

	// 构建 instructions：语速 + 风格 + 语气词
	var parts []string
	parts = append(parts, "语气自然")

	// 语速：speed=1.0 为正常，<1 慢速，>1 快速
	if speed > 0 && speed != 1.0 {
		if speed < 1.0 {
			parts = append(parts, fmt.Sprintf("语速放慢，约正常速度的%.0f%%", speed*100))
		} else {
			parts = append(parts, fmt.Sprintf("语速加快，约正常速度的%.0f%%", speed*100))
		}
	} else {
		parts = append(parts, "语速适中")
	}

	// 风格
	if strings.TrimSpace(style) != "" {
		parts = append(parts, strings.TrimSpace(style))
	}

	// 语气词：优先使用 tone 字段（前端独立选择，不再插入提示词）
	// 兼容旧数据：若 prompt 文本内嵌 (笑声) 等语气词标签，上面 text-extraction 会收集到 toneHints
	if strings.TrimSpace(tone) != "" {
		parts = append(parts, fmt.Sprintf("带有%s的语气", strings.TrimSpace(tone)))
	} else if len(toneHints) > 0 {
		parts = append(parts, fmt.Sprintf("在对应位置带有%s的语气", strings.Join(toneHints, "、")))
	}

	instructions := strings.Join(parts, "，")

	log.Printf("[AudioGen] 标签转换: original=%q processed=%q toneHints=%v instructions=%s", input, text, toneHints, instructions)
	return text, instructions
}
