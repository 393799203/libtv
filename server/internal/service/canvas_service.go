package service

import (
	"context"
	"log"

	"libtv/internal/model"
	"libtv/internal/repository"
)

type CanvasService struct {
	canvasRepo  repository.CanvasRepo
	projectRepo repository.ProjectRepo
}

func NewCanvasService(canvasRepo repository.CanvasRepo, projectRepo repository.ProjectRepo) *CanvasService {
	return &CanvasService{canvasRepo: canvasRepo, projectRepo: projectRepo}
}

func (s *CanvasService) GetByProjectID(ctx context.Context, projectID string) ([]byte, error) {
	canvas, err := s.canvasRepo.FindByProjectID(ctx, projectID)
	if err != nil {
		return nil, err
	}
	return canvas.Content, nil
}

// Save 保存画布，并顺带把项目的 updated_at 推一下（节流，见 ProjectRepo.Touch）。
//
// 为什么在这里：项目列表按 projects.updated_at 排「最近项目」，而画布保存是
// 「用户正在动这个项目」最频繁的信号；此前它只写 canvases 表，导致排序退化成
// 创建时间。touch 失败不影响保存本身 —— 排序精度不值得让用户的画布存不进去。
func (s *CanvasService) Save(ctx context.Context, projectID string, content []byte) error {
	canvas := &model.Canvas{
		ProjectID: projectID,
		Content:   content,
	}
	if err := s.canvasRepo.Save(ctx, canvas); err != nil {
		return err
	}
	if s.projectRepo != nil {
		if err := s.projectRepo.Touch(ctx, projectID); err != nil {
			log.Printf("[CanvasService] 更新项目活跃时间失败: projectID=%s err=%v", projectID, err)
		}
	}
	return nil
}
