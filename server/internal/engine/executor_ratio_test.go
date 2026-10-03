package engine

import "testing"

// 自适应比例：'adaptive' 是新枚举值，'free' 是历史值，两者都必须落到 16:9 兜底，
// 不能走到按 ":" 切分的分支（那样会解析失败再兜底，日志里还会出现误导性的比例字样）。
func TestCalculateSizeAdaptiveRatio(t *testing.T) {
	aw, ah := calculateSizeFromResolutionAndRatio("1K", "adaptive")
	lw, lh := calculateSizeFromResolutionAndRatio("1K", "free")
	ew, eh := calculateSizeFromResolutionAndRatio("1K", "")
	if aw != lw || ah != lh || aw != ew || ah != eh {
		t.Fatalf("三种写法应当一致: adaptive=%dx%d free=%dx%d 空=%dx%d", aw, ah, lw, lh, ew, eh)
	}
	if aw <= 0 || ah <= 0 {
		t.Fatalf("尺寸不合法: %dx%d", aw, ah)
	}
	// 显式比例仍按比例算，且与自适应不同
	gotW, gotH := calculateSizeFromResolutionAndRatio("1K", "9:16")
	if gotW == aw && gotH == ah {
		t.Fatalf("9:16 与自适应尺寸相同(%dx%d)，说明比例没生效", gotW, gotH)
	}
}
