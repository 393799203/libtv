package model

import (
	"time"

	"gorm.io/datatypes"
)

// AssistantLog AI 助手交互日志。
//
// 这张表**不参与任何业务逻辑**，唯一用途是评估意图识别质量、沉淀坏例。
// 为什么必须落库：助手的「听懂」是概率性的，准确率没法凭空评估——
// 没有真实语料回流，白名单和提示词就只能靠拍脑袋改。
//
// 其中 UndoneSoon 是最有价值的字段：用户让助手做完操作后很快撤销，
// 说明助手做错了（或没理解对）。这是最直接、最不需要人工标注的负反馈信号。
type AssistantLog struct {
	ID     int64  `gorm:"primaryKey;autoIncrement" json:"id"`
	UserID string `gorm:"size:36;not null;index" json:"user_id"`

	// Message 用户原话（截断后存储，避免超长文本撑爆表）
	Message string `gorm:"type:text" json:"message"`
	// Reply 助手回复
	Reply string `gorm:"type:text" json:"reply"`
	// Commands 解析出的命令数组（原样落库，包含被白名单拒绝的，便于发现「它想做什么但我们没支持」）
	Commands datatypes.JSON `gorm:"type:jsonb" json:"commands"`
	// Rejected 被白名单/参数校验拦下的命令数：>0 说明要么模型在乱来，要么白名单该扩了
	Rejected int `gorm:"not null;default:0" json:"rejected"`
	// Executed 前端是否真的执行了（由前端回执更新）
	Executed bool `gorm:"not null;default:false" json:"executed"`
	// UndoneSoon 执行后短时间内被撤销：最强负反馈信号
	UndoneSoon bool `gorm:"not null;default:false" json:"undone_soon"`
	// Model 实际使用的模型 ID（排查「是不是换了模型就变笨了」）
	Model string `gorm:"size:100" json:"model"`
	// TotalTokens / CompletionTokens 本次对话**平台侧实际消耗**的 token（上游口径）。
	//
	// 为什么必须落库：对话不扣用户积分，这些 token 的成本**全在平台**。
	// 只让 llm 包打一行日志的话（`[LLM] ok: ... usage.total=`），
	// 想回答「每个用户/每天花了多少」就只能去捞容器日志 —— 那基本等于查不了。
	// 注意 completion 里含推理模型的思考 token，它们和正文共用同一个预算。
	TotalTokens      int64 `gorm:"not null;default:0" json:"total_tokens"`
	CompletionTokens int64 `gorm:"not null;default:0" json:"completion_tokens"`
	// LatencyMs 从收到请求到返回命令的耗时
	LatencyMs int64 `gorm:"not null;default:0" json:"latency_ms"`

	CreatedAt time.Time `json:"created_at"`
}
