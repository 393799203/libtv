package apperror

import (
	"errors"
	"fmt"
	"net/http"
)

// AppError 携带 HTTP 状态码的业务错误
// 通过 errors.As 可以在 handler 层统一提取 HTTPStatus / Code
type AppError struct {
	Code       int    // 业务错误码（用于前端区分错误类型）
	Msg        string // 错误信息
	HTTPStatus int    // 对应 HTTP 状态码
}

func (e *AppError) Error() string {
	if e.Msg != "" {
		return e.Msg
	}
	return fmt.Sprintf("apperror code=%d http=%d", e.Code, e.HTTPStatus)
}

// New 构造一个 AppError
func New(code, httpStatus int, msg string) *AppError {
	return &AppError{Code: code, Msg: msg, HTTPStatus: httpStatus}
}

// HTTPStatusFromError 从任意 error 提取 HTTP 状态码
// 若不是 AppError，默认返回 500
func HTTPStatusFromError(err error) int {
	var ae *AppError
	if errors.As(err, &ae) {
		return ae.HTTPStatus
	}
	return http.StatusInternalServerError
}

// CodeFromError 从任意 error 提取业务错误码
// 若不是 AppError，默认返回 0
func CodeFromError(err error) int {
	var ae *AppError
	if errors.As(err, &ae) {
		return ae.Code
	}
	return 0
}

// MsgFromError 从任意 error 提取错误信息
// 若不是 AppError，返回 err.Error()
func MsgFromError(err error) string {
	var ae *AppError
	if errors.As(err, &ae) && ae.Msg != "" {
		return ae.Msg
	}
	return err.Error()
}
