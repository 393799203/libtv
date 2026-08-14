package service

import (
	"context"
	"log"

	"libtv/internal/model"
	"libtv/internal/repository"
	"libtv/internal/storage"
)

type ProjectService struct {
	projectRepo   repository.ProjectRepo
	canvasRepo    repository.CanvasRepo
	executionRepo repository.ExecutionRepo
	aiTaskRepo    repository.AITaskRepo
	storage       storage.Storage
}

func NewProjectService(
	projectRepo repository.ProjectRepo,
	canvasRepo repository.CanvasRepo,
	executionRepo repository.ExecutionRepo,
	aiTaskRepo repository.AITaskRepo,
	storage storage.Storage,
) *ProjectService {
	return &ProjectService{
		projectRepo:   projectRepo,
		canvasRepo:    canvasRepo,
		executionRepo: executionRepo,
		aiTaskRepo:    aiTaskRepo,
		storage:       storage,
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
	log.Printf("[ProjectService] 开始删除项目: projectID=%s", id)

	// 0. 先查项目拿属主用户ID（画布文件存于 users/<userID>/canvas/<projectID>/，需在删除项目记录前获取）
	ownerUserID := ""
	if project, err := s.projectRepo.FindByID(ctx, id); err == nil && project != nil {
		ownerUserID = project.UserID
	}

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
		log.Printf("[ProjectService] 删除 AITask 记录: count=%d", len(executionIDs))
	}

	// 3. 删除 WorkflowExecution 记录
	if err := s.executionRepo.DeleteByProjectID(ctx, id); err != nil {
		return err
	}
	log.Printf("[ProjectService] 删除 WorkflowExecution 记录")

	// 4. 删除关联的画布
	if err := s.canvasRepo.DeleteByProjectID(ctx, id); err != nil {
		return err
	}
	log.Printf("[ProjectService] 删除 Canvas 记录")

	// 5. 删除存储中的项目目录：新路径 users/<userID>/canvas/<projectID>/，
	// 旧路径 canvas/<projectID>/ 一并清理（历史数据兼容）
	prefixes := []string{"canvas/" + id + "/"}
	if ownerUserID != "" {
		prefixes = append(prefixes, "users/"+ownerUserID+"/canvas/"+id+"/")
	}
	for _, prefix := range prefixes {
		if err := s.storage.DeleteObjectsByPrefix(prefix); err != nil {
			log.Printf("[ProjectService] 删除存储目录失败: prefix=%s err=%v", prefix, err)
			// 不中断流程，继续删除项目记录
		} else {
			log.Printf("[ProjectService] 删除存储目录成功: prefix=%s", prefix)
		}
	}

	// 6. 删除项目记录
	if err := s.projectRepo.Delete(ctx, id); err != nil {
		return err
	}

	log.Printf("[ProjectService] 项目删除完成: projectID=%s", id)
	return nil
}
