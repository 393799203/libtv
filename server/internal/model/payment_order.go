package model

import "time"

// 支付渠道标识（payment_orders.pay_channel）
const (
	// PayChannelAlipay 支付宝（历史订单该列为空，读取时按支付宝处理）
	PayChannelAlipay = "alipay"
	// PayChannelWechat 微信支付（APIv3：PC Native 扫码 / 手机 H5）
	PayChannelWechat = "wechat"
)

// PaymentOrder 充值订单（支付宝 / 微信支付共用一张表，靠 PayChannel 区分渠道）
//
// 两条支付线共用同一套订单体系：
//   - 商户订单号 OrderNo 全站唯一（payment_orders.order_no 唯一索引），微信侧即 out_trade_no
//   - AlipayTradeNo / WxpayTradeNo 各自记录渠道交易号，用于对账与退款核对
//   - 到账统一走 billing.Service.Recharge（写 billing_records，OrderNo 与交易号一并落账），
//     因此「积分超市充值」无论走哪个渠道，账单与对账口径完全一致
type PaymentOrder struct {
	ID            uint       `gorm:"primaryKey;autoIncrement" json:"id"`
	OrderNo       string     `gorm:"size:64;uniqueIndex;not null" json:"order_no"` // 商户订单号（out_trade_no）
	UserID        string     `gorm:"size:36;not null;index" json:"user_id"`
	PackageID     string     `gorm:"size:36" json:"package_id"`                            // 积分套餐 ID
	PackageName   string     `gorm:"size:50" json:"package_name"`                          // 套餐名称快照
	Points        int64      `gorm:"not null" json:"points"`                               // 到账积分
	AmountFen     int64      `gorm:"not null;default:0" json:"amount_fen"`                 // 支付金额（分）
	Status        string     `gorm:"size:20;not null;default:pending;index" json:"status"` // pending / paid / closed
	PayChannel    string     `gorm:"size:20;default:'';index" json:"pay_channel"`          // alipay / wechat（历史订单为空=支付宝）
	AlipayTradeNo string     `gorm:"size:64" json:"alipay_trade_no"`                       // 支付宝交易号（trade_no）
	WxpayTradeNo  string     `gorm:"size:64" json:"wxpay_trade_no"`                        // 微信支付交易号（transaction_id）
	PaidAt        *time.Time `json:"paid_at"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func (PaymentOrder) TableName() string { return "payment_orders" }
