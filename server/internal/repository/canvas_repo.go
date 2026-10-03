package repository

import (
	"context"
	"encoding/json"
	"fmt"

	"libtv/internal/model"

	"gorm.io/datatypes"
	"gorm.io/gorm"
)

// CanvasRepo 画布数据访问
type CanvasRepo interface {
	FindByProjectID(ctx context.Context, projectID string) (*model.Canvas, error)
	Save(ctx context.Context, canvas *model.Canvas) error
	DeleteByProjectID(ctx context.Context, projectID string) error
}

type canvasRepo struct {
	db *gorm.DB
}

func NewCanvasRepo(db *gorm.DB) CanvasRepo {
	return &canvasRepo{db: db}
}

func (r *canvasRepo) FindByProjectID(ctx context.Context, projectID string) (*model.Canvas, error) {
	var canvas model.Canvas
	if err := r.db.WithContext(ctx).Where("project_id = ?", projectID).First(&canvas).Error; err != nil {
		return nil, err
	}
	return &canvas, nil
}

// Save 保存画布内容。
//
// 两件事必须一起做，否则画布会出现「产物被旧快照覆盖」这类事故：
//
//  1. **产物字段只增不减**（mergeStickyProducts）：即将保存的内容里某个节点缺了
//     imageUrl/videoUrl/thumbUrl/imageUrls/content，而磁盘上已有值，则保留磁盘的值。
//     画布是整块 JSON 覆盖写，前端保存的是它自己那份（可能因 SSE 丢事件而不知道某节点
//     已经生成好了）；没有这条规则，一次旧快照保存就能把已经交付、用户正在看的视频
//     从画布里抹掉 —— 表现就是「明明生成了，一刷新又变回生成中」。
//
//  2. **版本乐观锁 + 冲突重试**：并发写入（前端保存 vs 引擎逐节点落库 vs 看门狗收口）
//     谁都不该整块覆盖谁。带 version 条件更新，冲突就重新读一次再合并重试
//     （合并是幂等的，重试一定收敛）。
func (r *canvasRepo) Save(ctx context.Context, canvas *model.Canvas) error {
	var lastErr error
	for attempt := 0; attempt < 3; attempt++ {
		var existing model.Canvas
		err := r.db.WithContext(ctx).Where("project_id = ?", canvas.ProjectID).First(&existing).Error
		if err == gorm.ErrRecordNotFound {
			// 首次创建：并发创建由 project_id 唯一索引兜底
			if err := r.db.WithContext(ctx).Create(canvas).Error; err != nil {
				lastErr = err
				continue
			}
			return nil
		}
		if err != nil {
			return err
		}

		content := mergeStickyProducts(existing.Content, canvas.Content)
		canvas.ID = existing.ID
		canvas.Version = existing.Version + 1

		res := r.db.WithContext(ctx).Model(&model.Canvas{}).
			Where("project_id = ? AND version = ?", canvas.ProjectID, existing.Version).
			Updates(map[string]interface{}{
				"content": content,
				"version": canvas.Version,
			})
		if res.Error != nil {
			return res.Error
		}
		if res.RowsAffected > 0 {
			return nil
		}
		// 版本已被别的写入推进（并发保存）→ 重新读 + 合并后重试
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("canvas save conflict: project_id=%s", canvas.ProjectID)
	}
	return lastErr
}

// productFields 画布节点上「一旦有值就不该被抹掉」的产物字段。
// 与前端 NodeData 的产物字段保持一致（文本/剧本走 content，图片走 imageUrl/imageUrls，
// 视频走 videoUrl，缩略图走 thumbUrl）。
var productFields = []string{
	"content",   // 文本/故事/剧本节点的正文
	"imageUrl",  // 图片（首图）
	"imageUrls", // 图片（多图）
	"videoUrl",  // 视频
	"thumbUrl",  // 缩略图
	"thumbUrls", // 缩略图（多图）
	"audioUrl",  // 音频
	"stillUrl",  // 白模预演导出的静帧
}

// mergeStickyProducts 把「磁盘上已有的内容」与「即将保存的内容」按节点合并：
// 只补产物字段，不动其它任何字段（status、error、位置、连线都按即将保存的来）。
//
// 用 map[string]json.RawMessage 做通用搬运，是为了不依赖 engine 的画布 DSL 类型
// （repository 不该反向依赖 engine），同时保留 nodes/edges/viewport 上的未知字段。
func mergeStickyProducts(oldRaw, newRaw datatypes.JSON) datatypes.JSON {
	if len(oldRaw) == 0 || len(newRaw) == 0 {
		return newRaw
	}
	oldNodes := nodeDataByID(oldRaw)
	if len(oldNodes) == 0 {
		return newRaw
	}

	var doc map[string]json.RawMessage
	if err := json.Unmarshal(newRaw, &doc); err != nil {
		return newRaw
	}
	rawNodes, ok := doc["nodes"]
	if !ok {
		return newRaw
	}
	var nodes []map[string]json.RawMessage
	if err := json.Unmarshal(rawNodes, &nodes); err != nil {
		return newRaw
	}

	changed := false
	for _, n := range nodes {
		var id string
		if err := json.Unmarshal(n["id"], &id); err != nil || id == "" {
			continue
		}
		oldData, ok := oldNodes[id]
		if !ok {
			continue
		}
		var newData map[string]json.RawMessage
		if err := json.Unmarshal(n["data"], &newData); err != nil {
			continue
		}
		nodeChanged := false
		for _, field := range productFields {
			oldVal, hasOld := oldData[field]
			if !hasOld || isEmptyJSON(oldVal) {
				continue
			}
			if newVal, hasNew := newData[field]; !hasNew || isEmptyJSON(newVal) {
				newData[field] = oldVal
				nodeChanged = true
			}
		}
		if !nodeChanged {
			continue
		}
		if merged, err := json.Marshal(newData); err == nil {
			n["data"] = merged
			changed = true
		}
	}
	if !changed {
		return newRaw
	}
	if mergedNodes, err := json.Marshal(nodes); err == nil {
		doc["nodes"] = mergedNodes
	}
	if merged, err := json.Marshal(doc); err == nil {
		return datatypes.JSON(merged)
	}
	return newRaw
}

// nodeDataByID 解析画布内容里每个节点的 data 字段（节点 ID → data 的键值）
func nodeDataByID(raw datatypes.JSON) map[string]map[string]json.RawMessage {
	var doc struct {
		Nodes []struct {
			ID   string                     `json:"id"`
			Data map[string]json.RawMessage `json:"data"`
		} `json:"nodes"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil
	}
	out := make(map[string]map[string]json.RawMessage, len(doc.Nodes))
	for _, n := range doc.Nodes {
		if n.ID != "" && n.Data != nil {
			out[n.ID] = n.Data
		}
	}
	return out
}

// isEmptyJSON 判断原始 JSON 值是否「空」（缺失/null/空串/空数组/空对象）
func isEmptyJSON(raw json.RawMessage) bool {
	if len(raw) == 0 {
		return true
	}
	s := string(raw)
	switch s {
	case "null", `""`, "[]", "{}":
		return true
	}
	return false
}

func (r *canvasRepo) DeleteByProjectID(ctx context.Context, projectID string) error {
	return r.db.WithContext(ctx).Where("project_id = ?", projectID).Delete(&model.Canvas{}).Error
}
