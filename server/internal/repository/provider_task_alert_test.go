package repository

import "testing"

// 自检写备注的核心要求：只动自己写的那一段，人工备注一个字都不能碰。
func TestStripAlertSegmentKeepsHumanNote(t *testing.T) {
	cases := []struct{ in, want string }{
		// 只有机器写的一段 → 清空
		{"【自动核对】已交付但没有产物地址【核对结束】", ""},
		// 人工备注 + 机器段落 → 只留人工
		{"管理员手动退费（张三）: 上游确认失败；【自动核对】卡在进行中【核对结束】", "管理员手动退费（张三）: 上游确认失败"},
		// 多段（自检反复跑）→ 全部清掉
		{"人工备注；【自动核对】A【核对结束】；【自动核对】B【核对结束】", "人工备注"},
		// 旧数据：机器段落没有结束标记 → 从标记删到结尾
		{"人工备注；【自动核对】旧格式说明", "人工备注"},
		// 没有机器段落 → 原样
		{"人工备注", "人工备注"},
		{"", ""},
		// 机器段落出现在中间：两段人工内容都要保住，且不能粘在一起
		{"前段；【自动核对】X【核对结束】；后段", "前段；后段"},
		// 管理员在机器写完之后又补了话（最容易踩的坑）—— 补的话一个字都不能丢
		{"人工备注；【自动核对】X【核对结束】；后来管理员补充：上游已确认失败", "人工备注；后来管理员补充：上游已确认失败"},
	}
	for _, tc := range cases {
		if got := stripAlertSegment(tc.in); got != tc.want {
			t.Errorf("stripAlertSegment(%q) = %q, 期望 %q", tc.in, got, tc.want)
		}
	}
}

// 反复标记/清除必须幂等：不能越堆越长
func TestStripAlertSegmentIdempotent(t *testing.T) {
	once := stripAlertSegment("人工备注；【自动核对】第一版说明")
	twice := stripAlertSegment(once)
	if once != twice {
		t.Fatalf("清理不幂等: %q → %q", once, twice)
	}
	if once != "人工备注" {
		t.Fatalf("期望保留人工备注，得到 %q", once)
	}
}
