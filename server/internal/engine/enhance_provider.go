package engine

import (
	"context"
	"fmt"
	"log"
	"sort"
	"strings"
	"sync"

	"libtv/internal/service"
)

// ========== 清晰化渠道注册表（配置 × 实现）==========
//
// 两个来源合并成一个对外可见的清单：
//   - configs/enhance.yaml（配置）：有哪些渠道、叫什么、怎么描述、开不开放、支持哪些档位
//   - 代码里的 EnhanceImpl（实现）：真正怎么处理
//
// 为什么合并而不是二选一：
//   配置负责「上架/下架/改名/调价」，实现负责「怎么算」。
//   配置里写了一个没实现的渠道 → 告警并显示为「未开通」（不可选），绝不让用户选到一个点了就错的按钮；
//   实现了一个配置里没有的渠道 → 也告警（配置漏了，或渠道下线了但代码没删）。
//
// 计费不在这里做：单价走 model_prices（node_type=enhance，运营后台维护），渠道实现不碰账。

// EnhanceImpl 一个渠道的实现（今天只有本机 FFmpeg；P1 的 MPS/火山按同一接口加）
type EnhanceImpl interface {
	// Name 稳定 ID：必须与 enhance.yaml 里渠道的 id 一致
	Name() string
	// SupportedModes 这个实现认识的档位 ID（如 clean / hd）。
	// 配置里写了实现不认识的档位 → 该档位被剔除并告警：
	// 让「配置写错」的后果是少一个选项，而不是用户点下去才失败
	SupportedModes() []string
	// NeedsSourceBytes 是否需要执行器先把源视频下载成字节
	// （本机档必须下载；云端档只把 URL 交给对方，省一次几十 MB 的下载）
	NeedsSourceBytes() bool
	// Enhance 干活
	Enhance(ctx context.Context, req EnhanceRequest, progress func(string)) (EnhanceOutcome, error)
}

// EnhanceMode 一个档位（对外可见，含展示信息）
type EnhanceMode struct {
	ID          string                 `json:"id"`
	Label       string                 `json:"label"`
	Description string                 `json:"description"`
	Default     bool                   `json:"default"`
	Params      map[string]interface{} `json:"-"` // 渠道实现内部用，不下发前端
}

// EnhanceChannel 一个渠道（配置 + 实现合并后的对外视图）
type EnhanceChannel struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description"`
	// Available 可选：配置启用 + 有实现 + 至少有一个实现认识的档位
	Available bool          `json:"available"`
	Modes     []EnhanceMode `json:"modes"`
	impl      EnhanceImpl   // 内部用，不下发
}

// EnhanceRequest 一次清晰化请求
type EnhanceRequest struct {
	SourceURL   string                 // 源视频地址（云端渠道直接用；本机渠道用它下载）
	SourceBytes []byte                 // 源视频字节（仅当渠道 NeedsSourceBytes() 为 true 时由执行器填好）
	SourceExt   string                 // 源视频扩展名（含点，如 .mp4）
	Channel     string                 // 渠道 ID
	Mode        string                 // 档位 ID
	Params      map[string]interface{} // 档位配置里的参数（如 target_short_side）
}

// EnhanceOutcome 一次清晰化的结果
type EnhanceOutcome struct {
	Bytes []byte                 // 处理结果字节（本机渠道）；为空时用 URL
	URL   string                 // 处理结果地址（云端渠道通常直接返回可访问地址）
	Meta  map[string]interface{} // 渠道留痕，原样进入节点数据
	Note  string                 // 一句话说明，展示在节点徽标与日志里
}

var (
	enhanceMU       sync.RWMutex
	enhanceImpls    = map[string]EnhanceImpl{}
	enhanceChannels = map[string]*EnhanceChannel{} // 配置发布后的渠道（含 available/modes）
	enhanceOrder    []string                       // 展示顺序（配置文件顺序）
	// DefaultEnhanceChannel 默认渠道 ID：节点数据没写渠道时用它
	DefaultEnhanceChannel = "ffmpeg"
)

// RegisterEnhanceImpl 注册渠道实现（各实现文件在 init 里调用）
func RegisterEnhanceImpl(impl EnhanceImpl) {
	if impl == nil || impl.Name() == "" {
		return
	}
	enhanceMU.Lock()
	defer enhanceMU.Unlock()
	enhanceImpls[impl.Name()] = impl
}

// ApplyEnhanceConfig 用配置发布对外可见的渠道清单（启动时调用一次）。
//
// 合并规则（每条都对应一种运维手误，后果都收敛为「少一个选项 + 一行告警」）：
//  1. 渠道未启用 → 不上架
//  2. 渠道没有对应实现 → 上架但标未开通（前端置灰、后端拒绝），并告警
//  3. 档位实现不认识 → 该档位剔除，并告警
//  4. 实现认识的档位没写进配置 → 告警（配置可能漏了）
func ApplyEnhanceConfig(cfg *service.EnhanceConfig) {
	enhanceMU.Lock()
	defer enhanceMU.Unlock()

	enhanceChannels = map[string]*EnhanceChannel{}
	enhanceOrder = nil

	for _, ch := range cfg.Channels {
		impl := enhanceImpls[ch.ID]
		pub := &EnhanceChannel{
			ID:          ch.ID,
			Label:       ch.Label,
			Description: ch.Description,
			impl:        impl,
		}

		if impl == nil {
			log.Printf("⚠️  清晰化渠道 %s（%s）在配置里启用了，但代码里没有对应实现 → 显示为未开通", ch.ID, ch.Label)
			enhanceChannels[ch.ID] = pub
			enhanceOrder = append(enhanceOrder, ch.ID)
			continue
		}

		supported := map[string]bool{}
		for _, m := range impl.SupportedModes() {
			supported[m] = true
		}
		for _, m := range ch.Modes {
			if !supported[m.ID] {
				log.Printf("⚠️  清晰化渠道 %s 的档位 %s 实现不认识（支持：%s）→ 该档位已剔除",
					ch.ID, m.ID, strings.Join(impl.SupportedModes(), "/"))
				continue
			}
			pub.Modes = append(pub.Modes, EnhanceMode{
				ID:          m.ID,
				Label:       m.Label,
				Description: m.Description,
				Default:     m.Default,
				Params:      m.Params,
			})
		}
		for _, m := range impl.SupportedModes() {
			found := false
			for _, cm := range ch.Modes {
				if cm.ID == m {
					found = true
					break
				}
			}
			if !found {
				log.Printf("⚠️  清晰化渠道 %s 的实现支持档位 %s，但 enhance.yaml 里没配置 → 该档位对用户不可见", ch.ID, m)
			}
		}

		pub.Available = ch.Enabled && len(pub.Modes) > 0
		if !pub.Available && ch.Enabled {
			log.Printf("⚠️  清晰化渠道 %s 没有可用档位 → 按未开通处理", ch.ID)
		}
		enhanceChannels[ch.ID] = pub
		enhanceOrder = append(enhanceOrder, ch.ID)
	}

	// 默认渠道：配置里第一个可用的；一个都没有则保持原默认（并在下面喊出来）
	defaultSet := false
	for _, id := range enhanceOrder {
		if ch := enhanceChannels[id]; ch != nil && ch.Available {
			DefaultEnhanceChannel = id
			defaultSet = true
			break
		}
	}
	if !defaultSet {
		log.Printf("❌ 清晰化没有任何可用渠道：节点会拒绝执行（请检查 enhance.yaml 与实现是否匹配）")
	}

	for _, id := range enhanceOrder {
		ch := enhanceChannels[id]
		modes := make([]string, 0, len(ch.Modes))
		for _, m := range ch.Modes {
			modes = append(modes, m.ID)
		}
		log.Printf("   清晰化渠道 %s（%s）available=%v modes=%v", ch.ID, ch.Label, ch.Available, modes)
	}
}

// ListEnhanceChannels 对外可见的渠道清单（按配置文件顺序）
func ListEnhanceChannels() []*EnhanceChannel {
	enhanceMU.RLock()
	defer enhanceMU.RUnlock()
	out := make([]*EnhanceChannel, 0, len(enhanceOrder))
	for _, id := range enhanceOrder {
		if ch := enhanceChannels[id]; ch != nil {
			out = append(out, ch)
		}
	}
	return out
}

// GetEnhanceChannel 按 ID 取渠道
func GetEnhanceChannel(id string) (*EnhanceChannel, bool) {
	enhanceMU.RLock()
	defer enhanceMU.RUnlock()
	ch, ok := enhanceChannels[id]
	return ch, ok
}

// ResolvedEnhance 一次「渠道 + 档位」解析结果
type ResolvedEnhance struct {
	Channel *EnhanceChannel
	Mode    EnhanceMode
	Impl    EnhanceImpl
}

// ResolveEnhance 解析节点数据里的「渠道 + 档位」。
//
// 规则（与「绝不静默降级」一致 —— 用户选了云端档却拿本机结果是最坏的情况）：
//   - 渠道为空 → 默认渠道
//   - 渠道未知 / 未开通 → 明确报错，并列出可用渠道
//   - 档位为空 → 该渠道的默认档
//   - 档位不属于该渠道 → 明确报错，并列出该渠道的档位
func ResolveEnhance(channelID, modeID string) (*ResolvedEnhance, error) {
	enhanceMU.RLock()
	defer enhanceMU.RUnlock()

	if channelID == "" {
		channelID = DefaultEnhanceChannel
	}
	ch, ok := enhanceChannels[channelID]
	if !ok {
		return nil, fmt.Errorf("未知的清晰化渠道: %q（可用渠道：%s）", channelID, enhanceAvailableList())
	}
	if !ch.Available {
		return nil, fmt.Errorf("清晰化渠道「%s」尚未开通（可用渠道：%s）", ch.Label, enhanceAvailableList())
	}

	if modeID == "" {
		for _, m := range ch.Modes {
			if m.Default {
				modeID = m.ID
				break
			}
		}
		if modeID == "" && len(ch.Modes) > 0 {
			modeID = ch.Modes[0].ID
		}
	}
	for _, m := range ch.Modes {
		if m.ID == modeID {
			return &ResolvedEnhance{Channel: ch, Mode: m, Impl: ch.impl}, nil
		}
	}
	ids := make([]string, 0, len(ch.Modes))
	for _, m := range ch.Modes {
		ids = append(ids, m.ID)
	}
	return nil, fmt.Errorf("清晰化渠道「%s」不支持档位 %q（支持：%s）", ch.Label, modeID, strings.Join(ids, "、"))
}

// enhanceAvailableList 列出可用渠道（锁内调用）
func enhanceAvailableList() string {
	items := make([]string, 0, len(enhanceOrder))
	for _, id := range enhanceOrder {
		if ch := enhanceChannels[id]; ch != nil && ch.Available {
			items = append(items, fmt.Sprintf("%s(%s)", ch.Label, ch.ID))
		}
	}
	if len(items) == 0 {
		return "-"
	}
	sort.Strings(items)
	return strings.Join(items, "、")
}

// DefaultEnhanceConfig 兜底配置：enhance.yaml 读不到时用它，
// 保证「配置丢了」的后果是「少一条渠道」，而不是清晰化节点整条不可用
func DefaultEnhanceConfig() *service.EnhanceConfig {
	return &service.EnhanceConfig{
		Channels: []service.EnhanceChannelConfig{
			{
				ID:          "ffmpeg",
				Label:       "本机 FFmpeg",
				Description: "本机处理：去块 + 轻降噪 + 锐化，可把短边不足 720p 的放大到 720p。不额外扣积分、不补帧、素材不出境",
				Enabled:     true,
				Modes: []service.EnhanceModeConfig{
					{ID: "clean", Label: "标准", Description: "去块 + 轻降噪 + 锐化，分辨率不变（压掉压缩伪影，画面变干净）"},
					{ID: "hd", Label: "增强", Description: "标准档 + 短边不足 720p 的用 lanczos 放大到 720p（480p 出片也能凑到 720p 观感）", Default: true,
						Params: map[string]interface{}{"target_short_side": 720}},
				},
			},
		},
	}
}
