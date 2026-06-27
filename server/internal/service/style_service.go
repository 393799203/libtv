package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"libtv/internal/model"
	"libtv/internal/repository"
	"libtv/internal/storage"
)

// ============ Style 服务 ============

// StyleService 风格业务逻辑
type StyleService struct {
	styleRepo   repository.StyleRepo
	storage     storage.Storage
}

// NewStyleService 创建风格服务
func NewStyleService(styleRepo repository.StyleRepo, storage storage.Storage) *StyleService {
	return &StyleService{styleRepo: styleRepo, storage: storage}
}

// ListResult 列表查询结果
type ListResult struct {
	Items     []model.Style
	Total     int64
	Page      int
	PageSize  int
}

// List 风格列表
func (s *StyleService) List(ctx context.Context, q repository.StyleQuery) (*ListResult, error) {
	if q.Page <= 0 {
		q.Page = 1
	}
	if q.PageSize <= 0 || q.PageSize > 100 {
		q.PageSize = 50
	}
	styles, total, err := s.styleRepo.List(ctx, q)
	if err != nil {
		return nil, err
	}
	return &ListResult{Items: styles, Total: total, Page: q.Page, PageSize: q.PageSize}, nil
}

// Create 创建风格
func (s *StyleService) Create(ctx context.Context, name, author, categoryID string, tags []string) (*model.Style, error) {
	tagsJSON, _ := json.Marshal(tags)
	style := model.Style{
		Name:       name,
		Author:     author,
		ImageURL:   "", // 先创建，再上传图片后更新
		CategoryID: categoryID,
		Tags:       tagsJSON,
	}
	if err := s.styleRepo.Create(ctx, &style); err != nil {
		return nil, err
	}
	return &style, nil
}

// GetByID 获取风格详情
func (s *StyleService) GetByID(ctx context.Context, id string) (*model.Style, error) {
	return s.styleRepo.FindByID(ctx, id)
}

// UpdateImage 更新风格图片地址
func (s *StyleService) UpdateImage(ctx context.Context, id, imageURL string) error {
	return s.styleRepo.UpdateImage(ctx, id, imageURL)
}

// UpdateStyle 更新风格字段（nil 表示不更新）
func (s *StyleService) UpdateStyle(ctx context.Context, id string,
	name, author, categoryID *string, tags []string, tagsChanged bool,
) (*model.Style, error) {
	style, err := s.styleRepo.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	updates := map[string]interface{}{}
	if name != nil {
		updates["name"] = *name
	}
	if author != nil {
		updates["author"] = *author
	}
	if categoryID != nil {
		updates["category_id"] = *categoryID
	}
	if tagsChanged {
		tagsJSON, _ := json.Marshal(tags)
		updates["tags"] = tagsJSON
	}
	if len(updates) == 0 {
		return style, nil
	}
	if err := s.styleRepo.Update(ctx, style, updates); err != nil {
		return nil, err
	}
	return style, nil
}

// Delete 删除风格：先删除图片文件，再删除 DB 记录，最后级联删除收藏
// （DB 层的级联删除由调用方在 StyleService 这里组装，保持 Repo 单职责）
func (s *StyleService) Delete(ctx context.Context, id string) error {
	style, err := s.styleRepo.FindByID(ctx, id)
	if err != nil {
		return fmt.Errorf("风格不存在: %w", err)
	}
	// 删除图片文件
	if style.ImageURL != "" && strings.HasPrefix(style.ImageURL, "/media/styles/") {
		objectName := "styles/" + strings.TrimPrefix(style.ImageURL, "/media/styles/")
		_ = s.storage.DeleteObject(objectName)
	}
	if err := s.styleRepo.Delete(ctx, id); err != nil {
		return err
	}
	return nil
}
