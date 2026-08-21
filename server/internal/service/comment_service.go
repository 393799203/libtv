package service

import (
	"context"
	"errors"
	"strings"

	"libtv/internal/model"
	"libtv/internal/pkg/apperror"
	"libtv/internal/repository"

	"gorm.io/gorm"
)

// 评论相关错误
var (
	ErrCommentEmpty     = apperror.New(400, 400, "评论内容不能为空")
	ErrCommentTooLong   = apperror.New(400, 400, "评论不能超过500字")
	ErrCommentNotFound  = apperror.New(404, 404, "评论不存在")
	ErrCommentForbidden = apperror.New(403, 403, "只能删除自己的评论")
)

// CommentItem 评论列表条目（带评论人信息；顶级评论带回复数）
type CommentItem struct {
	model.ShowComment
	Nickname   string `json:"nickname"`
	AvatarURL  string `json:"avatar_url"`
	ReplyCount int64  `json:"reply_count"`
}

// CommentService 视频评论服务
type CommentService struct {
	commentRepo repository.CommentRepo
	showRepo    repository.ShowRepo
	userRepo    repository.UserRepo
}

func NewCommentService(commentRepo repository.CommentRepo, showRepo repository.ShowRepo, userRepo repository.UserRepo) *CommentService {
	return &CommentService{commentRepo: commentRepo, showRepo: showRepo, userRepo: userRepo}
}

// enrichUsers 批量补评论人昵称/头像，避免逐条 N+1
func (s *CommentService) enrichUsers(ctx context.Context, comments []model.ShowComment) []CommentItem {
	uidSet := make(map[string]struct{}, len(comments))
	uids := make([]string, 0, len(comments))
	for _, c := range comments {
		if _, ok := uidSet[c.UserID]; !ok {
			uidSet[c.UserID] = struct{}{}
			uids = append(uids, c.UserID)
		}
	}
	userByUID := make(map[string]model.User, len(uids))
	for _, uid := range uids {
		if u, err := s.userRepo.FindByID(ctx, uid); err == nil {
			userByUID[uid] = *u
		}
	}
	items := make([]CommentItem, 0, len(comments))
	for _, c := range comments {
		item := CommentItem{ShowComment: c}
		if u, ok := userByUID[c.UserID]; ok {
			item.Nickname = u.Nickname
			item.AvatarURL = u.AvatarURL
		}
		items = append(items, item)
	}
	return items
}

// List 分页列出视频顶级评论（公开，按时间倒序），带评论人信息与回复数
func (s *CommentService) List(ctx context.Context, showID string, page, pageSize int) ([]CommentItem, int64, error) {
	comments, total, err := s.commentRepo.ListByShowID(ctx, showID, (page-1)*pageSize, pageSize)
	if err != nil {
		return nil, 0, err
	}
	items := s.enrichUsers(ctx, comments)
	// 批量补回复数
	ids := make([]string, 0, len(comments))
	for _, c := range comments {
		ids = append(ids, c.ID)
	}
	if counts, err := s.commentRepo.CountByParentIDs(ctx, ids); err == nil {
		for i := range items {
			items[i].ReplyCount = counts[items[i].ID]
		}
	}
	return items, total, nil
}

// ListReplies 分页列出某顶级评论的回复（公开，按时间正序）
func (s *CommentService) ListReplies(ctx context.Context, parentID string, page, pageSize int) ([]CommentItem, int64, error) {
	if _, err := s.commentRepo.FindByID(ctx, parentID); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, 0, ErrCommentNotFound
		}
		return nil, 0, err
	}
	comments, total, err := s.commentRepo.ListByParentID(ctx, parentID, (page-1)*pageSize, pageSize)
	if err != nil {
		return nil, 0, err
	}
	return s.enrichUsers(ctx, comments), total, nil
}

// Create 发表评论或回复（需登录）。
// parentID 非空表示回复：若被回复的是顶级评论，parent=该评论；若被回复的是回复，parent 归到其顶级评论下，
// 并记录被回复人昵称用于「回复 @xxx」展示（一层楼中楼，不再嵌套）
func (s *CommentService) Create(ctx context.Context, showID, userID, content, parentID string) (*CommentItem, error) {
	content = strings.TrimSpace(content)
	if content == "" {
		return nil, ErrCommentEmpty
	}
	if len([]rune(content)) > 500 {
		return nil, ErrCommentTooLong
	}
	// 确认视频存在
	if _, err := s.showRepo.FindByID(ctx, showID); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, apperror.New(404, 404, "视频不存在")
		}
		return nil, err
	}

	comment := &model.ShowComment{ShowID: showID, UserID: userID, Content: content}
	if parentID != "" {
		target, err := s.commentRepo.FindByID(ctx, parentID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, ErrCommentNotFound
			}
			return nil, err
		}
		if target.ShowID != showID {
			return nil, apperror.New(400, 400, "被回复的评论不属于该视频")
		}
		if target.ParentID == "" {
			// 回复顶级评论：直接挂到它下面
			comment.ParentID = target.ID
		} else {
			// 回复的回复：归到顶级评论下，并记录被回复人昵称
			comment.ParentID = target.ParentID
			if u, err := s.userRepo.FindByID(ctx, target.UserID); err == nil {
				comment.ReplyToNickname = u.Nickname
			}
		}
	}

	if err := s.commentRepo.Create(ctx, comment); err != nil {
		return nil, err
	}
	item := &CommentItem{ShowComment: *comment}
	if u, err := s.userRepo.FindByID(ctx, userID); err == nil {
		item.Nickname = u.Nickname
		item.AvatarURL = u.AvatarURL
	}
	return item, nil
}

// Delete 删除评论：本人可删，管理员可删任意评论
func (s *CommentService) Delete(ctx context.Context, commentID, operatorID string) error {
	comment, err := s.commentRepo.FindByID(ctx, commentID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrCommentNotFound
		}
		return err
	}
	if comment.UserID != operatorID {
		operator, err := s.userRepo.FindByID(ctx, operatorID)
		if err != nil || operator.Role != "admin" {
			return ErrCommentForbidden
		}
	}
	// 删除顶级评论时连带删除其所有回复
	if comment.ParentID == "" {
		if err := s.commentRepo.DeleteByParentID(ctx, comment.ID); err != nil {
			return err
		}
	}
	return s.commentRepo.Delete(ctx, commentID)
}
