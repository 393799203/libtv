package repository

import (
	"context"
	"time"

	"libtv/internal/model"

	"gorm.io/gorm"
)

// ExecutionRepo 工作流执行数据访问
type ExecutionRepo interface {
	Create(ctx context.Context, exec *model.WorkflowExecution) error
	FindByID(ctx context.Context, id int64) (*model.WorkflowExecution, error)
	UpdateStatus(ctx context.Context, id int64, status string, errMsg string) error
	// ListStaleActive 查询超过给定时刻仍未结束（pending/running）的执行（看门狗用）
	ListStaleActive(ctx context.Context, startedBefore time.Time) ([]*model.WorkflowExecution, error)
	// UpdateStatusIfActive 仅在执行仍处于 pending/running 时写状态，返回是否写成功（看门狗用）
	UpdateStatusIfActive(ctx context.Context, id int64, status string, errMsg string) (bool, error)
	DeleteByProjectID(ctx context.Context, projectID string) error
	ListByProjectID(ctx context.Context, projectID string) ([]*model.WorkflowExecution, error)
	// ListActiveByProject 查询项目下仍在进行中（pending/running）的执行，
	// 供前端重进项目时恢复「生成中」状态
	ListActiveByProject(ctx context.Context, projectID string) ([]*model.WorkflowExecution, error)
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
	return r.db.WithContext(ctx).Model(&model.WorkflowExecution{}).
		Where("id = ?", id).
		Updates(statusUpdates(status, errMsg)).Error
}

// UpdateStatusIfActive 仅在执行仍处于 pending/running 时才写状态，返回是否真的写成功。
//
// 看门狗收口必须走这个条件写：它和「执行刚好跑完并写了 done」的正常路径会并发，
// 若无条件覆盖，一条刚刚成功的执行（产物已上传、画布已写 success）会被后写的
// failed 盖掉 —— 用户看到的就是「明明生成了、都传上去了，却显示失败」。
func (r *executionRepo) UpdateStatusIfActive(ctx context.Context, id int64, status string, errMsg string) (bool, error) {
	res := r.db.WithContext(ctx).Model(&model.WorkflowExecution{}).
		Where("id = ? AND status IN ?", id, []string{"pending", "running"}).
		Updates(statusUpdates(status, errMsg))
	return res.RowsAffected > 0, res.Error
}

// statusUpdates 组装状态字段更新集合（status / error_msg / finished_at）
func statusUpdates(status string, errMsg string) map[string]interface{} {
	updates := map[string]interface{}{"status": status}
	if errMsg != "" {
		updates["error_msg"] = errMsg
	} else if status == "running" || status == "pending" {
		// 复位重跑时清掉上一轮的失败原因：否则前端会把旧错误挂到正在重跑的执行上
		updates["error_msg"] = ""
	}
	// 终态补 finished_at。此前从不写，线上执行记录 finished_at 几乎全是 NULL ——
	// 既看不到耗时（排障时无法判断"跑了多久/TTL 有没有踩线"），也失去了卡死判据。
	if status == "done" || status == "failed" {
		updates["finished_at"] = time.Now()
	}
	return updates
}

// ListStaleActive 查询「超过给定时刻仍未结束」的执行（看门狗用）。
// 以 started_at 为基准：它是入队/开始时刻，重试不会刷新 —— 也就是说看门狗判的是
// 「这次执行整体挂了多久」，与执行自身的预算（每 attempt 30 分钟 + 退避）匹配。
func (r *executionRepo) ListStaleActive(ctx context.Context, startedBefore time.Time) ([]*model.WorkflowExecution, error) {
	var execs []*model.WorkflowExecution
	err := r.db.WithContext(ctx).
		Where("status IN ?", []string{"pending", "running"}).
		Where("COALESCE(started_at, created_at) < ?", startedBefore).
		Order("id ASC").
		Limit(50).
		Find(&execs).Error
	return execs, err
}

func (r *executionRepo) DeleteByProjectID(ctx context.Context, projectID string) error {
	return r.db.WithContext(ctx).Where("project_id = ?", projectID).Delete(&model.WorkflowExecution{}).Error
}

func (r *executionRepo) ListByProjectID(ctx context.Context, projectID string) ([]*model.WorkflowExecution, error) {
	var executions []*model.WorkflowExecution
	if err := r.db.WithContext(ctx).Where("project_id = ?", projectID).Find(&executions).Error; err != nil {
		return nil, err
	}
	return executions, nil
}

// ListActiveByProject 查询项目下 pending/running 的执行
func (r *executionRepo) ListActiveByProject(ctx context.Context, projectID string) ([]*model.WorkflowExecution, error) {
	var executions []*model.WorkflowExecution
	if err := r.db.WithContext(ctx).
		Where("project_id = ? AND status IN ?", projectID, []string{"pending", "running"}).
		Order("id DESC").Find(&executions).Error; err != nil {
		return nil, err
	}
	return executions, nil
}

// AITaskRepo AI 任务数据访问
type AITaskRepo interface {
	Create(ctx context.Context, task *model.AITask) error
	FindByID(ctx context.Context, id int64) (*model.AITask, error)
	UpdateOutput(ctx context.Context, id int64, status string, output []byte, errMsg string) error
	ListByExecutionID(ctx context.Context, executionID int64) ([]*model.AITask, error)
	DeleteByExecutionIDs(ctx context.Context, executionIDs []int64) error
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

func (r *aiTaskRepo) DeleteByExecutionIDs(ctx context.Context, executionIDs []int64) error {
	if len(executionIDs) == 0 {
		return nil
	}
	return r.db.WithContext(ctx).Where("execution_id IN ?", executionIDs).Delete(&model.AITask{}).Error
}
