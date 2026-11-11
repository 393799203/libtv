package model

import "time"

// AuthSession is the server-side authority for both access and refresh tokens.
// ExpiresAt is an absolute deadline; refreshing never extends it.
type AuthSession struct {
	ID              string    `gorm:"primaryKey;size:36"`
	UserID          string    `gorm:"size:36;not null;index"`
	RefreshHash     string    `gorm:"size:64;not null;uniqueIndex"`
	PasswordVersion int       `gorm:"not null"`
	RememberMe      bool      `gorm:"not null"`
	ExpiresAt       time.Time `gorm:"not null;index"`
	RevokedAt       *time.Time
	RevokedReason   string `gorm:"size:20"`
	CreatedAt       time.Time
}

// RegistrationCode stores a keyed digest, never a plaintext verification code.
type RegistrationCode struct {
	Email     string    `gorm:"primaryKey;size:255"`
	CodeHash  string    `gorm:"size:64;not null"`
	Attempts  int       `gorm:"not null;default:0"`
	ExpiresAt time.Time `gorm:"not null;index"`
	CreatedAt time.Time
}

type AuthRateBucket struct {
	Key       string    `gorm:"primaryKey;size:64"`
	Attempts  int       `gorm:"not null"`
	ExpiresAt time.Time `gorm:"not null;index"`
}
