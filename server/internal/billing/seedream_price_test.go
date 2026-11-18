package billing

import (
	"context"
	"errors"
	"testing"

	"libtv/internal/llm"
	"libtv/internal/model"
	"libtv/internal/repository"

	"gorm.io/gorm"
)

type seedreamPriceRepo struct {
	repository.ModelPriceRepo
	rows   []model.ModelPrice
	fail   bool
	writes int
}

func (r *seedreamPriceRepo) ListAll(_ context.Context, channel string) ([]model.ModelPrice, error) {
	if r.fail {
		return nil, errors.New("price storage unavailable")
	}
	var rows []model.ModelPrice
	for _, row := range r.rows {
		if row.Channel == channel {
			rows = append(rows, row)
		}
	}
	return rows, nil
}

func (r *seedreamPriceRepo) BatchUpsert(_ context.Context, rows []model.ModelPrice) error {
	r.writes++
	r.rows = append(r.rows, rows...)
	return nil
}

func (r *seedreamPriceRepo) GetByNodeModelResolution(_ context.Context, channel, nodeType, modelID, resolution string, refVideo bool) (*model.ModelPrice, error) {
	for _, row := range r.rows {
		if row.Channel == channel && row.NodeType == nodeType && row.ModelID == modelID &&
			row.Resolution == resolution && row.HasReferenceVideo == refVideo {
			return &row, nil
		}
	}
	return nil, gorm.ErrRecordNotFound
}

func (r *seedreamPriceRepo) GetByNodeModel(ctx context.Context, channel, nodeType, modelID string) (*model.ModelPrice, error) {
	return r.GetByNodeModelResolution(ctx, channel, nodeType, modelID, "", false)
}

func TestSeedreamPricesInheritPerChannelWithoutOverwritingOrRewritingHistory(t *testing.T) {
	mm, err := llm.NewModelManager("../../configs/models.yaml")
	if err != nil {
		t.Fatal(err)
	}
	repo := &seedreamPriceRepo{}
	for _, channel := range []string{llm.ChannelWasu, llm.ChannelDianxin} {
		base := 30.0
		if channel == llm.ChannelDianxin {
			base = 25
		}
		for _, res := range []string{"", "2K", "4K"} {
			repo.rows = append(repo.rows,
				model.ModelPrice{Channel: channel, NodeType: "image", ModelID: "doubao-seedream-5.0-lite", Resolution: res, Price: base},
				model.ModelPrice{Channel: channel, NodeType: "image", ModelID: "doubao-seedream-5.0-pro", Resolution: res, Price: base * 2})
		}
	}
	// 显式免费和运营独立定价都不能被继承逻辑覆盖。
	repo.rows = append(repo.rows,
		model.ModelPrice{Channel: llm.ChannelDianxin, NodeType: "image", ModelID: "doubao-seedream-5.0-flash", Resolution: "", Price: 0},
		model.ModelPrice{Channel: llm.ChannelDianxin, NodeType: "image", ModelID: "doubao-seedream-5.5", Resolution: "2K", Price: 88},
		model.ModelPrice{Channel: llm.ChannelWasu, NodeType: "image", ModelID: "doubao-seedream-5.0-lite", Resolution: "1K", Price: 10})
	originals := append([]model.ModelPrice(nil), repo.rows...)
	service := NewPricingService(mm, repo)
	if err := service.SeedSeedreamPrices(context.Background()); err != nil {
		t.Fatal(err)
	}
	for i, row := range originals {
		if repo.rows[i] != row {
			t.Fatal("existing prices were changed")
		}
	}
	biller := &Service{priceRepo: repo, modelManager: mm}
	for _, channel := range []string{llm.ChannelWasu, llm.ChannelDianxin} {
		ctx := llm.WithChannel(context.Background(), channel)
		base := 30.0
		if channel == llm.ChannelDianxin {
			base = 25
		}
		for _, res := range []string{"", "2K"} {
			for _, id := range []string{"doubao-seedream-5.0-flash", "doubao-seedream-5.5"} {
				want := base
				if id == "doubao-seedream-5.5" {
					want *= 2
				}
				if id == "doubao-seedream-5.0-flash" && channel == llm.ChannelDianxin && res == "" {
					want = 0
				}
				if id == "doubao-seedream-5.5" && channel == llm.ChannelDianxin && res == "2K" {
					want = 88
				}
				got, configured := biller.lookupPrice(ctx, "image", id, res, false)
				if channel == llm.ChannelWasu {
					if configured {
						t.Fatalf("new price was added to wasu: %+v", got)
					}
					continue
				}
				if !configured || got.Price != want {
					t.Fatalf("%s/%s/%s price=%+v configured=%v want=%v", channel, id, res, got, configured, want)
				}
			}
		}
		list, err := service.ListPrices(ctx, channel)
		if err != nil {
			t.Fatal(err)
		}
		for _, group := range list.Nodes {
			if group.NodeType != "image" {
				continue
			}
			found := map[string]int{}
			for _, m := range group.Models {
				found[m.ModelID]++
			}
			if channel == llm.ChannelWasu {
				if len(found) != 0 {
					t.Fatalf("wasu registry changed: %v", found)
				}
			} else if found["doubao-seedream-5.0-lite"] != 0 || found["doubao-seedream-5.5"] != 1 || found["doubao-seedream-5.0-flash"] != 1 {
				t.Fatalf("price management registry mismatch: %v", found)
			}
		}
	}
	if err := service.SeedSeedreamPrices(context.Background()); err != nil || repo.writes != 1 {
		t.Fatalf("seed must be idempotent: writes=%d err=%v", repo.writes, err)
	}
	for _, res := range []string{"1K", "4K"} {
		if _, err := repo.GetByNodeModelResolution(context.Background(), llm.ChannelDianxin, "image", "doubao-seedream-5.0-flash", res, false); !errors.Is(err, gorm.ErrRecordNotFound) {
			t.Fatal("unsupported resolution should not inherit a price")
		}
	}
}

func TestMinimaxSpeechInitialPricesAndAdminList(t *testing.T) {
	mm, err := llm.NewModelManager("../../configs/models.yaml")
	if err != nil {
		t.Fatal(err)
	}
	repo := &seedreamPriceRepo{rows: []model.ModelPrice{
		{Channel: llm.ChannelWasu, NodeType: "audio", ModelID: "qwen3-tts-instruct-flash", Price: 26},
		{Channel: llm.ChannelDianxin, NodeType: "audio", ModelID: "minimax-speech-2.8-hd", Price: 88},
	}}
	service := NewPricingService(mm, repo)
	if err := service.SeedMinimaxSpeechPrices(context.Background()); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		model string
		price float64
	}{
		{"minimax-speech-2.8-turbo", 26}, {"minimax-speech-2.8-hd", 88},
	} {
		row, err := repo.GetByNodeModel(context.Background(), llm.ChannelDianxin, "audio", tc.model)
		if err != nil || row.Price != tc.price {
			t.Fatalf("speech price mismatch: %+v err=%v", row, err)
		}
	}
	if err := service.SeedMinimaxSpeechPrices(context.Background()); err != nil || repo.writes != 1 || len(repo.rows) != 3 {
		t.Fatalf("speech seeding overwrites or duplicates prices: err=%v rows=%v", err, repo.rows)
	}
	list, err := service.ListPrices(context.Background(), llm.ChannelDianxin)
	if err != nil {
		t.Fatal(err)
	}
	for _, group := range list.Nodes {
		if group.NodeType == "audio" && (group.BillingType != BillingTypePerChar || len(group.Models) != 2) {
			t.Fatalf("speech pricing group mismatch: %+v", group)
		}
	}
}

func TestSeedreamPriceReadFailureDoesNotPartiallySeed(t *testing.T) {
	mm, err := llm.NewModelManager("../../configs/models.yaml")
	if err != nil {
		t.Fatal(err)
	}
	repo := &seedreamPriceRepo{fail: true}
	if err := NewPricingService(mm, repo).SeedSeedreamPrices(context.Background()); err == nil || repo.writes != 0 {
		t.Fatalf("price read failure must be returned without writes: err=%v writes=%d", err, repo.writes)
	}
}

type channelRefundUsers struct {
	repository.UserRepo
	credits int64
}

func (r *channelRefundUsers) AddCredits(_ context.Context, _ string, amount int64) error {
	r.credits += amount
	return nil
}

func (r *channelRefundUsers) GetCredits(context.Context, string) (int64, error) {
	return r.credits, nil
}

type channelRefundBills struct {
	repository.BillingRepo
	records []model.BillingRecord
}

func (r *channelRefundBills) Create(_ context.Context, record *model.BillingRecord) error {
	r.records = append(r.records, *record)
	return nil
}

func TestRetiredChannelRefundKeepsOriginalLedgerDimension(t *testing.T) {
	users := &channelRefundUsers{}
	bills := &channelRefundBills{}
	svc := NewService(users, bills, nil, nil)
	if channelOf(context.Background()) != llm.ChannelDianxin {
		t.Fatal("new billing default must use electricity channel")
	}
	if err := svc.RefundOnChannel("user", 30, ActionImage, "doubao-seedream-5.0-lite",
		"图片生成", "original error", ChargeExtra{ChargeKey: "original-charge", Resolution: "2K"}, llm.ChannelWasu); err != nil {
		t.Fatal(err)
	}
	if users.credits != 30 || len(bills.records) != 1 {
		t.Fatalf("refund lost or duplicated: credits=%d records=%v", users.credits, bills.records)
	}
	row := bills.records[0]
	if row.Channel != llm.ChannelWasu || row.Model != "doubao-seedream-5.0-lite" ||
		row.Amount != 30 || row.ChargeKey != "original-charge" || row.Resolution != "2K" {
		t.Fatalf("historical refund was rewritten: %+v", row)
	}
}
