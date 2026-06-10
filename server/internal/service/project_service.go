package service

import (
	"context"

	"libtv/internal/model"
	"libtv/internal/repository"
)

type ProjectService struct {
	projectRepo repository.ProjectRepo
	canvasRepo  repository.CanvasRepo
}

func NewProjectService(projectRepo repository.ProjectRepo, canvasRepo repository.CanvasRepo) *ProjectService {
	return &ProjectService{projectRepo: projectRepo, canvasRepo: canvasRepo}
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
	// 先删除关联的画布
	if err := s.canvasRepo.DeleteByProjectID(ctx, id); err != nil {
		return err
	}
	return s.projectRepo.Delete(ctx, id)
}
