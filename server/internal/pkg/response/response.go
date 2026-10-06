package response

import (
	"log"
	"strings"

	"github.com/gin-gonic/gin"

	"libtv/internal/pkg/apperror"
)

// 标准响应结构
//
//   成功: {"code": 0,    "msg": "ok", "data": {...}}
//   失败: {"code": 1001, "msg": "show not found", "data": null}
//
// code=0 表示成功；非 0 表示业务错误码（与 HTTP 状态码解耦）
// HTTP 状态码由 AppError.HTTPStatus 决定，默认 500

// OK 返回 200 + 标准成功结构
func OK(c *gin.Context, data interface{}) {
	c.JSON(200, gin.H{
		"code": 0,
		"msg":  "ok",
		"data": data,
	})
}

// OKWithMsg 返回 200 + 自定义 msg + data
func OKWithMsg(c *gin.Context, msg string, data interface{}) {
	c.JSON(200, gin.H{
		"code": 0,
		"msg":  msg,
		"data": data,
	})
}

// Created 返回 201 + 标准成功结构（用于资源创建）
func Created(c *gin.Context, data interface{}) {
	c.JSON(201, gin.H{
		"code": 0,
		"msg":  "created",
		"data": data,
	})
}

// Fail 返回指定 HTTP 状态码 + 错误结构
// msg 是用户可见错误信息
func Fail(c *gin.Context, httpStatus int, msg string) {
	c.JSON(httpStatus, gin.H{
		"code": appErrCode(httpStatus),
		"msg":  msg,
		"data": nil,
	})
}

// FailWith 从任意 error 自动提取 HTTP 状态码与消息
// 优先使用 AppError 携带的 HTTPStatus/Code/Msg，否则默认 500
func FailWith(c *gin.Context, err error) {
	httpStatus := apperror.HTTPStatusFromError(err)
	code := apperror.CodeFromError(err)
	if code == 0 {
		code = appErrCode(httpStatus)
	}
	msg := sanitizeMsg(apperror.MsgFromError(err))
	if msg != err.Error() {
		// 兜底换掉了原始信息，真实原因必须留在日志里（否则这类错误无法排查）
		log.Printf("[error] %s %s: %v", c.Request.Method, c.Request.URL.Path, err)
	}
	c.JSON(httpStatus, gin.H{
		"code": code,
		"msg":  msg,
		"data": nil,
	})
}

// rawErrFragments 驱动层/数据库层原始报错的典型片段。
// 这类信息对用户毫无意义、还会把表结构和约束名暴露出去，绝不能当提示弹给用户
// （曾经出现过前端提示条直接显示 "violates foreign key constraint fk_shows_category"）。
var rawErrFragments = []string{
	"SQLSTATE", "pq:", "gorm", "constraint", "duplicate key", "violates",
	"invalid input syntax", "relation \"", "column \"",
	"dial tcp", "connection refused", "no such host", "i/o timeout", "EOF",
}

// sanitizeMsg 把原始技术错误换成人能看懂又不泄露内部信息的提示；
// 业务错误（"该标签下还有 3 个视频…"、"不支持的文件格式"）原样保留。
func sanitizeMsg(msg string) string {
	for _, frag := range rawErrFragments {
		if strings.Contains(msg, frag) {
			return "服务器内部错误，请稍后重试（如反复出现请联系管理员）"
		}
	}
	return msg
}

// appErrCode 根据 HTTP 状态码生成默认业务错误码
// 约定：业务错误码 = HTTP 状态码（如 404 → code 404），简单直观
func appErrCode(httpStatus int) int {
	return httpStatus
}
