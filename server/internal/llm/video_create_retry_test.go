package llm

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

// TestDoCreateWithRetryRetriesOnce 创建任务超时要重试一次：
//
// 回归的是 10-03 00:04 那次线上事故 —— 创建请求被拖满超时，我们退款收工，
// 上游那边任务照跑照计费（电信按生成后计费），成片也丢了。创建是唯一
// 「拿不到任务号就全瞎」的一步，所以必须重试，且重试要用重建的请求体。
func TestDoCreateWithRetryRetriesOnce(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&calls, 1)
		if n == 1 {
			// 第一次故意拖过超时，逼出「上游没回应」这种最危险的情况
			time.Sleep(300 * time.Millisecond)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"id":"task-ok"}`))
	}))
	defer srv.Close()

	c := &VideoClient{createCli: &http.Client{Timeout: 50 * time.Millisecond}}
	resp, err := c.doCreateWithRetry(context.Background(), "测试创建", func(ctx context.Context) (*http.Request, error) {
		// 每次调用都要新建请求体（bytes.Reader 是一次性读的）
		return http.NewRequestWithContext(ctx, http.MethodPost, srv.URL, nil)
	})
	if err != nil {
		t.Fatalf("重试后应当成功，却报错: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("期望 200，得到 %d", resp.StatusCode)
	}
	if got := atomic.LoadInt32(&calls); got != 2 {
		t.Fatalf("期望一共请求 2 次（1 次超时 + 1 次重试），实际 %d 次", got)
	}
}

// TestDoCreateWithRetryFailsAfterTwoAttempts 两次都没回应才报错，且错误里能看出「连续 2 次」。
func TestDoCreateWithRetryFailsAfterTwoAttempts(t *testing.T) {
	var calls int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&calls, 1)
		time.Sleep(300 * time.Millisecond)
	}))
	defer srv.Close()

	c := &VideoClient{createCli: &http.Client{Timeout: 30 * time.Millisecond}}
	_, err := c.doCreateWithRetry(context.Background(), "测试创建", func(ctx context.Context) (*http.Request, error) {
		return http.NewRequestWithContext(ctx, http.MethodPost, srv.URL, nil)
	})
	if err == nil {
		t.Fatal("两次都超时应当返回错误")
	}
	if got := atomic.LoadInt32(&calls); got != 2 {
		t.Fatalf("期望请求 2 次，实际 %d 次", got)
	}
}
