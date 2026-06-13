package storage

import (
	"context"
	"fmt"
	"io"
	"log"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// MinIOStorage MinIO存储实现
type MinIOStorage struct {
	client         *minio.Client
	bucket         string
	publicEndpoint string
	available      bool
	lastCheckTime  time.Time
	checkInterval  time.Duration
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
		checkInterval:  checkInterval,
		available:      false,
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

	// 初始检查可用性
	storage.checkAvailability()

	return storage, nil
}

// checkAvailability 检查MinIO可用性
func (m *MinIOStorage) checkAvailability() {
	// 如果距离上次检查时间小于检查间隔，直接返回
	if time.Since(m.lastCheckTime) < m.checkInterval && m.lastCheckTime != (time.Time{}) {
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	_, err := m.client.ListBuckets(ctx)
	m.available = (err == nil)
	m.lastCheckTime = time.Now()

	if m.available {
		log.Printf("✅ MinIO可用: %s", m.client.EndpointURL())
	} else {
		log.Printf("⚠️ MinIO不可用: %v", err)
	}
}

// IsAvailable 检查存储是否可用
func (m *MinIOStorage) IsAvailable() bool {
	m.checkAvailability()
	return m.available
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