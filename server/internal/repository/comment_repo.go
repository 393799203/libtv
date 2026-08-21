package repository

import (
	"context"

	"libtv/internal/model"

	"gorm.io/gorm"
)

// CommentRepo 视频评论数据访问
type CommentRepo interface {
	Create(ctx context.Context, comment *model.ShowComment) error
	// ListByShowID 分页列出视频的顶级评论（按时间倒序），返回总数
	ListByShowID(ctx context.Context, showID string, offset, limit int) ([]model.ShowComment, int64, error)
	// ListByParentID 分页列出某顶级评论的回复（按时间正序），返回总数
	ListByParentID(ctx context.Context, parentID string, offset, limit int) ([]model.ShowComment, int64, error)
	FindByID(ctx context.Context, id string) (*model.ShowComment, error)
	Delete(ctx context.Context, id string) error
	// CountByShowIDs 批量统计视频评论数（列表展示用）
	CountByShowIDs(ctx context.Context, showIDs []string) (map[string]int64, error)
	// CountByParentIDs 批量统计顶级评论的回复数
	CountByParentIDs(ctx context.Context, parentIDs []string) (map[string]int64, error)
	// DeleteByParentID 删除某顶级评论下的所有回复（删除顶级评论时连带清理）
	DeleteByParentID(ctx context.Context, parentID string) error
}

type commentRepo struct {
	db *gorm.DB
}

func NewCommentRepo(db *gorm.DB) CommentRepo {
	return &commentRepo{db: db}
}

func (r *commentRepo) Create(ctx context.Context, comment *model.ShowComment) error {
	return r.db.WithContext(ctx).Create(comment).Error
}

func (r *commentRepo) ListByShowID(ctx context.Context, showID string, offset, limit int) ([]model.ShowComment, int64, error) {
	var total int64
	// 只查顶级评论（parent_id 为空）
	q := r.db.WithContext(ctx).Model(&model.ShowComment{}).
		Where("show_id = ? AND (parent_id = '' OR parent_id IS NULL)", showID)
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var comments []model.ShowComment
	err := q.Order("created_at DESC").Offset(offset).Limit(limit).Find(&comments).Error
	return comments, total, err
}

func (r *commentRepo) ListByParentID(ctx context.Context, parentID string, offset, limit int) ([]model.ShowComment, int64, error) {
	var total int64
	q := r.db.WithContext(ctx).Model(&model.ShowComment{}).Where("parent_id = ?", parentID)
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var comments []model.ShowComment
	err := q.Order("created_at ASC").Offset(offset).Limit(limit).Find(&comments).Error
	return comments, total, err
}

func (r *commentRepo) FindByID(ctx context.Context, id string) (*model.ShowComment, error) {
	var comment model.ShowComment
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&comment).Error; err != nil {
		return nil, err
	}
	return &comment, nil
}

func (r *commentRepo) Delete(ctx context.Context, id string) error {
	return r.db.WithContext(ctx).Where("id = ?", id).Delete(&model.ShowComment{}).Error
}

func (r *commentRepo) DeleteByParentID(ctx context.Context, parentID string) error {
	return r.db.WithContext(ctx).Where("parent_id = ?", parentID).Delete(&model.ShowComment{}).Error
}

func (r *commentRepo) CountByShowIDs(ctx context.Context, showIDs []string) (map[string]int64, error) {
	counts := make(map[string]int64, len(showIDs))
	if len(showIDs) == 0 {
		return counts, nil
	}
	var rows []struct {
		ShowID string
		Count  int64
	}
	if err := r.db.WithContext(ctx).Model(&model.ShowComment{}).
		Select("show_id, COUNT(*) AS count").
		Where("show_id IN ?", showIDs).
		Group("show_id").
		Scan(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		counts[row.ShowID] = row.Count
	}
	return counts, nil
}

func (r *commentRepo) CountByParentIDs(ctx context.Context, parentIDs []string) (map[string]int64, error) {
	counts := make(map[string]int64, len(parentIDs))
	if len(parentIDs) == 0 {
		return counts, nil
	}
	var rows []struct {
		ParentID string
		Count    int64
	}
	if err := r.db.WithContext(ctx).Model(&model.ShowComment{}).
		Select("parent_id, COUNT(*) AS count").
		Where("parent_id IN ?", parentIDs).
		Group("parent_id").
		Scan(&rows).Error; err != nil {
		return nil, err
	}
	for _, row := range rows {
		counts[row.ParentID] = row.Count
	}
	return counts, nil
}
