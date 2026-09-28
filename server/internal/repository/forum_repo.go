package repository

import (
	"strings"
	"context"

	"libtv/internal/model"

	"gorm.io/gorm"
)

// ForumRepo 论坛数据访问（帖子 + 回复）
type ForumRepo interface {
	CreatePost(ctx context.Context, post *model.ForumPost) error
	FindPostByID(ctx context.Context, id string) (*model.ForumPost, error)
	// ListPosts 分页列出帖子：置顶优先，其余按发帖时间倒序；keyword 为空表示不按标题过滤
	ListPosts(ctx context.Context, keyword string, offset, limit int) ([]model.ForumPost, int64, error)
	DeletePost(ctx context.Context, id string) error
	// IncrPostView 浏览量 +1
	IncrPostView(ctx context.Context, id string) error
	// AddReplyCount 回复数增减（delta 可为负，用于删回复时回退）
	AddReplyCount(ctx context.Context, id string, delta int64) error
	// SetPinned 置顶/取消置顶
	SetPinned(ctx context.Context, id string, pinned bool) error

	CreateReply(ctx context.Context, reply *model.ForumReply) error
	FindReplyByID(ctx context.Context, id string) (*model.ForumReply, error)
	// ListReplies 分页列出某帖子的回复（按时间正序），返回总数
	ListReplies(ctx context.Context, postID string, offset, limit int) ([]model.ForumReply, int64, error)
	DeleteReply(ctx context.Context, id string) error
	// DeleteRepliesByPostID 删除帖子下的全部回复（删帖时连带清理）
	DeleteRepliesByPostID(ctx context.Context, postID string) error
}

type forumRepo struct {
	db *gorm.DB
}

func NewForumRepo(db *gorm.DB) ForumRepo {
	return &forumRepo{db: db}
}

func (r *forumRepo) CreatePost(ctx context.Context, post *model.ForumPost) error {
	return r.db.WithContext(ctx).Create(post).Error
}

func (r *forumRepo) FindPostByID(ctx context.Context, id string) (*model.ForumPost, error) {
	var post model.ForumPost
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&post).Error; err != nil {
		return nil, err
	}
	return &post, nil
}

func (r *forumRepo) ListPosts(ctx context.Context, keyword string, offset, limit int) ([]model.ForumPost, int64, error) {
	q := r.db.WithContext(ctx).Model(&model.ForumPost{})
	if keyword != "" {
		// ILIKE：标题搜索不区分大小写（Postgres 的 LIKE 是大小写敏感的）
		// ESCAPE：把用户输入里的 % _ \ 转成字面量，否则搜 "%" 会匹配到所有帖子
		q = q.Where(`title ILIKE ? ESCAPE '\'`, "%"+escapeLike(keyword)+"%")
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var posts []model.ForumPost
	// 置顶的永远在最前，其后按发帖时间倒序
	if err := q.Order("is_pinned DESC, created_at DESC").Offset(offset).Limit(limit).Find(&posts).Error; err != nil {
		return nil, 0, err
	}
	return posts, total, nil
}

func (r *forumRepo) DeletePost(ctx context.Context, id string) error {
	return r.db.WithContext(ctx).Where("id = ?", id).Delete(&model.ForumPost{}).Error
}

func (r *forumRepo) IncrPostView(ctx context.Context, id string) error {
	return r.db.WithContext(ctx).Model(&model.ForumPost{}).Where("id = ?", id).
		UpdateColumn("view_count", gorm.Expr("view_count + 1")).Error
}

func (r *forumRepo) AddReplyCount(ctx context.Context, id string, delta int64) error {
	return r.db.WithContext(ctx).Model(&model.ForumPost{}).Where("id = ?", id).
		UpdateColumn("reply_count", gorm.Expr("GREATEST(reply_count + ?, 0)", delta)).Error
}

func (r *forumRepo) SetPinned(ctx context.Context, id string, pinned bool) error {
	return r.db.WithContext(ctx).Model(&model.ForumPost{}).Where("id = ?", id).
		Update("is_pinned", pinned).Error
}

func (r *forumRepo) CreateReply(ctx context.Context, reply *model.ForumReply) error {
	return r.db.WithContext(ctx).Create(reply).Error
}

func (r *forumRepo) FindReplyByID(ctx context.Context, id string) (*model.ForumReply, error) {
	var reply model.ForumReply
	if err := r.db.WithContext(ctx).Where("id = ?", id).First(&reply).Error; err != nil {
		return nil, err
	}
	return &reply, nil
}

func (r *forumRepo) ListReplies(ctx context.Context, postID string, offset, limit int) ([]model.ForumReply, int64, error) {
	q := r.db.WithContext(ctx).Model(&model.ForumReply{}).Where("post_id = ?", postID)

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var replies []model.ForumReply
	if err := q.Order("created_at ASC").Offset(offset).Limit(limit).Find(&replies).Error; err != nil {
		return nil, 0, err
	}
	return replies, total, nil
}

func (r *forumRepo) DeleteReply(ctx context.Context, id string) error {
	return r.db.WithContext(ctx).Where("id = ?", id).Delete(&model.ForumReply{}).Error
}

func (r *forumRepo) DeleteRepliesByPostID(ctx context.Context, postID string) error {
	return r.db.WithContext(ctx).Where("post_id = ?", postID).Delete(&model.ForumReply{}).Error
}

// escapeLike 转义 LIKE/ILIKE 的通配符，使用户输入按字面量匹配
func escapeLike(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}
