package model

import "time"

// PaymentOrder 充值订单（支付宝支付，到账后回调 Recharge 增加积分）
type PaymentOrder struct {
	ID            uint      `gorm:"primaryKey;autoIncrement" json:"id"`
	OrderNo       string    `gorm:"size:64;uniqueIndex;not null" json:"order_no"` // 商户订单号（out_trade_no）
	UserID        string    `gorm:"size:36;not null;index" json:"user_id"`
	PackageID     string    `gorm:"size:36" json:"package_id"`     // 积分套餐 ID
	PackageName   string    `gorm:"size:50" json:"package_name"`   // 套餐名称快照
	Points        int64     `gorm:"not null" json:"points"`        // 到账积分
	AmountFen     int64     `gorm:"not null;default:0" json:"amount_fen"` // 支付金额（分）
	Status        string    `gorm:"size:20;not null;default:pending;index" json:"status"` // pending / paid / closed
	AlipayTradeNo string    `gorm:"size:64" json:"alipay_trade_no"` // 支付宝交易号（trade_no）
	PaidAt        *time.Time `json:"paid_at"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (PaymentOrder) TableName() string { return "payment_orders" }