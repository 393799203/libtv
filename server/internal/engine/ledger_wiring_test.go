package engine

import (
	"testing"

	"libtv/internal/billing"
)

// TestEveryChargingExecutorHasLedger 每个「会扣费」的执行器都必须拿到对账账本。
//
// 这条测试是补出来的教训：图片执行器接上了账本、文本/剧本/音频漏了（构造函数里少写一个字段，
// 编译不会报错、扣费照旧发生，只是对账表里永远没有这几行 —— 用户被扣的钱在对账页上隐形）。
// 只要新增会扣费的执行器，就在这里加一条断言。
func TestEveryChargingExecutorHasLedger(t *testing.T) {
	ledger := billing.NewLedger(nil)

	text := NewTextExecutor(nil, nil, ledger)
	if text.providerTasks == nil {
		t.Errorf("TextExecutor（故事）没拿到对账账本：扣了费但对账表里没有记录")
	}
	script := NewScriptExecutor(nil, nil, ledger)
	if script.providerTasks == nil {
		t.Errorf("ScriptExecutor（剧本）没拿到对账账本")
	}
	image := NewImageExecutor(nil, nil, nil, nil, nil, ledger)
	if image.providerTasks == nil {
		t.Errorf("ImageExecutor（图片）没拿到对账账本")
	}
	audio := NewAudioExecutor(nil, nil, nil, ledger)
	if audio.providerTasks == nil {
		t.Errorf("AudioExecutor（音频）没拿到对账账本")
	}
	video := NewVideoExecutor(nil, nil, nil, nil, ledger)
	if video.providerTasks == nil {
		t.Errorf("VideoExecutor（视频）没拿到对账账本")
	}
}

// TestSyncTaskKeyIsPerNode 同步调用的对账行编号按「执行+节点」，同一节点重试只更新同一行
func TestSyncTaskKeyIsPerNode(t *testing.T) {
	task := syncTask{ExecID: 1277}
	if got, want := task.key("shot-video-1"), "sync:1277:shot-video-1"; got != want {
		t.Errorf("对账行编号 = %q, want %q", got, want)
	}
}
