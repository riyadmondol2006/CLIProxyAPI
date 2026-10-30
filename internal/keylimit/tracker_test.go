package keylimit

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
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
