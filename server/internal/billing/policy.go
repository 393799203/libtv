package billing

import (
	"errors"

	"libtv/internal/pkg/textcut"

	"libtv/internal/llm"
)

// 退款规则（产品口径，唯一的判定入口 —— 执行器、看门狗、人工退费都只能从这里取答案）
//
//  1. 上游明确报错/拒绝（参数不合法、不过审、任务被判 failed）→ **自动退费**。
//     上游自己说「这个任务我不做」，那它不会计费，钱必须马上还给用户。
//  2. 其余一切失败（请求超时、没拿到任务号、连接中断、用户中断、轮询预算耗尽、
//     视频转存失败）→ **不自动退费**，在对账账本里落一条「待人工退费」，
//     由管理员在对账页判断后退。理由：这些情况我们并不知道上游做了什么，
//     而上游是「生成后计费」——它很可能已经受理并跑完、已经收了我们钱，
//     我们单方面退费等于白付上游一次（线上实例：10-03 00:04 创建超时后自动退款，
//     上游任务照跑照计费）。
//
// 改动这条规则时只需要改本文件，所有调用点自动跟着变。
var ErrRefundNotAllowed = errors.New("该记录不能退费：已交付或已退费，或没有可退的扣费")

// 对账状态取值（执行器、看门狗、对账页共用；改动只需改这里）
const (
	// StatusSubmitted 已下发上游、结果未定
	StatusSubmitted = "submitted"
	// StatusDelivered 已交付给用户（正常收场）
	StatusDelivered = "delivered"
	// StatusPendingReview 上游没返回结果（超时 / 没拿到任务号 / 转存失败…），
	// 不自动退费，交人工决定（对账页的「退费」按钮）
	StatusPendingReview = "pending_review"
	// StatusRefunded 已退费（自动或人工，用 RefundSource 区分）
	StatusRefunded = "refunded"
)

// 退费来源取值（对账页据此区分「上游拒绝、上游不计费」与「可能已计费的真成本」）
const (
	// RefundSourceAuto 上游明确拒绝后自动退费：任务没被上游受理/被判失败，上游不会计费
	RefundSourceAuto = "auto"
	// RefundSourceManual 管理员人工判断后退费：上游没明确拒绝，可能已生成并计费，是真实成本
	RefundSourceManual = "manual"
)

// ShouldAutoRefund 该失败是否属于「上游明确拒绝」，也就是是否自动退费
func ShouldAutoRefund(err error) bool {
	return err != nil && errors.Is(err, llm.ErrUpstreamRejected)
}

// AutoRefundReason 自动退费时写进退费账单的原因（对账时能一眼区分自动退 / 人工退）
func AutoRefundReason(detail string) string {
	return "上游明确拒绝本次任务，自动退还本次扣费: " + detail
}

// TruncateNote 把备注截到不超过 maxBytes 字节，且不切断 UTF-8 字符（详见 textcut 包注释）。
func TruncateNote(note string, maxBytes int) string {
	return textcut.NotLongerThan(note, maxBytes)
}
