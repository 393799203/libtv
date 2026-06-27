package service

import (
	"context"
	"errors"
	"time"

	"libtv/internal/config"
	"libtv/internal/model"
	"libtv/internal/repository"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

// 用户管理相关业务错误
var (
	ErrUserNotFound        = errors.New("user not found")
	ErrCannotDeleteSelf    = errors.New("cannot delete self")
	ErrCannotModifySelf    = errors.New("cannot modify self role")
	ErrInvalidRole         = errors.New("invalid role")
)

type UserService struct {
	userRepo repository.UserRepo
}

func NewUserService(userRepo repository.UserRepo) *UserService {
	return &UserService{userRepo: userRepo}
}

func (s *UserService) Register(ctx context.Context, email, password, nickname string) (*model.User, error) {
	existing, err := s.userRepo.FindByEmail(ctx, email)
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	if existing != nil {
		return nil, errors.New("email already registered")
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, err
	}

	user := &model.User{
		Email:        email,
		PasswordHash: string(hash),
		Nickname:     nickname,
	}
	if err := s.userRepo.Create(ctx, user); err != nil {
		return nil, err
	}
	return user, nil
}

func (s *UserService) Login(ctx context.Context, email, password string) (string, *model.User, error) {
	user, err := s.userRepo.FindByEmail(ctx, email)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", nil, errors.New("invalid email or password")
		}
		return "", nil, err
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(password)); err != nil {
		return "", nil, errors.New("invalid email or password")
	}

	token, err := s.generateToken(user)
	if err != nil {
		return "", nil, err
	}
	return token, user, nil
}

func (s *UserService) GetByID(ctx context.Context, id string) (*model.User, error) {
	return s.userRepo.FindByID(ctx, id)
}

// List 用户列表（管理员）
func (s *UserService) List(ctx context.Context, keyword string) ([]model.User, error) {
	return s.userRepo.List(ctx, keyword)
}

// Delete 删除用户（含级联删除关联数据）
// operatorID 为当前操作者用户 ID，用于禁止删除自己
func (s *UserService) Delete(ctx context.Context, id, operatorID string) error {
	if id == operatorID {
		return ErrCannotDeleteSelf
	}
	if _, err := s.userRepo.FindByID(ctx, id); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrUserNotFound
		}
		return err
	}
	return s.userRepo.CascadeDelete(ctx, id)
}

// UpdateRole 更新用户角色（仅 admin/user）
// operatorID 为当前操作者用户 ID，用于禁止修改自己的角色
func (s *UserService) UpdateRole(ctx context.Context, id, role, operatorID string) (*model.User, error) {
	if role != "user" && role != "admin" {
		return nil, ErrInvalidRole
	}
	if id == operatorID {
		return nil, ErrCannotModifySelf
	}
	user, err := s.userRepo.FindByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrUserNotFound
		}
		return nil, err
	}
	if err := s.userRepo.UpdateRole(ctx, id, role); err != nil {
		return nil, err
	}
	user.Role = role
	return user, nil
}

func (s *UserService) generateToken(user *model.User) (string, error) {
	claims := jwt.MapClaims{
		"user_id": user.ID,
		"email":   user.Email,
		"exp":     time.Now().Add(time.Duration(config.C.JWT.ExpireHours) * time.Hour).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(config.C.JWT.Secret))
}

