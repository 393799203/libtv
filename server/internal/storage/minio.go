package storage

import (
	"context"
	"fmt"
	"io"
	"log"
	"sync/atomic"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"

	"libtv/internal/config"
)

// MinIOStorage MinIO存储实现
//
// 可用性检测采用后台 ticker goroutine 定时刷新 available（atomic.Bool），
// IsAvailable() 只读，避免并发读写 data race。
type MinIOStorage struct {
	client         *minio.Client
	bucket         string
	publicEndpoint string
	available      atomic.Bool
	stop           chan struct{}
}

// MinIOConfig MinIO配置
type MinIOConfig struct {
	Endpoint        string
	AccessKey       string
	SecretKey       string
	Bucket          string
	UseSSL          bool
	PublicEndpoint  string
	CheckInterval   time.Duration
	CheckTimeout    time.Duration
}

// NewMinIOStorage 创建MinIO存储
func NewMinIOStorage(cfg *MinIOConfig) (*MinIOStorage, error) {
	client, err := minio.New(cfg.Endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
		Secure: cfg.UseSSL,
	})
	if err != nil {
		return nil, fmt.Errorf("创建MinIO客户端失败: %w", err)
	}

	// 设置默认检查间隔
	checkInterval := cfg.CheckInterval
	if checkInterval == 0 {
		checkInterval = 30 * time.Second
	}

	storage := &MinIOStorage{
		client:         client,
		bucket:         cfg.Bucket,
		publicEndpoint: cfg.PublicEndpoint,
		stop:           make(chan struct{}),
	}

	// 确保bucket存在
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	err = client.MakeBucket(ctx, cfg.Bucket, minio.MakeBucketOptions{})
	if err != nil {
		// 检查bucket是否已存在
		exists, err := client.BucketExists(ctx, cfg.Bucket)
		if err == nil && exists {
			log.Printf("✅ MinIO bucket已存在: %s", cfg.Bucket)
		} else {
			log.Printf("⚠️ MinIO bucket检查失败: %v", err)
		}
	} else {
		log.Printf("✅ MinIO bucket创建成功: %s", cfg.Bucket)
	}

	// 立即执行一次可用性检查，再启动后台 ticker 定时刷新
	storage.refreshAvailability()
	go storage.startAvailabilityChecker(checkInterval)

	return storage, nil
}

// startAvailabilityChecker 后台定时刷新 available 字段
func (m *MinIOStorage) startAvailabilityChecker(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-m.stop:
			return
		case <-ticker.C:
			m.refreshAvailability()
		}
	}
}

// refreshAvailability 执行一次 MinIO 可用性探测并更新 available
func (m *MinIOStorage) refreshAvailability() {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	_, err := m.client.ListBuckets(ctx)
	m.available.Store(err == nil)

	if err == nil {
		log.Printf("✅ MinIO可用: %s", m.client.EndpointURL())
	} else {
		log.Printf("⚠️ MinIO不可用: %v", err)
	}
}

// Close 停止后台可用性检查 goroutine
func (m *MinIOStorage) Close() {
	close(m.stop)
}

func init() {
	Register("minio", func(cfg config.StorageConfig, publicDir string) (Storage, error) {
		return NewMinIOStorage(&MinIOConfig{
			Endpoint:       cfg.MinIO.Endpoint,
			AccessKey:      cfg.MinIO.AccessKey,
			SecretKey:      cfg.MinIO.SecretKey,
			Bucket:         cfg.MinIO.Bucket,
			UseSSL:         cfg.MinIO.UseSSL,
			PublicEndpoint: cfg.MinIO.PublicEndpoint,
			CheckInterval:  parseCheckInterval(cfg.MinIO.CheckInterval),
		})
	})
}

// IsAvailable 检查存储是否可用（只读 atomic.Bool，避免 data race）
func (m *MinIOStorage) IsAvailable() bool {
	return m.available.Load()
}

// GetType 获取存储类型
func (m *MinIOStorage) GetType() string {
	return "minio"
}

// PutObject 上传文件
func (m *MinIOStorage) PutObject(objectName string, reader io.Reader, objectSize int64, contentType string) error {
	if !m.IsAvailable() {
		return fmt.Errorf("MinIO不可用")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if contentType == "" {
		contentType = "application/octet-stream"
	}

	_, err := m.client.PutObject(ctx, m.bucket, objectName, reader, objectSize, minio.PutObjectOptions{
		ContentType: contentType,
	})
	if err != nil {
		return fmt.Errorf("MinIO上传失败: %w", err)
	}

	log.Printf("✅ MinIO上传成功: %s", objectName)
	return nil
}

// GetObject 获取文件
func (m *MinIOStorage) GetObject(objectName string) (io.ReadCloser, error) {
	if !m.IsAvailable() {
		return nil, fmt.Errorf("MinIO不可用")
	}

	ctx := context.Background()

	object, err := m.client.GetObject(ctx, m.bucket, objectName, minio.GetObjectOptions{})
	if err != nil {
		return nil, fmt.Errorf("MinIO获取文件失败: %w", err)
	}

	return object, nil
}

// GetObjectRange 获取文件指定范围（支持Range请求）
func (m *MinIOStorage) GetObjectRange(objectName string, start, end int64) (io.ReadCloser, error) {
	if !m.IsAvailable() {
		return nil, fmt.Errorf("MinIO不可用")
	}

	ctx := context.Background()

	// 设置Range请求选项
	opts := minio.GetObjectOptions{}
	opts.SetRange(start, end)

	object, err := m.client.GetObject(ctx, m.bucket, objectName, opts)
	if err != nil {
		return nil, fmt.Errorf("MinIO获取文件范围失败: %w", err)
	}

	return object, nil
}

// DeleteObject 删除文件
func (m *MinIOStorage) DeleteObject(objectName string) error {
	if !m.IsAvailable() {
		return fmt.Errorf("MinIO不可用")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	err := m.client.RemoveObject(ctx, m.bucket, objectName, minio.RemoveObjectOptions{})
	if err != nil {
		return fmt.Errorf("MinIO删除失败: %w", err)
	}

	log.Printf("✅ MinIO删除成功: %s", objectName)
	return nil
}

// ListObjects 列出指定前缀的所有文件
func (m *MinIOStorage) ListObjects(prefix string) ([]string, error) {
	if !m.IsAvailable() {
		return nil, fmt.Errorf("MinIO不可用")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	var objects []string

	// 使用 ListObjects 列出所有匹配前缀的对象
	for objectInfo := range m.client.ListObjects(ctx, m.bucket, minio.ListObjectsOptions{
		Prefix:    prefix,
		Recursive: true,
	}) {
		if objectInfo.Err != nil {
			return nil, fmt.Errorf("列出对象失败: %w", objectInfo.Err)
		}
		objects = append(objects, objectInfo.Key)
	}

	return objects, nil
}

// DeleteObjectsByPrefix 删除指定前缀的所有文件（用于删除目录）
func (m *MinIOStorage) DeleteObjectsByPrefix(prefix string) error {
	if !m.IsAvailable() {
		return fmt.Errorf("MinIO不可用")
	}

	// 1. 列出所有匹配前缀的文件
	objects, err := m.ListObjects(prefix)
	if err != nil {
		return fmt.Errorf("列出文件失败: %w", err)
	}

	if len(objects) == 0 {
		log.Printf("[MinIOStorage] 没有找到匹配前缀的文件: prefix=%s", prefix)
		return nil
	}

	log.Printf("[MinIOStorage] 开始删除文件: prefix=%s count=%d", prefix, len(objects))

	// 2. 批量删除
	ctx := context.Background()
	for _, objectName := range objects {
		if err := m.client.RemoveObject(ctx, m.bucket, objectName, minio.RemoveObjectOptions{}); err != nil {
			log.Printf("[MinIOStorage] 删除文件失败: objectName=%s err=%v", objectName, err)
			// 继续删除其他文件，不中断整个流程
			continue
		}
	}

	log.Printf("[MinIOStorage] 删除完成: prefix=%s deleted=%d", prefix, len(objects))
	return nil
}

// StatObject 获取文件信息
func (m *MinIOStorage) StatObject(objectName string) (ObjectInfo, error) {
	if !m.IsAvailable() {
		return ObjectInfo{}, fmt.Errorf("MinIO不可用")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	info, err := m.client.StatObject(ctx, m.bucket, objectName, minio.StatObjectOptions{})
	if err != nil {
		return ObjectInfo{}, fmt.Errorf("MinIO获取文件信息失败: %w", err)
	}

	return ObjectInfo{
		Size:         info.Size,
		ContentType:  info.ContentType,
		LastModified: info.LastModified,
		ETag:         info.ETag,
	}, nil
}

// GetURL 获取访问URL
func (m *MinIOStorage) GetURL(objectName string) string {
	// 如果配置了公网访问地址，直接返回MinIO公网URL
	if m.publicEndpoint != "" {
		return m.publicEndpoint + "/" + m.bucket + "/" + objectName
	}
	// 否则返回相对路径，由代理路由处理
	return "/media/" + objectName
}

// ParseObjectName 从访问 URL 反解出 objectName
// 复用包级公共函数，仅传入 MinIO 自己的绝对 URL 前缀
func (m *MinIOStorage) ParseObjectName(url string) (string, bool) {
	prefix := ""
	if m.publicEndpoint != "" {
		prefix = m.publicEndpoint + "/" + m.bucket + "/"
	}
	return parseObjectNameFromURL(url, prefix)
}