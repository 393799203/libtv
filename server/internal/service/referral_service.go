package service

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"gorm.io/gorm"
	"libtv/internal/model"
)

var referralCodePattern = regexp.MustCompile(`^[0-9A-F]{16}$`)

type ReferralService struct{ db *gorm.DB }

func NewReferralService(db *gorm.DB) *ReferralService { return &ReferralService{db: db} }

type MyReferral struct {
	Code         string `json:"code"`
	InvitedUsers int64  `json:"invited_users"`
}

type ReferralDay struct {
	Date  string `json:"date"`
	Users int64  `json:"users"`
}
type MyReferralStats struct {
	ReferralMetrics
	Last7Days  int64         `json:"last_7_days"`
	Last30Days int64         `json:"last_30_days"`
	Days       []ReferralDay `json:"days" gorm:"-"`
}

// Only aggregate the authenticated user's direct invitees. Individual payment
// records and account identifiers are never returned by this endpoint.
func (s *ReferralService) MyStats(ctx context.Context, userID string) (*MyReferralStats, error) {
	zone := time.FixedZone("Asia/Shanghai", 8*60*60)
	now := time.Now().In(zone)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, zone)
	since7, since30 := today.AddDate(0, 0, -6), today.AddDate(0, 0, -29)
	out := &MyReferralStats{Days: []ReferralDay{}}
	err := s.db.WithContext(ctx).Raw(`SELECT COUNT(*) AS invited_users,
 COUNT(*) FILTER (WHERE created_at >= ?) AS last7_days,
 COUNT(*) FILTER (WHERE created_at >= ?) AS last30_days FROM users WHERE inviter_id=?`,
		since7, since30, userID).Scan(out).Error
	if err != nil {
		return nil, err
	}
	var metrics ReferralMetrics
	if err := s.db.WithContext(ctx).Raw(referralCTE+`SELECT `+referralMetricColumns+`
 FROM grouped g WHERE g.inviter_id=?`, userID).Scan(&metrics).Error; err != nil {
		return nil, err
	}
	out.ReferralMetrics = metrics
	var days []ReferralDay
	err = s.db.WithContext(ctx).Raw(`SELECT to_char(created_at AT TIME ZONE 'Asia/Shanghai','YYYY-MM-DD') AS date,
 COUNT(*) AS users FROM users WHERE inviter_id=? AND created_at>=? GROUP BY date ORDER BY date`,
		userID, since30).Scan(&days).Error
	if err != nil {
		return nil, err
	}
	counts := map[string]int64{}
	for _, day := range days {
		counts[day.Date] = day.Users
	}
	for date := since30; !date.After(today); date = date.AddDate(0, 0, 1) {
		key := date.Format("2006-01-02")
		out.Days = append(out.Days, ReferralDay{Date: key, Users: counts[key]})
	}
	return out, nil
}

func (s *ReferralService) ResolveInviter(ctx context.Context, raw string) (string, error) {
	code := strings.ToUpper(strings.TrimSpace(raw))
	if !referralCodePattern.MatchString(code) {
		return "", fmt.Errorf("推荐码格式不正确")
	}
	var user model.User
	if err := s.db.WithContext(ctx).Select("id").Where("referral_code = ?", code).First(&user).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", fmt.Errorf("推荐码不存在，请检查后重试")
		}
		return "", err
	}
	return user.ID, nil
}

func (s *ReferralService) Mine(ctx context.Context, userID string) (*MyReferral, error) {
	var user model.User
	if err := s.db.WithContext(ctx).Select("id", "referral_code").First(&user, "id = ?", userID).Error; err != nil {
		return nil, err
	}
	for attempt := 0; user.ReferralCode == nil || *user.ReferralCode == ""; attempt++ {
		if attempt >= 8 {
			return nil, fmt.Errorf("推荐码生成失败，请重试")
		}
		code, err := model.NewReferralCode()
		if err != nil {
			return nil, err
		}
		err = s.db.WithContext(ctx).Model(&model.User{}).
			Where("id = ? AND (referral_code IS NULL OR referral_code = '')", userID).
			Update("referral_code", code).Error
		if err != nil {
			if strings.Contains(err.Error(), "23505") || errors.Is(err, gorm.ErrDuplicatedKey) {
				continue
			}
			return nil, err
		}
		// Another request may have assigned the code first; return the persisted one.
		if err := s.db.WithContext(ctx).Select("id", "referral_code").First(&user, "id = ?", userID).Error; err != nil {
			return nil, err
		}
	}
	out := &MyReferral{Code: *user.ReferralCode}
	if err := s.db.WithContext(ctx).Model(&model.User{}).Where("inviter_id = ?", userID).Count(&out.InvitedUsers).Error; err != nil {
		return nil, err
	}
	return out, nil
}

type ReferralMetrics struct {
	InvitedUsers      int64 `json:"invited_users"`
	PayingUsers       int64 `json:"paying_users"`
	PaidOrders        int64 `json:"paid_orders"`
	AmountFen         int64 `json:"amount_fen"`
	PaidPoints        int64 `json:"paid_points"`
	BonusPoints       int64 `json:"bonus_points"`
	ConsumedPoints    int64 `json:"consumed_points"`
	RefundedPoints    int64 `json:"refunded_points"`
	NetConsumedPoints int64 `json:"net_consumed_points"`
}
type ReferralSummary struct {
	ReferralMetrics
	PlatformUsers int64 `json:"platform_users"`
	Inviters      int64 `json:"inviters"`
}
type ReferralRow struct {
	ID           string    `json:"id"`
	Nickname     string    `json:"nickname"`
	Email        string    `json:"email"`
	ReferralCode string    `json:"referral_code"`
	CreatedAt    time.Time `json:"created_at"`
	Credits      int64     `json:"credits"`
	ReferralMetrics
}
type ReferralDashboard struct {
	Summary  ReferralSummary `json:"summary"`
	Items    []ReferralRow   `json:"items"`
	Total    int64           `json:"total"`
	Page     int             `json:"page"`
	PageSize int             `json:"page_size"`
}

// Aggregate each source first: joining raw orders to raw bills multiplies money.
const referralCTE = `WITH paid AS (
 SELECT user_id, COUNT(*) AS paid_orders, SUM(amount_fen) AS amount_fen, SUM(points) AS paid_points
 FROM payment_orders WHERE status = 'paid' GROUP BY user_id
), spent AS (
 SELECT user_id,
 SUM(CASE WHEN type='deduct' THEN amount ELSE 0 END) AS consumed_points,
 SUM(CASE WHEN type='refund' THEN amount ELSE 0 END) AS refunded_points,
 SUM(CASE WHEN type='recharge' AND COALESCE(order_no,'')='' THEN amount ELSE 0 END) AS bonus_points
 FROM billing_records GROUP BY user_id
), invited AS (
 SELECT u.id, u.inviter_id,
 COALESCE(p.paid_orders,0) AS paid_orders, COALESCE(p.amount_fen,0) AS amount_fen,
 COALESCE(p.paid_points,0) AS paid_points, COALESCE(b.bonus_points,0) AS bonus_points,
 COALESCE(b.consumed_points,0) AS consumed_points, COALESCE(b.refunded_points,0) AS refunded_points,
 COALESCE(b.consumed_points,0)-COALESCE(b.refunded_points,0) AS net_consumed_points
 FROM users u LEFT JOIN paid p ON p.user_id=u.id LEFT JOIN spent b ON b.user_id=u.id
 WHERE u.inviter_id IS NOT NULL AND EXISTS(SELECT 1 FROM users owner WHERE owner.id=u.inviter_id)
), grouped AS (
 SELECT inviter_id, COUNT(*) AS invited_users,
 COUNT(*) FILTER (WHERE paid_orders>0) AS paying_users,
 SUM(paid_orders) AS paid_orders, SUM(amount_fen) AS amount_fen, SUM(paid_points) AS paid_points,
 SUM(bonus_points) AS bonus_points, SUM(consumed_points) AS consumed_points,
 SUM(refunded_points) AS refunded_points, SUM(net_consumed_points) AS net_consumed_points
 FROM invited GROUP BY inviter_id
) `

const referralMetricColumns = `
 COALESCE(g.invited_users,0) AS invited_users, COALESCE(g.paying_users,0) AS paying_users,
 COALESCE(g.paid_orders,0) AS paid_orders, COALESCE(g.amount_fen,0) AS amount_fen,
 COALESCE(g.paid_points,0) AS paid_points, COALESCE(g.bonus_points,0) AS bonus_points,
 COALESCE(g.consumed_points,0) AS consumed_points, COALESCE(g.refunded_points,0) AS refunded_points,
 COALESCE(g.net_consumed_points,0) AS net_consumed_points `

func (s *ReferralService) Dashboard(ctx context.Context, keyword string, page, size int) (*ReferralDashboard, error) {
	if page < 1 {
		page = 1
	}
	if size < 1 || size > 100 {
		size = 20
	}
	out := &ReferralDashboard{Items: []ReferralRow{}, Page: page, PageSize: size}
	summarySQL := referralCTE + `SELECT (SELECT COUNT(*) FROM users) AS platform_users,
 COUNT(DISTINCT inviter_id) AS inviters, COUNT(*) AS invited_users,
 COUNT(*) FILTER(WHERE paid_orders>0) AS paying_users,
 COALESCE(SUM(paid_orders),0) AS paid_orders, COALESCE(SUM(amount_fen),0) AS amount_fen,
 COALESCE(SUM(paid_points),0) AS paid_points, COALESCE(SUM(bonus_points),0) AS bonus_points,
 COALESCE(SUM(consumed_points),0) AS consumed_points, COALESCE(SUM(refunded_points),0) AS refunded_points,
 COALESCE(SUM(net_consumed_points),0) AS net_consumed_points FROM invited`
	if err := s.db.WithContext(ctx).Raw(summarySQL).Scan(&out.Summary).Error; err != nil {
		return nil, err
	}
	where := "TRUE"
	args := []interface{}{}
	if keyword = strings.TrimSpace(keyword); keyword != "" {
		where = "(u.nickname ILIKE ? OR u.email ILIKE ? OR u.referral_code ILIKE ?)"
		args = append(args, "%"+keyword+"%", "%"+keyword+"%", "%"+keyword+"%")
	}
	if err := s.db.WithContext(ctx).Table("users u").Where(where, args...).Count(&out.Total).Error; err != nil {
		return nil, err
	}
	query := referralCTE + `SELECT u.id,u.nickname,u.email,u.created_at,u.credits,
 COALESCE(u.referral_code,'') AS referral_code,` + referralMetricColumns + `
 FROM users u LEFT JOIN grouped g ON g.inviter_id=u.id WHERE ` + where + `
 ORDER BY invited_users DESC,amount_fen DESC,u.created_at DESC,u.id LIMIT ? OFFSET ?`
	args = append(args, size, (page-1)*size)
	if err := s.db.WithContext(ctx).Raw(query, args...).Scan(&out.Items).Error; err != nil {
		return nil, err
	}
	return out, nil
}

func (s *ReferralService) Invitees(ctx context.Context, inviterID string, page, size int) (*ReferralDashboard, error) {
	if page < 1 {
		page = 1
	}
	if size < 1 || size > 100 {
		size = 20
	}
	out := &ReferralDashboard{Items: []ReferralRow{}, Page: page, PageSize: size}
	if err := s.db.WithContext(ctx).Model(&model.User{}).Where("inviter_id = ?", inviterID).Count(&out.Total).Error; err != nil {
		return nil, err
	}
	query := referralCTE + `SELECT u.id,u.nickname,u.email,u.created_at,u.credits,
 COALESCE(u.referral_code,'') AS referral_code,i.paid_orders,i.amount_fen,i.paid_points,
 i.bonus_points,i.consumed_points,i.refunded_points,i.net_consumed_points
 FROM invited i JOIN users u ON u.id=i.id WHERE i.inviter_id=?
 ORDER BY u.created_at DESC,u.id LIMIT ? OFFSET ?`
	if err := s.db.WithContext(ctx).Raw(query, inviterID, size, (page-1)*size).Scan(&out.Items).Error; err != nil {
		return nil, err
	}
	return out, nil
}

func (s *ReferralService) EnrichUsers(ctx context.Context, items []UserListItem) error {
	ids := []string{}
	for _, item := range items {
		if item.InviterID != nil {
			ids = append(ids, *item.InviterID)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	var parents []model.User
	if err := s.db.WithContext(ctx).Select("id", "nickname", "email").Where("id IN ?", ids).Find(&parents).Error; err != nil {
		return err
	}
	byID := map[string]model.User{}
	for _, parent := range parents {
		byID[parent.ID] = parent
	}
	for i := range items {
		if items[i].InviterID == nil {
			continue
		}
		parent := byID[*items[i].InviterID]
		items[i].InviterNickname, items[i].InviterEmail = parent.Nickname, parent.Email
	}
	return nil
}
