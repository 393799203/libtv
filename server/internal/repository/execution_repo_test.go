package repository

import (
	"strings"
	"testing"
	"unicode/utf8"
)

func TestFailedExecutionCanPersistChineseAndMalformedErrorDetails(t *testing.T) {
	for _, msg := range []string{
		"模型输出错误：" + strings.Repeat("分镜生成失败", 250),
		"JSON 格式错误：" + string([]byte{0xe5, 0x88}),
		strings.Repeat("upstream error ", 200),
	} {
		updates := statusUpdates("failed", msg)
		safe := updates["error_msg"].(string)
		if !utf8.ValidString(safe) || utf8.RuneCountInString(safe) > 1000 {
			t.Fatalf("错误摘要无法写入 PostgreSQL varchar(1000): %q", safe)
		}
		if updates["status"] != "failed" || updates["finished_at"] == nil {
			t.Fatalf("失败终态或完成时间缺失: %+v", updates)
		}
	}
	if got := statusUpdates("running", "")["error_msg"]; got != "" {
		t.Fatalf("重新执行应清除旧错误: %v", got)
	}
}
