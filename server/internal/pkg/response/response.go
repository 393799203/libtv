package response

import (
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
	c.JSON(httpStatus, gin.H{
		"code": code,
		"msg":  apperror.MsgFromError(err),
		"data": nil,
	})
}

// appErrCode 根据 HTTP 状态码生成默认业务错误码
// 约定：业务错误码 = HTTP 状态码（如 404 → code 404），简单直观
func appErrCode(httpStatus int) int {
	return httpStatus
}
