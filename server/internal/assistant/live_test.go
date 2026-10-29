package assistant

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"libtv/internal/config"
	"libtv/internal/llm"
)

// 联网测试：验证「提示词 → 真实模型 → 解析 → 白名单校验」这条完整链路。
//
// 为什么要它：助手是**概率性输入**驱动的功能。纯函数单测只能证明「给对 JSON 就解析得对」，
// 证明不了「模型愿不愿意给对的 JSON」——而后者才是这类功能唯一的真实风险。
// 提示词改一句话就可能在某个说法上退化，靠手点很难复现，所以固化成用例。
//
// 默认跳过（要花平台的 token）：只在显式设置 ASSISTANT_LIVE=1 时运行。
//
//	ASSISTANT_LIVE=1 go test ./internal/assistant/ -run TestLive -v
//
// 渠道可用 ASSISTANT_CHANNEL 指定（默认 dianxin：线上 44 个用户里 42 个在电信）。
func TestLiveIntentRecognition(t *testing.T) {
	if os.Getenv("ASSISTANT_LIVE") != "1" {
		t.Skip("联网测试默认跳过；设 ASSISTANT_LIVE=1 开启")
	}

	if err := config.Load("../../configs/config.yaml"); err != nil {
		t.Fatalf("加载 config.yaml 失败: %v", err)
	}
	mm, err := llm.NewModelManager("../../configs/models.yaml")
	if err != nil {
		t.Fatalf("加载 models.yaml 失败: %v", err)
	}

	channel := os.Getenv("ASSISTANT_CHANNEL")
	if channel == "" {
		channel = llm.ChannelDianxin
	}
	modelID := mm.DefaultLLMModelID(channel)
	if modelID == "" {
		t.Fatalf("渠道 %s 没有解析出默认文本模型", channel)
	}
	t.Logf("渠道=%s 默认文本模型=%s", channel, modelID)

	// 走真实的 Service.Chat：只有 DB 与渠道解析被替掉（不做日志落库、不查库定渠道），
	// 其余（提示词、模型选择、参数、解析、白名单）全是生产代码路径。
	// 客户端按渠道取凭据 —— 生产里是 router 按 ctx 动态取，这里直接钉死同一个渠道。
	svc := NewService(llm.NewClient(config.C.AI, channel), mm, fixedChannel(channel), nil)

	// 一个「有两张图、都选中」的画布：覆盖指代解析
	canvas := Context{
		ProjectID: "p-test",
		Nodes: []CanvasNode{
			{ID: "i-aaa", Type: "image", Label: "首帧图", Status: "success"},
			{ID: "i-bbb", Type: "image", Label: "尾帧图", Status: "success"},
		},
		SelectedIDs: []string{"i-aaa", "i-bbb"},
		Credits:     3000,
	}
	empty := Context{ProjectID: "p-test", Credits: 3000}

	cases := []struct {
		name     string
		message  string
		canvas   Context
		wantCmd  string   // 期望出现的命令（空 = 期望不产生任何命令）
		wantArgs []string // 期望在 args 里出现的值（子串）
	}{
		{name: "新建文本节点", message: "帮我新建一个文本节点", canvas: empty, wantCmd: "create_node", wantArgs: []string{"text"}},
		{name: "带标题新建图片节点", message: "新建一个图片节点，标题叫首帧图", canvas: empty, wantCmd: "create_node", wantArgs: []string{"image", "首帧图"}},
		{name: "口语化新建视频节点", message: "给我整个视频节点吧", canvas: empty, wantCmd: "create_node", wantArgs: []string{"video"}},
		{name: "把选中的两个连起来", message: "把选中的两个节点连起来", canvas: canvas, wantCmd: "connect_nodes", wantArgs: []string{"i-aaa", "i-bbb"}},
		{name: "改标题", message: "把首帧图那个节点的标题改成开场画面", canvas: canvas, wantCmd: "update_node", wantArgs: []string{"i-aaa"}},
		// 关键负例：范围外/纯咨询的问题**不能编命令**，否则用户会看到莫名其妙的操作
		{name: "范围外的问题（天气）", message: "今天天气怎么样", canvas: canvas, wantCmd: ""},
		{name: "纯咨询（要花多少积分）", message: "新建一个图片节点要花多少积分？", canvas: canvas, wantCmd: ""},
	}

	pass := 0
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
			defer cancel()

			res, err := svc.Chat(ctx, "u-test", &Request{Message: tc.message, Context: tc.canvas})
			if err != nil {
				t.Fatalf("调用失败: %v", err)
			}
			t.Logf("reply=%q commands=%+v rejected=%d", res.Reply, res.Commands, res.Rejected)

			if strings.TrimSpace(res.Reply) == "" {
				t.Fatal("回复为空，用户会看到一个空气泡")
			}

			if tc.wantCmd == "" {
				if len(res.Commands) != 0 {
					t.Fatalf("这个问题不该产生命令，实际: %+v", res.Commands)
				}
				return
			}

			var hit *Command
			for i := range res.Commands {
				if res.Commands[i].Command == tc.wantCmd {
					hit = &res.Commands[i]
					break
				}
			}
			if hit == nil {
				t.Fatalf("期望命令 %s，实际: %+v", tc.wantCmd, res.Commands)
			}
			joined := strings.Join(argStrings(hit.Args), " ")
			for _, want := range tc.wantArgs {
				if !strings.Contains(joined, want) {
					t.Errorf("参数里没找到 %q，实际: %+v", want, hit.Args)
				}
			}
		})
	}
	_ = pass
}

// TestLiveChannelDefaults 记录渠道默认模型的事实（不联网，只读配置）。
// 这两条断言的意义：助手的模型是**运营在 models.yaml 上标的默认值**，
// 一旦它被改成 glm 之类对参数挑剔的模型，assistant.go 里「不传 WithThinkingDisabled」的
// 决定就需要重新评估 —— 让这个前提变更时有人被提醒。
func TestLiveChannelDefaults(t *testing.T) {
	if err := config.Load("../../configs/config.yaml"); err != nil {
		t.Skipf("跳过（配置不可读）: %v", err)
	}
	mm, err := llm.NewModelManager("../../configs/models.yaml")
	if err != nil {
		t.Skipf("跳过（模型配置不可读）: %v", err)
	}

	wasu := mm.DefaultLLMModelID(llm.ChannelWasu)
	dx := mm.DefaultLLMModelID(llm.ChannelDianxin)
	t.Logf("wasu 默认文本模型=%s，dianxin 默认文本模型=%s", wasu, dx)

	if wasu == "" || dx == "" {
		t.Fatal("两个渠道都应能解析出默认文本模型（否则助手上线后可能整渠道不可用）")
	}
	for _, id := range []string{wasu, dx} {
		if strings.Contains(id, "glm") {
			t.Logf("提醒：%s 是 glm —— 它对 thinking 参数挑剔，助手刻意不传该参数的判断仍然正确", id)
		}
	}
}

// fixedChannel 替代真实的渠道路由（避免联网测试依赖数据库）
type fixedChannel string

func (f fixedChannel) ResolveUserChannel(context.Context, string) string { return string(f) }

func argStrings(m map[string]any) []string {
	out := make([]string, 0, len(m))
	for _, v := range m {
		if s, ok := v.(string); ok {
			out = append(out, s)
		}
	}
	return out
}
