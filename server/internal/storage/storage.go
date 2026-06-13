package storage

import (
	"io"
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

	// IsAvailable 检查存储是否可用
	IsAvailable() bool

	// GetType 获取存储类型
	GetType() string
}

// ObjectInfo 文件信息
type ObjectInfo struct {
	Size         int64
	ContentType  string
	LastModified time.Time
	ETag         string
}