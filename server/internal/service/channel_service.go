package service

import (
	"context"
	"log"

	"libtv/internal/llm"
	"libtv/internal/repository"
)

// ChannelService AI 渠道策略服务：全局三档策略 + 渠道解析
// 后台可动态切换（全A / 全B / 按各自渠道），无需重启
type ChannelService struct {
	settings repository.SettingRepo
	users    repository.UserRepo
	router   *llm.ChannelRouter
}

// NewChannelService 创建渠道服务
func NewChannelService(settings repository.SettingRepo, users repository.UserRepo, router *llm.ChannelRouter) *ChannelService {
	return &ChannelService{settings: settings, users: users, router: router}
}

// GetPolicy 读取全局渠道策略（默认 per_user）
func (s *ChannelService) GetPolicy(ctx context.Context) (string, error) {
	v, err := s.settings.Get(ctx, llm.SettingKeyChannelPolicy)
	if err != nil {
		return "", err
	}
	if v == "" {
		return llm.PolicyPerUser, nil
	}
	return v, nil
}

// SetPolicy 设置全局渠道策略（校验合法性）
func (s *ChannelService) SetPolicy(ctx context.Context, policy string) error {
	if err := llm.ValidatePolicy(policy); err != nil {
		return err
	}
	return s.settings.Set(ctx, llm.SettingKeyChannelPolicy, policy)
}

// policyReader 供 ChannelRouter 使用的无缓存读取（router 内部有缓存）
func (s *ChannelService) policyReader(ctx context.Context) (string, error) {
	return s.GetPolicy(ctx)
}

// ResolveUserChannel 解析用户的最终渠道（全局策略 + 用户渠道）
// 返回 wasu / dianxin
func (s *ChannelService) ResolveUserChannel(ctx context.Context, userID string) string {
	userChannel, err := s.GetUserChannel(ctx, userID)
	if err != nil {
		log.Printf("[ChannelService] 查询用户渠道失败，回退 wasu: userID=%s err=%v", userID, err)
		userChannel = llm.ChannelWasu
	}
	if s.router == nil {
		return userChannel
	}
	return s.router.Resolve(ctx, userChannel)
}

// GetUserChannel 查询用户自身渠道（未设置回退 wasu）
func (s *ChannelService) GetUserChannel(ctx context.Context, userID string) (string, error) {
	if userID == "" {
		return llm.ChannelWasu, nil
	}
	user, err := s.users.FindByID(ctx, userID)
	if err != nil {
		return llm.ChannelWasu, nil // 用户不存在按默认渠道
	}
	if user.Channel == "" {
		return llm.ChannelWasu, nil
	}
	return user.Channel, nil
}
