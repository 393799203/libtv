package service

import (
	"context"
	"errors"

	"libtv/internal/model"
	"libtv/internal/repository"

	"gorm.io/gorm"
)

// StyleFavoriteService 风格收藏业务逻辑
type StyleFavoriteService struct {
	favoriteRepo repository.StyleFavoriteRepo
	styleRepo    repository.StyleRepo
}

// NewStyleFavoriteService 创建收藏服务
func NewStyleFavoriteService(favoriteRepo repository.StyleFavoriteRepo, styleRepo repository.StyleRepo) *StyleFavoriteService {
	return &StyleFavoriteService{favoriteRepo: favoriteRepo, styleRepo: styleRepo}
}

// Toggle 切换收藏状态，返回新的收藏状态
func (s *StyleFavoriteService) Toggle(ctx context.Context, userID, styleID string) (bool, error) {
	existing, err := s.favoriteRepo.Find(ctx, userID, styleID)
	if err == nil {
		// 已收藏 → 取消收藏
		if err := s.favoriteRepo.Delete(ctx, existing); err != nil {
			return false, err
		}
		_ = s.styleRepo.IncrementLikes(ctx, styleID, -1)
		return false, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return false, err
	}
	// 未收藏 → 添加收藏
	fav := model.StyleFavorite{UserID: userID, StyleID: styleID}
	if err := s.favoriteRepo.Create(ctx, &fav); err != nil {
		return false, err
	}
	_ = s.styleRepo.IncrementLikes(ctx, styleID, 1)
	return true, nil
}

// ListByUser 获取用户的收藏风格列表（按收藏时间倒序）
func (s *StyleFavoriteService) ListByUser(ctx context.Context, userID string) ([]model.Style, error) {
	favIDs, err := s.favoriteRepo.ListFavoriteStyleIDs(ctx, userID)
	if err != nil {
		return nil, err
	}
	if len(favIDs) == 0 {
		return []model.Style{}, nil
	}
	styles, err := s.favoriteRepo.ListStylesByIDs(ctx, favIDs)
	if err != nil {
		return nil, err
	}
	// 按 favIDs 顺序排列
	styleMap := make(map[string]model.Style, len(styles))
	for _, s := range styles {
		styleMap[s.ID] = s
	}
	ordered := make([]model.Style, 0, len(favIDs))
	for _, id := range favIDs {
		if s, ok := styleMap[id]; ok {
			ordered = append(ordered, s)
		}
	}
	return ordered, nil
}

// CheckFavorited 批量检查用户对风格列表的收藏状态
func (s *StyleFavoriteService) CheckFavorited(ctx context.Context, userID string, styleIDs []string) (map[string]bool, error) {
	if userID == "" || len(styleIDs) == 0 {
		return map[string]bool{}, nil
	}
	favs, err := s.favoriteRepo.ListFavoritedStyleIDs(ctx, userID, styleIDs)
	if err != nil {
		return nil, err
	}
	result := make(map[string]bool, len(favs))
	for _, f := range favs {
		result[f.StyleID] = true
	}
	return result, nil
}
