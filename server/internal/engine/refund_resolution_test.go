package engine

import (
	"testing"

	"libtv/internal/billing"
)

// 退费分录带的计费口径必须与**当初扣费那条分录**逐字一致，而且必须是账单表放得下的短档位。
//
// 锁的是 2026-10-09 13:57 那次线上事故：图片退费把对账展示口径「2K(2560x1440)」（13 字）
// 写进了只有 varchar(10) 的 billing_records.resolution → PG 拒绝 INSERT，而写账单失败只打日志
// 不报错 → 退费被当成成功、对账行标成「已退费」，账面却没有退费分录，
// 自检于是把那一行标成 amount_mismatch（对账页上显示「金额对不上」）。
func TestRefundResolutionMatchesChargedTier(t *testing.T) {
	cases := []struct {
		name     string
		task     syncTask
		expected string
	}{
		{
			name: "图片：口径取扣费时的短档位，不是「档位(尺寸)」展示口径",
			task: syncTask{
				Action:            billing.ActionImage,
				Resolution:        "2K(2560x1440)",
				BillingResolution: "2K",
			},
			expected: "2K",
		},
		{
			name: "图片：老画布没选过档位（扣费分录记的就是空）→ 退费也必须记空",
			task: syncTask{
				Action:            billing.ActionImage,
				Resolution:        "2560x1440",
				BillingResolution: "",
			},
			expected: "",
		},
		{
			name: "图片：4K 档",
			task: syncTask{
				Action:            billing.ActionImage,
				Resolution:        "4K(3840x2160)",
				BillingResolution: "4K",
			},
			expected: "4K",
		},
		{
			name:     "故事/剧本/音频这类没有档位：口径本来就是空",
			task:     syncTask{Action: billing.ActionStory, Resolution: ""},
			expected: "",
		},
		{
			name:     "非图片若带了口径：沿用 Resolution（历史行为不变）",
			task:     syncTask{Action: billing.ActionAudio, Resolution: "480p"},
			expected: "480p",
		},
		{
			name: "兜底：万一口径超长，按账单列宽截断也不能丢整条分录",
			task: syncTask{
				Action:            billing.ActionImage,
				Resolution:        "2K(2560x1440)",
				BillingResolution: "2K(2560x1440)",
			},
			expected: "2K(2560x14",
		},
	}
	for _, c := range cases {
		if got := c.task.refundResolution(); got != c.expected {
			t.Errorf("%s: refundResolution() = %q，期望 %q", c.name, got, c.expected)
		}
	}
}

// 截断只该在「不截就整条分录写不进去」时发生：正常档位必须原样带过去。
func TestBillingResolutionKeepsShortTierAsIs(t *testing.T) {
	for _, ok := range []string{"", "2K", "4K", "480p", "720p", "1080p"} {
		if got := billingResolutionOf(ok, ""); got != ok {
			t.Errorf("正常口径被改动: %q → %q", ok, got)
		}
	}
	// 超长（图片展示口径）走截断分支，且长度正好等于列宽
	long := "2K(2560x1440)"
	got := billingResolutionOf(long, "")
	if len([]rune(got)) != maxBillingResolutionRunes {
		t.Errorf("超长口径应截断到 %d 字，实际 %q", maxBillingResolutionRunes, got)
	}
	// 第一参数为空时退回第二参数（非图片动作的老路径）
	if got := billingResolutionOf("", "1080p"); got != "1080p" {
		t.Errorf("退回参数失效: %q", got)
	}
}
