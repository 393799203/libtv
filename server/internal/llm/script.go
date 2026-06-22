package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"libtv/internal/config"
)

// ScriptShot LLM 返回的分镜结构
type ScriptShot struct {
	ID            string `json:"id"`
	ShotNumber    int    `json:"shotNumber"`
	Duration      int    `json:"duration"`
	VisualPrompt  string `json:"visualPrompt"`
	ShotSize      string `json:"shotSize"`
	CameraAngle   string `json:"cameraAngle"`
	Dialogue      string `json:"dialogue"`
	SoundEffect   string `json:"soundEffect"`
	CameraMovement string `json:"cameraMovement"`
	ToneHint      string `json:"toneHint"`
}

// Character 角色信息
type Character struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

// ScriptResult 剧本生成结果
type ScriptResult struct {
	ScriptContent string       `json:"scriptContent"`
	Characters    []Character  `json:"characters"`
	Shots         []ScriptShot `json:"shots"`
}

// scriptResponse LLM 原始响应结构
type scriptResponse struct {
	ScriptContent string       `json:"scriptContent"`
	Characters    []Character  `json:"characters"`
	Shots         []ScriptShot `json:"shots"`
}

// GenerateStory 根据用户提示词生成故事剧本文本
// 用于 TextNode：用户输入 prompt → LLM 生成故事 → 填充 content
func GenerateStory(ctx context.Context, client *Client, userPrompt string) (string, error) {
	resp, err := client.Chat(
		ctx,
		StorySystemPrompt,
		BuildStoryUserPrompt(userPrompt),
		WithTemperature(0.8),
		WithMaxTokens(4096),
	)
	if err != nil {
		return "", fmt.Errorf("llm chat: %w", err)
	}

	if len(resp.Choices) == 0 {
		return "", fmt.Errorf("empty response from LLM")
	}

	content := resp.Choices[0].Message.Content

	// 清理可能的 markdown 包裹
	content = cleanMarkdownBlock(content)

	return content, nil
}

// GenerateScript 从文本内容生成结构化分镜剧本（后续脚本节点用）
func GenerateScript(ctx context.Context, client *Client, textContent string) (*ScriptResult, error) {
	resp, err := client.Chat(
		ctx,
		ScriptSystemPrompt,
		BuildScriptUserPrompt(textContent),
		WithTemperature(0.7),
		WithMaxTokens(8192),
	)
	if err != nil {
		return nil, fmt.Errorf("llm chat: %w", err)
	}

	if len(resp.Choices) == 0 {
		return nil, fmt.Errorf("empty response from LLM")
	}

	content := resp.Choices[0].Message.Content

	// 清理可能的 markdown 代码块包裹
	content = cleanJSONMarkdown(content)

	var result scriptResponse
	if err := json.Unmarshal([]byte(content), &result); err != nil {
		return nil, fmt.Errorf("parse script json: %w, raw: %s", err, content)
	}

	// 确保每个 shot 有 ID
	for i := range result.Shots {
		if result.Shots[i].ID == "" {
			result.Shots[i].ID = fmt.Sprintf("shot-%d", i+1)
		}
	}

	return &ScriptResult{
		ScriptContent: result.ScriptContent,
		Characters:    result.Characters,
		Shots:         result.Shots,
	}, nil
}

// NewScriptClient 创建用于剧本生成的 LLM 客户端
func NewScriptClient(cfg config.AIConfig) *Client {
	return NewClient(cfg, cfg.LLM.Provider)
}

// cleanJSONMarkdown 清理 LLM 返回中可能包裹的 ```json ... ``` 标记
func cleanJSONMarkdown(raw string) string {
	raw = strings.TrimSpace(raw)
	// 移除开头的 ```json 或 ```
	if strings.HasPrefix(raw, "```") {
		if idx := strings.Index(raw, "\n"); idx > 0 {
			raw = raw[idx+1:]
		}
	}
	// 移除结尾的 ```
	if strings.HasSuffix(raw, "```") {
		raw = strings.TrimSuffix(raw, "```")
	}
	return strings.TrimSpace(raw)
}

// cleanMarkdownBlock 清理 LLM 返回中可能包裹的 ```markdown ... ``` 或 ``` ... ``` 标记
func cleanMarkdownBlock(raw string) string {
	raw = strings.TrimSpace(raw)
	if strings.HasPrefix(raw, "```") {
		if idx := strings.Index(raw, "\n"); idx > 0 {
			raw = raw[idx+1:]
		}
	}
	if strings.HasSuffix(raw, "```") {
		raw = strings.TrimSuffix(raw, "```")
	}
	return strings.TrimSpace(raw)
}
