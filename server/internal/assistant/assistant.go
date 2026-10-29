package assistant

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"libtv/internal/llm"
	"libtv/internal/model"

	"gorm.io/datatypes"
	"gorm.io/gorm"
)

// ============================================================
//  传输类型
// ============================================================

// Command 模型解析出的一个操作命令。
// 字段名与前端约定一致（command / args），不要改成 skill——见 commands.go 顶部的术语说明。
type Command struct {
	Command string         `json:"command"`
	Args    map[string]any `json:"args"`
}

// CanvasNode 前端传来的**节点摘要**。
//
// 刻意只要这 4 个字段：完整画布 JSON 里含大量 URL / base64 产物，
// 既没必要又贵，还有隐私问题。指代解析只需要 id + 类型 + 名字。
type CanvasNode struct {
	ID     string `json:"id"`
	Type   string `json:"type"`
	Label  string `json:"label"`
	Status string `json:"status"`
}

// Context 当前画布上下文（精简）。
type Context struct {
	ProjectID   string       `json:"projectId"`
	Nodes       []CanvasNode `json:"nodes"`
	SelectedIDs []string     `json:"selectedIds"`
	Credits     int64        `json:"credits"`
}

// Turn 一轮历史对话。
type Turn struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// Request 助手请求。
type Request struct {
	Message string  `json:"message"`
	Context Context `json:"context"`
	Recent  []Turn  `json:"recent"`
}

// Result 助手返回。
type Result struct {
	Reply       string    `json:"reply"`
	Commands    []Command `json:"commands"`
	NeedConfirm bool      `json:"needConfirm"`
	// LogID 本次交互的日志 ID：前端执行完 / 撤销后带回来更新回执字段
	LogID int64 `json:"logId"`
	// Rejected 被白名单或参数校验拦下的命令数（>0 说明模型越界或白名单该扩了）
	Rejected int `json:"rejected"`
}

// ============================================================
//  服务
// ============================================================

// ChannelResolver 解析用户当前渠道；由 service.ChannelService 实现。
// 这里用接口而不是直接依赖 service 包，避免 assistant ← service 的方向耦合。
type ChannelResolver interface {
	ResolveUserChannel(ctx context.Context, userID string) string
}

// Service 助手服务：把自然语言翻译成白名单内的画布命令。
//
// 它**不做任何画布操作、不扣费**——那是前端的职责。
// 后端只负责「听懂」，执行权留在前端，这是本方案的安全边界。
type Service struct {
	llmClient    *llm.Client
	modelManager *llm.ModelManager
	channels     ChannelResolver
	db           *gorm.DB
}

func NewService(llmClient *llm.Client, modelManager *llm.ModelManager, channels ChannelResolver, db *gorm.DB) *Service {
	return &Service{llmClient: llmClient, modelManager: modelManager, channels: channels, db: db}
}

// 单次意图识别的输出上限。
// 回复本来就要求 ≤ 2 句，这里给足 JSON 结构 + 少量话术即可；
// 收紧同时也是成本闸门（对话不扣用户积分，token 成本全在平台）。
const maxAssistantTokens = 1024

// 历史轮数上限：再多对意图识别帮助有限，却会让每次调用的 token 线性上涨。
const maxRecentTurns = 8

// 落库时的文本截断长度，防止超长输入撑爆日志表
const maxLogTextLen = 2000

// Chat 处理一次对话。
func (s *Service) Chat(ctx context.Context, userID string, req *Request) (*Result, error) {
	started := time.Now()

	if strings.TrimSpace(req.Message) == "" {
		return nil, fmt.Errorf("消息不能为空")
	}

	// 渠道：模型按渠道隔离（同一 ID 在两个渠道可能是不同模型），必须先解析
	channel := ""
	if s.channels != nil {
		channel = s.channels.ResolveUserChannel(ctx, userID)
	}
	// 用量采集：对话不扣用户积分，但平台侧的 token 成本要能看见
	ctx = llm.WithUsageRecorder(ctx)
	if channel != "" {
		ctx = llm.WithChannel(ctx, channel)
	}

	modelID := s.pickModel(channel)
	if modelID == "" {
		return nil, fmt.Errorf("当前渠道没有可用的文本模型")
	}

	// 注意：**不传 WithThinkingDisabled**。
	// 那个开关并非所有上游都接受（电信渠道的 glm 传了会直接 InvalidParameter），
	// 而这里的模型是运营在 models.yaml 上标的渠道默认值 —— 随时可能被换成 glm 之类的模型。
	// 助手是通用入口，不该在某次纯配置变更后就整条链路报错，所以宁可慢一点、稳一点。
	resp, err := s.llmClient.ChatWithModel(
		ctx, modelID,
		systemPrompt(),
		buildUserPrompt(req),
		llm.WithTemperature(0.2), // 意图识别要的是稳定，不是创意
		llm.WithMaxTokens(maxAssistantTokens),
	)
	if err != nil {
		return nil, fmt.Errorf("llm chat: %w", err)
	}
	if len(resp.Choices) == 0 {
		return nil, fmt.Errorf("模型没有返回内容")
	}

	content := resp.Choices[0].Message.Content
	if content == "" && resp.Choices[0].Message.ReasoningContent != "" {
		// 推理模型可能把内容放在 reasoning_content 里
		content = resp.Choices[0].Message.ReasoningContent
	}

	result := s.interpret(content)

	// 落库：解析失败也要记（那正是最该复盘的坏例）
	logID := s.writeLog(userID, req, result, modelID, time.Since(started))
	result.LogID = logID
	return result, nil
}

// interpret 把模型输出解析成「回复 + 合法命令」。
//
// 解析失败一律**降级成一句道歉**而不是报错：助手听不懂不应该让整个请求 500，
// 那对用户是莫名其妙的一次失败；回一句「没太听懂，换个说法？」体验上合理得多。
func (s *Service) interpret(raw string) *Result {
	parsed, err := parseModelOutput(raw)
	if err != nil {
		log.Printf("[Assistant] ⚠ 模型输出解析失败: %v | 原始输出前 200 字: %.200s", err, raw)
		return &Result{
			Reply: "抱歉，我没太听懂。可以换个说法，或者告诉我你想在画布上做什么？",
		}
	}

	valid := make([]Command, 0, len(parsed.Commands))
	rejected := 0
	for _, c := range parsed.Commands {
		if err := validateCommand(c); err != nil {
			log.Printf("[Assistant] ⛔ 丢弃非法命令 %q: %v", c.Command, err)
			rejected++
			continue
		}
		valid = append(valid, c)
	}

	reply := strings.TrimSpace(parsed.Reply)
	if reply == "" {
		reply = "好的，我这就处理。"
	}

	return &Result{
		Reply:       reply,
		Commands:    valid,
		NeedConfirm: parsed.NeedConfirm || anySpending(valid),
		Rejected:    rejected,
	}
}

// anySpending 只要有一条命令会花钱，就要求前端确认。
// 这是 fail-safe：不依赖模型在 needConfirm 里说实话。
func anySpending(cmds []Command) bool {
	for _, c := range cmds {
		if IsSpending(c.Command) {
			return true
		}
	}
	return false
}

// validateCommand 白名单 + 参数校验。
func validateCommand(c Command) error {
	spec := Spec(c.Command)
	if spec == nil {
		return fmt.Errorf("不在白名单内")
	}
	if c.Args == nil {
		c.Args = map[string]any{}
	}

	for name, as := range spec.Args {
		raw, ok := c.Args[name]
		if !ok || raw == nil {
			if as.Required {
				return fmt.Errorf("缺少必填参数 %s", name)
			}
			continue
		}
		switch as.Type {
		case "string":
			val, ok := raw.(string)
			if !ok {
				return fmt.Errorf("参数 %s 必须是字符串", name)
			}
			if len(as.Enum) > 0 && !contains(as.Enum, val) {
				return fmt.Errorf("参数 %s 取值非法: %q", name, val)
			}
		case "stringArray":
			arr, ok := raw.([]any)
			if !ok {
				return fmt.Errorf("参数 %s 必须是数组", name)
			}
			for _, item := range arr {
				if _, ok := item.(string); !ok {
					return fmt.Errorf("参数 %s 的元素必须是字符串", name)
				}
			}
		default:
			return fmt.Errorf("参数 %s 的类型未定义", name)
		}
	}

	if spec.ExtraValidate != nil {
		return spec.ExtraValidate(c.Args)
	}
	return nil
}

func contains(list []string, v string) bool {
	for _, s := range list {
		if s == v {
			return true
		}
	}
	return false
}

// pickModel 取当前渠道的默认文本模型。
// 解析不到就返回空，由调用方报错——不猜模型，避免把请求打到不该去的模型上。
func (s *Service) pickModel(channel string) string {
	if s.modelManager == nil {
		return ""
	}
	return s.modelManager.DefaultLLMModelID(channel)
}

// ============================================================
//  解析模型输出
// ============================================================

// modelOutput 模型应当返回的 JSON 结构
type modelOutput struct {
	Reply       string    `json:"reply"`
	Commands    []Command `json:"commands"`
	NeedConfirm bool      `json:"needConfirm"`
}

// parseModelOutput 从模型输出里抠出 JSON。
//
// 即便提示词反复要求「只输出 JSON」，模型仍会时不时加上 ```json 围栏或一句开场白，
// 所以这里先剥围栏、再按首个 { 到最后一个 } 截取——比直接 Unmarshal 稳得多。
func parseModelOutput(raw string) (*modelOutput, error) {
	s := strings.TrimSpace(raw)
	s = stripCodeFence(s)

	start := strings.Index(s, "{")
	end := strings.LastIndex(s, "}")
	if start < 0 || end <= start {
		return nil, fmt.Errorf("输出里找不到 JSON 对象")
	}
	s = s[start : end+1]

	var out modelOutput
	if err := json.Unmarshal([]byte(s), &out); err != nil {
		return nil, fmt.Errorf("JSON 解析失败: %w", err)
	}
	return &out, nil
}

// stripCodeFence 去掉 ```json ... ``` / ``` ... ``` 包裹
func stripCodeFence(s string) string {
	if !strings.HasPrefix(s, "```") {
		return s
	}
	if i := strings.Index(s, "\n"); i >= 0 {
		s = s[i+1:]
	}
	if i := strings.LastIndex(s, "```"); i >= 0 {
		s = s[:i]
	}
	return strings.TrimSpace(s)
}

// ============================================================
//  日志
// ============================================================

func (s *Service) writeLog(userID string, req *Request, result *Result, modelID string, cost time.Duration) int64 {
	if s.db == nil {
		return 0
	}

	commands, err := json.Marshal(result.Commands)
	if err != nil {
		commands = []byte("[]")
	}

	row := model.AssistantLog{
		UserID:    userID,
		Message:   truncate(req.Message, maxLogTextLen),
		Reply:     truncate(result.Reply, maxLogTextLen),
		Commands:  datatypes.JSON(commands),
		Rejected:  result.Rejected,
		Model:     modelID,
		LatencyMs: cost.Milliseconds(),
	}
	if err := s.db.Create(&row).Error; err != nil {
		// 日志失败不能影响主流程
		log.Printf("[Assistant] ⚠ 交互日志写入失败: %v", err)
		return 0
	}
	return row.ID
}

// truncate 按 rune 截断，避免把多字节汉字切成半个
func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}
