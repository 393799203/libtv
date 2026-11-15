package billing

import (
	"context"
	"libtv/internal/llm"
	"testing"
)

func TestRefundReasonIsOnlyUpstreamError(t *testing.T) {
	const original = "FutureCode: original Request id: r-1"
	if got := AutoRefundReason("上游明确拒绝本次任务: 电信视频任务失败: " + original); got != original {
		t.Fatalf("refund reason contains added prose: %s", got)
	}
	err := llm.NewUpstreamError(400, `{"error":{"code":"FutureCode","message":"original"}}`, true)
	if !ShouldAutoRefund(err) || !ShouldAutoRefund(llm.WithUpstreamDisplay(err)) {
		t.Fatal("cleaning message changed refund classification")
	}
}

func TestMissingRefundFundsNeverClaimsRefundSuccess(t *testing.T) {
	err := llm.NewUpstreamError(400, `{"error":{"message":"original"}}`, true)
	result := (SyncCall{}).Settle(context.Background(), err)
	if result == nil || result.Error() != "original；需人工核对（缺少可退金额）" {
		t.Fatalf("missing refund amount incorrectly reported: %v", result)
	}
}
