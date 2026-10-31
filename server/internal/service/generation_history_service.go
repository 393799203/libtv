package service

import (
	"context"
	"time"

	"libtv/internal/model"
	"libtv/internal/repository"

	"github.com/google/uuid"
)

// GenerationHistoryService 生成历史记录服务
type GenerationHistoryService struct {
	repo repository.GenerationHistoryRepo
}

// NewGenerationHistoryService 创建生成历史记录服务
func NewGenerationHistoryService(repo repository.GenerationHistoryRepo) *GenerationHistoryService {
	return &GenerationHistoryService{repo: repo}
}

// RecordGeneration 记录一次生成结果
func (s *GenerationHistoryService) RecordGeneration(ctx context.Context, userID, projectID, nodeID, nodeType, prompt, modelName, resultURL string) error {
	history := &model.GenerationHistory{
		ID:        uuid.New().String(),
		UserID:    userID,
		ProjectID: projectID,
		NodeID:    nodeID,
		NodeType:  nodeType,
		Prompt:    prompt,
		Model:     modelName,
		ResultURL: resultURL,
	}
	return s.repo.Create(ctx, history)
}

// ListByNode 获取某个节点的生成历史
func (s *GenerationHistoryService) ListByNode(ctx context.Context, nodeID string, page, pageSize int) ([]model.GenerationHistory, int64, error) {
	return s.repo.ListByNode(ctx, nodeID, page, pageSize)
}

// LatestByProjectNodes 见 repository.GenerationHistoryRepo 注释（看门狗判「是否已交付」用）
func (s *GenerationHistoryService) LatestByProjectNodes(ctx context.Context, projectID string, nodeIDs []string, since time.Time) ([]model.GenerationHistory, error) {
	return s.repo.LatestByProjectNodes(ctx, projectID, nodeIDs, since)
}

// ProjectHasVideo 该项目是否已经有过成功的视频生成。
//
// 项目封面用它定优先级：有视频 → 用视频尾帧当封面，所以**图片生成只在项目还没有视频时**
// 才去顶封面，否则会把尾帧盖成一张参考图。
// 出错按「没有视频」处理：图片当封面只是降级展示，不该因为一次查询失败就把封面空着。
func (s *GenerationHistoryService) ProjectHasVideo(ctx context.Context, projectID string) bool {
	if projectID == "" {
		return false
	}
	h, err := s.repo.LatestNodeByProjectType(ctx, projectID, "video")
	return err == nil && h != nil
}
