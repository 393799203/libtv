package storage

import (
	"io"
	"strings"
	"time"
)

// Storage 存储接口（支持MinIO和本地存储）
type Storage interface {
	// PutObject 上传文件
	PutObject(objectName string, reader io.Reader, objectSize int64, contentType string) error

	// GetObject 获取文件
	GetObject(objectName string) (io.ReadCloser, error)

	// GetObjectRange 获取文件指定范围（支持Range请求）
	GetObjectRange(objectName string, start, end int64) (io.ReadCloser, error)

	// DeleteObject 删除文件
	DeleteObject(objectName string) error

	// StatObject 获取文件信息
	StatObject(objectName string) (ObjectInfo, error)

	// GetURL 获取访问URL
	GetURL(objectName string) string

	// ParseObjectName 从访问 URL 反解出 objectName
	// 同时识别绝对 URL（含 publicEndpoint + /bucket/）与相对 URL（/media/...）
	// 若 URL 不属于本存储管辖，返回 ("", false)
	ParseObjectName(url string) (objectName string, ok bool)

	// IsAvailable 检查存储是否可用
	IsAvailable() bool

	// GetType 获取存储类型
	GetType() string
}

// parseObjectNameFromURL 公共 URL→objectName 反解函数，供各 Storage 实现复用。
//
//   absolutePrefix: 绝对 URL 前缀，如 "http://39.171.58.10:9990/libtv/"；
//                   传空串则跳过绝对 URL 匹配（适用于 LocalStorage）
//
// 识别顺序：
//   1. 绝对 URL 前缀匹配 → 截掉前缀得到 objectName
//   2. 相对 URL "/media/" 前缀匹配 → 截掉得到 objectName
//   3. 都不匹配 → 返回 ("", false)
func parseObjectNameFromURL(url, absolutePrefix string) (string, bool) {
	if url == "" {
		return "", false
	}
	if absolutePrefix != "" && strings.HasPrefix(url, absolutePrefix) {
		return strings.TrimPrefix(url, absolutePrefix), true
	}
	if strings.HasPrefix(url, "/media/") {
		return strings.TrimPrefix(url, "/media/"), true
	}
	return "", false
}

// ObjectInfo 文件信息
type ObjectInfo struct {
	Size         int64
	ContentType  string
	LastModified time.Time
	ETag         string
}