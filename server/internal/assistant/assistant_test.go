package assistant

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"libtv/internal/config"
	"libtv/internal/llm"
)

// 说明：本仓库此前没有任何 Go 测试，这是第一份。
// 之所以从这里开始：意图解析是**概率性输入 + 严格输出**的组合，
// 模型什么时候多打一个 ``` 围栏、少一个必填参数，都无法靠手测覆盖；
// 而这段逻辑一旦出错，用户看到的是「助手明明答应了却什么都没发生」。
//
// 这些用例只覆盖纯函数（不碰 LLM、不碰数据库），所以无需任何环境即可运行。

func TestParseModelOutput(t *testing.T) {
	cases := []struct {
		name    string
		raw     string
		wantErr bool
		wantCmd string
	}{
		{
			name:    "裸 JSON",
			raw:     `{"reply":"好","commands":[{"command":"create_node","args":{"nodeType":"text"}}]}`,
			wantCmd: "create_node",
		},
		{
			// 最常见的情况：提示词明确要求不要围栏，模型仍然加上
			name:    "```json 围栏",
			raw:     "```json\n{\"reply\":\"好\",\"commands\":[{\"command\":\"update_node\",\"args\":{\"nodeId\":\"n1\",\"label\":\"x\"}}]}\n```",
			wantCmd: "update_node",
		},
		{
			name:    "``` 无语言围栏",
			raw:     "```\n{\"reply\":\"好\",\"commands\":[]}\n```",
			wantCmd: "",
		},
		{
			// 模型先寒暄一句再给 JSON
			name:    "前后有解释文字",
			raw:     "好的，我来处理。\n{\"reply\":\"好\",\"commands\":[{\"command\":\"connect_nodes\",\"args\":{\"sourceId\":\"a\",\"targetId\":\"b\"}}]}\n还需要别的吗？",
			wantCmd: "connect_nodes",
		},
		{name: "完全不是 JSON", raw: "我不太确定你是什么意思", wantErr: true},
		{name: "空字符串", raw: "", wantErr: true},
		{name: "残缺 JSON", raw: `{"reply":"好","commands":[`, wantErr: true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			out, err := parseModelOutput(tc.raw)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("期望报错，实际解析成功: %+v", out)
				}
				return
			}
			if err != nil {
				t.Fatalf("期望成功，实际报错: %v", err)
			}
			if tc.wantCmd == "" {
				if len(out.Commands) != 0 {
					t.Fatalf("期望无命令，实际 %d 条", len(out.Commands))
				}
				return
			}
			if len(out.Commands) != 1 || out.Commands[0].Command != tc.wantCmd {
				t.Fatalf("期望命令 %s，实际 %+v", tc.wantCmd, out.Commands)
			}
		})
	}
}

func TestValidateCommand(t *testing.T) {
	cases := []struct {
		name    string
		cmd     Command
		wantErr bool
	}{
		{
			name: "合法的 create_node",
			cmd:  Command{Command: "create_node", Args: map[string]any{"nodeType": "text"}},
		},
		{
			name: "create_node 带 label 与 prompt",
			cmd: Command{Command: "create_node", Args: map[string]any{
				"nodeType": "image", "label": "首帧图", "prompt": "一只橘猫",
			}},
		},
		{
			name:    "白名单外的命令（M0 未开放 run_nodes）",
			cmd:     Command{Command: "run_nodes", Args: map[string]any{"nodeIds": []any{"n1"}}},
			wantErr: true,
		},
		{
			name:    "模型编造的命令名",
			cmd:     Command{Command: "delete_everything", Args: map[string]any{}},
			wantErr: true,
		},
		{
			name:    "缺少必填参数 nodeType",
			cmd:     Command{Command: "create_node", Args: map[string]any{}},
			wantErr: true,
		},
		{
			name:    "nodeType 不在枚举内（group 不开放）",
			cmd:     Command{Command: "create_node", Args: map[string]any{"nodeType": "group"}},
			wantErr: true,
		},
		{
			name:    "参数类型不对（nodeType 传了数字）",
			cmd:     Command{Command: "create_node", Args: map[string]any{"nodeType": 123}},
			wantErr: true,
		},
		{
			name: "合法的 connect_nodes",
			cmd:  Command{Command: "connect_nodes", Args: map[string]any{"sourceId": "a", "targetId": "b"}},
		},
		{
			name:    "自连应被拒绝",
			cmd:     Command{Command: "connect_nodes", Args: map[string]any{"sourceId": "a", "targetId": "a"}},
			wantErr: true,
		},
		{
			name: "合法的 update_node",
			cmd:  Command{Command: "update_node", Args: map[string]any{"nodeId": "n1", "label": "新名字"}},
		},
		{
			// 放行的话前端会「执行成功但什么都没变」，用户看着像卡住
			name:    "update_node 只有 nodeId、没指定改什么",
			cmd:     Command{Command: "update_node", Args: map[string]any{"nodeId": "n1"}},
			wantErr: true,
		},
		{
			name:    "update_node 字段是空白字符串也算没指定",
			cmd:     Command{Command: "update_node", Args: map[string]any{"nodeId": "n1", "label": "   "}},
			wantErr: true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateCommand(tc.cmd)
			if tc.wantErr && err == nil {
				t.Fatalf("期望被拒绝，实际通过")
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("期望通过，实际被拒绝: %v", err)
			}
		})
	}
}

// TestInterpretDropsIllegalCommands 非法命令必须被丢掉，且**保留合法的那条**。
// 模型经常一次给多条，不能因为其中一条越界就把整轮回复作废。
func TestInterpretDropsIllegalCommands(t *testing.T) {
	s := &Service{}
	out := s.interpret(`{"reply":"好","commands":[
		{"command":"create_node","args":{"nodeType":"text"}},
		{"command":"rm_rf","args":{}},
		{"command":"create_node","args":{"nodeType":"group"}}
	]}`, false)

	if len(out.Commands) != 1 {
		t.Fatalf("期望只保留 1 条合法命令，实际 %d 条: %+v", len(out.Commands), out.Commands)
	}
	if out.Commands[0].Command != "create_node" {
		t.Fatalf("保留的命令不对: %+v", out.Commands[0])
	}
	if out.Rejected != 2 {
		t.Fatalf("期望拦下 2 条，实际 %d", out.Rejected)
	}
}

// TestInterpretNeverErrors 解析失败要降级成一句人话，而不是让请求 500。
func TestInterpretNeverErrors(t *testing.T) {
	s := &Service{}
	out := s.interpret("我今天不太想干活", false)
	if out == nil {
		t.Fatal("interpret 不应返回 nil")
	}
	if len(out.Commands) != 0 {
		t.Fatalf("解析失败时不应有命令，实际 %+v", out.Commands)
	}
	if strings.TrimSpace(out.Reply) == "" {
		t.Fatal("解析失败时必须给一句回复，否则用户看到空气泡")
	}
}

// TestIsSpendingFailsSafe 未登记的命令一律按「花钱」处理：
// 宁可多弹一次确认，也不能因为漏登记而静默扣费。
func TestIsSpendingFailsSafe(t *testing.T) {
	if IsSpending("run_nodes") != true {
		t.Fatal("run_nodes 应当被判定为花钱（当前未登记在 M0 白名单里）")
	}
	if IsSpending("create_node") != false {
		t.Fatal("create_node 应当被判定为不花钱")
	}
}

// TestSystemPromptListsAllCommands 提示词里的命令清单必须是**从代码现场生成**的。
// 这条断言存在的意义：手写清单一旦与白名单分叉，模型就会对着不存在的命令名输出，
// 表现成「它说会做但做不到」，是极难排查的一类 bug。
func TestSystemPromptListsAllCommands(t *testing.T) {
	p := systemPrompt()
	for _, spec := range Specs() {
		if !strings.Contains(p, spec.Name) {
			t.Fatalf("提示词里缺少命令 %s", spec.Name)
		}
		for argName := range spec.Args {
			if !strings.Contains(p, argName) {
				t.Fatalf("命令 %s 的参数 %s 没写进提示词", spec.Name, argName)
			}
		}
	}
	// 已经暴露的枚举值也要写进去，否则模型会瞎猜 nodeType
	if !strings.Contains(p, "previz") {
		t.Fatal("提示词里缺少 nodeType 的枚举取值")
	}
}

// TestBuildUserPromptCarriesCanvas 画布摘要必须进提示词，且超量节点要被截断。
func TestBuildUserPromptCarriesCanvas(t *testing.T) {
	nodes := make([]CanvasNode, 0, maxPromptNodes+10)
	for i := 0; i < maxPromptNodes+10; i++ {
		nodes = append(nodes, CanvasNode{ID: "n" + itoa(i), Type: "image", Label: "图", Status: "success"})
	}
	req := &Request{
		Message: "把第一个和第二个连起来",
		Context: Context{ProjectID: "p1", Nodes: nodes, SelectedIDs: []string{"n0"}, Credits: 3000},
	}
	p := buildUserPrompt(req)

	if !strings.Contains(p, "把第一个和第二个连起来") {
		t.Fatal("提示词里没有用户原话")
	}
	if !strings.Contains(p, "n0") || !strings.Contains(p, "用户当前选中") {
		t.Fatal("选中标记没进提示词，指代解析会失准")
	}
	if !strings.Contains(p, "未列出") {
		t.Fatal("超出上限的节点应有截断提示，否则模型会以为画布就这么大")
	}
	if strings.Count(p, "- n") > maxPromptNodes {
		t.Fatalf("节点数超过上限未被截断")
	}
}

// TestInterpretTruncatedOutputDegrades 被 max_tokens 截断的输出要走「听不懂」降级路径，
// 而不是崩掉或返回半截 JSON。截断与「模型不听话」对外表现一样，但日志要能分辨。
func TestInterpretTruncatedOutputDegrades(t *testing.T) {
	s := &Service{}
	// 典型的截断残片：JSON 开到一半
	out := s.interpret(`{"reply":"好，我来帮你","commands":[{"command":"create_no`, true)

	if out == nil {
		t.Fatal("interpret 不应返回 nil")
	}
	if len(out.Commands) != 0 {
		t.Fatalf("截断的输出不应产生任何命令，实际: %+v", out.Commands)
	}
	if strings.TrimSpace(out.Reply) == "" {
		t.Fatal("截断时必须给一句回复，否则用户看到空气泡")
	}
}

// TestSystemPromptKeepsFallbackRules 锁住两条**最容易被后人删掉**的对话规则。
//
// 为什么值得单独立测：这两条都不是功能性的，删掉后代码照样跑、单测照样过，
// 但用户体验会明显退化 ——
//
//	第 7 条：答不上来时不给任何能接的话，对话就断在那儿了；
//	第 8 条：有命令却写成问句，会让用户以为助手在等他确认，其实已经执行了。
//
// 两者都是线上实测踩出来的，所以固化成断言。
func TestSystemPromptKeepsFallbackRules(t *testing.T) {
	p := systemPrompt()

	if !strings.Contains(p, "引回画布") {
		t.Error("提示词里缺少「答不上来时把话题引回画布」的要求（第 7 条）")
	}
	if !strings.Contains(p, "照着说就能得到结果") {
		t.Error("提示词里缺少「给一句用户照着说就能得到结果的建议」的要求（第 7 条）")
	}
	if !strings.Contains(p, "陈述句") {
		t.Error("提示词里缺少「有 commands 时 reply 必须用陈述句」的要求（第 8 条）")
	}
	// 反面例子比正面规则更能约束模型，删了它规则会明显变松
	if !strings.Contains(p, "反例") {
		t.Error("提示词里缺少反例示范，规则的约束力会明显下降")
	}
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	var b []byte
	for i > 0 {
		b = append([]byte{byte('0' + i%10)}, b...)
		i /= 10
	}
	return string(b)
}

// TestUsageRecorderCapturesTokens 锁住「平台侧 token 成本会被记下来」这条链路。
//
// 为什么值得单测：对话不扣用户积分，成本全在平台，所以 assistant_logs 里的
// token 数是**唯一**能回答「助手一个月花了多少」的数据。而这条链路有个很坏的失败模式 ——
// 采集器没挂上时 UsageFrom 返回 nil，Snapshot() 安静地回全 0，
// 落库照常成功、测试全绿、界面上毫无异常，只是成本永远显示为 0。
// 所以这里用一个本地假上游把真实数字钉死，不依赖网络。
func TestUsageRecorderCapturesTokens(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"id":"1","object":"chat.completion","model":"m",`+
			`"choices":[{"index":0,"message":{"role":"assistant","content":"{\"reply\":\"好\",\"commands\":[]}"},"finish_reason":"stop"}],`+
			`"usage":{"prompt_tokens":600,"completion_tokens":200,"total_tokens":800}}`)
	}))
	defer srv.Close()

	cfg := config.AIConfig{Providers: map[string]config.ProviderConfig{
		"wasu": {APIKey: "test", BaseURL: srv.URL},
	}}
	client := llm.NewClient(cfg, llm.ChannelWasu)

	// 与 Service.Chat 里完全一致的用法：先挂采集器，再发起调用
	ctx := llm.WithUsageRecorder(context.Background())
	if _, err := client.ChatWithModel(ctx, "m", "sys", "hi"); err != nil {
		t.Fatalf("调用假上游失败: %v", err)
	}

	total, completion, _, calls := llm.UsageFrom(ctx).Snapshot()
	if calls != 1 {
		t.Fatalf("期望登记 1 次调用，实际 %d 次", calls)
	}
	if total != 800 {
		t.Errorf("total_tokens = %d，期望 800（采集器没挂上时会静默记 0）", total)
	}
	if completion != 200 {
		t.Errorf("completion_tokens = %d，期望 200", completion)
	}
}
