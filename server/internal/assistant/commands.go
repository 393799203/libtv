package assistant

import (
	"fmt"
	"strings"
)

// ============================================================
//  命令白名单
// ============================================================
//
// 这是助手安全边界的**唯一入口**：LLM 只能输出这里列出的命令，
// 除此之外的一切输出都会被丢弃。模型不能扩展这个集合。
//
// 术语提醒：这里的「命令 / command」指的是「助手能执行的一个画布操作」，
// 与 docs/skill-integration-design.md 里那个 `skill` **节点类型**不是一回事，
// 新代码不要用 skill 命名，避免两边混淆。

// ArgSpec 单个参数的约束。
//
// 只做「类型 + 枚举」这一档校验：够挡住模型胡编的取值，
// 又不至于让每次扩命令都要写一堆解析代码。
type ArgSpec struct {
	Type     string   // string | stringArray
	Required bool     // 是否必填
	Enum     []string // 非空时限定取值
	Desc     string   // 写进提示词，让模型知道这个参数是什么
}

// CommandSpec 一条命令的完整定义。
type CommandSpec struct {
	Name        string
	Description string
	// Spends 是否会让用户花积分。
	// 注意：这个标记只是**提示前端的默认建议**，真正是否花钱由前端按命令名决定，
	// 不能因为模型把某个花钱命令说成不花钱就跳过确认。
	Spends bool
	Args   map[string]ArgSpec
	// ExtraValidate 跨字段校验（例如 update_node 至少要改一个字段）
	ExtraValidate func(args map[string]any) error
}

// 节点类型枚举：与 web/src/types/canvas.ts 的 NodeType 对齐，但**排除 group**。
// group 只能通过「打组」产生（成员要带 parentId），凭空建一个空组是没有意义的，
// 所以不开放给助手，避免它建出一个用户无法理解的空框。
var creatableNodeTypes = []string{"text", "image", "video", "audio", "script", "previz", "enhance"}

// commandSpecs 白名单本体。
//
// M0 只开放 3 条命令，刻意收窄：意图识别是概率性的，
// 「帮我新建一个文本节点」这一条能稳定做对，比一次上 15 条但错三个更容易建立信任。
// 扩张顺序见 docs/AI助手-智能问答与操作方案.md 的路线图。
var commandSpecs = []CommandSpec{
	{
		Name:        "create_node",
		Description: "在画布上新建一个节点。用户说「新建/加一个/放一个 XX 节点」时用它。",
		Args: map[string]ArgSpec{
			"nodeType": {
				Type:     "string",
				Required: true,
				Enum:     creatableNodeTypes,
				Desc:     "节点类型：text=文本, image=图片, video=视频, audio=音频, script=分镜剧本, previz=白模漫剧, enhance=增强/补帧/高清",
			},
			"label":  {Type: "string", Desc: "节点标题。用户没指定时可以给一个贴合语境的名字，也可以留空"},
			"prompt": {Type: "string", Desc: "预填的提示词/内容。只有当用户明确说出了想做什么内容时才填"},
		},
	},
	{
		Name:        "connect_nodes",
		Description: "把两个节点连起来（数据流：上游输出 → 下游输入）。用户说「连起来/接上/串起来」时用它。",
		Args: map[string]ArgSpec{
			"sourceId": {Type: "string", Required: true, Desc: "上游节点 ID，必须是当前画布里真实存在的 ID"},
			"targetId": {Type: "string", Required: true, Desc: "下游节点 ID，必须是当前画布里真实存在的 ID"},
		},
		ExtraValidate: func(args map[string]any) error {
			src, _ := args["sourceId"].(string)
			dst, _ := args["targetId"].(string)
			if src != "" && src == dst {
				return fmt.Errorf("不能把节点连到自己")
			}
			return nil
		},
	},
	{
		Name:        "update_node",
		Description: "修改已有节点的参数（标题、提示词、模型、文本内容）。用户说「改成/换成/改一下」时用它。",
		Args: map[string]ArgSpec{
			"nodeId":  {Type: "string", Required: true, Desc: "要修改的节点 ID，必须是当前画布里真实存在的 ID"},
			"label":   {Type: "string", Desc: "新的节点标题"},
			"prompt":  {Type: "string", Desc: "新的提示词"},
			"content": {Type: "string", Desc: "新的文本内容（仅文本类节点）"},
			"model":   {Type: "string", Desc: "新的模型 ID"},
		},
		ExtraValidate: func(args map[string]any) error {
			// 至少要改一个字段：模型有时会输出只有 nodeId 的空命令，
			// 放行的话前端会「执行成功但什么都没变」，用户看着像卡住
			for _, k := range []string{"label", "prompt", "content", "model"} {
				if s, ok := args[k].(string); ok && strings.TrimSpace(s) != "" {
					return nil
				}
			}
			return fmt.Errorf("没有指定要修改的内容")
		},
	},
}

// specIndex 命令名 → 定义，供 O(1) 查表
var specIndex = func() map[string]*CommandSpec {
	m := make(map[string]*CommandSpec, len(commandSpecs))
	for i := range commandSpecs {
		m[commandSpecs[i].Name] = &commandSpecs[i]
	}
	return m
}()

// Spec 按名字取命令定义，不存在返回 nil（调用方据此判断是否越界）
func Spec(name string) *CommandSpec {
	return specIndex[name]
}

// Specs 返回全部命令定义（提示词生成用）
func Specs() []CommandSpec {
	return commandSpecs
}

// IsSpending 该命令是否会让用户花积分。
// 未登记的命令按「花钱」处理（fail-safe：宁可多确认一次，也不要静默扣费）。
func IsSpending(name string) bool {
	if s := Spec(name); s != nil {
		return s.Spends
	}
	return true
}
