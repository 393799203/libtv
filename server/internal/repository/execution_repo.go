package repository

import (
	"context"

	"libtv/internal/model"

	"gorm.io/gorm"
)

// ExecutionRepo 工作流执行数据访问
type ExecutionRepo interface {
	Create(ctx context.Context, exec *model.WorkflowExecution) error
	FindByID(ctx context.Context, id int64) (*model.WorkflowExecution, error)
	UpdateStatus(ctx context.Context, id int64, status string, errMsg string) error
}

type executionRepo struct {
	db *gorm.DB
}

func NewExecutionRepo(db *gorm.DB) ExecutionRepo {
	return &executionRepo{db: db}
}

func (r *executionRepo) Create(ctx context.Context, exec *model.WorkflowExecution) error {
	return r.db.WithContext(ctx).Create(exec).Error
}

func (r *executionRepo) FindByID(ctx context.Context, id int64) (*model.WorkflowExecution, error) {
	var exec model.WorkflowExecution
	if err := r.db.WithContext(ctx).First(&exec, id).Error; err != nil {
		return nil, err
	}
	return &exec, nil
}

func (r *executionRepo) UpdateStatus(ctx context.Context, id int64, status string, errMsg string) error {
	updates := map[string]interface{}{"status": status}
	if errMsg != "" {
		updates["error_msg"] = errMsg
	}
	return r.db.WithContext(ctx).Model(&model.WorkflowExecution{}).Where("id = ?", id).Updates(updates).Error
}

// AITaskRepo AI 任务数据访问
type AITaskRepo interface {
	Create(ctx context.Context, task *model.AITask) error
	FindByID(ctx context.Context, id int64) (*model.AITask, error)
	UpdateOutput(ctx context.Context, id int64, status string, output []byte, errMsg string) error
	ListByExecutionID(ctx context.Context, executionID int64) ([]*model.AITask, error)
}

type aiTaskRepo struct {
	db *gorm.DB
}

func NewAITaskRepo(db *gorm.DB) AITaskRepo {
	return &aiTaskRepo{db: db}
}

func (r *aiTaskRepo) Create(ctx context.Context, task *model.AITask) error {
	return r.db.WithContext(ctx).Create(task).Error
}

func (r *aiTaskRepo) FindByID(ctx context.Context, id int64) (*model.AITask, error) {
	var task model.AITask
	if err := r.db.WithContext(ctx).First(&task, id).Error; err != nil {
		return nil, err
	}
	return &task, nil
}

func (r *aiTaskRepo) UpdateOutput(ctx context.Context, id int64, status string, output []byte, errMsg string) error {
	updates := map[string]interface{}{"status": status}
	if output != nil {
		updates["output"] = output
	}
	if errMsg != "" {
		updates["error_msg"] = errMsg
	}
	return r.db.WithContext(ctx).Model(&model.AITask{}).Where("id = ?", id).Updates(updates).Error
}

func (r *aiTaskRepo) ListByExecutionID(ctx context.Context, executionID int64) ([]*model.AITask, error) {
	var tasks []*model.AITask
	if err := r.db.WithContext(ctx).Where("execution_id = ?", executionID).Find(&tasks).Error; err != nil {
		return nil, err
	}
	return tasks, nil
}
