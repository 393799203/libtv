package llm

import (
	"log"
	"os"
	"sync"

	"gopkg.in/yaml.v3"
)

// ModelConfig 模型配置（对应 models.yaml 中某渠道下的一个模型）
// 各渠道模型 ID 完全独立（如华数 deepseek-v4-flash / 电信 deepseek-v4.1-flash），
// 无跨渠道映射；计费（model_prices 表）按各模型自己的 ID 分别配置。
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

// ModelsConfig models.yaml 的完整结构
// Models 结构：channel（wasu/dianxin）→ 模型分类（llm/image/video/audio）→ 模型列表
// 运行时凭据（api_key/base_url）在 config.yaml 的 ai.providers，不在本文件
type ModelsConfig struct {
	Models map[string]map[string][]ModelConfig `yaml:"models"`
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

// ListModels 返回所有渠道合并的模型配置（按类型分组，供价格管理/计费使用）
// 注意：不同渠道的模型 ID 独立，合并后 ID 不冲突（如 deepseek-v4-flash 与 deepseek-v4.1-flash）
func (mm *ModelManager) ListModels() map[string][]ModelConfig {
	mm.mu.RLock()
	defer mm.mu.RUnlock()

	result := make(map[string][]ModelConfig)
	for _, groups := range mm.config.Models { // 遍历所有渠道
		for group, models := range groups {
			result[group] = append(result[group], models...)
		}
	}
	return result
}

// ListModelsForChannel 按渠道返回模型清单（按类型分组）
// channel 为空或 wasu 时返回华数清单；其他渠道返回该渠道自己的清单
// 所有分类（llm/image/video/audio）均返回数组（空分类返回空数组，避免前端 null 兜底问题）
func (mm *ModelManager) ListModelsForChannel(channel string) map[string][]ModelConfig {
	mm.mu.RLock()
	defer mm.mu.RUnlock()

	if channel == "" {
		channel = "wasu"
	}
	groups, ok := mm.config.Models[channel]
	if !ok {
		return map[string][]ModelConfig{
			"llm": {}, "image": {}, "video": {}, "audio": {},
		}
	}

	result := make(map[string][]ModelConfig, len(groups))
	for _, grp := range []string{"llm", "image", "video", "audio"} {
		result[grp] = groups[grp] // 缺失分类返回 nil，序列化为 null；此处直接赋值即可
		if result[grp] == nil {
			result[grp] = []ModelConfig{} // 空分类转空数组
		}
	}
	return result
}

// ListChannels 返回所有已配置的渠道名
func (mm *ModelManager) ListChannels() []string {
	mm.mu.RLock()
	defer mm.mu.RUnlock()
	channels := make([]string, 0, len(mm.config.Models))
	for ch := range mm.config.Models {
		channels = append(channels, ch)
	}
	return channels
}

// GetModel 根据类型与 ID 获取模型配置（在所有渠道中查找）
func (mm *ModelManager) GetModel(modelType, modelID string) *ModelConfig {
	mm.mu.RLock()
	defer mm.mu.RUnlock()

	for _, groups := range mm.config.Models {
		if models, ok := groups[modelType]; ok {
			for _, m := range models {
				if m.ID == modelID {
					return &m
				}
			}
		}
	}
	return nil
}

// FindModelByID 在所有渠道中根据 ID 查找模型配置（计费/校验用）
func (mm *ModelManager) FindModelByID(modelID string) *ModelConfig {
	mm.mu.RLock()
	defer mm.mu.RUnlock()

	for _, groups := range mm.config.Models {
		for _, models := range groups {
			for _, m := range models {
				if m.ID == modelID {
					return &m
				}
			}
		}
	}
	return nil
}
