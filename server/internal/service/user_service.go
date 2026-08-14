package service

import (
	"context"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"libtv/internal/config"
	"libtv/internal/model"
	"libtv/internal/pkg/apperror"
	"libtv/internal/repository"
	"libtv/internal/storage"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

// 用户管理相关业务错误（携带 HTTP 状态码）
var (
	ErrUserNotFound     = apperror.New(2001, http.StatusNotFound, "用户不存在")
	ErrCannotDeleteSelf = apperror.New(2002, http.StatusBadRequest, "不能删除自己的账号")
	ErrCannotModifySelf = apperror.New(2003, http.StatusBadRequest, "不能修改自己的角色")
	ErrInvalidRole      = apperror.New(2004, http.StatusBadRequest, "角色必须是 user 或 admin")
	ErrWrongPassword    = apperror.New(2005, http.StatusBadRequest, "原密码不正确")
)

type UserService struct {
	userRepo repository.UserRepo
	storage  storage.Storage
}

func NewUserService(userRepo repository.UserRepo, s storage.Storage) *UserService {
	return &UserService{userRepo: userRepo, storage: s}
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

// Delete 删除用户（含级联删除关联数据 + 用户存储目录）
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
	if err := s.userRepo.CascadeDelete(ctx, id); err != nil {
		return err
	}
	// 删除用户存储目录 users/<userID>/（含 avatar/、assets/）；
	// 数据库已删成功，存储清理失败仅记录日志不回滚
	if s.storage != nil {
		if err := s.storage.DeleteObjectsByPrefix("users/" + id + "/"); err != nil {
			log.Printf("[UserDelete] 删除用户存储目录失败: userID=%s err=%v", id, err)
		}
	}
	return nil
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

// UpdateProfile 更新当前用户个人资料（昵称/头像）
// nickname/avatarURL 为指针，nil 表示不修改该字段（支持把头像清空）
func (s *UserService) UpdateProfile(ctx context.Context, id string, nickname, avatarURL *string) (*model.User, error) {
	fields := map[string]interface{}{}
	if nickname != nil {
		n := strings.TrimSpace(*nickname)
		if n == "" {
			return nil, errors.New("昵称不能为空")
		}
		if len([]rune(n)) > 50 {
			return nil, errors.New("昵称不能超过50个字符")
		}
		fields["nickname"] = n
	}
	if avatarURL != nil {
		fields["avatar_url"] = strings.TrimSpace(*avatarURL)
	}
	if len(fields) == 0 {
		return s.userRepo.FindByID(ctx, id)
	}

	if _, err := s.userRepo.FindByID(ctx, id); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrUserNotFound
		}
		return nil, err
	}
	if err := s.userRepo.UpdateProfile(ctx, id, fields); err != nil {
		return nil, err
	}
	return s.userRepo.FindByID(ctx, id)
}

// ChangePassword 修改当前用户密码（需验证原密码）
func (s *UserService) ChangePassword(ctx context.Context, id, oldPassword, newPassword string) error {
	if len(newPassword) < 6 {
		return errors.New("新密码至少6位")
	}
	user, err := s.userRepo.FindByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrUserNotFound
		}
		return err
	}
	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(oldPassword)); err != nil {
		return ErrWrongPassword
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(newPassword), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	return s.userRepo.UpdatePasswordHash(ctx, id, string(hash))
}

// CheckTokenValid 实现 middleware.UserTokenChecker：校验 token 中的密码版本号与数据库一致
// 改密码后版本号递增，所有旧 token（含其他设备）在此校验不通过；
// 不含 pwd_ver 的旧版 token 一律视为失效，需重新登录
func (s *UserService) CheckTokenValid(ctx context.Context, userID string, claims jwt.MapClaims) bool {
	ver, ok := claims["pwd_ver"].(float64)
	if !ok {
		return false
	}
	user, err := s.userRepo.FindByID(ctx, userID)
	if err != nil {
		return false
	}
	return int(ver) == user.PasswordVersion
}

func (s *UserService) generateToken(user *model.User) (string, error) {
	claims := jwt.MapClaims{
		"user_id": user.ID,
		"email":   user.Email,
		// 密码版本号：改密码后服务端版本递增，旧 token 中的版本号不匹配即失效
		"pwd_ver": user.PasswordVersion,
		"exp":     time.Now().Add(time.Duration(config.C.JWT.ExpireHours) * time.Hour).Unix(),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(config.C.JWT.Secret))
}
