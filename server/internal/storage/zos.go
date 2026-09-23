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

// ZOSStorage 天翼云对象存储（ZOS）实现
//
// 天翼云 ZOS 官方兼容 AWS S3 协议（"通过S3协议和标准的服务接口"），
// 因此直接复用 minio-go（S3 协议客户端）对接，仅 endpoint 指向天翼云。
//
// 可用性检测采用后台 ticker goroutine 定时刷新 available（atomic.Bool），
// IsAvailable() 只读，避免并发读写 data race。（与 MinIOStorage 同款模式）
type ZOSStorage struct {
	client         *minio.Client
	bucket         string
	publicEndpoint string
	available      atomic.Bool
	stop           chan struct{}
}

// ZOSConfig 天翼云 ZOS 配置
type ZOSConfig struct {
	Endpoint       string
	AccessKey      string
	SecretKey      string
	Bucket         string
	UseSSL         bool
	PublicEndpoint string
	CheckInterval  time.Duration
}

// NewZOSStorage 创建天翼云 ZOS 存储
func NewZOSStorage(cfg *ZOSConfig) (*ZOSStorage, error) {
	if cfg.Endpoint == "" || cfg.AccessKey == "" || cfg.SecretKey == "" || cfg.Bucket == "" {
		return nil, fmt.Errorf("ZOS配置不完整: endpoint/access_key/secret_key/bucket 均必填")
	}

	// minio-go 是 S3 协议客户端，天翼云 ZOS 兼容 S3，直接复用
	client, err := minio.New(cfg.Endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
		Secure: cfg.UseSSL,
	})
	if err != nil {
		return nil, fmt.Errorf("创建ZOS客户端失败: %w", err)
	}

	// 设置默认检查间隔
	checkInterval := cfg.CheckInterval
	if checkInterval == 0 {
		checkInterval = 30 * time.Second
	}

	storage := &ZOSStorage{
		client:         client,
		bucket:         cfg.Bucket,
		publicEndpoint: cfg.PublicEndpoint,
		stop:           make(chan struct{}),
	}

	// 确保 bucket 存在（天翼云控制台创建，或本账户有创建权限）
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	err = client.MakeBucket(ctx, cfg.Bucket, minio.MakeBucketOptions{})
	if err != nil {
		// 检查 bucket 是否已存在
		exists, err := client.BucketExists(ctx, cfg.Bucket)
		if err == nil && exists {
			log.Printf("✅ ZOS bucket已存在: %s", cfg.Bucket)
		} else {
			log.Printf("⚠️ ZOS bucket检查失败: %v", err)
		}
	} else {
		log.Printf("✅ ZOS bucket创建成功: %s", cfg.Bucket)
	}

	// 立即执行一次可用性检查，再启动后台 ticker 定时刷新
	storage.refreshAvailability()
	go storage.startAvailabilityChecker(checkInterval)

	return storage, nil
}

// startAvailabilityChecker 后台定时刷新 available 字段
func (z *ZOSStorage) startAvailabilityChecker(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-z.stop:
			return
		case <-ticker.C:
			z.refreshAvailability()
		}
	}
}

// refreshAvailability 执行一次 ZOS 可用性探测并更新 available
func (z *ZOSStorage) refreshAvailability() {
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	_, err := z.client.ListBuckets(ctx)
	z.available.Store(err == nil)

	if err == nil {
		log.Printf("✅ ZOS可用: %s", z.client.EndpointURL())
	} else {
		log.Printf("⚠️ ZOS不可用: %v", err)
	}
}

// Close 停止后台可用性检查 goroutine
func (z *ZOSStorage) Close() {
	close(z.stop)
}

func init() {
	Register("zos", func(cfg config.StorageConfig, publicDir string) (Storage, error) {
		return NewZOSStorage(&ZOSConfig{
			Endpoint:       cfg.ZOS.Endpoint,
			AccessKey:      cfg.ZOS.AccessKey,
			SecretKey:      cfg.ZOS.SecretKey,
			Bucket:         cfg.ZOS.Bucket,
			UseSSL:         cfg.ZOS.UseSSL,
			PublicEndpoint: cfg.ZOS.PublicEndpoint,
			CheckInterval:  parseCheckInterval(cfg.ZOS.CheckInterval),
		})
	})
}

// IsAvailable 检查存储是否可用（只读 atomic.Bool，避免 data race）
func (z *ZOSStorage) IsAvailable() bool {
	return z.available.Load()
}

// GetType 获取存储类型
func (z *ZOSStorage) GetType() string {
	return "zos"
}

// PutObject 上传文件
func (z *ZOSStorage) PutObject(objectName string, reader io.Reader, objectSize int64, contentType string) error {
	if !z.IsAvailable() {
		return fmt.Errorf("ZOS不可用")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if contentType == "" {
		contentType = "application/octet-stream"
	}

	_, err := z.client.PutObject(ctx, z.bucket, objectName, reader, objectSize, minio.PutObjectOptions{
		ContentType: contentType,
	})
	if err != nil {
		return fmt.Errorf("ZOS上传失败: %w", err)
	}

	log.Printf("✅ ZOS上传成功: %s", objectName)
	return nil
}

// GetObject 获取文件
func (z *ZOSStorage) GetObject(objectName string) (io.ReadCloser, error) {
	if !z.IsAvailable() {
		return nil, fmt.Errorf("ZOS不可用")
	}

	ctx := context.Background()

	object, err := z.client.GetObject(ctx, z.bucket, objectName, minio.GetObjectOptions{})
	if err != nil {
		return nil, fmt.Errorf("ZOS获取文件失败: %w", err)
	}

	// minio-go 的 GetObject 返回惰性 reader（读取时才报错），
	// 先 Stat 立即校验对象存在性，否则不存在的对象会让调用方拿到中途断流的 reader
	if _, err := object.Stat(); err != nil {
		object.Close()
		return nil, fmt.Errorf("ZOS获取文件失败: %w", err)
	}

	return object, nil
}

// GetObjectRange 获取文件指定范围（支持Range请求）
func (z *ZOSStorage) GetObjectRange(objectName string, start, end int64) (io.ReadCloser, error) {
	if !z.IsAvailable() {
		return nil, fmt.Errorf("ZOS不可用")
	}

	ctx := context.Background()

	opts := minio.GetObjectOptions{}
	opts.SetRange(start, end)

	object, err := z.client.GetObject(ctx, z.bucket, objectName, opts)
	if err != nil {
		return nil, fmt.Errorf("ZOS获取文件范围失败: %w", err)
	}

	// 同上：惰性 reader 需先 Stat 立即校验，避免对象不存在时中途断流
	if _, err := object.Stat(); err != nil {
		object.Close()
		return nil, fmt.Errorf("ZOS获取文件范围失败: %w", err)
	}

	return object, nil
}

// DeleteObject 删除文件（不受健康检查开关限制，直接尝试删除，避免瞬时探测不可用导致泄漏）
func (z *ZOSStorage) DeleteObject(objectName string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	err := z.client.RemoveObject(ctx, z.bucket, objectName, minio.RemoveObjectOptions{})
	if err != nil {
		return fmt.Errorf("ZOS删除失败: %w", err)
	}

	log.Printf("✅ ZOS删除成功: %s", objectName)
	return nil
}

// ListObjects 列出指定前缀的所有文件（不受健康检查开关限制，列举失败会返回具体错误）
func (z *ZOSStorage) ListObjects(prefix string) ([]string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	var objects []string

	for objectInfo := range z.client.ListObjects(ctx, z.bucket, minio.ListObjectsOptions{
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
// 不受健康检查开关限制，直接尝试列举删除，避免瞬时探测不可用导致目录泄漏
func (z *ZOSStorage) DeleteObjectsByPrefix(prefix string) error {
	// 1. 列出所有匹配前缀的文件
	objects, err := z.ListObjects(prefix)
	if err != nil {
		return fmt.Errorf("列出文件失败: %w", err)
	}

	if len(objects) == 0 {
		log.Printf("[ZOSStorage] 没有找到匹配前缀的文件: prefix=%s", prefix)
		return nil
	}

	log.Printf("[ZOSStorage] 开始删除文件: prefix=%s count=%d", prefix, len(objects))

	// 2. 批量删除
	ctx := context.Background()
	for _, objectName := range objects {
		if err := z.client.RemoveObject(ctx, z.bucket, objectName, minio.RemoveObjectOptions{}); err != nil {
			log.Printf("[ZOSStorage] 删除文件失败: objectName=%s err=%v", objectName, err)
			// 继续删除其他文件，不中断整个流程
			continue
		}
	}

	log.Printf("[ZOSStorage] 删除完成: prefix=%s deleted=%d", prefix, len(objects))
	return nil
}

// StatObject 获取文件信息
func (z *ZOSStorage) StatObject(objectName string) (ObjectInfo, error) {
	if !z.IsAvailable() {
		return ObjectInfo{}, fmt.Errorf("ZOS不可用")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	info, err := z.client.StatObject(ctx, z.bucket, objectName, minio.StatObjectOptions{})
	if err != nil {
		return ObjectInfo{}, fmt.Errorf("ZOS获取文件信息失败: %w", err)
	}

	return ObjectInfo{
		Size:         info.Size,
		ContentType:  info.ContentType,
		LastModified: info.LastModified,
		ETag:         info.ETag,
	}, nil
}

// GetURL 获取访问URL
// 天翼云 ZOS 采用虚拟主机风格：bucket 在子域名中（如 https://libtv.huadong-1.ctyunzos.cn），
// 因此 publicEndpoint 应配置为"Bucket 外网访问"域名（含 bucket 子域），URL 直接拼 objectName，
// 与 MinIO 的路径风格（publicEndpoint/bucket/object）不同。
func (z *ZOSStorage) GetURL(objectName string) string {
	// 如果配置了公网访问地址，直接返回ZOS公网URL（虚拟主机风格，bucket 已在域名中）
	if z.publicEndpoint != "" {
		return z.publicEndpoint + "/" + objectName
	}
	// 否则返回相对路径，由代理路由处理
	return "/media/" + objectName
}

// ParseObjectName 从访问 URL 反解出 objectName
// 复用包级公共函数，仅传入 ZOS 自己的绝对 URL 前缀（虚拟主机风格，无需 //bucket/）
func (z *ZOSStorage) ParseObjectName(url string) (string, bool) {
	prefix := ""
	if z.publicEndpoint != "" {
		prefix = z.publicEndpoint + "/"
	}
	return parseObjectNameFromURL(url, prefix)
}
