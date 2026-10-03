package engine

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"libtv/internal/llm"
)

// TestVideoFailureMessageFollowsRefundPolicy 失败文案必须与退费规则一致。
//
// 规则（产品口径）：只有「上游明确报错/拒绝」才自动退费；其余（超时、没拿到任务号、
// 轮询预算耗尽、用户中断、转存失败）一律不自动退，交人工复核。
// 文案说「已退还」而其实没退，用户查余额时会认为被骗 —— 所以这条必须锁住。
func TestVideoFailureMessageFollowsRefundPolicy(t *testing.T) {
	cases := []struct {
		name        string
		err         error
		wantRefund  bool // 文案里是否应出现「已退还」
		wantPending bool // 文案里是否应出现「未自动退还」
	}{
		{
			name:       "上游明确拒绝（参数不合法）",
			err:        fmt.Errorf("%w: 电信视频任务失败: 请求参数不符合要求", llm.ErrUpstreamRejected),
			wantRefund: true,
		},
		{
			name:        "轮询预算耗尽（上游一直在生成中）",
			err:         fmt.Errorf("%w（电信，已等待 25m0s）: taskID=x", llm.ErrVideoPollTimeout),
			wantPending: true,
		},
		{
			name:        "单次请求超时（可能已受理）",
			err:         fmt.Errorf("dianxin video http request: %w", context.DeadlineExceeded),
			wantPending: true,
		},
		{
			name:        "被中断（重启或取消）",
			err:         context.Canceled,
			wantPending: true,
		},
	}

	for _, tc := range cases {
		got := videoFailureMessage(context.Background(), tc.err).Error()
		if tc.wantRefund && !strings.Contains(got, "已退还") {
			t.Fatalf("%s：文案应说明已退还，实际: %s", tc.name, got)
		}
		if tc.wantPending {
			if !strings.Contains(got, "未自动退还") {
				t.Fatalf("%s：文案应说明未自动退还，实际: %s", tc.name, got)
			}
			if strings.Contains(got, "本次扣费已退还") {
				t.Fatalf("%s：文案自相矛盾（一边说不退一边说已退）: %s", tc.name, got)
			}
		}
		if !errors.Is(videoFailureMessage(context.Background(), tc.err), tc.err) {
			// 用 %w 保留错误链，队列的「不重试」判断依赖它
			if !errors.Is(tc.err, llm.ErrVideoPollTimeout) {
				t.Fatalf("%s：错误链被切断，errors.Is 判不出来", tc.name)
			}
		}
	}
}

// TestUpstreamRejectedIsIdentifiable 上游明确报错必须能被 errors.Is 认出来 ——
// 退费规则完全建立在这个判断上。
func TestUpstreamRejectedIsIdentifiable(t *testing.T) {
	wrapped := fmt.Errorf("%w: 电信视频API错误 (status=400): ratio invalid", llm.ErrUpstreamRejected)
	if !errors.Is(wrapped, llm.ErrUpstreamRejected) {
		t.Fatal("包装后应当仍能识别为上游明确拒绝")
	}
	// 超时/网络错误不能被误判成「上游拒绝」，否则又变成无脑自动退费
	ambiguous := []error{
		fmt.Errorf("http request: %w", context.DeadlineExceeded),
		fmt.Errorf("%w（已轮询 300 次）", llm.ErrVideoPollTimeout),
		errors.New("unmarshal response: unexpected end of JSON input"),
	}
	for _, err := range ambiguous {
		if errors.Is(err, llm.ErrUpstreamRejected) {
			t.Fatalf("这类失败不该被当成「上游明确拒绝」: %v", err)
		}
	}
}
