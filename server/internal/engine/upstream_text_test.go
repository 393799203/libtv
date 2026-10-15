package engine

import (
	"encoding/json"
	"strings"
	"testing"
)

// 文本节点连到图片/视频节点上，此前后端完全不读它的 content（mentions 分支只认 image/video/audio/previz），
// 用户连了等于没连 —— 只有先在面板点「导入提示词」把文字搬进自己的提示词才有效果。
// 这几个用例锁住「连上就算输入」「@引用优先」「不重复拼接」「没连就一个字符都不改」。
func upstreamTextExecCtx(t *testing.T, target string, sources []string, datas map[string]map[string]interface{}) *ExecutionContext {
	t.Helper()
	ec := NewExecutionContext()
	if len(sources) > 0 {
		ec.SetUpstreamMap(map[string][]string{target: sources})
	}
	m := make(map[string]json.RawMessage, len(datas))
	for id, d := range datas {
		m[id] = mustNodeData(t, d)
	}
	ec.SetNodeDataMap(m)
	return ec
}

func TestCollectUpstreamTextFromEdge(t *testing.T) {
	ec := upstreamTextExecCtx(t, "video-1", []string{"text-1", "image-1"}, map[string]map[string]interface{}{
		"text-1":  {"type": "text", "content": "  一只橘猫在窗台上打盹  "},
		"image-1": {"type": "image", "imageUrl": "https://x/a.png"},
	})
	got := collectUpstreamText("video-1", nil, ec)
	if len(got) != 1 || got[0] != "一只橘猫在窗台上打盹" {
		t.Fatalf("上游连着的文本节点应被取到（且首尾空白去掉），实际: %#v", got)
	}
	// 上游图片节点不能被当成文本参考
	if strings.Contains(strings.Join(got, ""), "a.png") {
		t.Fatalf("图片节点混进了文本参考: %#v", got)
	}
}

func TestCollectUpstreamTextMentionWins(t *testing.T) {
	ec := upstreamTextExecCtx(t, "video-1", []string{"text-1", "text-2"}, map[string]map[string]interface{}{
		"text-1": {"type": "text", "content": "连着的文本"},
		"text-2": {"type": "text", "content": "@引用的文本"},
	})
	got := collectUpstreamText("video-1", []promptMention{{ID: "m1", NodeID: "text-2", NodeType: "text"}}, ec)
	if len(got) != 1 || got[0] != "@引用的文本" {
		t.Fatalf("@引用了文本节点时只取被引用的那个，实际: %#v", got)
	}
}

func TestCollectUpstreamTextSkipsEmptyAndNonText(t *testing.T) {
	ec := upstreamTextExecCtx(t, "video-1", []string{"text-1", "audio-1"}, map[string]map[string]interface{}{
		"text-1":  {"type": "text", "content": "   "},
		"audio-1": {"type": "audio", "audioUrl": "https://x/a.mp3", "content": "不该被当文本"},
	})
	if got := collectUpstreamText("video-1", nil, ec); len(got) != 0 {
		t.Fatalf("空内容/非文本节点都不该产生参考文本，实际: %#v", got)
	}
}

func TestComposePromptWithUpstreamText(t *testing.T) {
	// 没有参考文本 → 原样返回（一个字符都不能改，否则会影响所有既有节点的出片）
	if got := composePromptWithUpstreamText("  一只猫在跑  ", nil); got != "  一只猫在跑  " {
		t.Fatalf("没有参考文本时必须原样返回，实际: %q", got)
	}

	// 自己的提示词在前，参考在后并带标记
	got := composePromptWithUpstreamText("镜头缓慢推进", []string{"一只橘猫在窗台上打盹"})
	want := "镜头缓慢推进\n\n[上游文本参考]\n一只橘猫在窗台上打盹"
	if got != want {
		t.Fatalf("拼接结果不符:\n got=%q\nwant=%q", got, want)
	}

	// 自己的提示词为空 → 只用参考文本（连上文本节点就能直接出片）
	if got := composePromptWithUpstreamText("", []string{"一只橘猫"}); got != "一只橘猫" {
		t.Fatalf("空提示词时应直接用参考文本，实际: %q", got)
	}

	// 已经把参考文本搬进自己提示词里（面板「导入提示词」）→ 不重复追加
	own := "视频运动提示词：一只橘猫在窗台上打盹"
	if got := composePromptWithUpstreamText(own, []string{"一只橘猫在窗台上打盹"}); got != own {
		t.Fatalf("参考文本已在提示词里就不该重复拼接，实际: %q", got)
	}

	// 多个文本节点按顺序拼接
	got = composePromptWithUpstreamText("", []string{"第一段", "第二段"})
	if got != "第一段\n\n第二段" {
		t.Fatalf("多段参考拼接不符，实际: %q", got)
	}

	// 超长参考文本按上限截断（视频模型 prompt 有长度上限，文本节点里可能是整段剧本）
	long := strings.Repeat("猫", upstreamTextMaxRunes+500)
	got = composePromptWithUpstreamText("", []string{long})
	if !strings.Contains(got, "...[truncated]") {
		t.Fatalf("超长参考文本应被截断并留标记，实际长度=%d", len([]rune(got)))
	}
	if n := len([]rune(strings.TrimSuffix(got, "\n...[truncated]"))); n > upstreamTextMaxRunes {
		t.Fatalf("截断后仍超过上限: %d", n)
	}
}