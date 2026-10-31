package repository

import (
	"context"
	"time"

	"libtv/internal/model"

	"gorm.io/gorm"
)

// ProjectRepo 项目数据访问
type ProjectRepo interface {
	Create(ctx context.Context, project *model.Project) error
	FindByID(ctx context.Context, id string) (*model.Project, error)
	ListByUserID(ctx context.Context, userID string, offset, limit int) ([]*model.Project, int64, error)
	Update(ctx context.Context, project *model.Project) error
	// UpdateCover 只更新封面列（不整行覆盖），见实现注释
	UpdateCover(ctx context.Context, projectID, coverURL string) error
	// BackfillCover 回填专用：只补封面，不动 updated_at，见实现注释
	BackfillCover(ctx context.Context, projectID, coverURL string) error
	// Touch 节流地把 updated_at 推到当前时间，供「最近项目」排序使用
	Touch(ctx context.Context, projectID string) error
	// ListMissingCover 按 id 升序游标分页取「还没有封面」的项目，供存量回填使用
	ListMissingCover(ctx context.Context, afterID string, limit int) ([]*model.Project, error)
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

// UpdateCover 只更新封面列，顺带把 updated_at 推到当前时间。
//
// 为什么不用 Update（db.Save 整行）：视频生成是并发收口的，同一项目可能有多个节点
// 先后完成；整行写是「读-改-写」，会把并发的改名/描述覆盖回旧值。
//
// 顺带更新 updated_at 是刻意的：项目列表按它排「最近项目」（见 ListByUserID），
// 而它此前只在改名/发布时变化，排序实际退化成创建时间。
func (r *projectRepo) UpdateCover(ctx context.Context, projectID, coverURL string) error {
	res := r.db.WithContext(ctx).Model(&model.Project{}).
		Where("id = ?", projectID).
		Updates(map[string]interface{}{
			"cover_url":  coverURL,
			"updated_at": time.Now(),
		})
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

// BackfillCover 存量回填专用：只补封面列，**不动 updated_at**。
//
// 为什么不复用 UpdateCover：那个会顺带把 updated_at 推到当前时间 —— 那是给
// 「刚刚生成完视频」用的，项目确实刚刚活跃过。而回填一次要动几百个历史项目，
// 如果也推 updated_at，一次回填就能把所有老项目顶到「最近项目」最前面，
// 反而把用户真正在做的项目挤下去，与这次要解决的问题正好相反。
//
// 用 UpdateColumn 而不是 Update：GORM 的 Update/Updates 会自动写 updated_at
// （跳过 updated_at 的唯一办法就是 UpdateColumn/UpdateColumns）。
func (r *projectRepo) BackfillCover(ctx context.Context, projectID, coverURL string) error {
	res := r.db.WithContext(ctx).Model(&model.Project{}).
		Where("id = ?", projectID).
		UpdateColumn("cover_url", coverURL)
	if res.Error != nil {
		return res.Error
	}
	if res.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

// projectTouchThrottle Touch 的写入节流窗口。
//
// 画布保存和引擎逐节点落库都会触发 Touch，不节流的话每存一次画布就多一条
// 必然 0 行命中的 UPDATE。「最近」的精度到分钟级就够，5 分钟与用户
// LastActiveAt 的节流口径（见 model.User 注释）保持一致。
const projectTouchThrottle = 5 * time.Minute

// Touch 把项目的 updated_at 推到当前时间（窗口内已更新过则不动）。
//
// 为什么需要它：项目列表按 updated_at DESC 排「最近项目」，但真正表示
// 「用户还在动这个项目」的两个入口 —— 画布保存、生成落库 —— 此前都不碰
// projects 表，于是用户最近在做的项目会沉到列表下面。条件不满足时是
// 0 行受影响（不是错误），所以调用方把它当"尽力而为"即可。
func (r *projectRepo) Touch(ctx context.Context, projectID string) error {
	if projectID == "" {
		return nil
	}
	return r.db.WithContext(ctx).Model(&model.Project{}).
		Where("id = ? AND updated_at < ?", projectID, time.Now().Add(-projectTouchThrottle)).
		Update("updated_at", time.Now()).Error
}

func (r *projectRepo) Delete(ctx context.Context, id string) error {
	return r.db.WithContext(ctx).Where("id = ?", id).Delete(&model.Project{}).Error
}

// ListMissingCover 取「还没有封面」的项目，按 id 升序、游标分页。
//
// 两个细节：
//   - 条件是「IS NULL 或等于空串」：这一列在早期版本可能整行为 NULL（varchar 可空），
//     只判空串会漏掉那批项目；
//   - 用 id 游标而不是 offset：回填是幂等的，但**能补上的项目补完就从结果集里消失了**，
//     用 offset 翻页会跳行/重复。id 游标（WHERE id > afterID）不受集合变化影响。
func (r *projectRepo) ListMissingCover(ctx context.Context, afterID string, limit int) ([]*model.Project, error) {
	if limit <= 0 {
		return nil, nil
	}
	q := r.db.WithContext(ctx).
		Where("cover_url IS NULL OR cover_url = ''").
		Order("id ASC").
		Limit(limit)
	if afterID != "" {
		q = q.Where("id > ?", afterID)
	}
	var projects []*model.Project
	if err := q.Find(&projects).Error; err != nil {
		return nil, err
	}
	return projects, nil
}
