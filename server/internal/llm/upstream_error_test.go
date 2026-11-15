package llm

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestUpstreamErrorKeepsMessageCodeAndRequestIDWithoutPrefixes(t *testing.T) {
	for _, tc := range []struct {
		body, code, message, requestID string
	}{
		{`{"error":{"code":"InvalidParameter.WidthTooSmall","message":"Width must be between 300px and 6000px."},"request_id":"request-1"}`, "InvalidParameter.WidthTooSmall", "Width must be between 300px and 6000px.", "request-1"},
		{`{"code":"fail_to_fetch_task","message":"{\"error\":{\"code\":\"InvalidParameter\",\"message\":\"bad input\"}}","request_id":"request-2"}`, "InvalidParameter", "bad input", "request-2"},
		{`{"output":{"task_status":"FAILED","code":"DataInspectionFailed","message":"blocked output"},"request_id":"request-3"}`, "DataInspectionFailed", "blocked output", "request-3"},
		{`{"code":"success","data":{"status":"FAIL","fail_reason":"{\"error\":{\"code\":\"FutureCode\",\"message\":\"original message\"}}"}}`, "FutureCode", "original message", ""},
		{`The request failed because the output video may be related to copyright restrictions. Request id: exact-request`, "", "The request failed because the output video may be related to copyright restrictions. Request id: exact-request", ""},
		{`{"error":{"code":"OnlyCode"}}`, "OnlyCode", "", ""},
		{`{"code":429,"message":"slow down","request_id":"numeric"}`, "429", "slow down", "numeric"},
		{`{"code":null,"message":"original","data":[]}`, "", "original", ""},
		{`{"error":{"message":"original"},"data":[{"url":"unrelated"}]}`, "", "original", ""},
	} {
		err := NewUpstreamError(400, tc.body, true)
		var upstream *UpstreamError
		if !errors.As(err, &upstream) || !errors.Is(err, ErrUpstreamRejected) {
			t.Fatal("lost structured error or rejection classification")
		}
		if upstream.Code != tc.code || (tc.message != "" && upstream.Message != tc.message) || upstream.RequestID != tc.requestID {
			t.Fatalf("lost upstream fields: %+v", upstream)
		}
		if upstream.Raw != tc.body || strings.Contains(err.Error(), "上游明确拒绝") || strings.Contains(err.Error(), "视频任务失败") {
			t.Fatalf("modified raw body or added a prefix: %s", err)
		}
		if tc.code != "" && !strings.Contains(err.Error(), tc.code) {
			t.Fatalf("code not visible: %s", err)
		}
	}
}

func TestDianxinPollAcceptsNumericErrorCodes(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"status":"failed","error":{"code":1234,"message":"original failure"}}`))
	}))
	defer upstream.Close()
	client := &VideoClient{baseURL: upstream.URL, httpCli: upstream.Client(), pollInterval: time.Millisecond, pollTimeout: time.Second}
	_, err := client.pollDianxinVideoTask(context.Background(), "task")
	if err == nil || err.Error() != "1234: original failure" || !errors.Is(err, ErrUpstreamRejected) {
		t.Fatalf("numeric error code lost: %v", err)
	}
}

func TestUpstreamHTTPClassificationUnchanged(t *testing.T) {
	for _, code := range []int{400, 401, 403, 408, 429, 500, 502} {
		err := NewUpstreamError(code, `{"error":{"code":"FutureCode","message":"original"}}`, UpstreamRejectedStatus(code))
		if errors.Is(err, ErrUpstreamRejected) != UpstreamRejectedStatus(code) {
			t.Fatalf("HTTP classification changed for %d", code)
		}
		displayed := WithUpstreamDisplay(err)
		if errors.Is(displayed, ErrUpstreamRejected) != errors.Is(err, ErrUpstreamRejected) {
			t.Fatalf("display formatting changed refund eligibility: %d", code)
		}
	}
}

func TestDianxinPollPreservesUnknownErrorCodeAndOriginalMessage(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"failed","error":{"code":"FutureVideoError","message":"original failure"},"request_id":"req-poll"}`))
	}))
	defer upstream.Close()
	client := &VideoClient{baseURL: upstream.URL, httpCli: upstream.Client(), pollInterval: time.Millisecond, pollTimeout: time.Second}
	_, err := client.pollDianxinVideoTask(context.Background(), "task")
	if err == nil || err.Error() != "FutureVideoError: original failure Request id: req-poll" || !errors.Is(err, ErrUpstreamRejected) {
		t.Fatalf("poll error lost upstream detail: %v", err)
	}
}

func TestLegacyErrorCleanupDoesNotRemoveUpstreamDetails(t *testing.T) {
	raw := "上游明确拒绝本次任务，自动退还本次扣费: 上游明确拒绝本次任务: 电信视频任务失败: FutureCode: original Request id: req-raw（本次扣费已退还，可直接重新生成）"
	if got := CleanUpstreamMessage(raw); got != "FutureCode: original Request id: req-raw" {
		t.Fatalf("wrong cleanup: %s", got)
	}
}
