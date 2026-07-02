package storage

import (
	"fmt"
	"io"
	"log"
	"mime"
	"os"
	"path/filepath"

	"libtv/internal/config"
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

func init() {
	Register("local", func(cfg config.StorageConfig, publicDir string) (Storage, error) {
		basePath := cfg.Local.BasePath
		if basePath == "" {
			basePath = publicDir
		}
		return NewLocalStorage(basePath)
	})
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

// ParseObjectName 从访问 URL 反解出 objectName
// LocalStorage 只产生 /media/<objectName> 格式，absolutePrefix 为空
func (l *LocalStorage) ParseObjectName(url string) (string, bool) {
	return parseObjectNameFromURL(url, "")
}

// ListObjects 列出所有文件（用于同步）
func (l *LocalStorage) ListObjects(prefix string) ([]string, error) {
	prefixPath := filepath.Join(l.basePath, prefix)
	var objects []string

	// 如果路径不存在，返回空列表
	if !os.IsPathSeparator(prefix[len(prefix)-1]) {
		prefix = prefix + "/"
	}

	err := filepath.Walk(prefixPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			// 如果路径不存在，忽略错误
			if os.IsNotExist(err) {
				return nil
			}
			return err
		}

		// 只处理文件，忽略目录
		if !info.IsDir() {
			// 获取相对于basePath的路径
			relPath, err := filepath.Rel(l.basePath, path)
			if err != nil {
				return err
			}
			objects = append(objects, relPath)
		}

		return nil
	})

	if err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("遍历目录失败: %w", err)
	}

	return objects, nil
}

// DeleteObjectsByPrefix 删除指定前缀的所有文件（用于删除目录）
func (l *LocalStorage) DeleteObjectsByPrefix(prefix string) error {
	prefixPath := filepath.Join(l.basePath, prefix)

	log.Printf("[LocalStorage] 开始删除目录: prefix=%s path=%s", prefix, prefixPath)

	// 检查目录是否存在
	if _, err := os.Stat(prefixPath); os.IsNotExist(err) {
		log.Printf("[LocalStorage] 目录不存在: path=%s", prefixPath)
		return nil
	}

	// 直接删除整个目录及其内容
	err := os.RemoveAll(prefixPath)
	if err != nil {
		return fmt.Errorf("删除目录失败: %w", err)
	}

	log.Printf("[LocalStorage] 删除目录成功: prefix=%s", prefix)
	return nil
}