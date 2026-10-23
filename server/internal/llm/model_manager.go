package llm

import (
	"log"
	"os"
	"strings"
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
	// DurationRange 视频时长范围 [min, max]（秒）。未配置时回退默认 4-15；
	// 例：wan3.0-video [2,30]、cdance2.5-0807 [4,30]
	DurationRange []int `yaml:"duration_range"`
	// RefVideoBilling 带参考视频输入时是否按「输入视频时长 + 输出视频时长」计费（并单独配置单价）。
	// 当前仅 3 个 Seedance 模型开启（华数 doubao-seedance-2.0 / -fast / 2.5，
	// 电信 cdance2.0-0807 / cdance2.0-fast-0807 / cdance2.5-0807）；
	// wan3.0 系列不开：仍按「常规单价 × 输出时长」计费，参考视频不影响扣费
	RefVideoBilling bool `yaml:"ref_video_billing"`
	// APIStyle 该模型使用的上游接口协议风格；空字符串 = 该类型的各家默认协议。
	//
	// 目前只有图像模型需要显式指定（见 image.go 的 generate 分派）：
	//   "dashscope-multimodal" → DashScope 多模态生成
	//     POST {base_url}/services/aigc/multimodal-generation/generation
	//     请求 input.messages[].content[] 里混排 {image}/{text}，
	//     图片从 output.choices[].message.content[].image 取（**不是** data[]）
	//   ""（默认）→ OpenAI 兼容的 POST {base_url}/images/generations
	//
	// 做成配置项而不是在代码里按模型名硬判：新增同类模型只改 models.yaml
	APIStyle string `yaml:"api_style"`
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

// FallbackImageModelID 图像模型的最后兜底（models.yaml 里 image 分类标了 default: true 的那个，
// 同时也是 ImageClient.model 的初值，见 image.go）——三处必须同名，改默认模型时一起改。
const FallbackImageModelID = "doubao-seedream-5.0-lite"

// 图像模型的上游协议风格（对应 models.yaml 的 api_style 字段）。
// 判定入口是 ImageAPIStyle，分派点在 image.go 的 generate。
const (
	// ImageStyleOpenAI OpenAI 兼容的 /images/generations（默认；api_style 留空即此档）
	ImageStyleOpenAI = ""
	// ImageStyleDashScopeMultimodal DashScope 多模态生成（Qwen-Image 2.0 系列）
	ImageStyleDashScopeMultimodal = "dashscope-multimodal"
)

// DefaultImageModelID 返回指定渠道下的默认图像模型，供「节点没填模型」时兜底。
//
// 为什么读配置而不是直接写死常量：默认模型是运营在 models.yaml 上标的（default: true），
// 渠道不同可以用不同模型；写死常量会在换默认模型时悄悄和配置分叉。
// 配置缺失（manager 为 nil / 该渠道没有 image 分类 / 没有任何 default 标记）时退回
// FallbackImageModelID，保证兜底一定拿得到一个可用的模型 ID。
func (mm *ModelManager) DefaultImageModelID(channel string) string {
	// 允许 nil receiver：执行器里的 modelManager 可能是 nil（测试/降级装配），
	// 调用方不必先判空，兜底逻辑只有一条路径
	if mm == nil {
		return FallbackImageModelID
	}

	mm.mu.RLock()
	defer mm.mu.RUnlock()

	if mm.config == nil {
		return FallbackImageModelID
	}
	// 空渠道按华数处理：与 ListModelsForChannel 的约定保持一致
	if channel == "" {
		channel = "wasu"
	}
	// 注意不要调 ListModelsForChannel：它自己会 RLock，递归读锁在有待写者时会死锁
	for _, m := range mm.config.Models[channel]["image"] {
		if m.Default && m.ID != "" {
			return m.ID
		}
	}
	return FallbackImageModelID
}

// ImageAPIStyle 返回图像模型的上游协议风格（models.yaml 的 api_style）。
//
// 查不到模型（管理未装配 / 模型不在该渠道 / 模型未注册）一律返回 ImageStyleOpenAI，
// 即改动前的 OpenAI 兼容行为 —— 让「查不到」退化成老路径，而不是让生成失败。
func (mm *ModelManager) ImageAPIStyle(channel, modelID string) string {
	if mm == nil || modelID == "" {
		return ImageStyleOpenAI
	}
	m := mm.FindModelByIDForChannel(channel, modelID)
	if m == nil {
		return ImageStyleOpenAI
	}
	return strings.TrimSpace(m.APIStyle)
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

// FindModelByIDForChannel 在**指定渠道内**根据 ID 查找模型配置。
// 华数/电信可能存在同名模型（如 doubao-seedream-5.0-lite、deepseek-v4.1-flash），
// 此时 FindModelByID 因 map 遍历顺序随机而可能返回另一渠道的配置；
// 有渠道上下文时（提示词生成、白模解析等）应使用本方法，保证取到当前渠道的配置
func (mm *ModelManager) FindModelByIDForChannel(channel, modelID string) *ModelConfig {
	if channel == "" {
		channel = "wasu"
	}
	mm.mu.RLock()
	defer mm.mu.RUnlock()

	groups, ok := mm.config.Models[channel]
	if !ok {
		return nil
	}
	for _, models := range groups {
		for i := range models {
			if models[i].ID == modelID || models[i].ModelID == modelID {
				return &models[i]
			}
		}
	}
	return nil
}

// VideoDurationRange 返回模型支持的视频时长范围（秒，闭区间）。
// 优先取 models.yaml 的 duration_range 配置；未配置或配置非法时回退 4-15。
// 让新增视频模型只需改配置，无需改代码
func (mm *ModelManager) VideoDurationRange(channel, modelID string) (int, int) {
	minDur, maxDur := DefaultVideoDurationRange()
	if mm == nil {
		return minDur, maxDur
	}
	m := mm.FindModelByIDForChannel(channel, modelID)
	if m == nil || len(m.DurationRange) < 2 || m.DurationRange[1] <= m.DurationRange[0] {
		return minDur, maxDur
	}
	return m.DurationRange[0], m.DurationRange[1]
}

// RefVideoBilling 该模型是否按「参考视频（输入）时长」计费：
// models.yaml 的 ref_video_billing=true 时，带参考视频输入的一次生成按
// 「输入视频时长 + 输出视频时长」计费，单价走「带参考视频」档（见 BillingService）。
// 未配置（或查不到模型）一律按 false：只按输出时长与常规单价计费，不会多扣用户积分
func (mm *ModelManager) RefVideoBilling(channel, modelID string) bool {
	if mm == nil || modelID == "" {
		return false
	}
	m := mm.FindModelByIDForChannel(channel, modelID)
	if m == nil {
		return false
	}
	return m.RefVideoBilling
}
