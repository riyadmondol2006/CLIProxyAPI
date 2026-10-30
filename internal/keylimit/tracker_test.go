package keylimit

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
	coreusage "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/usage"
)

type fakeClock struct{ now time.Time }

func (c *fakeClock) Now() time.Time { return c.now }

func newTestTracker(now time.Time) (*Tracker, *fakeClock) {
	clock := &fakeClock{now: now}
	tracker := NewTracker()
	tracker.nowFunc = clock.Now
	return tracker, clock
}

func TestCheckBlocksKeyAfterTokenLimit(t *testing.T) {
	tracker, _ := newTestTracker(time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC))
	tracker.Configure([]string{"sk-a"}, []config.APIKeyLimit{{APIKey: "sk-a", TokenLimit: 100, Period: "daily"}})

	if decision := tracker.Check("sk-a"); !decision.Allowed {
		t.Fatalf("fresh key should be allowed: %+v", decision)
	}
	tracker.Record("sk-a", 60, true)
	if decision := tracker.Check("sk-a"); !decision.Allowed {
		t.Fatalf("key under limit should be allowed: %+v", decision)
	}
	tracker.Record("sk-a", 40, true)
	decision := tracker.Check("sk-a")
	if decision.Allowed || decision.Status != http.StatusTooManyRequests || decision.Code != "api_key_token_limit_exceeded" {
		t.Fatalf("key at limit should be rejected with 429: %+v", decision)
	}
	if !strings.Contains(decision.Message, "2026-10-31T00:00:00Z") {
		t.Fatalf("message should include the reset time: %q", decision.Message)
	}
}

func TestPeriodRolloverResetsCounters(t *testing.T) {
	tracker, clock := newTestTracker(time.Date(2026, 10, 30, 23, 0, 0, 0, time.UTC))
	tracker.Configure([]string{"sk-a"}, []config.APIKeyLimit{{APIKey: "sk-a", TokenLimit: 10, Period: "daily"}})
	tracker.Record("sk-a", 10, true)
	if tracker.Check("sk-a").Allowed {
		t.Fatal("expected key to be over its daily limit")
	}
	clock.now = clock.now.Add(2 * time.Hour)
	if decision := tracker.Check("sk-a"); !decision.Allowed {
		t.Fatalf("expected new day to reset the limit: %+v", decision)
	}
	if status := tracker.Snapshot()[0]; status.TokensUsed != 0 || status.Requests != 0 {
		t.Fatalf("expected zero usage after rollover, got %+v", status)
	}
}

func TestPeriodBounds(t *testing.T) {
	now := time.Date(2026, 10, 30, 15, 4, 5, 0, time.UTC) // a Friday
	cases := []struct {
		period     string
		start, end time.Time
	}{
		{"daily", time.Date(2026, 10, 30, 0, 0, 0, 0, time.UTC), time.Date(2026, 10, 31, 0, 0, 0, 0, time.UTC)},
		{"weekly", time.Date(2026, 10, 26, 0, 0, 0, 0, time.UTC), time.Date(2026, 11, 2, 0, 0, 0, 0, time.UTC)},
		{"monthly", time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC), time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC)},
	}
	for _, tc := range cases {
		start, end := periodBounds(tc.period, now)
		if !start.Equal(tc.start) || !end.Equal(tc.end) {
			t.Errorf("%s: got %v-%v want %v-%v", tc.period, start, end, tc.start, tc.end)
		}
	}
	if start, end := periodBounds("total", now); !start.IsZero() || !end.IsZero() {
		t.Errorf("total should have no bounds, got %v-%v", start, end)
	}
}

func TestDisabledKeyIsRejected(t *testing.T) {
	tracker, _ := newTestTracker(time.Now())
	tracker.Configure([]string{"sk-a"}, []config.APIKeyLimit{{APIKey: "sk-a", Disabled: true}})
	decision := tracker.Check("sk-a")
	if decision.Allowed || decision.Status != http.StatusForbidden {
		t.Fatalf("disabled key should get 403: %+v", decision)
	}
	if !tracker.Check("sk-other").Allowed {
		t.Fatal("keys without limits must stay allowed")
	}
}

func TestUnlimitedKeysAreTrackedButAllowed(t *testing.T) {
	tracker, _ := newTestTracker(time.Now())
	tracker.Configure([]string{"sk-a", "sk-b"}, nil)
	tracker.Record("sk-a", 1_000_000, true)
	if !tracker.Check("sk-a").Allowed {
		t.Fatal("key without a limit should be allowed")
	}
	snapshot := tracker.Snapshot()
	if len(snapshot) != 2 || snapshot[0].APIKey != "sk-a" || snapshot[0].TokensUsed != 1_000_000 || snapshot[0].Requests != 1 {
		t.Fatalf("unexpected snapshot: %+v", snapshot)
	}
	if snapshot[1].TokensUsed != 0 || snapshot[1].Exceeded {
		t.Fatalf("unused key should report zero usage: %+v", snapshot[1])
	}
}

func TestResetClearsUsage(t *testing.T) {
	tracker, _ := newTestTracker(time.Now())
	tracker.Configure([]string{"sk-a"}, []config.APIKeyLimit{{APIKey: "sk-a", TokenLimit: 5, Period: "total"}})
	tracker.Record("sk-a", 5, true)
	if tracker.Check("sk-a").Allowed {
		t.Fatal("expected key to be over its total limit")
	}
	if !tracker.Reset("sk-a") {
		t.Fatal("reset should report existing usage")
	}
	if !tracker.Check("sk-a").Allowed {
		t.Fatal("reset key should be allowed again")
	}
}

func TestFlushPersistsUsageWithoutPlaintextKeys(t *testing.T) {
	path := filepath.Join(t.TempDir(), StoreFileName)
	now := time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC)
	tracker, _ := newTestTracker(now)
	tracker.SetStorePath(path)
	tracker.Configure([]string{"sk-secret"}, []config.APIKeyLimit{{APIKey: "sk-secret", TokenLimit: 100}})
	tracker.Record("sk-secret", 42, true)
	if errFlush := tracker.Flush(); errFlush != nil {
		t.Fatalf("flush: %v", errFlush)
	}
	data, errRead := os.ReadFile(path)
	if errRead != nil {
		t.Fatalf("read store: %v", errRead)
	}
	if strings.Contains(string(data), "sk-secret") {
		t.Fatal("usage store must not contain plaintext keys")
	}

	reloaded, _ := newTestTracker(now)
	reloaded.SetStorePath(path)
	reloaded.Configure([]string{"sk-secret"}, []config.APIKeyLimit{{APIKey: "sk-secret", TokenLimit: 100}})
	if got := reloaded.Snapshot()[0].TokensUsed; got != 42 {
		t.Fatalf("expected persisted usage 42, got %d", got)
	}
}

func TestUsagePluginCountsOnlyNativeKeys(t *testing.T) {
	tracker, _ := newTestTracker(time.Now())
	tracker.Configure([]string{"sk-a"}, nil)
	plugin := usagePlugin{tracker: tracker}
	plugin.HandleUsage(context.Background(), coreusage.Record{
		APIKey: "sk-a", IsNativeKey: true,
		Detail: coreusage.Detail{InputTokens: 7, OutputTokens: 3},
	})
	plugin.HandleUsage(context.Background(), coreusage.Record{
		APIKey: "sk-a", IsNativeKey: false,
		Detail: coreusage.Detail{TotalTokens: 1000},
	})
	if got := tracker.Snapshot()[0].TokensUsed; got != 10 {
		t.Fatalf("expected 10 tokens from the native record only, got %d", got)
	}
}

func TestRecordKeepsDailyHistoryAcrossPeriodRollover(t *testing.T) {
	tracker, clock := newTestTracker(time.Date(2026, 10, 29, 22, 0, 0, 0, time.UTC))
	tracker.Configure([]string{"sk-a"}, []config.APIKeyLimit{{APIKey: "sk-a", TokenLimit: 1000, Period: "daily"}})
	tracker.Record("sk-a", 100, true)
	tracker.Record("sk-a", 50, false)
	clock.now = clock.now.Add(4 * time.Hour) // 2026-10-30 02:00, a new daily period
	tracker.Record("sk-a", 7, true)

	if status := tracker.Snapshot()[0]; status.TokensUsed != 7 || status.Requests != 1 {
		t.Fatalf("period counter should only hold today's usage, got %+v", status)
	}
	history := tracker.History(3)
	if want := []string{"2026-10-28", "2026-10-29", "2026-10-30"}; !slices.Equal(history.Dates, want) {
		t.Fatalf("dates = %v, want %v", history.Dates, want)
	}
	entry := history.Keys[0]
	if !slices.Equal(entry.Tokens, []int64{0, 150, 7}) || !slices.Equal(entry.Requests, []int64{0, 1, 1}) {
		t.Fatalf("unexpected series: %+v", entry)
	}
	if entry.TotalTokens != 157 || entry.TotalRequests != 2 {
		t.Fatalf("unexpected totals: %+v", entry)
	}
}

func TestMonthlyRolloverKeepsDailyHistory(t *testing.T) {
	tracker, clock := newTestTracker(time.Date(2026, 10, 31, 12, 0, 0, 0, time.UTC))
	tracker.Configure([]string{"sk-a"}, nil) // monthly by default
	tracker.Record("sk-a", 40, true)
	clock.now = time.Date(2026, 11, 1, 9, 0, 0, 0, time.UTC)
	if status := tracker.Snapshot()[0]; status.TokensUsed != 0 {
		t.Fatalf("new month should start from zero, got %+v", status)
	}
	if entry := tracker.History(2).Keys[0]; !slices.Equal(entry.Tokens, []int64{40, 0}) {
		t.Fatalf("history must survive the monthly rollover, got %+v", entry)
	}
}

func TestResetKeepsDailyHistory(t *testing.T) {
	tracker, _ := newTestTracker(time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC))
	tracker.Configure([]string{"sk-a"}, []config.APIKeyLimit{{APIKey: "sk-a", TokenLimit: 10, Period: "total"}})
	tracker.Record("sk-a", 25, true)
	if !tracker.Reset("sk-a") {
		t.Fatal("reset should report existing usage")
	}
	status := tracker.Snapshot()[0]
	if status.TokensUsed != 0 || status.Requests != 0 || status.Exceeded {
		t.Fatalf("reset should zero the period counters, got %+v", status)
	}
	if status.LastUsed == nil {
		t.Fatal("reset should keep the last-used time")
	}
	if entry := tracker.History(1).Keys[0]; entry.TotalTokens != 25 || entry.TotalRequests != 1 {
		t.Fatalf("reset must keep the daily history, got %+v", entry)
	}
	if tracker.Reset("sk-unused") {
		t.Fatal("reset of a key without usage should report false")
	}
}

func TestRecordPrunesDaysOutsideRetention(t *testing.T) {
	start := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	tracker, clock := newTestTracker(start)
	tracker.Configure([]string{"sk-a"}, nil)
	tracker.Record("sk-a", 1, true)
	clock.now = start.AddDate(0, 0, HistoryRetentionDays-1) // the first day is still the oldest kept
	tracker.Record("sk-a", 2, true)
	days := tracker.usage[hashKey("sk-a")].Days
	if _, ok := days["2026-01-01"]; !ok || len(days) != 2 {
		t.Fatalf("day inside retention was pruned: %v", days)
	}
	clock.now = start.AddDate(0, 0, HistoryRetentionDays)
	tracker.Record("sk-a", 3, true)
	if _, ok := days["2026-01-01"]; ok || len(days) != 2 {
		t.Fatalf("day older than %d days should be pruned: %v", HistoryRetentionDays, days)
	}
}

func TestHistoryZeroFillsInSnapshotOrderAndClampsDays(t *testing.T) {
	tracker, clock := newTestTracker(time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC))
	tracker.Configure([]string{"sk-b", "sk-a"}, []config.APIKeyLimit{
		{APIKey: "sk-a", Name: "Laptop"},
		{APIKey: "sk-stale", Name: "Old"},
	})
	tracker.Record("sk-a", 9, true)
	clock.now = clock.now.AddDate(0, 0, 2)

	history := tracker.History(3)
	snapshot := tracker.Snapshot()
	if len(history.Keys) != len(snapshot) {
		t.Fatalf("history keys %d, snapshot keys %d", len(history.Keys), len(snapshot))
	}
	for i, status := range snapshot {
		if history.Keys[i].APIKey != status.APIKey {
			t.Fatalf("history order differs from snapshot at %d: %s vs %s", i, history.Keys[i].APIKey, status.APIKey)
		}
	}
	if entry := history.Keys[0]; entry.APIKey != "sk-b" || !slices.Equal(entry.Tokens, []int64{0, 0, 0}) || !slices.Equal(entry.Requests, []int64{0, 0, 0}) {
		t.Fatalf("unused key should be zero-filled: %+v", entry)
	}
	if entry := history.Keys[1]; entry.Name != "Laptop" || !slices.Equal(entry.Tokens, []int64{9, 0, 0}) || entry.TotalTokens != 9 {
		t.Fatalf("unexpected series for sk-a: %+v", entry)
	}
	if entry := history.Keys[2]; entry.APIKey != "sk-stale" || entry.TotalTokens != 0 {
		t.Fatalf("limit-only key should be reported last: %+v", entry)
	}
	if got := len(tracker.History(0).Dates); got != 1 {
		t.Fatalf("days below 1 should clamp to 1, got %d", got)
	}
	if got := tracker.History(1000).Dates; len(got) != HistoryRetentionDays || got[len(got)-1] != "2026-10-30" {
		t.Fatalf("days above retention should clamp to %d ending today, got %d", HistoryRetentionDays, len(got))
	}
}

func TestSetStorePathLoadsStoreWithoutDailyHistory(t *testing.T) {
	path := filepath.Join(t.TempDir(), StoreFileName)
	legacy := `{"` + hashKey("sk-a") + `": {"period": "monthly", "period_start": "2026-10-01T00:00:00Z", "tokens": 70, "requests": 3}}`
	if errWrite := os.WriteFile(path, []byte(legacy), 0o600); errWrite != nil {
		t.Fatalf("write legacy store: %v", errWrite)
	}
	now := time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC)
	tracker, _ := newTestTracker(now)
	tracker.SetStorePath(path)
	tracker.Configure([]string{"sk-a"}, nil)
	if status := tracker.Snapshot()[0]; status.TokensUsed != 70 || status.Requests != 3 {
		t.Fatalf("legacy counters should load, got %+v", status)
	}
	if entry := tracker.History(30).Keys[0]; entry.TotalTokens != 0 {
		t.Fatalf("legacy store has no history, got %+v", entry)
	}

	tracker.Record("sk-a", 5, true)
	if errFlush := tracker.Flush(); errFlush != nil {
		t.Fatalf("flush: %v", errFlush)
	}
	reloaded, _ := newTestTracker(now)
	reloaded.SetStorePath(path)
	reloaded.Configure([]string{"sk-a"}, nil)
	if status := reloaded.Snapshot()[0]; status.TokensUsed != 75 {
		t.Fatalf("expected 75 tokens after reload, got %+v", status)
	}
	if entry := reloaded.History(1).Keys[0]; !slices.Equal(entry.Tokens, []int64{5}) || !slices.Equal(entry.Requests, []int64{1}) {
		t.Fatalf("daily history should persist, got %+v", entry)
	}
}
