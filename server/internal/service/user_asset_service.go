package service

import (
	"context"
	"log"
	"net/http"
	"path"
	"strings"

	"libtv/internal/model"
	"libtv/internal/pkg/apperror"
	"libtv/internal/repository"
	"libtv/internal/storage"
)

var (
	// ErrUserAssetNotFound 资产不存在或不属于当前用户
	ErrUserAssetNotFound = apperror.New(6001, http.StatusNotFound, "资产不存在")
	// ErrUserAssetInvalidType 资产类型非法
	ErrUserAssetInvalidType = apperror.New(6002, http.StatusBadRequest, "资产类型必须为 image 或 video")
	// ErrUserAssetDuplicate 同一文件重复保存到资产库
	ErrUserAssetDuplicate = apperror.New(6003, http.StatusConflict, "当前资产已保存")
)

// UserAssetService 用户个人资产库（图片/视频收藏）
// 保存资产时把文件复制到 users/<userID>/assets/ 目录，URL 指向新地址；
// 删除资产时同步清理该文件（删用户时整个 users/<id>/ 前缀也会被级联清理）
type UserAssetService struct {
	assetRepo repository.UserAssetRepo
	storage   storage.Storage
}

func NewUserAssetService(assetRepo repository.UserAssetRepo, s storage.Storage) *UserAssetService {
	return &UserAssetService{assetRepo: assetRepo, storage: s}
}

// Create 保存资产（类型校验 + 重复检查 + 复制文件到用户资产目录）
func (s *UserAssetService) Create(ctx context.Context, asset *model.UserAsset) error {
	if asset.Type != "image" && asset.Type != "video" {
		return ErrUserAssetInvalidType
	}
	if dup, err := s.isDuplicate(ctx, asset); err == nil && dup {
		return ErrUserAssetDuplicate
	}
	s.copyToUserAssetsDir(asset)
	return s.assetRepo.Create(ctx, asset)
}

// isDuplicate 判断同一用户是否已保存过同一文件：
// 源 URL 完全相同，或复制目标路径（users/<userID>/assets/<源文件名>）已被引用
// （同一文件无论来自哪个目录，目标文件名都相同）
func (s *UserAssetService) isDuplicate(ctx context.Context, asset *model.UserAsset) (bool, error) {
	existing, err := s.assetRepo.ListByUser(ctx, asset.UserID, asset.Type)
	if err != nil {
		return false, err
	}
	var targetURL string
	if s.storage != nil {
		if srcName, ok := s.storage.ParseObjectName(asset.URL); ok {
			targetURL = s.storage.GetURL("users/" + asset.UserID + "/assets/" + path.Base(srcName))
		}
	}
	for _, a := range existing {
		if a.URL == asset.URL || (targetURL != "" && a.URL == targetURL) {
			return true, nil
		}
	}
	return false, nil
}

// copyToUserAssetsDir 将源文件复制到 users/<userID>/assets/<原文件名>，并把 asset.URL 改写为新地址。
// 源 URL 不属于本存储管辖（外部链接）或复制失败时降级保存原 URL 引用，不阻断保存流程
func (s *UserAssetService) copyToUserAssetsDir(asset *model.UserAsset) {
	if s.storage == nil {
		return
	}
	srcName, ok := s.storage.ParseObjectName(asset.URL)
	if !ok {
		return // 外部 URL，无法复制，保留原引用
	}
	assetsPrefix := "users/" + asset.UserID + "/assets/"
	if strings.HasPrefix(srcName, assetsPrefix) {
		return // 已在用户资产目录内，无需重复复制
	}

	newName := assetsPrefix + path.Base(srcName)
	info, err := s.storage.StatObject(srcName)
	if err != nil {
		log.Printf("[UserAsset] 读取源文件信息失败，降级保存原URL: src=%s err=%v", srcName, err)
		return
	}
	rc, err := s.storage.GetObject(srcName)
	if err != nil {
		log.Printf("[UserAsset] 读取源文件失败，降级保存原URL: src=%s err=%v", srcName, err)
		return
	}
	defer rc.Close()
	if err := s.storage.PutObject(newName, rc, info.Size, info.ContentType); err != nil {
		log.Printf("[UserAsset] 复制文件到用户资产目录失败，降级保存原URL: dst=%s err=%v", newName, err)
		return
	}
	asset.URL = s.storage.GetURL(newName)
}

// List 列出当前用户的资产；assetType 为空表示全部
func (s *UserAssetService) List(ctx context.Context, userID, assetType string) ([]*model.UserAsset, error) {
	if assetType != "" && assetType != "image" && assetType != "video" {
		return nil, ErrUserAssetInvalidType
	}
	return s.assetRepo.ListByUser(ctx, userID, assetType)
}

// Delete 删除资产（校验归属，防止越权删除他人资产），并清理用户资产目录下的文件
func (s *UserAssetService) Delete(ctx context.Context, userID, id string) error {
	asset, err := s.assetRepo.FindByID(ctx, id)
	if err != nil || asset.UserID != userID {
		return ErrUserAssetNotFound
	}
	if err := s.assetRepo.Delete(ctx, id); err != nil {
		return err
	}
	// 仅清理复制到用户资产目录的文件；降级保存的外部/原引用不动
	// 若同一用户还有其他记录引用同一文件（历史重复数据），保留物理文件避免连带失效
	if s.storage != nil {
		if name, ok := s.storage.ParseObjectName(asset.URL); ok &&
			strings.HasPrefix(name, "users/"+userID+"/assets/") {
			if count, err := s.assetRepo.CountByURLAndUser(ctx, userID, asset.URL); err == nil && count > 0 {
				log.Printf("[UserAsset] 文件仍被 %d 条记录引用，跳过物理删除: file=%s", count, name)
				return nil
			}
			if err := s.storage.DeleteObject(name); err != nil {
				log.Printf("[UserAsset] 删除资产文件失败: assetID=%s file=%s err=%v", id, name, err)
			}
		}
	}
	return nil
}
