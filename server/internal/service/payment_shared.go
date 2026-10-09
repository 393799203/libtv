package service

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strconv"
	"time"

	"gorm.io/gorm"

	"libtv/internal/billing"
	"libtv/internal/model"
	"libtv/internal/pkg/apperror"
)

// ==================== 支付宝 / 微信支付共用的订单与到账路径 ====================
//
// 两条支付线**共用同一张订单表**（payment_orders）与同一套到账逻辑（billing.Recharge），
// 区别只在「用哪个渠道下单 / 哪个渠道回调」以及交易号写哪一列。
// 提在这里是为了保证：无论走哪条线，幂等抢占、账单落账、失败回滚的口径完全一致。

// loadEnabledPackage 读取在售套餐（不存在或下架 → 业务错误，不是 500）
func loadEnabledPackage(ctx context.Context, db *gorm.DB, packageID string) (*model.PointsPackage, error) {
	var pkg model.PointsPackage
	if err := db.WithContext(ctx).First(&pkg, "id = ? AND enabled = true", packageID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, apperror.New(400, 400, "套餐不存在或已下架")
		}
		return nil, err
	}
	if pkg.Price <= 0 || pkg.Points <= 0 {
		return nil, ErrPaymentOrderFails
	}
	return &pkg, nil
}

// newPendingOrder 按套餐快照构造待支付订单（金额以「分」存整，避免浮点误差）
func newPendingOrder(userID string, pkg *model.PointsPackage, channel string) *model.PaymentOrder {
	return &model.PaymentOrder{
		OrderNo:     genOrderNo(),
		UserID:      userID,
		PackageID:   strconv.FormatInt(pkg.ID, 10),
		PackageName: pkg.Name,
		Points:      pkg.Points,
		AmountFen:   int64(math.Round(pkg.Price * 100)),
		Status:      "pending",
		PayChannel:  channel,
	}
}

// channelOf 归一化支付渠道：历史订单该列为空，按支付宝处理（本次改动之前只有支付宝）
func channelOf(order *model.PaymentOrder) string {
	if order.PayChannel == model.PayChannelWechat {
		return model.PayChannelWechat
	}
	return model.PayChannelAlipay
}

// claimPaidOrder 原子抢占待支付订单（幂等核心）：
// 只有把 pending 改成 paid 成功的**那一次**才返回 claimed=true，其余（重复通知/并发回调）返回 false。
// 调用方据此保证「同一笔订单只加一次积分」。
func claimPaidOrder(ctx context.Context, db *gorm.DB, orderNo, tradeNo string) (*model.PaymentOrder, bool, error) {
	var order model.PaymentOrder
	if err := db.WithContext(ctx).First(&order, "order_no = ?", orderNo).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, false, ErrPaymentOrderNotFound
		}
		return nil, false, err
	}

	updates := map[string]interface{}{
		"status":  "paid",
		"paid_at": time.Now(),
	}
	if channelOf(&order) == model.PayChannelWechat {
		updates["wxpay_trade_no"] = tradeNo
	} else {
		updates["alipay_trade_no"] = tradeNo
	}

	res := db.WithContext(ctx).Model(&model.PaymentOrder{}).
		Where("order_no = ? AND status = 'pending'", orderNo).
		Updates(updates)
	if res.Error != nil {
		return &order, false, res.Error
	}
	return &order, res.RowsAffected > 0, nil
}

// rollbackClaim 到账失败时回滚抢占状态，让渠道重试（下次通知重新抢占、重新到账）
func rollbackClaim(ctx context.Context, db *gorm.DB, orderNo, channel string) {
	updates := map[string]interface{}{"status": "pending", "paid_at": nil}
	if channel == model.PayChannelWechat {
		updates["wxpay_trade_no"] = ""
	} else {
		updates["alipay_trade_no"] = ""
	}
	_ = db.WithContext(ctx).Model(&model.PaymentOrder{}).Where("order_no = ?", orderNo).Updates(updates).Error
}

// rechargeClaimedOrder 抢占成功后的到账：加分 + 落账单（订单号与渠道交易号一并记录，供对账）
func rechargeClaimedOrder(ctx context.Context, billingSvc *billing.Service, order *model.PaymentOrder, tradeNo, channelName string) error {
	remark := fmt.Sprintf("%s购买「%s」", channelName, order.PackageName)
	payload := billing.RechargeOrder{OrderNo: order.OrderNo}
	if channelOf(order) == model.PayChannelWechat {
		payload.WxpayTradeNo = tradeNo
	} else {
		payload.AlipayTradeNo = tradeNo
	}
	return billingSvc.Recharge(ctx, order.UserID, order.Points, "积分充值", remark, payload)
}
