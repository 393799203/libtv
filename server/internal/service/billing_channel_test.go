package service

import (
	"testing"

	"libtv/internal/model"
)

// 账单展示口径：渠道独立成列（打标签），模型列只放纯模型 ID。
// 历史账单把渠道拼进了模型名，必须在读取时拆开 —— 拆错等于把模型名改坏（对账看不了），
// 所以边界要钉住：只有 wasu-/dianxin- 前缀才拆，纯模型 ID / 已带渠道列的记录不动。
func TestNormalizeBillingChannel(t *testing.T) {
	cases := []struct {
		name        string
		rec         model.BillingRecord
		wantChannel string
		wantModel   string
	}{
		{
			name:        "历史记录：wasu 前缀拆开",
			rec:         model.BillingRecord{Model: "wasu-cdance2.5-0807"},
			wantChannel: "wasu",
			wantModel:   "cdance2.5-0807",
		},
		{
			name:        "历史记录：dianxin 前缀拆开",
			rec:         model.BillingRecord{Model: "dianxin-wan3.0-video"},
			wantChannel: "dianxin",
			wantModel:   "wan3.0-video",
		},
		{
			name:        "历史记录：没有前缀就不猜渠道",
			rec:         model.BillingRecord{Model: "deepseek-v4-flash"},
			wantChannel: "",
			wantModel:   "deepseek-v4-flash",
		},
		{
			name:        "新记录：渠道列已有值，模型名保持原样",
			rec:         model.BillingRecord{Model: "doubao-seedance-2.0-fast", Channel: "dianxin"},
			wantChannel: "dianxin",
			wantModel:   "doubao-seedance-2.0-fast",
		},
		{
			name:        "非模型调用（充值为空模型名）",
			rec:         model.BillingRecord{Model: ""},
			wantChannel: "",
			wantModel:   "",
		},
		{
			// 保护：真正的模型 ID 不会被误拆（线上模型名里没有 wasu-/dianxin- 开头的）
			name:        "形似但非前缀的模型名不动",
			rec:         model.BillingRecord{Model: "wasu"},
			wantChannel: "",
			wantModel:   "wasu",
		},
		{
			// 人工校正过的历史记录：渠道列已是真实渠道（dianxin），模型文本还留着旧前缀
			// → 模型列剥掉前缀显示纯 ID，渠道列不被前缀覆盖（渠道列才是权威）
			name:        "渠道列优先于模型名前缀",
			rec:         model.BillingRecord{Model: "wasu-cdance2.5-0807", Channel: "dianxin"},
			wantChannel: "dianxin",
			wantModel:   "cdance2.5-0807",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			NormalizeBillingChannel(&tc.rec)
			if tc.rec.Channel != tc.wantChannel {
				t.Errorf("channel = %q, 期望 %q", tc.rec.Channel, tc.wantChannel)
			}
			if tc.rec.Model != tc.wantModel {
				t.Errorf("model = %q, 期望 %q", tc.rec.Model, tc.wantModel)
			}
		})
	}

	// 空指针不该 panic（列表接口对每条记录都调一次）
	NormalizeBillingChannel(nil)
}
