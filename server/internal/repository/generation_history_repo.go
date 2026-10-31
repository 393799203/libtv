package repository

import (
	"context"
	"time"

	"libtv/internal/model"

	"gorm.io/gorm"
)

// GenerationHistoryRepo 生成历史记录仓库接口
type GenerationHistoryRepo interface {
	Create(ctx context.Context, history *model.GenerationHistory) error
	ListByNode(ctx context.Context, nodeID string, page, pageSize int) ([]model.GenerationHistory, int64, error)
	// LatestByProjectNodes 查询这些节点在 since 之后最近一次「已交付」的生成结果。
	// 看门狗用它判断「结果其实已经产出并上传对象存储、只是执行状态没跟上」，
	// 避免把已交付的生成误判为失败并退费。since 用于排除上一次生成的旧记录。
	LatestByProjectNodes(ctx context.Context, projectID string, nodeIDs []string, since time.Time) ([]model.GenerationHistory, error)
	// LatestNodeByProjectType 取该项目某类型最近一次成功生成的节点（查不到返回 nil, nil）
	LatestNodeByProjectType(ctx context.Context, projectID, nodeType string) (*model.GenerationHistory, error)
}

type generationHistoryRepo struct {
	db *gorm.DB
}

// NewGenerationHistoryRepo 创建生成历史记录仓库
func NewGenerationHistoryRepo(db *gorm.DB) GenerationHistoryRepo {
	return &generationHistoryRepo{db: db}
}

func (r *generationHistoryRepo) Create(ctx context.Context, history *model.GenerationHistory) error {
	return r.db.WithContext(ctx).Create(history).Error
}

func (r *generationHistoryRepo) ListByNode(ctx context.Context, nodeID string, page, pageSize int) ([]model.GenerationHistory, int64, error) {
	var items []model.GenerationHistory
	var total int64

	query := r.db.WithContext(ctx).Model(&model.GenerationHistory{}).Where("node_id = ?", nodeID)

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	offset := (page - 1) * pageSize
	if err := query.Order("created_at DESC").Offset(offset).Limit(pageSize).Find(&items).Error; err != nil {
		return nil, 0, err
	}

	return items, total, nil
}

// LatestByProjectNodes 见接口注释。按 created_at 倒序返回，调用方取每个节点的第一条即可。
func (r *generationHistoryRepo) LatestByProjectNodes(ctx context.Context, projectID string, nodeIDs []string, since time.Time) ([]model.GenerationHistory, error) {
	if projectID == "" || len(nodeIDs) == 0 {
		return nil, nil
	}
	var items []model.GenerationHistory
	err := r.db.WithContext(ctx).
		Where("project_id = ? AND node_id IN ?", projectID, nodeIDs).
		Where("created_at >= ?", since).
		Order("created_at DESC").
		Find(&items).Error
	return items, err
}

// LatestNodeByProjectType 取该项目某种类型（image/video）最近一次成功生成的节点。
//
// 供存量封面回填定位「最后一次生成视频的节点」—— 生成历史里没有存输入素材，
// 但存了节点 ID，回填据此回画布里取该节点的素材引用。
// 查不到返回 (nil, nil)：老项目可能根本没有生成历史，调用方要能退化处理。
func (r *generationHistoryRepo) LatestNodeByProjectType(ctx context.Context, projectID, nodeType string) (*model.GenerationHistory, error) {
	if projectID == "" || nodeType == "" {
		return nil, nil
	}
	var item model.GenerationHistory
	err := r.db.WithContext(ctx).
		Where("project_id = ? AND node_type = ?", projectID, nodeType).
		Order("created_at DESC").
		First(&item).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &item, nil
}
