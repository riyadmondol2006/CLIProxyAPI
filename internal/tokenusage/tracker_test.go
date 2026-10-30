package tokenusage

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"testing"
	"time"

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

func codexRecord(apiKey string, native bool, detail coreusage.Detail) coreusage.Record {
	return coreusage.Record{
		Provider:    "codex",
		AuthID:      "codex-user.json",
		AuthIndex:   "idx-1",
		Model:       "gpt-5-codex",
		APIKey:      apiKey,
		IsNativeKey: native,
		Detail:      detail,
	}
}

func TestRecordAggregatesPerDayAndKey(t *testing.T) {
	tracker, clock := newTestTracker(time.Date(2026, 10, 29, 22, 0, 0, 0, time.UTC))
	tracker.Record(codexRecord("sk-a", true, coreusage.Detail{InputTokens: 90, OutputTokens: 10, TotalTokens: 120}))
	failed := codexRecord("sk-a", true, coreusage.Detail{InputTokens: 5, OutputTokens: 1})
	failed.Failed = true
	tracker.Record(failed)
	clock.now = clock.now.Add(4 * time.Hour) // 2026-10-30 02:00
	tracker.Record(codexRecord("sk-a", true, coreusage.Detail{InputTokens: 7, OutputTokens: 3}))
	// Same credential and model through a non-native key lands in its own bucket.
	tracker.Record(codexRecord("sk-a", false, coreusage.Detail{TotalTokens: 50}))

	report := tracker.Report(3)
	if want := []string{"2026-10-28", "2026-10-29", "2026-10-30"}; !slices.Equal(report.Dates, want) {
		t.Fatalf("dates = %v, want %v", report.Dates, want)
	}
	if len(report.Rows) != 2 {
		t.Fatalf("expected 2 rows, got %+v", report.Rows)
	}
	var native, other Row
	for _, row := range report.Rows {
		if row.Client == "" {
			other = row
		} else {
			native = row
		}
	}
	if native.Client != ClientHash("sk-a") || native.Provider != "codex" || native.Model != "gpt-5-codex" || native.AuthID != "codex-user.json" || native.AuthIndex != "idx-1" {
		t.Fatalf("unexpected native key: %+v", native.Key)
	}
	// Day one: 120 (total wins over input+output) + 6 (derived); day two: 10.
	if !slices.Equal(native.Tokens, []int64{0, 126, 10}) {
		t.Fatalf("tokens = %v", native.Tokens)
	}
	if !slices.Equal(native.Input, []int64{0, 95, 7}) || !slices.Equal(native.Output, []int64{0, 11, 3}) {
		t.Fatalf("input = %v output = %v", native.Input, native.Output)
	}
	if !slices.Equal(native.Requests, []int64{0, 2, 1}) || !slices.Equal(native.Failed, []int64{0, 1, 0}) {
		t.Fatalf("requests = %v failed = %v", native.Requests, native.Failed)
	}
	if !slices.Equal(other.Tokens, []int64{0, 0, 50}) || !slices.Equal(other.Requests, []int64{0, 0, 1}) {
		t.Fatalf("non-native row = %+v", other)
	}
}

func TestRecordNormalizesKeyAndCounts(t *testing.T) {
	tracker, _ := newTestTracker(time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC))
	tracker.Record(coreusage.Record{Provider: "  ", Model: "", Detail: coreusage.Detail{InputTokens: -5, OutputTokens: 2}})
	tracker.Record(coreusage.Record{Provider: " Codex ", Model: " gpt-5 ", APIKey: "  ", IsNativeKey: true})

	report := tracker.Report(1)
	if len(report.Rows) != 2 {
		t.Fatalf("expected 2 rows, got %+v", report.Rows)
	}
	codex, unknown := report.Rows[0], report.Rows[1] // ordered by provider
	if codex.Provider != "codex" || codex.Model != "gpt-5" || codex.Client != "" {
		t.Fatalf("unexpected normalized key: %+v", codex.Key)
	}
	if unknown.Provider != "unknown" || unknown.Model != "unknown" {
		t.Fatalf("empty provider and model should become unknown: %+v", unknown.Key)
	}
	if unknown.Tokens[0] != 0 || unknown.Input[0] != 0 || unknown.Output[0] != 2 {
		t.Fatalf("counts must never be negative: %+v", unknown)
	}
	if codex.Requests[0] != 1 || codex.Tokens[0] != 0 {
		t.Fatalf("an attempt without tokens still counts as a request: %+v", codex)
	}
}

func TestRecordPrunesDaysOutsideRetention(t *testing.T) {
	start := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)
	tracker, clock := newTestTracker(start)
	tracker.Record(codexRecord("", false, coreusage.Detail{TotalTokens: 1}))
	tracker.Record(coreusage.Record{Provider: "claude", Model: "sonnet", Detail: coreusage.Detail{TotalTokens: 1}})

	clock.now = start.AddDate(0, 0, RetentionDays-1) // the first day is still the oldest kept
	tracker.Record(codexRecord("", false, coreusage.Detail{TotalTokens: 2}))
	codexKey := recordKey(codexRecord("", false, coreusage.Detail{}))
	if days := tracker.series[codexKey]; len(days) != 2 {
		t.Fatalf("day inside retention was pruned: %v", days)
	}

	clock.now = start.AddDate(0, 0, RetentionDays)
	tracker.Record(codexRecord("", false, coreusage.Detail{TotalTokens: 3}))
	if _, ok := tracker.series[codexKey]["2026-01-01"]; ok {
		t.Fatalf("day older than %d days should be pruned: %v", RetentionDays, tracker.series[codexKey])
	}
	if len(tracker.series) != 1 {
		t.Fatalf("keys without days in retention should be dropped: %v", tracker.series)
	}
}

func TestReportClampsDaysAndOmitsInactiveKeys(t *testing.T) {
	tracker, clock := newTestTracker(time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC))
	tracker.Record(codexRecord("", false, coreusage.Detail{TotalTokens: 9}))
	clock.now = time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC)

	if rows := tracker.Report(7).Rows; len(rows) != 0 {
		t.Fatalf("keys without activity in the window must be left out: %+v", rows)
	}
	if rows := tracker.Report(30).Rows; len(rows) != 1 || rows[0].Tokens[0] != 9 {
		t.Fatalf("expected the old day at the start of a 30-day window: %+v", rows)
	}
	if got := len(tracker.Report(0).Dates); got != 1 {
		t.Fatalf("days below 1 should clamp to 1, got %d", got)
	}
	dates := tracker.Report(1000).Dates
	if len(dates) != RetentionDays || dates[len(dates)-1] != "2026-10-30" {
		t.Fatalf("days above retention should clamp to %d ending today, got %d ending %s", RetentionDays, len(dates), dates[len(dates)-1])
	}
	var empty *Tracker
	if report := empty.Report(5); report.Dates == nil || report.Rows == nil {
		t.Fatalf("nil tracker should return empty slices: %+v", report)
	}
}

func TestFlushRoundTripsWithoutPlaintextClientKeys(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, StoreFileName)
	now := time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC)
	tracker, _ := newTestTracker(now)
	tracker.SetStorePath(path)
	tracker.Record(codexRecord("sk-very-secret-client-key", true, coreusage.Detail{InputTokens: 30, OutputTokens: 12}))
	tracker.Record(codexRecord("sk-other-not-native", false, coreusage.Detail{TotalTokens: 5}))
	if errFlush := tracker.Flush(); errFlush != nil {
		t.Fatalf("flush: %v", errFlush)
	}

	data, errRead := os.ReadFile(path)
	if errRead != nil {
		t.Fatalf("read store: %v", errRead)
	}
	if strings.Contains(string(data), "sk-very-secret-client-key") || strings.Contains(string(data), "sk-other-not-native") {
		t.Fatalf("store must not contain plaintext client keys: %s", data)
	}
	if !strings.Contains(string(data), ClientHash("sk-very-secret-client-key")) {
		t.Fatalf("store should identify the native key by its hash: %s", data)
	}
	if runtime.GOOS != "windows" {
		info, errStat := os.Stat(path)
		if errStat != nil {
			t.Fatalf("stat store: %v", errStat)
		}
		if mode := info.Mode().Perm(); mode != 0o600 {
			t.Fatalf("store mode = %o, want 600", mode)
		}
	}

	reloaded, _ := newTestTracker(now)
	reloaded.SetStorePath(path)
	if got, want := reloaded.Report(1), tracker.Report(1); !reportsEqual(got, want) {
		t.Fatalf("reloaded report = %+v, want %+v", got, want)
	}
}

func TestFlushReplacesStoreAtomically(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, StoreFileName)
	if errWrite := os.WriteFile(path, []byte(strings.Repeat("x", 4096)), 0o644); errWrite != nil {
		t.Fatalf("seed store: %v", errWrite)
	}
	tracker, _ := newTestTracker(time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC))
	tracker.SetStorePath(path) // unreadable content is ignored, then replaced
	tracker.Record(codexRecord("", false, coreusage.Detail{TotalTokens: 1}))
	if errFlush := tracker.Flush(); errFlush != nil {
		t.Fatalf("flush: %v", errFlush)
	}

	entries, errList := os.ReadDir(dir)
	if errList != nil {
		t.Fatalf("list dir: %v", errList)
	}
	if len(entries) != 1 || entries[0].Name() != StoreFileName {
		names := make([]string, 0, len(entries))
		for _, entry := range entries {
			names = append(names, entry.Name())
		}
		t.Fatalf("flush must leave only the store file, got %v", names)
	}
	data, errRead := os.ReadFile(path)
	if errRead != nil {
		t.Fatalf("read store: %v", errRead)
	}
	var stored storeFile
	if errDecode := json.Unmarshal(data, &stored); errDecode != nil {
		t.Fatalf("store must be a complete JSON document: %v (%s)", errDecode, data)
	}
	if stored.Version != storeVersion || len(stored.Series) != 1 {
		t.Fatalf("unexpected store: %+v", stored)
	}
	if runtime.GOOS != "windows" {
		if info, errStat := os.Stat(path); errStat != nil || info.Mode().Perm() != 0o600 {
			t.Fatalf("replaced store must be 0600: %v %v", info, errStat)
		}
	}

	// A clean tracker does not rewrite the file.
	if errRemove := os.Remove(path); errRemove != nil {
		t.Fatalf("remove store: %v", errRemove)
	}
	if errFlush := tracker.Flush(); errFlush != nil {
		t.Fatalf("second flush: %v", errFlush)
	}
	if _, errStat := os.Stat(path); !os.IsNotExist(errStat) {
		t.Fatalf("flush without changes should not write, stat err = %v", errStat)
	}
}

func TestSetStorePathHandlesMissingAndOldStores(t *testing.T) {
	dir := t.TempDir()
	now := time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC)

	missing, _ := newTestTracker(now)
	missing.SetStorePath(filepath.Join(dir, "missing", StoreFileName))
	if rows := missing.Report(RetentionDays).Rows; len(rows) != 0 {
		t.Fatalf("missing store should start empty: %+v", rows)
	}
	if errFlush := missing.Flush(); errFlush != nil {
		t.Fatalf("flush of an empty tracker: %v", errFlush)
	}

	path := filepath.Join(dir, StoreFileName)
	old := `{"version": 1, "series": [
		{"provider": "codex", "auth-id": "a.json", "auth-index": "i", "model": "m", "client": "",
		 "days": {"2026-01-01": {"tokens": 100, "requests": 1}, "2026-10-29": {"tokens": 7, "input": 5, "output": 2, "requests": 2, "failed": 1}, "not-a-day": {"tokens": 1}}},
		{"provider": "claude", "auth-id": "b", "auth-index": "j", "model": "n", "client": "",
		 "days": {"2025-12-31": {"tokens": 50, "requests": 1}}}
	]}`
	if errWrite := os.WriteFile(path, []byte(old), 0o600); errWrite != nil {
		t.Fatalf("write old store: %v", errWrite)
	}
	tracker, _ := newTestTracker(now)
	tracker.SetStorePath(path)
	if len(tracker.series) != 1 {
		t.Fatalf("keys with only expired days should be dropped on load: %v", tracker.series)
	}
	for _, days := range tracker.series {
		if len(days) != 1 {
			t.Fatalf("expired and invalid days should be dropped on load: %v", days)
		}
	}
	rows := tracker.Report(2).Rows
	if len(rows) != 1 || !slices.Equal(rows[0].Tokens, []int64{7, 0}) || !slices.Equal(rows[0].Failed, []int64{1, 0}) {
		t.Fatalf("unexpected rows from the old store: %+v", rows)
	}
	// Pruning on load marks the store dirty so the file drops the expired days.
	if errFlush := tracker.Flush(); errFlush != nil {
		t.Fatalf("flush: %v", errFlush)
	}
	data, errRead := os.ReadFile(path)
	if errRead != nil {
		t.Fatalf("read store: %v", errRead)
	}
	if strings.Contains(string(data), "2026-01-01") || strings.Contains(string(data), "claude") {
		t.Fatalf("expired days should be gone from the rewritten store: %s", data)
	}

	future := filepath.Join(dir, "future.json")
	if errWrite := os.WriteFile(future, []byte(`{"version": 99, "series": []}`), 0o600); errWrite != nil {
		t.Fatalf("write future store: %v", errWrite)
	}
	newer, _ := newTestTracker(now)
	newer.SetStorePath(future)
	if rows := newer.Report(1).Rows; len(rows) != 0 {
		t.Fatalf("a store from a newer version should be ignored: %+v", rows)
	}
}

func TestUsagePluginRecordsEveryAttempt(t *testing.T) {
	tracker, _ := newTestTracker(time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC))
	plugin := usagePlugin{tracker: tracker}
	plugin.HandleUsage(context.Background(), codexRecord("sk-a", true, coreusage.Detail{TotalTokens: 10}))
	failed := codexRecord("sk-a", true, coreusage.Detail{})
	failed.Failed = true
	plugin.HandleUsage(context.Background(), failed)
	usagePlugin{}.HandleUsage(context.Background(), failed) // nil tracker is a no-op

	rows := tracker.Report(1).Rows
	if len(rows) != 1 || rows[0].Requests[0] != 2 || rows[0].Failed[0] != 1 || rows[0].Tokens[0] != 10 {
		t.Fatalf("unexpected rows: %+v", rows)
	}
}

func TestStorePathUsesConfigDirectory(t *testing.T) {
	t.Setenv("WRITABLE_PATH", "")
	t.Setenv("writable_path", "")
	dir := t.TempDir()
	if got, want := StorePath(filepath.Join(dir, "config.yaml")), filepath.Join(dir, StoreFileName); got != want {
		t.Fatalf("StorePath(file) = %q, want %q", got, want)
	}
	if got, want := StorePath(dir), filepath.Join(dir, StoreFileName); got != want {
		t.Fatalf("StorePath(dir) = %q, want %q", got, want)
	}
	if got := StorePath(" "); got != "" {
		t.Fatalf("StorePath(empty) = %q, want empty", got)
	}
}

func reportsEqual(a, b Report) bool {
	if !slices.Equal(a.Dates, b.Dates) || len(a.Rows) != len(b.Rows) {
		return false
	}
	for i := range a.Rows {
		x, y := a.Rows[i], b.Rows[i]
		if x.Key != y.Key || !slices.Equal(x.Tokens, y.Tokens) || !slices.Equal(x.Input, y.Input) ||
			!slices.Equal(x.Output, y.Output) || !slices.Equal(x.Requests, y.Requests) || !slices.Equal(x.Failed, y.Failed) {
			return false
		}
	}
	return true
}
