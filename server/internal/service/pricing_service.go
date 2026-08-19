package service

import (
	"context"
	"fmt"
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
}

// priceNodeDefs 价格管理页签的节点顺序（文本/剧本/图片按次，视频按秒，语音按字）
var priceNodeDefs = []priceNodeDef{
	{NodeType: "text", NodeName: "文本节点", ModelGroup: "llm", BillingType: BillingTypePerCall, Usage: "text"},
	{NodeType: "script", NodeName: "剧本节点", ModelGroup: "llm", BillingType: BillingTypePerCall, Usage: "script"},
	{NodeType: "image", NodeName: "图片节点", ModelGroup: "image", BillingType: BillingTypePerCall, Usage: "image"},
	{NodeType: "video", NodeName: "视频节点", ModelGroup: "video", BillingType: BillingTypePerSecond, Usage: "video"},
	{NodeType: "audio", NodeName: "语音节点", ModelGroup: "audio", BillingType: BillingTypePerChar, Usage: "audio"},
}

// ErrInvalidPriceConfig 价格配置参数非法（HTTP 400）
var ErrInvalidPriceConfig = apperror.New(400, http.StatusBadRequest, "价格配置参数非法")

// PriceModelItem 单个模型的价格条目（价格管理页签展示用）
type PriceModelItem struct {
	ModelID    string  `json:"model_id"`
	ModelName  string  `json:"model_name"`
	Description string `json:"description"`
	Resolution string  `json:"resolution,omitempty"` // 分辨率（视频节点：480p/720p/1080p/4k，其他节点为空）
	Price      float64 `json:"price"`                // 未配置时为 0
}

// NodePriceGroup 节点维度的价格分组
type NodePriceGroup struct {
	NodeType    string           `json:"node_type"`
	NodeName    string           `json:"node_name"`
	BillingType string           `json:"billing_type"` // per_call / per_second
	Models      []PriceModelItem `json:"models"`
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
// 视频节点按分辨率拆分展示：同一模型不同分辨率各占一行
func (s *PricingService) ListPrices(ctx context.Context) (*PriceListResult, error) {
	records, err := s.priceRepo.ListAll(ctx)
	if err != nil {
		return nil, err
	}
	// 价格按（节点 + 模型 + 分辨率）三维度索引
	priceByKey := make(map[string]float64, len(records))
	for _, r := range records {
		priceByKey[r.NodeType+"|"+r.ModelID+"|"+r.Resolution] = r.Price
	}

	registry := s.modelManager.ListModels()
	result := &PriceListResult{Nodes: make([]NodePriceGroup, 0, len(priceNodeDefs))}
	for _, def := range priceNodeDefs {
		group := NodePriceGroup{
			NodeType:    def.NodeType,
			NodeName:    def.NodeName,
			BillingType: def.BillingType,
			Models:      make([]PriceModelItem, 0),
		}
		for _, m := range registry[def.ModelGroup] {
			if !containsUsage(m.Usage, def.Usage) {
				continue
			}
			// 视频模型按分辨率拆分：每个分辨率一行
			if def.NodeType == "video" && len(m.Resolutions) > 0 {
				for _, res := range m.Resolutions {
					group.Models = append(group.Models, PriceModelItem{
						ModelID:     m.ID,
						ModelName:   m.Name,
						Description: m.Description,
						Resolution:  res,
						Price:       priceByKey[def.NodeType+"|"+m.ID+"|"+res],
					})
				}
			} else {
				group.Models = append(group.Models, PriceModelItem{
					ModelID:     m.ID,
					ModelName:   m.Name,
					Description: m.Description,
					Price:       priceByKey[def.NodeType+"|"+m.ID+"|"],
				})
			}
		}
		result.Nodes = append(result.Nodes, group)
	}
	return result, nil
}

// SavePrices 批量保存价格配置：校验节点与模型真实存在后按 (node_type, model_id, resolution) upsert
func (s *PricingService) SavePrices(ctx context.Context, items []PriceSaveItem) error {
	if len(items) == 0 {
		return ErrInvalidPriceConfig
	}

	// 汇总 models.yaml 中的全部模型 ID，拒绝为不存在的模型配置价格
	registry := s.modelManager.ListModels()
	validIDs := make(map[string]struct{})
	for _, models := range registry {
		for _, m := range models {
			validIDs[m.ID] = struct{}{}
		}
	}

	prices := make([]model.ModelPrice, 0, len(items))
	seen := make(map[string]struct{}, len(items))
	for _, item := range items {
		if nodeDefByType(item.NodeType) == nil {
			return apperror.New(400, http.StatusBadRequest, fmt.Sprintf("未知节点类型: %s", item.NodeType))
		}
		if _, ok := validIDs[item.ModelID]; !ok {
			return apperror.New(400, http.StatusBadRequest, fmt.Sprintf("模型不存在: %s", item.ModelID))
		}
		if item.Price < 0 || item.Price != math.Trunc(item.Price) {
			// 单价统一为整数（视频/语音按秒单价同样如此），小数一律拒绝
			return ErrInvalidPriceConfig
		}
		key := item.NodeType + "|" + item.ModelID + "|" + item.Resolution
		if _, dup := seen[key]; dup {
			continue
		}
		seen[key] = struct{}{}
		prices = append(prices, model.ModelPrice{NodeType: item.NodeType, ModelID: item.ModelID, Resolution: item.Resolution, Price: item.Price})
	}

	return s.priceRepo.BatchUpsert(ctx, prices)
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
