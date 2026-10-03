package llm

import (
	"context"
	"testing"
)

// TestRecordSubmittedTaskFiresHook 任务号一到手就必须通知上层（executor 靠它写对账表）。
//
// 回归的是线上反馈：生成还在跑的那几分钟里，后台对账页上什么都看不到 ——
// 因为记录只在生成出结论时才写。这里保证「拿到任务号」这一刻就有回调，
// 且回调拿到的是**补齐后**的 provider/model（调用方可能只传了 taskID）。
func TestRecordSubmittedTaskFiresHook(t *testing.T) {
	var gotProvider, gotModel, gotTaskID string
	calls := 0

	holder := NewAsyncTaskRef(42, "video-1")
	holder.Provider, holder.Model = "dianxin", "cdance2.5-0807"

	ctx := WithAsyncTaskHolder(context.Background(), holder)
	ctx = WithTaskSubmittedHook(ctx, func(provider, model, taskID string) {
		calls++
		gotProvider, gotModel, gotTaskID = provider, model, taskID
	})

	// 调用方只知道 taskID（华数取结果路径就是这样），provider/model 由登记里补齐
	RecordSubmittedTask(ctx, "", "", "task-abc")

	if calls != 1 {
		t.Fatalf("期望回调 1 次，实际 %d 次", calls)
	}
	if gotTaskID != "task-abc" {
		t.Fatalf("任务号不对: %s", gotTaskID)
	}
	if gotProvider != "dianxin" || gotModel != "cdance2.5-0807" {
		t.Fatalf("应当补齐登记里的渠道/模型，实际 provider=%s model=%s", gotProvider, gotModel)
	}
	if holder.TaskID != "task-abc" {
		t.Fatalf("登记本身也要写任务号，实际 %s", holder.TaskID)
	}
}
