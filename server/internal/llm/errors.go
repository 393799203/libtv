package llm

import "net/http"

// UpstreamRejectedStatus 判断 HTTP 状态码是否代表「上游明确拒绝本次任务」。
//
// 只有这类才算「上游不计费」，可以自动退费：
//   - 4xx：参数不合法、不过审、无权限 —— 上游根本没接单；
//   - 408（请求超时）/ 429（限流）虽属 4xx，但上游可能已经排上队或已扣了配额，按「不确定」处理；
//   - 5xx：网关/上游故障，请求可能已经被受理（10-03 00:04 那次就是创建超时后
//     自动退款、白付上游一次），一律按「不确定」处理，交人工复核。
func UpstreamRejectedStatus(code int) bool {
	if code == http.StatusRequestTimeout || code == http.StatusTooManyRequests {
		return false
	}
	return code >= 400 && code < 500
}
