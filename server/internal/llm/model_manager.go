package llm

import (
	"log"
	"os"
	"sync"

	"gopkg.in/yaml.v3"
)

// ModelConfig 模型配置（对应 models.yaml）
type ModelConfig struct {
	ID          string                 `yaml:"id"`
	Name        string                 `yaml:"name"`
	Provider    string                 `yaml:"provider"`
	ModelID     string                 `yaml:"model_id"`
	Usage       []string               `yaml:"usage"`
	MaxTokens   int                    `yaml:"max_tokens"`
	Temperature float64                `yaml:"temperature"`
	Description string                 `yaml:"description"`
	Parameters  map[string]interface{} `yaml:"parameters"`
	Default     bool                   `yaml:"default"`     // 是否为默认模型
	Resolutions []string               `yaml:"resolutions"` // 支持的分辨率（视频模型用）
}

// ProviderConfig Provider 配置
type ProviderConfig struct {
	Type            string `yaml:"type"`
	BaseURLTemplate string `yaml:"base_url_template"`
}

// ModelsConfig models.yaml 的完整结构
type ModelsConfig struct {
	Models    map[string][]ModelConfig  `yaml:"models"`
	Providers map[string]ProviderConfig `yaml:"providers"`
}

// ModelManager 模型管理器
type ModelManager struct {
	configPath string
	config     *ModelsConfig
	mu         sync.RWMutex
}

// NewModelManager 创建模型管理器
func NewModelManager(configPath string) (*ModelManager, error) {
	mm := &ModelManager{
		configPath: configPath,
	}

	if err := mm.load(); err != nil {
		return nil, err
	}

	return mm, nil
}

// load 加载 models.yaml
func (mm *ModelManager) load() error {
	mm.mu.Lock()
	defer mm.mu.Unlock()

	data, err := os.ReadFile(mm.configPath)
	if err != nil {
		return err
	}

	var config ModelsConfig
	if err := yaml.Unmarshal(data, &config); err != nil {
		return err
	}

	mm.config = &config
	log.Printf("✅ 模型配置加载成功: %s", mm.configPath)
	return nil
}

// ListModels 返回所有模型配置（按类型分组）
func (mm *ModelManager) ListModels() map[string][]ModelConfig {
	mm.mu.RLock()
	defer mm.mu.RUnlock()

	// 返回副本，避免外部修改
	result := make(map[string][]ModelConfig)
	for k, v := range mm.config.Models {
		result[k] = v
	}

	return result
}

// GetModel 根据 ID 获取模型配置
func (mm *ModelManager) GetModel(modelType, modelID string) *ModelConfig {
	mm.mu.RLock()
	defer mm.mu.RUnlock()

	if models, ok := mm.config.Models[modelType]; ok {
		for _, m := range models {
			if m.ID == modelID {
				return &m
			}
		}
	}

	return nil
}

// GetProvider 获取 Provider 配置
func (mm *ModelManager) GetProvider(providerName string) *ProviderConfig {
	mm.mu.RLock()
	defer mm.mu.RUnlock()

	if p, ok := mm.config.Providers[providerName]; ok {
		return &p
	}

	return nil
}

// FindModelByID 在所有类型中根据 ID 查找模型配置
func (mm *ModelManager) FindModelByID(modelID string) *ModelConfig {
	mm.mu.RLock()
	defer mm.mu.RUnlock()

	for _, models := range mm.config.Models {
		for _, m := range models {
			if m.ID == modelID {
				return &m
			}
		}
	}

	return nil
}