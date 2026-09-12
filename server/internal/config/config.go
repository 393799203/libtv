package config

import (
	"fmt"
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Server   ServerConfig   `yaml:"server"`
	Database DatabaseConfig `yaml:"database"`
	Redis    RedisConfig    `yaml:"redis"`
	JWT      JWTConfig      `yaml:"jwt"`
	Storage  StorageConfig  `yaml:"storage"`
	AI       AIConfig       `yaml:"ai"`
	Payment  PaymentConfig  `yaml:"payment"`
	CORS     CORSConfig     `yaml:"cors"`
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
	Type   string        `yaml:"type"`
	Local  LocalConfig   `yaml:"local"`
	MinIO  MinIOConfigYaml `yaml:"minio"`
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

type AIConfig struct {
	Providers map[string]ProviderConfig `yaml:"providers"`
	LLM       LLMConfig                 `yaml:"llm"`
	Image     ImageConfig               `yaml:"image"`
	Video     VideoConfig               `yaml:"video"`
	Audio     AudioConfig               `yaml:"audio"`
}

// ProviderConfig AI Provider 运行时凭据
type ProviderConfig struct {
	APIKey  string `yaml:"api_key"`
	BaseURL string `yaml:"base_url"`
}

type LLMConfig struct {
	Provider string `yaml:"provider"`
	APIKey   string `yaml:"api_key"`
	BaseURL  string `yaml:"base_url"`
	Model    string `yaml:"model"`
}

type ImageConfig struct {
	Provider string `yaml:"provider"`
	APIUrl   string `yaml:"api_url"`
}

type VideoConfig struct {
	Provider string `yaml:"provider"`
	APIKey   string `yaml:"api_key"`
	APIUrl   string `yaml:"api_url"`
}

type AudioConfig struct {
	Provider string `yaml:"provider"`
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
