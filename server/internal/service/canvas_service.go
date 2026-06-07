package service

import (
	"context"

	"libtv/internal/model"
	"libtv/internal/repository"
)

type CanvasService struct {
	canvasRepo repository.CanvasRepo
}

func NewCanvasService(canvasRepo repository.CanvasRepo) *CanvasService {
	return &CanvasService{canvasRepo: canvasRepo}
}

func (s *CanvasService) GetByProjectID(ctx context.Context, projectID string) ([]byte, error) {
	canvas, err := s.canvasRepo.FindByProjectID(ctx, projectID)
	if err != nil {
		return nil, err
	}
	return canvas.Content, nil
}

func (s *CanvasService) Save(ctx context.Context, projectID string, content []byte) error {
	canvas := &model.Canvas{
		ProjectID: projectID,
		Content:   content,
	}
	return s.canvasRepo.Save(ctx, canvas)
}
