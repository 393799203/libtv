package billing

import (
	"context"
	"fmt"
	"log"
	"math"
	"net/http"

	"libtv/internal/llm"
	"libtv/internal/model"
	"libtv/internal/pkg/apperror"
	"libtv/internal/repository"
)

// 计费类型：文本 / 图片模型按次，视频模型按秒，语音模型按字
const (
	BillingTypePerCall   = "per_call"   // 按次计费（积分/次）
	BillingTypePerSecond = "per_second" // 按秒计费（积分/秒）
	BillingTypePerChar   = "per_char"   // 按字计费（积分/100字）
)

// priceNodeDef 价格管理的节点分组定义：
// NodeType 对应画布节点类型，ModelGroup 对应 models.yaml 的模型分类，
// Usage 用于过滤该分类下归属此节点的模型
type priceNodeDef struct {
	NodeType    string
	NodeName    string
	ModelGroup  string
	BillingType string
	Usage       string
	ModelIDs    []string // 可选模型白名单：仅展示这些模型（如白模解析只挂 Seed 2.1）
}

// priceNodeDefs 价格管理页签的节点顺序（文本/剧本/图片按次，视频按秒，语音按字）
var priceNodeDefs = []priceNodeDef{
	{NodeType: "text", NodeName: "文本节点", ModelGroup: "llm", BillingType: BillingTypePerCall, Usage: "text"},
	{NodeType: "script", NodeName: "剧本节点", ModelGroup: "llm", BillingType: BillingTypePerCall, Usage: "script"},
	{NodeType: "image", NodeName: "图片节点", ModelGroup: "image", BillingType: BillingTypePerCall, Usage: "image"},
	{NodeType: "video", NodeName: "视频节点", ModelGroup: "video", BillingType: BillingTypePerSecond, Usage: "video"},
	{NodeType: "audio", NodeName: "语音节点", ModelGroup: "audio", BillingType: BillingTypePerChar, Usage: "audio"},
	{NodeType: "previz", NodeName: "白模解析", ModelGroup: "llm", BillingType: BillingTypePerCall, Usage: "script", ModelIDs: []string{"doubao-seed-2.1-turbo", "doubao-seed-2.1-pro", "glm-5.3-flash", "deepseek-v4.1-flash"}},
}

// ErrInvalidPriceConfig 价格配置参数非法（HTTP 400）
var ErrInvalidPriceConfig = apperror.New(400, http.StatusBadRequest, "价格配置参数非法")

// PriceModelItem 单个模型的价格条目（价格管理页签展示用）
type PriceModelItem struct {
	ModelID     string  `json:"model_id"`
	ModelName   string  `json:"model_name"`
	Description string  `json:"description"`
	Resolution  string  `json:"resolution,omitempty"` // 分辨率档位（视频 480p/720p/1080p、图片 2K/4K；文本/剧本/语音等无档位，为空）
	Price       float64 `json:"price"`                // 生效单价：本档单独配置过就是本档的价，没配过则继承默认档（都没有 = 0）
	// PriceConfigured 该分辨率档是否已单独配置过。
	// false = 这个价是从「默认档」继承来的 —— 界面要标出来，
	// 否则运营会以为 4K 已经配了 60，其实只是继承了 2K 的价（真正的成本缺口就藏在这里）
	PriceConfigured bool `json:"price_configured,omitempty"`
	// RefVideoBilling 该模型是否支持「带参考视频输入」单独定价
	// （models.yaml 的 ref_video_billing，目前仅 3 个 Seedance 模型为 true）。
	// false 的模型参考视频不参与计费，页面不展示「带参考视频」输入框
	RefVideoBilling bool `json:"ref_video_billing,omitempty"`
	// RefVideoPrice 带参考视频输入的单价（积分/秒，仅视频节点）；
	// 未单独配置时为「无参考视频单价 6 折」的预设值（此时 RefVideoPriceConfigured=false）
	RefVideoPrice float64 `json:"ref_video_price,omitempty"`
	// RefVideoPriceConfigured 是否已在后台单独配置「带参考视频」单价（false = 当前用 6 折预设兜底）
	RefVideoPriceConfigured bool `json:"ref_video_price_configured,omitempty"`
}

// NodePriceGroup 节点维度的价格分组
type NodePriceGroup struct {
	NodeType    string           `json:"node_type"`
	NodeName    string           `json:"node_name"`
	BillingType string           `json:"billing_type"` // per_call / per_second
	Models      []PriceModelItem `json:"models"`
	// RefVideoDiscount 带参考视频输入的预设折扣（仅视频节点返回，0.6 = 6 折）：
	// 「带参考视频」单价未配置时按无参考视频单价 × 该折扣计费，页面据此提示折扣文案
	RefVideoDiscount float64 `json:"ref_video_discount,omitempty"`
}

// PriceListResult 价格管理列表响应
type PriceListResult struct {
	Nodes []NodePriceGroup `json:"nodes"`
}

// PriceSaveItem 保存价格请求条目
type PriceSaveItem struct {
	NodeType   string  `json:"node_type" binding:"required"`
	ModelID    string  `json:"model_id" binding:"required"`
	Resolution string  `json:"resolution"` // 分辨率（视频节点必填，其他节点留空）
	Price      float64 `json:"price" binding:"gte=0"`
	// RefVideoPrice 带参考视频输入的单价（积分/秒，仅 ref_video_billing 模型）。
	// 传 nil 表示本次不改动该档（保持「6 折预设」或已配置的值）；传值则连同常规单价一起保存。
	// 用指针是为了区分「没提交」与「提交了 0（免费）」
	RefVideoPrice *float64 `json:"ref_video_price"`
	// ClearRefVideoPrice 清除该档已单独配置的单价，回到「无参考视频单价 6 折」预设
	// （后台「恢复默认」按钮）；与 RefVideoPrice 同时传时以清除为准
	ClearRefVideoPrice bool `json:"clear_ref_video_price"`
}

// priceKey 价格索引键：与 model_prices 的唯一维度一致（渠道已在查询时过滤）
type priceKey struct {
	nodeType   string
	modelID    string
	resolution string
	refVideo   bool
}

// nodeDefByType 按节点类型查找分组定义（校验 node_type 合法性 / 取计费类型）
func nodeDefByType(nodeType string) *priceNodeDef {
	for i := range priceNodeDefs {
		if priceNodeDefs[i].NodeType == nodeType {
			return &priceNodeDefs[i]
		}
	}
	return nil
}

// PricingService 模型价格配置服务：
// 模型清单来自 models.yaml（ModelManager），价格持久化在 model_prices 表
type PricingService struct {
	modelManager *llm.ModelManager
	priceRepo    repository.ModelPriceRepo
}

func NewPricingService(modelManager *llm.ModelManager, priceRepo repository.ModelPriceRepo) *PricingService {
	return &PricingService{modelManager: modelManager, priceRepo: priceRepo}
}

// ListPrices 返回各节点下模型的价格配置（模型清单以 models.yaml 为准，未配置价格的模型价格为 0）
// channel 指定渠道（wasu/dianxin）：只展示该渠道的模型清单与价格；
// channel 为空时按华数（wasu）展示（兼容默认）
// 视频节点按分辨率拆分展示：同一模型不同分辨率各占一行；
// 支持参考视频计费的模型（ref_video_billing）额外带一档「带参考视频」单价
func (s *PricingService) ListPrices(ctx context.Context, channel string) (*PriceListResult, error) {
	if channel == "" {
		channel = "wasu"
	}
	records, err := s.priceRepo.ListAll(ctx, channel)
	if err != nil {
		return nil, err
	}
	// 价格按（节点 + 模型 + 分辨率 + 是否带参考视频输入）四维度索引（记录已按渠道过滤）；
	// configured 用于区分「配置为 0（免费）」与「没配置过」（后者走 6 折预设）
	priceByKey := make(map[priceKey]float64, len(records))
	configured := make(map[priceKey]struct{}, len(records))
	for _, r := range records {
		key := priceKey{nodeType: r.NodeType, modelID: r.ModelID, resolution: r.Resolution, refVideo: r.HasReferenceVideo}
		priceByKey[key] = r.Price
		configured[key] = struct{}{}
	}
	priceOf := func(nodeType, modelID, resolution string, refVideo bool) (float64, bool) {
		key := priceKey{nodeType: nodeType, modelID: modelID, resolution: resolution, refVideo: refVideo}
		_, ok := configured[key]
		return priceByKey[key], ok
	}

	registry := s.modelManager.ListModelsForChannel(channel)
	result := &PriceListResult{Nodes: make([]NodePriceGroup, 0, len(priceNodeDefs))}
	for _, def := range priceNodeDefs {
		group := NodePriceGroup{
			NodeType:    def.NodeType,
			NodeName:    def.NodeName,
			BillingType: def.BillingType,
			Models:      make([]PriceModelItem, 0),
		}
		if def.NodeType == "video" {
			group.RefVideoDiscount = RefVideoPriceDiscount
		}
		for _, m := range registry[def.ModelGroup] {
			if !containsUsage(m.Usage, def.Usage) {
				continue
			}
			if len(def.ModelIDs) > 0 && !containsString(def.ModelIDs, m.ID) {
				continue
			}
			// 视频与图片模型按分辨率拆分：每个分辨率一行、各自定价。
			// 图片的档位不是摆设：上游按 token 计费而 token ≈ 像素/256，
			// 2K(16,384) 与 4K(65,536) 差 4 倍，必须能分开定价
			if (def.NodeType == "video" || def.NodeType == "image") && len(m.Resolutions) > 0 {
				for _, res := range m.Resolutions {
					item := PriceModelItem{
						ModelID:     m.ID,
						ModelName:   m.Name,
						Description: m.Description,
						Resolution:  res,
					}
					// 本档自己的配置优先；没配过就继承默认档（与计费侧同一口径），
					// 并用 PriceConfigured=false 让界面把它标成「继承默认」
					item.Price, item.PriceConfigured = priceOf(def.NodeType, m.ID, res, false)
					if !item.PriceConfigured {
						item.Price, _ = priceOf(def.NodeType, m.ID, "", false)
					}
					if m.RefVideoBilling {
						item.RefVideoBilling = true
						refPrice, ok := priceOf(def.NodeType, m.ID, res, true)
						item.RefVideoPriceConfigured = ok
						if !ok {
							// 未单独配置 → 与计费侧兜底同口径：无参考视频单价的 6 折
							refPrice = RefVideoPrice(item.Price)
						}
						item.RefVideoPrice = refPrice
					}
					group.Models = append(group.Models, item)
				}
			} else {
				price, _ := priceOf(def.NodeType, m.ID, "", false)
				group.Models = append(group.Models, PriceModelItem{
					ModelID:     m.ID,
					ModelName:   m.Name,
					Description: m.Description,
					Price:       price,
				})
			}
		}
		result.Nodes = append(result.Nodes, group)
	}
	return result, nil
}

// SavePrices 批量保存指定渠道的价格配置：
// 校验节点合法且模型属于该渠道后，按 (channel, node_type, model_id, resolution, has_reference_video) upsert；
// 提交了 RefVideoPrice 的视频模型会额外写入一条「带参考视频」档价格，
// 提交了 ClearRefVideoPrice 的则删除该档（回到 6 折预设）
func (s *PricingService) SavePrices(ctx context.Context, channel string, items []PriceSaveItem) error {
	if len(items) == 0 {
		return ErrInvalidPriceConfig
	}
	if channel == "" {
		channel = "wasu"
	}

	// 汇总该渠道 models.yaml 中的模型（ID → 配置），拒绝为不存在的模型或跨渠道模型配置价格
	registry := s.modelManager.ListModelsForChannel(channel)
	validModels := make(map[string]llm.ModelConfig)
	for _, models := range registry {
		for _, m := range models {
			validModels[m.ID] = m
		}
	}

	prices := make([]model.ModelPrice, 0, len(items))
	clearRefs := make([]PriceSaveItem, 0)
	seen := make(map[priceKey]struct{}, len(items))
	for _, item := range items {
		def := nodeDefByType(item.NodeType)
		if def == nil {
			return apperror.New(400, http.StatusBadRequest, fmt.Sprintf("未知节点类型: %s", item.NodeType))
		}
		modelConfig, ok := validModels[item.ModelID]
		if !ok {
			return apperror.New(400, http.StatusBadRequest, fmt.Sprintf("模型不属于渠道 %s: %s", channel, item.ModelID))
		}
		if item.Price < 0 || item.Price != math.Trunc(item.Price) {
			// 单价统一为整数（视频/语音按秒单价同样如此），小数一律拒绝
			return ErrInvalidPriceConfig
		}
		// 「带参考视频」档仅对开启 ref_video_billing 的视频模型有意义（如 wan3.0 系列没有这一档）
		if item.RefVideoPrice != nil || item.ClearRefVideoPrice {
			if item.NodeType != "video" || !modelConfig.RefVideoBilling {
				return apperror.New(400, http.StatusBadRequest,
					fmt.Sprintf("模型不支持「带参考视频」单价: %s", item.ModelID))
			}
		}
		if item.RefVideoPrice != nil && (*item.RefVideoPrice < 0 || *item.RefVideoPrice != math.Trunc(*item.RefVideoPrice)) {
			return ErrInvalidPriceConfig
		}

		rows := []model.ModelPrice{{
			Channel:    channel,
			NodeType:   item.NodeType,
			ModelID:    item.ModelID,
			Resolution: item.Resolution,
			Price:      item.Price,
		}}
		// 清除优先于写入：同一条请求里既传值又要求清除时，结果应是「回到 6 折预设」
		if item.ClearRefVideoPrice {
			clearRefs = append(clearRefs, item)
		} else if item.RefVideoPrice != nil {
			rows = append(rows, model.ModelPrice{
				Channel:           channel,
				NodeType:          item.NodeType,
				ModelID:           item.ModelID,
				Resolution:        item.Resolution,
				HasReferenceVideo: true,
				Price:             *item.RefVideoPrice,
			})
		}
		for _, row := range rows {
			key := priceKey{nodeType: row.NodeType, modelID: row.ModelID, resolution: row.Resolution, refVideo: row.HasReferenceVideo}
			if _, dup := seen[key]; dup {
				continue
			}
			seen[key] = struct{}{}
			prices = append(prices, row)
		}
	}

	if err := s.priceRepo.BatchUpsert(ctx, prices); err != nil {
		return err
	}
	// 清除放在写入之后：先保证常规单价已保存成功，再删掉那一档配置
	for _, item := range clearRefs {
		if err := s.priceRepo.DeleteRefVideoPrice(ctx, channel, item.NodeType, item.ModelID, item.Resolution); err != nil {
			return err
		}
	}
	return nil
}

// SeedRefVideoPrices 给「带参考视频」档补默认价：
// 对开启 ref_video_billing 的视频模型，只要该（渠道 + 分辨率）已配置常规单价、且还没有
// 「带参考视频」价，就补一条 = 常规单价 6 折（RefVideoPrice）。
// 目的：价格管理页打开时这一档就是「已经配好的 6 折价」，运营直接在框里改；
// 已有配置（含运营手改过的价）一律不动，可重复执行
func (s *PricingService) SeedRefVideoPrices(ctx context.Context) error {
	rows := make([]model.ModelPrice, 0)
	for _, channel := range s.modelManager.ListChannels() {
		existing, err := s.priceRepo.ListAll(ctx, channel)
		if err != nil {
			return err
		}
		priceAt := make(map[priceKey]float64, len(existing))
		for _, r := range existing {
			priceAt[priceKey{nodeType: r.NodeType, modelID: r.ModelID, resolution: r.Resolution, refVideo: r.HasReferenceVideo}] = r.Price
		}
		for _, m := range s.modelManager.ListModelsForChannel(channel)["video"] {
			if !m.RefVideoBilling {
				continue
			}
			for _, res := range m.Resolutions {
				refKey := priceKey{nodeType: "video", modelID: m.ID, resolution: res, refVideo: true}
				if _, ok := priceAt[refKey]; ok {
					continue // 已配置过（含运营手改），不覆盖
				}
				base, ok := priceAt[priceKey{nodeType: "video", modelID: m.ID, resolution: res, refVideo: false}]
				if !ok || base <= 0 {
					continue // 常规单价没配、或配成 0（暂不扣费）：不补默认价
				}
				rows = append(rows, model.ModelPrice{
					Channel:           channel,
					NodeType:          "video",
					ModelID:           m.ID,
					Resolution:        res,
					HasReferenceVideo: true,
					Price:             RefVideoPrice(base),
				})
			}
		}
	}
	if len(rows) == 0 {
		return nil
	}
	if err := s.priceRepo.BatchUpsert(ctx, rows); err != nil {
		return err
	}
	log.Printf("[Pricing] 已补齐「带参考视频」默认价 %d 条（= 无参考视频单价 6 折）", len(rows))
	return nil
}

// containsUsage 模型 usage 列表是否包含指定用途
func containsUsage(usage []string, keyword string) bool {
	for _, u := range usage {
		if u == keyword {
			return true
		}
	}
	return false
}

func containsString(list []string, target string) bool {
	for _, s := range list {
		if s == target {
			return true
		}
	}
	return false
}
