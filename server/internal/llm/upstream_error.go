package llm

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// UpstreamError 的错误分类和展示文本分离，errors.Is 继续决定重试/退款。
type UpstreamError struct {
	Code       string
	Message    string
	RequestID  string
	HTTPStatus int
	Raw        string
	Rejected   bool
}

func (e *UpstreamError) Error() string {
	detail := e.Message
	if detail == "" {
		detail = e.Raw
	}
	if detail == "" && e.HTTPStatus > 0 {
		detail = fmt.Sprintf("HTTP %d", e.HTTPStatus)
	}
	if e.Code != "" && !strings.Contains(detail, e.Code) {
		detail = e.Code + ": " + detail
	}
	if e.RequestID != "" && !strings.Contains(detail, e.RequestID) {
		detail += " Request id: " + e.RequestID
	}
	return detail
}

func (e *UpstreamError) Is(target error) bool {
	return e.Rejected && target == ErrUpstreamRejected
}

// NewUpstreamError 支持标准 error 对象、DashScope output 和网关内嵌 JSON。
// 无错误码/非 JSON 时不编造字段，保留上游原文。
func NewUpstreamError(status int, body string, rejected bool) error {
	e := &UpstreamError{Raw: body, HTTPStatus: status, Rejected: rejected}
	decodeUpstreamError(body, e, 0)
	if e.Message == "" {
		e.Message = body
	}
	return e
}

func decodeUpstreamError(body string, result *UpstreamError, depth int) {
	if depth > 5 {
		return
	}
	var obj map[string]json.RawMessage
	if json.Unmarshal([]byte(body), &obj) != nil || obj == nil {
		result.Message = body
		return
	}
	for _, key := range []string{"request_id", "requestId", "RequestId", "trace_id"} {
		var value string
		if json.Unmarshal(obj[key], &value) == nil && value != "" {
			result.RequestID = value
		}
	}
	if code := parseUpstreamErrorCode(obj["code"]); code != "" {
		result.Code = code
	}
	if raw := obj["base_resp"]; len(raw) > 0 {
		var base struct {
			Code    json.RawMessage `json:"status_code"`
			Message string          `json:"status_msg"`
		}
		if json.Unmarshal(raw, &base) == nil && parseUpstreamErrorCode(base.Code) != "" {
			result.Code = parseUpstreamErrorCode(base.Code)
			result.Message = base.Message
			return
		}
	}
	for _, key := range []string{"error", "output", "data"} {
		if raw := obj[key]; len(raw) > 0 && string(raw) != "null" {
			var inner string
			if json.Unmarshal(raw, &inner) == nil {
				decodeUpstreamError(inner, result, depth+1)
			} else if strings.HasPrefix(strings.TrimSpace(string(raw)), "{") {
				decodeUpstreamError(string(raw), result, depth+1)
			}
			if result.Message != "" {
				return
			}
		}
	}
	for _, key := range []string{"message", "fail_reason", "error_msg"} {
		var message string
		if json.Unmarshal(obj[key], &message) == nil && message != "" {
			decodeUpstreamError(message, result, depth+1)
			return
		}
	}
}

func parseUpstreamErrorCode(raw json.RawMessage) string {
	var code string
	if json.Unmarshal(raw, &code) != nil {
		var number json.Number
		if json.Unmarshal(raw, &number) != nil {
			return ""
		}
		code = number.String()
	}
	if code == "0" || code == "200" || strings.EqualFold(code, "success") || strings.EqualFold(code, "ok") {
		return ""
	}
	return code
}

// 兼容旧调用点的包装错误：只替换展示，不改变 errors.Is 的分类。
type displayError struct {
	cause error
	text  string
}

func (e *displayError) Error() string { return e.text }
func (e *displayError) Unwrap() error { return e.cause }

func CleanUpstreamMessage(detail string) string {
	prefixes := []string{
		"上游明确拒绝本次任务，自动退还本次扣费: ", "上游明确拒绝本次任务: ",
		"电信视频任务失败: ", "电信视频API错误: ", "电信 wan3.0 视频任务失败: ",
		"电信 wan3.0 API错误: ", "Video API error: ", "Image API error: ", "LLM error: ", "task failed: ",
	}
	for {
		before := detail
		for _, prefix := range prefixes {
			detail = strings.TrimPrefix(detail, prefix)
		}
		if before == detail {
			break
		}
	}
	for _, suffix := range []string{"（本次扣费已退还，可直接重新生成）", "（本次扣费此前已退还）"} {
		detail = strings.TrimSuffix(detail, suffix)
	}
	return detail
}

func WithUpstreamDisplay(err error) error {
	if err == nil {
		return nil
	}
	var upstream *UpstreamError
	if errors.As(err, &upstream) {
		return &displayError{cause: err, text: upstream.Error()}
	}
	return &displayError{cause: err, text: CleanUpstreamMessage(err.Error())}
}
