package service

import (
	"context"

	"libtv/internal/llm"
	"libtv/internal/repository"
)

// ChannelService 保留旧接口的响应结构，所有新调用固定使用电信。
type ChannelService struct {
	settings repository.SettingRepo
	users    repository.UserRepo
	router   *llm.ChannelRouter
}

// NewChannelService 创建渠道服务
func NewChannelService(settings repository.SettingRepo, users repository.UserRepo, router *llm.ChannelRouter) *ChannelService {
	return &ChannelService{settings: settings, users: users, router: router}
}

// GetPolicy 返回唯一允许的电信策略。
func (s *ChannelService) GetPolicy(ctx context.Context) (string, error) {
	return llm.PolicyAllDianxin, nil
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

// ResolveUserChannel 历史用户渠道不参与新请求路由。
func (s *ChannelService) ResolveUserChannel(ctx context.Context, userID string) string {
	return llm.ChannelDianxin
}

// GetUserChannel 返回当前实际使用的渠道。
func (s *ChannelService) GetUserChannel(ctx context.Context, userID string) (string, error) {
	return llm.ChannelDianxin, nil
}
