package config

import (
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Server   ServerConfig   `yaml:"server"`
	Database DatabaseConfig `yaml:"database"`
	Redis    RedisConfig    `yaml:"redis"`
	JWT      JWTConfig      `yaml:"jwt"`
	Storage  StorageConfig  `yaml:"storage"`
	AI       AIConfig       `yaml:"ai"`
}

type ServerConfig struct {
	Port int    `yaml:"port"`
	Mode string `yaml:"mode"`
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
	Driver    string     `yaml:"driver"`
	LocalPath string     `yaml:"local_path"`
	OSS       OSSConfig  `yaml:"oss"`
}

type OSSConfig struct {
	Endpoint  string `yaml:"endpoint"`
	AccessKey string `yaml:"access_key"`
	SecretKey string `yaml:"secret_key"`
	Bucket    string `yaml:"bucket"`
}

type AIConfig struct {
	LLM   LLMConfig   `yaml:"llm"`
	Image ImageConfig `yaml:"image"`
	Video VideoConfig `yaml:"video"`
	Audio AudioConfig `yaml:"audio"`
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

	return nil
}
