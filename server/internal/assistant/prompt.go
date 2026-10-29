package assistant

import (
	"fmt"
	"sort"
	"strings"
)

// ============================================================
//  提示词
// ============================================================
//
// 命令清单是**从 commandSpecs 现场生成**的，不是手写一份。
// 手写的话，加命令时一定会忘记同步提示词，模型就会对着一个不存在的命令名输出，
// 表现成「它明明说会却做不到」——这类 bug 极难排查。

// maxPromptNodes 单次塞进提示词的节点数上限。
// 画布可以有几百个节点，全塞进去会让 token 暴涨且噪音过大；
// 超出的部分只报数量，并提示模型「如需操作具体节点请先让用户选中」。
const maxPromptNodes = 60

const assistantRules = `你是 libtv（漫蛙AI）创作画布里的助手，名字叫「蛙导」。

你的唯一职责：听懂用户想对**画布**做什么，把它翻译成下面列出的命令，交给前端执行。

## 硬性规则
1. 只输出**一个 JSON 对象**，不要输出任何解释文字、不要用 markdown 代码块包裹。
2. 只能使用下面【可用命令】里列出的命令。没有能对应的命令时，commands 用空数组，并在 reply 里说明你暂时还做不到。
3. 你**不能**直接操作画布、不能生成图片或视频、不能扣费。你只负责把意图翻译成命令。
4. 不要编造节点 ID。只能使用【当前画布】里真实出现过的 ID。
5. reply 是给用户看的，**最多两句**，用搭档的口吻。不要用「请点击」「第一步」「您需要」这类教程腔或客服腔。
6. 指代不明确时（例如用户说「那个节点」，但画布上有多个候选）**不要猜**：commands 留空，在 reply 里问一句是哪一个。

## 关于积分（用户问起时照这个说，不要自己发挥）
- 和你对话**不消耗积分**；新建节点、连线、改参数这些操作也不消耗。
- 只有真正让 AI 生成内容（图片 / 视频 / 音频 / 剧本）才扣积分，价格取决于所选模型，界面上会显示。
- 你手里**没有价目表**，具体多少钱、还剩多少，一概不要编数字，让用户看界面上显示的即可。

## 输出格式
{"reply":"给用户的一句话","commands":[{"command":"命令名","args":{}}],"needConfirm":false}

## 可用命令
`

// systemPrompt 生成系统提示词（含从代码现场生成的命令清单）
func systemPrompt() string {
	var b strings.Builder
	b.WriteString(assistantRules)

	for _, spec := range Specs() {
		fmt.Fprintf(&b, "\n- %s：%s\n", spec.Name, spec.Description)
		b.WriteString("  args:\n")

		// 参数按名排序：保证同一份配置每次生成完全一致的提示词，
		// 便于 diff 排查「改了配置之后模型行为为什么变了」
		names := make([]string, 0, len(spec.Args))
		for n := range spec.Args {
			names = append(names, n)
		}
		sort.Strings(names)

		for _, n := range names {
			a := spec.Args[n]
			need := "可选"
			if a.Required {
				need = "必填"
			}
			enum := ""
			if len(a.Enum) > 0 {
				enum = "，取值限于：" + strings.Join(a.Enum, " | ")
			}
			fmt.Fprintf(&b, "    %s（%s，%s%s）：%s\n", n, a.Type, need, enum, a.Desc)
		}
	}
	return b.String()
}

// buildUserPrompt 拼出本轮的用户消息：画布摘要 + 历史 + 用户原话
func buildUserPrompt(req *Request) string {
	var b strings.Builder

	b.WriteString("## 当前画布\n")
	if req.Context.ProjectID == "" {
		b.WriteString("（用户还没进入任何项目）\n")
	}
	fmt.Fprintf(&b, "用户积分：%d\n", req.Context.Credits)
	fmt.Fprintf(&b, "节点总数：%d\n", len(req.Context.Nodes))

	if len(req.Context.Nodes) > 0 {
		selected := make(map[string]bool, len(req.Context.SelectedIDs))
		for _, id := range req.Context.SelectedIDs {
			selected[id] = true
		}

		b.WriteString("节点列表：\n")
		limit := len(req.Context.Nodes)
		if limit > maxPromptNodes {
			limit = maxPromptNodes
		}
		for _, n := range req.Context.Nodes[:limit] {
			line := fmt.Sprintf("- %s [%s]", n.ID, n.Type)
			if n.Label != "" {
				line += " " + n.Label
			}
			if n.Status != "" {
				line += fmt.Sprintf("（%s）", n.Status)
			}
			if selected[n.ID] {
				line += " ← 用户当前选中"
			}
			b.WriteString(line + "\n")
		}
		if len(req.Context.Nodes) > limit {
			fmt.Fprintf(&b, "（还有 %d 个节点未列出；若用户指的是具体节点，让他先选中）\n",
				len(req.Context.Nodes)-limit)
		}
	}

	if len(req.Context.SelectedIDs) > 0 {
		fmt.Fprintf(&b, "用户选中了：%s\n", strings.Join(req.Context.SelectedIDs, ", "))
	} else {
		b.WriteString("用户当前没有选中任何节点。\n")
	}

	// 历史只带最近若干轮：再多对意图识别帮助有限，token 却线性上涨
	if len(req.Recent) > 0 {
		recent := req.Recent
		if len(recent) > maxRecentTurns {
			recent = recent[len(recent)-maxRecentTurns:]
		}
		b.WriteString("\n## 最近对话\n")
		for _, t := range recent {
			role := "用户"
			if t.Role == "assistant" {
				role = "你"
			}
			fmt.Fprintf(&b, "%s：%s\n", role, truncate(strings.TrimSpace(t.Content), 300))
		}
	}

	b.WriteString("\n## 用户这次说\n")
	b.WriteString(strings.TrimSpace(req.Message))
	return b.String()
}
