package service

import (
	"context"

	"libtv/internal/model"
	"libtv/internal/repository"
)

type ProjectService struct {
	projectRepo   repository.ProjectRepo
	canvasRepo    repository.CanvasRepo
	executionRepo repository.ExecutionRepo
	aiTaskRepo    repository.AITaskRepo
}

func NewProjectService(
	projectRepo repository.ProjectRepo,
	canvasRepo repository.CanvasRepo,
	executionRepo repository.ExecutionRepo,
	aiTaskRepo repository.AITaskRepo,
) *ProjectService {
	return &ProjectService{
		projectRepo:   projectRepo,
		canvasRepo:    canvasRepo,
		executionRepo: executionRepo,
		aiTaskRepo:    aiTaskRepo,
	}
}

func (s *ProjectService) Create(ctx context.Context, userID string, name, description string) (*model.Project, error) {
	project := &model.Project{
		UserID:      userID,
		Name:        name,
		Description: description,
	}
	if err := s.projectRepo.Create(ctx, project); err != nil {
		return nil, err
	}

	// 创建默认空画布
	canvas := &model.Canvas{
		ProjectID: project.ID,
		Content:   []byte(`{"nodes":[],"edges":[],"viewport":{"x":0,"y":0,"zoom":1}}`),
		Version:   1,
	}
	if err := s.canvasRepo.Save(ctx, canvas); err != nil {
		return nil, err
	}

	return project, nil
}

func (s *ProjectService) GetByID(ctx context.Context, id string) (*model.Project, error) {
	return s.projectRepo.FindByID(ctx, id)
}

func (s *ProjectService) ListByUserID(ctx context.Context, userID string, page, pageSize int) ([]*model.Project, int64, error) {
	offset := (page - 1) * pageSize
	return s.projectRepo.ListByUserID(ctx, userID, offset, pageSize)
}

func (s *ProjectService) Update(ctx context.Context, id string, name, description string) (*model.Project, error) {
	project, err := s.projectRepo.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if name != "" {
		project.Name = name
	}
	if description != "" {
		project.Description = description
	}
	if err := s.projectRepo.Update(ctx, project); err != nil {
		return nil, err
	}
	return project, nil
}

func (s *ProjectService) Delete(ctx context.Context, id string) error {
	// 1. 查询项目的所有 WorkflowExecution 记录
	executions, err := s.executionRepo.ListByProjectID(ctx, id)
	if err != nil {
		return err
	}

	// 2. 删除这些 WorkflowExecution 对应的所有 AITask 记录
	if len(executions) > 0 {
		executionIDs := make([]int64, len(executions))
		for i, exec := range executions {
			executionIDs[i] = exec.ID
		}
		if err := s.aiTaskRepo.DeleteByExecutionIDs(ctx, executionIDs); err != nil {
			return err
		}
	}

	// 3. 删除 WorkflowExecution 记录
	if err := s.executionRepo.DeleteByProjectID(ctx, id); err != nil {
		return err
	}

	// 4. 删除关联的画布
	if err := s.canvasRepo.DeleteByProjectID(ctx, id); err != nil {
		return err
	}

	// 5. 删除项目
	return s.projectRepo.Delete(ctx, id)
}
