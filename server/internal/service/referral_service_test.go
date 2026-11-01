package service

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"libtv/internal/model"
	"libtv/internal/repository"
)

func referralTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("REFERRAL_TEST_DSN")
	if dsn == "" {
		dsn = "host=localhost user=libtv password=libtv123 dbname=libtv port=5432 sslmode=disable"
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Skip("local Postgres unavailable")
	}
	conn, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	conn.SetMaxOpenConns(1)
	schema := fmt.Sprintf("referral_test_%d", time.Now().UnixNano())
	if err := db.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("SET search_path TO " + schema).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Exec("DROP SCHEMA " + schema + " CASCADE"); conn.Close() })
	if err := db.AutoMigrate(&model.User{}, &model.PaymentOrder{}, &model.BillingRecord{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func TestReferralRegistrationAndStableHistoricalCode(t *testing.T) {
	db := referralTestDB(t)
	ctx := context.Background()
	ref := NewReferralService(db)
	users := NewUserService(repository.NewUserRepo(db), nil, nil)
	users.SetReferralService(ref)
	parent, err := users.Register(ctx, "parent@example.invalid", "test-password", "推荐人")
	if err != nil {
		t.Fatal(err)
	}
	if parent.ReferralCode == nil || len(*parent.ReferralCode) != 16 {
		t.Fatal("new users need a referral code")
	}
	if _, err := users.RegisterWithChannel(ctx, "bad@example.invalid", "test-password", "无效邀请", "wasu", "invalid"); err == nil {
		t.Fatal("invalid code must reject registration")
	}
	var count int64
	db.Model(&model.User{}).Count(&count)
	if count != 1 {
		t.Fatal("invalid invitation must not create an account")
	}
	child, err := users.RegisterWithChannel(ctx, "child@example.invalid", "test-password", "被邀请人", "dianxin", " "+strings.ToLower(*parent.ReferralCode)+" ")
	if err != nil {
		t.Fatal(err)
	}
	if child.InviterID == nil || *child.InviterID != parent.ID {
		t.Fatal("attribution was not persisted")
	}
	if _, err := users.RegisterWithChannel(ctx, child.Email, "test-password", "重绑", "dianxin", ""); err == nil {
		t.Fatal("an existing account must not rebind via registration")
	}
	mine, err := ref.Mine(ctx, parent.ID)
	if err != nil || mine.InvitedUsers != 1 || mine.Code != *parent.ReferralCode {
		t.Fatalf("mine: %+v %v", mine, err)
	}
	// Simulate an account created before this migration, including nullable codes.
	if err := db.Model(&model.User{}).Where("id=?", child.ID).Update("referral_code", nil).Error; err != nil {
		t.Fatal(err)
	}
	first, err := ref.Mine(ctx, child.ID)
	if err != nil {
		t.Fatal(err)
	}
	second, err := ref.Mine(ctx, child.ID)
	if err != nil || first.Code != second.Code {
		t.Fatal("historical code must stay stable")
	}
	items := []UserListItem{{User: *child}}
	if err := ref.EnrichUsers(ctx, items); err != nil || items[0].InviterNickname != "推荐人" {
		t.Fatalf("inviter metadata: %+v %v", items, err)
	}
}

func TestReferralAggregatesDoNotMultiplyOrdersAndBills(t *testing.T) {
	db := referralTestDB(t)
	ctx := context.Background()
	parent := model.User{Email: "owner@example.invalid", PasswordHash: "disabled", Nickname: "推荐人"}
	if err := db.Create(&parent).Error; err != nil {
		t.Fatal(err)
	}
	a := model.User{Email: "a@example.invalid", PasswordHash: "disabled", InviterID: &parent.ID}
	b := model.User{Email: "b@example.invalid", PasswordHash: "disabled", InviterID: &parent.ID}
	other := model.User{Email: "other@example.invalid", PasswordHash: "disabled"}
	for _, u := range []*model.User{&a, &b, &other} {
		if err := db.Create(u).Error; err != nil {
			t.Fatal(err)
		}
	}
	orders := []model.PaymentOrder{
		{OrderNo: "a-paid-1", UserID: a.ID, Status: "paid", AmountFen: 1200, Points: 100},
		{OrderNo: "a-paid-2", UserID: a.ID, Status: "paid", AmountFen: 3300, Points: 400},
		{OrderNo: "b-pending", UserID: b.ID, Status: "pending", AmountFen: 999999, Points: 90000},
		{OrderNo: "b-closed", UserID: b.ID, Status: "closed", AmountFen: 999999, Points: 90000},
		{OrderNo: "other-paid", UserID: other.ID, Status: "paid", AmountFen: 999999, Points: 90000},
	}
	if err := db.Create(&orders).Error; err != nil {
		t.Fatal(err)
	}
	bills := []model.BillingRecord{
		{UserID: a.ID, Type: "deduct", Amount: 100}, {UserID: a.ID, Type: "deduct", Amount: 70},
		{UserID: a.ID, Type: "refund", Amount: 20}, {UserID: a.ID, Type: "recharge", Amount: 40},
		{UserID: a.ID, Type: "recharge", Amount: 500, OrderNo: "a-paid-1"},
		{UserID: other.ID, Type: "deduct", Amount: 90000},
	}
	if err := db.Create(&bills).Error; err != nil {
		t.Fatal(err)
	}
	ref := NewReferralService(db)
	result, err := ref.Dashboard(ctx, "", 1, 20)
	if err != nil {
		t.Fatal(err)
	}
	s := result.Summary
	if s.PlatformUsers != 4 || s.InvitedUsers != 2 || s.Inviters != 1 || s.PayingUsers != 1 ||
		s.PaidOrders != 2 || s.AmountFen != 4500 || s.PaidPoints != 500 ||
		s.BonusPoints != 40 || s.ConsumedPoints != 170 || s.RefundedPoints != 20 || s.NetConsumedPoints != 150 {
		t.Fatalf("incorrect aggregation: %+v", s)
	}
	searched, err := ref.Dashboard(ctx, "owner@", 1, 20)
	if err != nil || searched.Total != 1 || searched.Items[0].InvitedUsers != 2 || searched.Summary.AmountFen != 4500 {
		t.Fatalf("search must not change overall metrics: %+v %v", searched, err)
	}
	detail, err := ref.Invitees(ctx, parent.ID, 1, 20)
	if err != nil || detail.Total != 2 || len(detail.Items) != 2 {
		t.Fatalf("detail: %+v %v", detail, err)
	}
	for _, row := range detail.Items {
		if row.ID == a.ID && row.NetConsumedPoints != 150 {
			t.Fatalf("detail double-counted: %+v", row)
		}
	}
	personal, err := ref.MyStats(ctx, parent.ID)
	if err != nil {
		t.Fatal(err)
	}
	if personal.ReferralMetrics != s.ReferralMetrics {
		t.Fatalf("personal cohort totals must match admin totals: personal=%+v admin=%+v",
			personal.ReferralMetrics, s.ReferralMetrics)
	}
	// Personal statistics must not turn into the invitee's own account totals,
	// include unrelated users, or expose per-user transaction records.
	unrelatedStats, err := ref.MyStats(ctx, other.ID)
	if err != nil {
		t.Fatal(err)
	}
	if unrelatedStats.ReferralMetrics != (ReferralMetrics{}) {
		t.Fatalf("an account without invitees must have zero cohort totals: %+v", unrelatedStats)
	}
	ownOrder := model.PaymentOrder{OrderNo: "owner-paid", UserID: parent.ID, Status: "paid", AmountFen: 99900, Points: 99900}
	if err := db.Create(&ownOrder).Error; err != nil {
		t.Fatal(err)
	}
	ownBill := model.BillingRecord{UserID: parent.ID, Type: "deduct", Amount: 9000}
	if err := db.Create(&ownBill).Error; err != nil {
		t.Fatal(err)
	}
	again, err := ref.MyStats(ctx, parent.ID)
	if err != nil || again.ReferralMetrics != personal.ReferralMetrics {
		t.Fatalf("owner's own payment and consumption must not be attributed to invitees: %+v %v", again, err)
	}
}

func TestMyReferralStatsScopesOwnerAndShanghaiCalendar(t *testing.T) {
	db := referralTestDB(t)
	parent := model.User{Email: "stats-owner@example.invalid", PasswordHash: "disabled"}
	other := model.User{Email: "stats-other@example.invalid", PasswordHash: "disabled"}
	for _, u := range []*model.User{&parent, &other} {
		if err := db.Create(u).Error; err != nil {
			t.Fatal(err)
		}
	}
	zone := time.FixedZone("Asia/Shanghai", 8*60*60)
	now := time.Now().In(zone)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, zone)
	for i, date := range []time.Time{today.Add(time.Hour), today.AddDate(0, 0, -6), today.AddDate(0, 0, -29), today.AddDate(0, 0, -30)} {
		u := model.User{Email: fmt.Sprintf("stats-%d@example.invalid", i), PasswordHash: "disabled", InviterID: &parent.ID, CreatedAt: date}
		if err := db.Create(&u).Error; err != nil {
			t.Fatal(err)
		}
	}
	unrelated := model.User{Email: "stats-unrelated@example.invalid", PasswordHash: "disabled", InviterID: &other.ID}
	if err := db.Create(&unrelated).Error; err != nil {
		t.Fatal(err)
	}
	stats, err := NewReferralService(db).MyStats(context.Background(), parent.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stats.InvitedUsers != 4 || stats.Last7Days != 2 || stats.Last30Days != 3 || len(stats.Days) != 30 {
		t.Fatalf("incorrect personal stats: %+v", stats)
	}
	if stats.Days[0].Users != 1 || stats.Days[29].Users != 1 {
		t.Fatalf("Shanghai dates incorrect: %+v", stats.Days)
	}
}
