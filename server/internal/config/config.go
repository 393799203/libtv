package config

import (
	"fmt"
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Server    ServerConfig    `yaml:"server"`
	Database  DatabaseConfig  `yaml:"database"`
	Redis     RedisConfig     `yaml:"redis"`
	Queue     QueueConfig     `yaml:"queue"`
	RateLimit RateLimitConfig `yaml:"ratelimit"`
	JWT       JWTConfig       `yaml:"jwt"`
	Storage   StorageConfig   `yaml:"storage"`
	AI        AIConfig        `yaml:"ai"`
	Payment   PaymentConfig   `yaml:"payment"`
	CORS      CORSConfig      `yaml:"cors"`
}

// QueueConfig 生成任务队列（Redis Stream）。
// 队列化后任务具备：跨重启续跑（原裸 goroutine 会被重启杀掉，执行永久卡 running）、
// 失败重试、死信留存、消费端并发可控。Enabled=false 时回退为直接 goroutine。
type QueueConfig struct {
	Enabled             bool   `yaml:"enabled"`
	Workers             int    `yaml:"workers"`               // worker 数 = 同时消费的任务数
	MaxRetry            int    `yaml:"max_retry"`             // 失败重试次数，超出进死信
	Stream              string `yaml:"stream"`                // 任务流
	DeadStream          string `yaml:"dead_stream"`           // 死信流
	ConsumerGroup       string `yaml:"consumer_group"`        // 消费者组
	VisibilityTimeoutSec int   `yaml:"visibility_timeout_sec"` // 超时未确认视为 worker 崩溃，重新认领
}

// RateLimitConfig 生成接口限流。
// 限制单用户发起频率，防狂点；全局并发上界由 queue.workers 承担（worker 数即闸门）。
type RateLimitConfig struct {
	Enabled   bool `yaml:"enabled"`
	PerMinute int  `yaml:"per_minute"` // 0 表示不限制
}

type ServerConfig struct {
	Port int    `yaml:"port"`
	Mode string `yaml:"mode"`
}

// CORSConfig 跨域配置；Origins 为空时表示允许所有来源（便于本地开发）
type CORSConfig struct {
	Origins []string `yaml:"origins"`
}

type DatabaseConfig struct {
	Host     string `yaml:"host"`
	Port     int    `yaml:"port"`
	User     string `yaml:"user"`
	Password string `yaml:"password"`
	DBName   string `yaml:"dbname"`
	SSLMode  string `yaml:"sslmode"`
}

func (d *DatabaseConfig) DSN() string {
	return fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=%s",
		d.Host, d.Port, d.User, d.Password, d.DBName, d.SSLMode)
}

type RedisConfig struct {
	Host     string `yaml:"host"`
	Port     int    `yaml:"port"`
	Password string `yaml:"password"`
	DB       int    `yaml:"db"`
}

func (r *RedisConfig) Addr() string {
	return fmt.Sprintf("%s:%d", r.Host, r.Port)
}

type JWTConfig struct {
	Secret      string `yaml:"secret"`
	ExpireHours int    `yaml:"expire_hours"`
}

type StorageConfig struct {
	Type   string          `yaml:"type"`
	Local  LocalConfig     `yaml:"local"`
	MinIO  MinIOConfigYaml `yaml:"minio"`
	ZOS    ZOSConfigYaml   `yaml:"zos"`
}

type LocalConfig struct {
	BasePath string `yaml:"base_path"`
}

type MinIOConfigYaml struct {
	Endpoint        string `yaml:"endpoint"`
	AccessKey       string `yaml:"access_key"`
	SecretKey       string `yaml:"secret_key"`
	Bucket          string `yaml:"bucket"`
	UseSSL          bool   `yaml:"use_ssl"`
	PublicEndpoint  string `yaml:"public_endpoint"`
	CheckInterval   string `yaml:"check_interval"`
	CheckTimeout    string `yaml:"check_timeout"`
}

// ZOSConfigYaml 天翼云对象存储（ZOS）配置
type ZOSConfigYaml struct {
	Endpoint       string `yaml:"endpoint"`        // 如 https://oos-cn-north-2.ctyun.cn（天翼云 ZOS 兼容 S3 协议）
	AccessKey      string `yaml:"access_key"`      // AccessKey ID（天翼云控制台-访问密钥）
	SecretKey      string `yaml:"secret_key"`      // AccessKey Secret
	Bucket         string `yaml:"bucket"`          // bucket 名
	UseSSL         bool   `yaml:"use_ssl"`         // endpoint 是否走 HTTPS（默认 true 更稳妥）
	PublicEndpoint string `yaml:"public_endpoint"` // 公网访问前缀（如 https://libtv.oos-cn-north-2.ctyun.cn 或 CDN 域名）
	CheckInterval  string `yaml:"check_interval"`  // 健康检查间隔
}

type AIConfig struct {
	Providers map[string]ProviderConfig `yaml:"providers"`
}

// ProviderConfig AI Provider 运行时凭据
type ProviderConfig struct {
	APIKey  string `yaml:"api_key"`
	BaseURL string `yaml:"base_url"`
}

// PaymentConfig 支付配置
type PaymentConfig struct {
	Alipay AlipayConfig `yaml:"alipay"`
}

// AlipayConfig 支付宝开放平台配置（企业账户；RSA2 签名）
type AlipayConfig struct {
	Enabled         bool   `yaml:"enabled"`
	AppID           string `yaml:"app_id"`
	PrivateKey      string `yaml:"private_key"`       // 应用私钥（PEM，PKCS1/PKCS8 均可，可多行）
	AlipayPublicKey string `yaml:"alipay_public_key"` // 支付宝公钥（PEM，PKIX）
	Gateway         string `yaml:"gateway"`           // 生产 openapi.alipay.com/gateway.do；沙箱 openapi-sandbox.dl.alipaydev.com/gateway.do
	NotifyURL       string `yaml:"notify_url"`        // 异步回调（必须公网可达）
	ReturnURL       string `yaml:"return_url"`        // 同步跳转（支付宝先跳回本地址）
	SubjectPrefix   string `yaml:"subject_prefix"`    // 商品标题前缀
}

var C Config

func Load(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read config file: %w", err)
	}
	if err := yaml.Unmarshal(data, &C); err != nil {
		return fmt.Errorf("parse config file: %w", err)
	}

	// 支持环境变量覆盖（用于 Docker 环境）
	if host := os.Getenv("DB_HOST"); host != "" {
		C.Database.Host = host
	}
	if host := os.Getenv("REDIS_HOST"); host != "" {
		C.Redis.Host = host
	}

	// MinIO配置环境变量覆盖
	if endpoint := os.Getenv("MINIO_ENDPOINT"); endpoint != "" {
		C.Storage.MinIO.Endpoint = endpoint
	}
	if publicEndpoint := os.Getenv("MINIO_PUBLIC_ENDPOINT"); publicEndpoint != "" {
		C.Storage.MinIO.PublicEndpoint = publicEndpoint
	}
	if accessKey := os.Getenv("MINIO_ACCESS_KEY"); accessKey != "" {
		C.Storage.MinIO.AccessKey = accessKey
	}
	if secretKey := os.Getenv("MINIO_SECRET_KEY"); secretKey != "" {
		C.Storage.MinIO.SecretKey = secretKey
	}

	// ZOS配置环境变量覆盖（天翼云对象存储，兼容 S3 协议）
	if endpoint := os.Getenv("ZOS_ENDPOINT"); endpoint != "" {
		C.Storage.ZOS.Endpoint = endpoint
	}
	if publicEndpoint := os.Getenv("ZOS_PUBLIC_ENDPOINT"); publicEndpoint != "" {
		C.Storage.ZOS.PublicEndpoint = publicEndpoint
	}
	if accessKey := os.Getenv("ZOS_ACCESS_KEY"); accessKey != "" {
		C.Storage.ZOS.AccessKey = accessKey
	}
	if secretKey := os.Getenv("ZOS_SECRET_KEY"); secretKey != "" {
		C.Storage.ZOS.SecretKey = secretKey
	}
	if bucket := os.Getenv("ZOS_BUCKET"); bucket != "" {
		C.Storage.ZOS.Bucket = bucket
	}
	if useSSL := os.Getenv("ZOS_USE_SSL"); useSSL != "" {
		C.Storage.ZOS.UseSSL = useSSL == "1" || strings.EqualFold(useSSL, "true")
	}

	// 存储类型环境变量覆盖（docker-compose中设置）
	if storageType := os.Getenv("STORAGE_TYPE"); storageType != "" {
		C.Storage.Type = storageType
	}

	// CORS 白名单环境变量覆盖（逗号分隔，CORS_ORIGINS=http://a,http://b）
	if corsOrigins := os.Getenv("CORS_ORIGINS"); corsOrigins != "" {
		C.CORS.Origins = splitCSV(corsOrigins)
	}

	// 支付宝支付环境变量覆盖（密钥/回调地址建议走环境变量，避免明文入库）
	if v := os.Getenv("ALIPAY_ENABLED"); v != "" {
		C.Payment.Alipay.Enabled = v == "1" || strings.EqualFold(v, "true")
	}
	if v := os.Getenv("ALIPAY_APP_ID"); v != "" {
		C.Payment.Alipay.AppID = v
	}
	if v := os.Getenv("ALIPAY_PRIVATE_KEY"); v != "" {
		C.Payment.Alipay.PrivateKey = v
	}
	if v := os.Getenv("ALIPAY_PUBLIC_KEY"); v != "" {
		C.Payment.Alipay.AlipayPublicKey = v
	}
	if v := os.Getenv("ALIPAY_GATEWAY"); v != "" {
		C.Payment.Alipay.Gateway = v
	}
	if v := os.Getenv("ALIPAY_NOTIFY_URL"); v != "" {
		C.Payment.Alipay.NotifyURL = v
	}
	if v := os.Getenv("ALIPAY_RETURN_URL"); v != "" {
		C.Payment.Alipay.ReturnURL = v
	}
	// 密钥走 PEM 文件（推荐：挂载进容器，避免私钥进镜像/环境变量换行问题）
	if v := os.Getenv("ALIPAY_PRIVATE_KEY_FILE"); v != "" {
		b, err := os.ReadFile(v)
		if err != nil {
			return fmt.Errorf("read ALIPAY_PRIVATE_KEY_FILE %s: %w", v, err)
		}
		C.Payment.Alipay.PrivateKey = string(b)
	}
	if v := os.Getenv("ALIPAY_PUBLIC_KEY_FILE"); v != "" {
		b, err := os.ReadFile(v)
		if err != nil {
			return fmt.Errorf("read ALIPAY_PUBLIC_KEY_FILE %s: %w", v, err)
		}
		C.Payment.Alipay.AlipayPublicKey = string(b)
	}

	return nil
}

// splitCSV 将逗号分隔的字符串切分为切片（忽略空白项）
func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}
