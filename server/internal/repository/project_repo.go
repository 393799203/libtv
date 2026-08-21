package repository

import (
	"context"

	"libtv/internal/model"

	"gorm.io/gorm"
)

// ProjectRepo 项目数据访问
type ProjectRepo interface {
	Create(ctx context.Context, project *model.Project) error
	FindByID(ctx context.Context, id string) (*model.Project, error)
	ListByUserID(ctx context.Context, userID string, offset, limit int) ([]*model.Project, int64, error)
	Update(ctx context.Context, project *model.Project) error
	Delete(ctx context.Context, id string) error
}

type projectRepo struct {
	db *gorm.DB
}

func NewProjectRepo(db *gorm.DB) ProjectRepo {
	return &projectRepo{db: db}
}

func (r *projectRepo) Create(ctx context.Context, project *model.Project) error {
	return r.db.WithContext(ctx).Create(project).Error
}

func (r *projectRepo) FindByID(ctx context.Context, id string) (*model.Project, error) {
	var project model.Project
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&project).Error; err != nil {
		return nil, err
	}
	return &project, nil
}

func (r *projectRepo) ListByUserID(ctx context.Context, userID string, offset, limit int) ([]*model.Project, int64, error) {
	var projects []*model.Project
	var total int64
	db := r.db.WithContext(ctx).Where("user_id = ?", userID)
	if err := db.Model(&model.Project{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err := db.Order("updated_at DESC").Offset(offset).Limit(limit).Find(&projects).Error; err != nil {
		return nil, 0, err
	}
	fillShowStatus(ctx, r.db, projects)
	return projects, total, nil
}

// fillShowStatus 批量补充项目关联视频的发布状态（两条查询，避免逐项目 N+1；published 优先）
func fillShowStatus(ctx context.Context, db *gorm.DB, projects []*model.Project) {
	if len(projects) == 0 {
		return
	}
	ids := make([]string, 0, len(projects))
	for _, p := range projects {
		ids = append(ids, p.ID)
	}
	var rows []struct {
		ProjectID string
		Status    string
	}
	if err := db.WithContext(ctx).Model(&model.Show{}).
		Select("project_id, status").
		Where("project_id IN ?", ids).
		Scan(&rows).Error; err != nil {
		return // 查询失败不阻断项目列表，仅不显示发布角标
	}
	statusByProject := make(map[string]string, len(rows))
	for _, row := range rows {
		if row.ProjectID == "" {
			continue
		}
		// 一个项目可能有多条 show 记录：published 优先，否则保留先到的状态
		if cur, ok := statusByProject[row.ProjectID]; !ok || (cur != "published" && row.Status == "published") {
			statusByProject[row.ProjectID] = row.Status
		}
	}
	for _, p := range projects {
		p.ShowStatus = statusByProject[p.ID]
	}
}

func (r *projectRepo) Update(ctx context.Context, project *model.Project) error {
	return r.db.WithContext(ctx).Save(project).Error
}

func (r *projectRepo) Delete(ctx context.Context, id string) error {
	return r.db.WithContext(ctx).Where("id = ?", id).Delete(&model.Project{}).Error
}
