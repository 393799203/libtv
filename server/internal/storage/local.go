package storage

import (
	"fmt"
	"io"
	"log"
	"mime"
	"os"
	"path/filepath"
	"strings"
)

// LocalStorage 本地存储实现
type LocalStorage struct {
	basePath string
}

// NewLocalStorage 创建本地存储
func NewLocalStorage(basePath string) (*LocalStorage, error) {
	// 确保基础目录存在
	if err := os.MkdirAll(basePath, 0755); err != nil {
		return nil, fmt.Errorf("创建本地存储目录失败: %w", err)
	}

	log.Printf("✅ 本地存储初始化成功: %s", basePath)
	return &LocalStorage{basePath: basePath}, nil
}

// IsAvailable 检查存储是否可用
func (l *LocalStorage) IsAvailable() bool {
	// 本地存储总是可用（除非磁盘满了）
	return true
}

// GetType 获取存储类型
func (l *LocalStorage) GetType() string {
	return "local"
}

// PutObject 上传文件
func (l *LocalStorage) PutObject(objectName string, reader io.Reader, objectSize int64, contentType string) error {
	fullPath := filepath.Join(l.basePath, objectName)

	// 创建目录
	dir := filepath.Dir(fullPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("创建目录失败: %w", err)
	}

	// 写入文件
	file, err := os.Create(fullPath)
	if err != nil {
		return fmt.Errorf("创建文件失败: %w", err)
	}
	defer file.Close()

	_, err = io.Copy(file, reader)
	if err != nil {
		return fmt.Errorf("写入文件失败: %w", err)
	}

	log.Printf("✅ 本地存储上传成功: %s", objectName)
	return nil
}

// GetObject 获取文件
func (l *LocalStorage) GetObject(objectName string) (io.ReadCloser, error) {
	fullPath := filepath.Join(l.basePath, objectName)

	file, err := os.Open(fullPath)
	if err != nil {
		return nil, fmt.Errorf("打开文件失败: %w", err)
	}

	return file, nil
}

// GetObjectRange 获取文件指定范围（支持Range请求）
func (l *LocalStorage) GetObjectRange(objectName string, start, end int64) (io.ReadCloser, error) {
	fullPath := filepath.Join(l.basePath, objectName)

	file, err := os.Open(fullPath)
	if err != nil {
		return nil, fmt.Errorf("打开文件失败: %w", err)
	}

	// 定位到起始位置
	_, err = file.Seek(start, 0)
	if err != nil {
		file.Close()
		return nil, fmt.Errorf("定位文件失败: %w", err)
	}

	// 创建一个限制读取范围的Reader
	length := end - start + 1
	return &limitedReader{file: file, remaining: length}, nil
}

// limitedReader 限制读取范围的Reader
type limitedReader struct {
	file      *os.File
	remaining int64
}

func (lr *limitedReader) Read(p []byte) (n int, err error) {
	if lr.remaining <= 0 {
		return 0, io.EOF
	}

	if int64(len(p)) > lr.remaining {
		p = p[:lr.remaining]
	}

	n, err = lr.file.Read(p)
	lr.remaining -= int64(n)
	return
}

func (lr *limitedReader) Close() error {
	return lr.file.Close()
}

// DeleteObject 删除文件
func (l *LocalStorage) DeleteObject(objectName string) error {
	fullPath := filepath.Join(l.basePath, objectName)

	err := os.Remove(fullPath)
	if err != nil {
		return fmt.Errorf("删除文件失败: %w", err)
	}

	log.Printf("✅ 本地存储删除成功: %s", objectName)
	return nil
}

// StatObject 获取文件信息
func (l *LocalStorage) StatObject(objectName string) (ObjectInfo, error) {
	fullPath := filepath.Join(l.basePath, objectName)

	info, err := os.Stat(fullPath)
	if err != nil {
		return ObjectInfo{}, fmt.Errorf("获取文件信息失败: %w", err)
	}

	// 根据扩展名推断ContentType
	contentType := mime.TypeByExtension(filepath.Ext(objectName))
	if contentType == "" {
		contentType = "application/octet-stream"
	}

	return ObjectInfo{
		Size:         info.Size(),
		ContentType:  contentType,
		LastModified: info.ModTime(),
	}, nil
}

// GetURL 获取访问URL
func (l *LocalStorage) GetURL(objectName string) string {
	// 返回相对路径，由代理路由统一处理
	return "/media/" + objectName
}

// ListObjects 列出所有文件（用于同步）
func (l *LocalStorage) ListObjects(prefix string) ([]string, error) {
	var objects []string

	err := filepath.Walk(l.basePath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		if !info.IsDir() {
			// 获取相对路径
			relPath := strings.TrimPrefix(path, l.basePath)
			relPath = strings.TrimPrefix(relPath, "/")

			if strings.HasPrefix(relPath, prefix) {
				objects = append(objects, relPath)
			}
		}

		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("列出文件失败: %w", err)
	}

	return objects, nil
}