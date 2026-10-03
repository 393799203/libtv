package billing

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"libtv/internal/llm"
)

// TestRefundPolicy 退款规则的唯一判定入口：只有上游明确拒绝才自动退费。
func TestRefundPolicy(t *testing.T) {
	auto := []error{
		fmt.Errorf("%w: 电信视频任务失败: 请求参数不符合要求", llm.ErrUpstreamRejected),
		fmt.Errorf("%w: task failed: 内容审核未通过", llm.ErrUpstreamRejected),
	}
	for _, err := range auto {
		if !ShouldAutoRefund(err) {
			t.Fatalf("上游明确拒绝必须自动退费: %v", err)
		}
	}

	manual := []error{
		nil,
		fmt.Errorf("http request: %w", context.DeadlineExceeded),
		context.Canceled,
		fmt.Errorf("%w（已轮询 300 次 / 25m0s）", llm.ErrVideoPollTimeout),
		errors.New("视频转存失败: connection reset"),
		errors.New("电信视频响应无任务ID: {}"),
	}
	for _, err := range manual {
		if ShouldAutoRefund(err) {
			t.Fatalf("这类失败不能自动退费，必须交人工复核: %v", err)
		}
	}
}

// TestAutoRefundReason 自动退费的原因要写清「是上游拒绝」，对账时能一眼区分于人工退费。
func TestAutoRefundReason(t *testing.T) {
	reason := AutoRefundReason("参数不合法")
	if reason == "" {
		t.Fatal("退费原因不能为空")
	}
	if !strings.Contains(reason, "上游明确拒绝") || !strings.Contains(reason, "参数不合法") {
		t.Fatalf("退费原因应说明是上游拒绝并带上原文: %s", reason)
	}
}
