package service

import (
	"context"

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
