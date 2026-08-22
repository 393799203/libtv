package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"

	"libtv/internal/config"
)

// ScriptShot LLM 返回的分镜结构
type ScriptShot struct {
	ID                 string `json:"id"`
	ShotNumber         int    `json:"shotNumber"`
	Duration           int    `json:"duration"`
	Visual             string `json:"visual"`
	ShotSize           string `json:"shotSize"`
	CameraMovement     string `json:"cameraMovement"` // 运镜方式（含角度）
	Dialogue           string `json:"dialogue"`
	SoundEffect        string `json:"soundEffect"`
	LightingAtmosphere string `json:"lightingAtmosphere"` // 光影氛围
	ToneHint           string `json:"toneHint"`
}

// Character 角色信息
type Character struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	ImageURL    string `json:"imageUrl,omitempty"` // 用户上传的角色参考图
}

// Scene 场景信息
type Scene struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	TimeOfDay   string `json:"timeOfDay"`          // 早晨/上午/中午/下午/傍晚/夜晚/深夜
	Location    string `json:"location"`           // 具体地点
	Mood        string `json:"mood"`               // 氛围/情绪
	ImageURL    string `json:"imageUrl,omitempty"` // 用户上传的场景参考图
}

// Prop 道具信息
type Prop struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Category    string `json:"category"`           // 服装/武器/交通工具/日常用品/电子设备/其他
	ImageURL    string `json:"imageUrl,omitempty"` // 用户上传的道具参考图
}

// ScriptResult 剧本生成结果
type ScriptResult struct {
	ScriptContent string       `json:"scriptContent"`
	Characters    []Character  `json:"characters"`
	Scenes        []Scene      `json:"scenes"`
	Props         []Prop       `json:"props"`
	Shots         []ScriptShot `json:"shots"`
}

// scriptResponse LLM 原始响应结构
type scriptResponse struct {
	ScriptContent string       `json:"scriptContent"`
	Characters    []Character  `json:"characters"`
	Scenes        []Scene      `json:"scenes"`
	Props         []Prop       `json:"props"`
	Shots         []ScriptShot `json:"shots"`
}

// maxGenerationTokens 文本生成调用的 max_tokens 上限：
// 显式传大值，避免服务端写死小值截断、也避免不传时网关套用小默认值
const maxGenerationTokens = 65536

// GenerateStory 根据用户提示词生成故事剧本文本
// 用于 TextNode：用户输入 prompt → LLM 生成故事 → 填充 content
func GenerateStory(ctx context.Context, client *Client, userPrompt string, model string) (string, error) {
	var resp *ChatResponse
	var err error

	if model != "" {
		// 使用指定的模型
		resp, err = client.ChatWithModel(
			ctx,
			model,
			StorySystemPrompt,
			BuildStoryUserPrompt(userPrompt),
			WithTemperature(0.8),
			WithMaxTokens(maxGenerationTokens),
		)
	} else {
		// 使用默认模型
		resp, err = client.Chat(
			ctx,
			StorySystemPrompt,
			BuildStoryUserPrompt(userPrompt),
			WithTemperature(0.8),
			WithMaxTokens(maxGenerationTokens),
		)
	}

	if err != nil {
		return "", fmt.Errorf("llm chat: %w", err)
	}

	if len(resp.Choices) == 0 {
		return "", fmt.Errorf("empty response from LLM")
	}

	content := resp.Choices[0].Message.Content
	// DeepSeek 推理模型：如果 content 为空但 reasoning_content 有值，使用 reasoning_content
	if content == "" && resp.Choices[0].Message.ReasoningContent != "" {
		content = resp.Choices[0].Message.ReasoningContent
	}

	// 清理可能的 markdown 包裹
	content = cleanMarkdownBlock(content)

	return content, nil
}

// GenerateScript 从文本内容生成结构化分镜剧本（后续脚本节点用）
func GenerateScript(ctx context.Context, client *Client, textContent string, model string) (*ScriptResult, error) {
	var resp *ChatResponse
	var err error

	if model != "" {
		// 使用指定的模型
		resp, err = client.ChatWithModel(
			ctx,
			model,
			ScriptSystemPrompt,
			BuildScriptUserPrompt(textContent),
			WithTemperature(0.7),
			WithMaxTokens(maxGenerationTokens),
		)
	} else {
		// 使用默认模型
		resp, err = client.Chat(
			ctx,
			ScriptSystemPrompt,
			BuildScriptUserPrompt(textContent),
			WithTemperature(0.7),
			WithMaxTokens(maxGenerationTokens),
		)
	}

	if err != nil {
		return nil, fmt.Errorf("llm chat: %w", err)
	}

	if len(resp.Choices) == 0 {
		return nil, fmt.Errorf("empty response from LLM")
	}

	content := resp.Choices[0].Message.Content
	// DeepSeek 推理模型：如果 content 为空但 reasoning_content 有值，使用 reasoning_content
	if content == "" && resp.Choices[0].Message.ReasoningContent != "" {
		content = resp.Choices[0].Message.ReasoningContent
	}

	// 输出被 max_tokens 截断：JSON 必然不完整，直接报明确错误，不再走解析
	if resp.Choices[0].FinishReason == "length" {
		return nil, fmt.Errorf("生成内容超出长度限制被截断，请缩短输入文本或减少镜头数量后重试")
	}

	// 清理可能的 markdown 代码块包裹
	content = cleanJSONMarkdown(content)

	var result scriptResponse
	if err := json.Unmarshal([]byte(content), &result); err != nil {
		// 完整原文写服务端日志（截断展示），返回给前端的错误只带末尾片段：
		// JSON 语法错误看末尾才能区分是截断（ unexpected end ）还是格式错误（少逗号等）
		rawLog := content
		if len(rawLog) > 2000 {
			rawLog = rawLog[:2000] + "..."
		}
		log.Printf("[GenerateScript] JSON 解析失败: %v\nraw: %s", err, rawLog)
		tail := content
		if len(tail) > 200 {
			tail = "..." + tail[len(tail)-200:]
		}
		return nil, fmt.Errorf("模型输出的 JSON 格式有误，请重试（%v）: %s", err, tail)
	}

	// 确保每个 shot 有 ID
	for i := range result.Shots {
		if result.Shots[i].ID == "" {
			result.Shots[i].ID = fmt.Sprintf("shot-%d", i+1)
		}
	}

	// 清理资产名字中的括号（全角和半角都替换为连字符）
	for i := range result.Characters {
		result.Characters[i].Name = cleanAssetName(result.Characters[i].Name)
	}
	for i := range result.Scenes {
		result.Scenes[i].Name = cleanAssetName(result.Scenes[i].Name)
	}
	for i := range result.Props {
		result.Props[i].Name = cleanAssetName(result.Props[i].Name)
	}

	return &ScriptResult{
		ScriptContent: result.ScriptContent,
		Characters:    result.Characters,
		Scenes:        result.Scenes,
		Props:         result.Props,
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

// cleanAssetName 清理资产名字中的括号，将全角和半角括号替换为连字符
// 例如："康熙（黄三）" -> "康熙-黄三"
func cleanAssetName(name string) string {
	name = strings.ReplaceAll(name, "（", "-")
	name = strings.ReplaceAll(name, "）", "-")
	name = strings.ReplaceAll(name, "(", "-")
	name = strings.ReplaceAll(name, ")", "-")
	// 清理可能出现的连续连字符（如 "康熙--黄三"）
	name = strings.ReplaceAll(name, "--", "-")
	// 去除首尾的连字符和空格
	return strings.Trim(name, "- ")
}
