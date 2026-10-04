package service

import (
	"fmt"
	"log"
	"os"

	"gopkg.in/yaml.v3"
)

// ========== 清晰化渠道配置（configs/enhance.yaml）==========
//
// 分层原则（与 models.yaml 一致）：
//   - 配置文件：开放哪些渠道、怎么展示、支持哪些档位、运维旋钮
//   - 代码：真正怎么处理（engine 里注册的 provider 实现）
//
// 配置不能让没实现的渠道凭空可用：加载阶段只做「结构与取值」的校验（ID 非空、档位不重复等），
// 「配置的渠道是否真有实现」由 engine 在做注册表合并时校验并告警 —— 这里不认识 engine，
// 也不该认识（service 在 engine 下层）。

// EnhanceModeConfig 一个档位（模式）
type EnhanceModeConfig struct {
	ID          string                 `yaml:"id"`
	Label       string                 `yaml:"label"`
	Description string                 `yaml:"description"`
	Default     bool                   `yaml:"default"`
	Params      map[string]interface{} `yaml:"params"`
}

// EnhanceChannelConfig 一个渠道
type EnhanceChannelConfig struct {
	ID          string              `yaml:"id"`
	Label       string              `yaml:"label"`
	Description string              `yaml:"description"`
	Enabled     bool                `yaml:"enabled"`
	Modes       []EnhanceModeConfig `yaml:"modes"`
}

// EnhanceLimitsConfig 本机档运维旋钮（零值 = 用代码里的默认值）
type EnhanceLimitsConfig struct {
	MaxDurationSeconds int    `yaml:"max_duration_seconds"`
	TimeoutSeconds     int    `yaml:"timeout_seconds"`
	MaxConcurrency     int    `yaml:"max_concurrency"`
	CRF                int    `yaml:"crf"`
	Preset             string `yaml:"preset"`
}

// EnhanceConfig enhance.yaml 的完整结构
type EnhanceConfig struct {
	Channels []EnhanceChannelConfig `yaml:"channels"`
	Limits   EnhanceLimitsConfig    `yaml:"limits"`
}

// DefaultChannel 配置里没写渠道时的兜底：仍然是本机 FFmpeg
// （配置整份丢了也不该让节点变成砖头 —— 与「接口挂了用兜底清单」同一个思路）
func (c *EnhanceConfig) DefaultChannel() string {
	for _, ch := range c.Channels {
		if !ch.Enabled {
			continue
		}
		return ch.ID
	}
	return "ffmpeg"
}

// LoadEnhanceConfig 读取并校验 enhance.yaml
func LoadEnhanceConfig(path string) (*EnhanceConfig, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("读取清晰化配置失败 %s: %w", path, err)
	}

	var cfg EnhanceConfig
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("解析清晰化配置失败 %s: %w", path, err)
	}

	if err := cfg.normalize(); err != nil {
		return nil, err
	}

	log.Printf("✅ 清晰化配置加载成功: %s（渠道 %d 个，并发上限 %d）",
		path, len(cfg.Channels), cfg.Limits.MaxConcurrency)
	return &cfg, nil
}

// normalize 结构与取值校验 + 填默认值。
// 原则：能在加载期发现的问题绝不留到运行期（运行期发现 = 用户点下去才炸）。
func (c *EnhanceConfig) normalize() error {
	if len(c.Channels) == 0 {
		return fmt.Errorf("enhance.yaml 里没有任何渠道：至少要有本机 FFmpeg（id: ffmpeg）")
	}

	seen := map[string]bool{}
	for i := range c.Channels {
		ch := &c.Channels[i]
		if ch.ID == "" {
			return fmt.Errorf("enhance.yaml 第 %d 个渠道缺少 id", i+1)
		}
		if seen[ch.ID] {
			return fmt.Errorf("enhance.yaml 渠道 id 重复: %s", ch.ID)
		}
		seen[ch.ID] = true
		if ch.Label == "" {
			ch.Label = ch.ID // 少个展示名不该挡住启动
		}
		if len(ch.Modes) == 0 {
			// 没有档位的渠道等于没有可执行的动作：视为没上架，而不是给用户一个点了就错的按钮
			log.Printf("⚠️  清晰化渠道 %s 没配置任何档位，按未开通处理", ch.ID)
			ch.Enabled = false
		}

		modeSeen := map[string]bool{}
		defaultCount := 0
		for j := range ch.Modes {
			m := &ch.Modes[j]
			if m.ID == "" {
				return fmt.Errorf("enhance.yaml 渠道 %s 第 %d 个档位缺少 id", ch.ID, j+1)
			}
			if modeSeen[m.ID] {
				return fmt.Errorf("enhance.yaml 渠道 %s 档位 id 重复: %s", ch.ID, m.ID)
			}
			modeSeen[m.ID] = true
			if m.Label == "" {
				m.Label = m.ID
			}
			if m.Default {
				defaultCount++
			}
		}
		if defaultCount > 1 {
			return fmt.Errorf("enhance.yaml 渠道 %s 有 %d 个档位标了 default，只能有一个", ch.ID, defaultCount)
		}
		if defaultCount == 0 {
			ch.Modes[0].Default = true // 没标就取第一个，保证前端总有东西可选中
		}
	}

	// 运维旋钮：非正值一律回退默认（0 会让 ffmpeg 收到 -crf 0 之类，等于静默改变画质）
	if c.Limits.MaxDurationSeconds <= 0 {
		c.Limits.MaxDurationSeconds = 120
	}
	if c.Limits.TimeoutSeconds <= 0 {
		c.Limits.TimeoutSeconds = 300
	}
	if c.Limits.MaxConcurrency <= 0 {
		c.Limits.MaxConcurrency = 2
	}
	if c.Limits.CRF <= 0 || c.Limits.CRF > 51 {
		c.Limits.CRF = 20
	}
	if c.Limits.Preset == "" {
		c.Limits.Preset = "veryfast"
	}
	return nil
}
