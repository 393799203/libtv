package llm

import "testing"

func TestSeedanceRatio(t *testing.T) {
	cases := []struct {
		name        string
		ratio       string
		hasRefVideo bool
		want        string
	}{
		// 有参考视频：无论节点选了什么，上游都要求 adaptive（视频延长）
		{"有参考视频+16:9", "16:9", true, "adaptive"},
		{"有参考视频+9:16", "9:16", true, "adaptive"},
		{"有参考视频+自适应", "free", true, "adaptive"},
		{"有参考视频+空", "", true, "adaptive"},
		// 无参考视频：选「自适应」要落成 adaptive，别的原样透传
		{"无参考视频+自适应", "free", false, "adaptive"},
		{"无参考视频+空", "", false, "adaptive"},
		{"无参考视频+auto", "auto", false, "adaptive"},
		{"无参考视频+16:9", "16:9", false, "16:9"},
		{"无参考视频+9:16", "9:16", false, "9:16"},
		{"无参考视频+1:1", "1:1", false, "1:1"},
		{"大小写与空格", " FREE ", false, "adaptive"},
	}
	for _, tc := range cases {
		if got := seedanceRatio(tc.ratio, tc.hasRefVideo); got != tc.want {
			t.Errorf("%s: seedanceRatio(%q, %v) = %q, 期望 %q", tc.name, tc.ratio, tc.hasRefVideo, got, tc.want)
		}
	}
}
