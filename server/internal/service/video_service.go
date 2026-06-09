package service

import (
	"context"

	"libtv/internal/model"
	"libtv/internal/repository"
)

type VideoService struct {
	videoRepo repository.VideoRepo
}

func NewVideoService(videoRepo repository.VideoRepo) *VideoService {
	return &VideoService{videoRepo: videoRepo}
}

func (s *VideoService) Create(ctx context.Context, userID int64, title, description, videoURL string, duration int) (*model.Video, error) {
	video := &model.Video{
		UserID:      userID,
		Title:       title,
		Description: description,
		VideoURL:    videoURL,
		Duration:    duration,
	}
	if err := s.videoRepo.Create(ctx, video); err != nil {
		return nil, err
	}
	return video, nil
}

func (s *VideoService) GetByID(ctx context.Context, id string) (*model.Video, error) {
	return s.videoRepo.FindByID(ctx, id)
}

func (s *VideoService) List(ctx context.Context, page, pageSize int, tag string, keyword string) ([]*model.Video, int64, error) {
	offset := (page - 1) * pageSize
	return s.videoRepo.List(ctx, offset, pageSize, tag, keyword)
}

func (s *VideoService) Update(ctx context.Context, id string, title, description string) (*model.Video, error) {
	video, err := s.videoRepo.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	if title != "" {
		video.Title = title
	}
	if description != "" {
		video.Description = description
	}
	if err := s.videoRepo.Update(ctx, video); err != nil {
		return nil, err
	}
	return video, nil
}

func (s *VideoService) Delete(ctx context.Context, id string) error {
	return s.videoRepo.Delete(ctx, id)
}
