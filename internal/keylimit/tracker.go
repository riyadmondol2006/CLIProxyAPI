// Package keylimit tracks token usage per client API key and enforces the
// optional budgets configured under access.key-limits.
package keylimit

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/util"
	log "github.com/sirupsen/logrus"
)

// StoreFileName is the file, next to the config, that persists per-key counters.
const StoreFileName = "key-usage.json"

const flushInterval = 15 * time.Second

// HistoryRetentionDays is how many local days of per-key usage are kept, today included.
const HistoryRetentionDays = 90

// dayLayout formats the local date that keys the daily usage history.
const dayLayout = "2006-01-02"

// Usage is the persisted counter for one client key in its current period,
// plus its daily history. Period rollover and Reset leave Days untouched.
type Usage struct {
	Period      string    `json:"period"`
	PeriodStart time.Time `json:"period_start"`
	Tokens      int64     `json:"tokens"`
	Requests    int64     `json:"requests"`
	LastUsed    time.Time `json:"last_used,omitempty"`
	// Days maps a local date (2006-01-02) to the usage recorded on that day.
	Days map[string]DayUsage `json:"days,omitempty"`
}

// DayUsage is the usage of one client key on one local day.
type DayUsage struct {
	Tokens   int64 `json:"tokens"`
	Requests int64 `json:"requests"`
}

// Status is the management view of one configured client key.
type Status struct {
	APIKey      string     `json:"api-key"`
	Name        string     `json:"name,omitempty"`
	Disabled    bool       `json:"disabled"`
	Period      string     `json:"period"`
	TokenLimit  int64      `json:"token-limit"`
	TokensUsed  int64      `json:"tokens-used"`
	Requests    int64      `json:"requests"`
	PeriodStart *time.Time `json:"period-start,omitempty"`
	PeriodEnd   *time.Time `json:"period-end,omitempty"`
	LastUsed    *time.Time `json:"last-used,omitempty"`
	Exceeded    bool       `json:"exceeded"`
}

// History is the daily usage of every configured client key over the last N days.
type History struct {
	// Dates lists the local days covered, oldest first. Every series has one entry per date.
	Dates []string     `json:"dates"`
	Keys  []KeyHistory `json:"keys"`
}

// KeyHistory is one client key's daily series and its totals over the History dates.
type KeyHistory struct {
	APIKey        string  `json:"api-key"`
	Name          string  `json:"name,omitempty"`
	Tokens        []int64 `json:"tokens"`
	Requests      []int64 `json:"requests"`
	TotalTokens   int64   `json:"total-tokens"`
	TotalRequests int64   `json:"total-requests"`
}

// Decision is the result of checking a key before a request is served.
type Decision struct {
	Allowed bool
	Status  int
	Type    string
	Code    string
	Message string
}

var allowed = Decision{Allowed: true}

// Tracker holds limits and counters. All methods are safe for concurrent use.
type Tracker struct {
	mu      sync.Mutex
	keys    []string
	limits  map[string]config.APIKeyLimit
	usage   map[string]*Usage // keyed by hashKey(apiKey)
	path    string
	dirty   bool
	nowFunc func() time.Time

	startOnce sync.Once
}

// NewTracker returns an empty tracker.
func NewTracker() *Tracker {
	return &Tracker{
		limits:  make(map[string]config.APIKeyLimit),
		usage:   make(map[string]*Usage),
		nowFunc: time.Now,
	}
}

var defaultTracker = NewTracker()

// Default returns the process-wide tracker used by the HTTP server.
func Default() *Tracker { return defaultTracker }

func hashKey(apiKey string) string {
	sum := sha256.Sum256([]byte(apiKey))
	return hex.EncodeToString(sum[:])
}

// Configure replaces the known client keys and their limits.
func (t *Tracker) Configure(apiKeys []string, limits []config.APIKeyLimit) {
	next := make(map[string]config.APIKeyLimit, len(limits))
	for _, limit := range limits {
		key := strings.TrimSpace(limit.APIKey)
		if key == "" {
			continue
		}
		limit.APIKey = key
		next[key] = limit
	}
	keys := make([]string, 0, len(apiKeys))
	seen := make(map[string]bool, len(apiKeys))
	for _, key := range apiKeys {
		key = strings.TrimSpace(key)
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		keys = append(keys, key)
	}
	t.mu.Lock()
	t.keys = keys
	t.limits = next
	t.mu.Unlock()
}

// SetStorePath loads persisted counters from path and remembers it for flushing.
func (t *Tracker) SetStorePath(path string) {
	path = strings.TrimSpace(path)
	t.mu.Lock()
	defer t.mu.Unlock()
	if path == t.path {
		return
	}
	t.path = path
	if path == "" {
		return
	}
	data, errRead := os.ReadFile(path)
	if errRead != nil {
		if !errors.Is(errRead, os.ErrNotExist) {
			log.WithError(errRead).Warn("key limits: failed to read usage store")
		}
		return
	}
	loaded := make(map[string]*Usage)
	if errDecode := json.Unmarshal(data, &loaded); errDecode != nil {
		log.WithError(errDecode).Warn("key limits: ignoring unreadable usage store")
		return
	}
	for hash, usage := range loaded {
		if usage != nil {
			t.usage[hash] = usage
		}
	}
}

// Start flushes counters to disk periodically until ctx ends, then flushes once more.
func (t *Tracker) Start(ctx context.Context) {
	if ctx == nil {
		ctx = context.Background()
	}
	t.startOnce.Do(func() {
		go func() {
			ticker := time.NewTicker(flushInterval)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					if errFlush := t.Flush(); errFlush != nil {
						log.WithError(errFlush).Warn("key limits: final usage flush failed")
					}
					return
				case <-ticker.C:
					if errFlush := t.Flush(); errFlush != nil {
						log.WithError(errFlush).Warn("key limits: usage flush failed")
					}
				}
			}
		}()
	})
}

// periodBounds returns the start and end of the period containing now.
// The total period has no bounds and returns zero times.
func periodBounds(period string, now time.Time) (time.Time, time.Time) {
	y, m, d := now.Date()
	loc := now.Location()
	switch period {
	case config.APIKeyLimitPeriodDaily:
		start := time.Date(y, m, d, 0, 0, 0, 0, loc)
		return start, start.AddDate(0, 0, 1)
	case config.APIKeyLimitPeriodWeekly:
		offset := (int(now.Weekday()) + 6) % 7 // weeks start on Monday
		start := time.Date(y, m, d-offset, 0, 0, 0, 0, loc)
		return start, start.AddDate(0, 0, 7)
	case config.APIKeyLimitPeriodMonthly:
		start := time.Date(y, m, 1, 0, 0, 0, 0, loc)
		return start, start.AddDate(0, 1, 0)
	default:
		return time.Time{}, time.Time{}
	}
}

func (t *Tracker) periodFor(apiKey string) string {
	if limit, ok := t.limits[apiKey]; ok {
		return limit.NormalizedPeriod()
	}
	return config.APIKeyLimitPeriodMonthly
}

// currentLocked returns the counter for apiKey, rolling it over when its period ended.
// The caller must hold t.mu. It returns nil when create is false and no counter exists.
func (t *Tracker) currentLocked(apiKey string, create bool) *Usage {
	hash := hashKey(apiKey)
	period := t.periodFor(apiKey)
	start, _ := periodBounds(period, t.nowFunc())
	usage := t.usage[hash]
	if usage == nil {
		if !create {
			return nil
		}
		usage = &Usage{Period: period, PeriodStart: start}
		t.usage[hash] = usage
		t.dirty = true
		return usage
	}
	if usage.Period != period || !usage.PeriodStart.Equal(start) {
		usage.Period = period
		usage.PeriodStart = start
		usage.Tokens = 0
		usage.Requests = 0
		t.dirty = true
	}
	return usage
}

// Check reports whether a request authenticated with apiKey may proceed.
func (t *Tracker) Check(apiKey string) Decision {
	apiKey = strings.TrimSpace(apiKey)
	if t == nil || apiKey == "" {
		return allowed
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	limit, ok := t.limits[apiKey]
	if !ok {
		return allowed
	}
	if limit.Disabled {
		return Decision{
			Status:  http.StatusForbidden,
			Type:    "permission_error",
			Code:    "api_key_disabled",
			Message: "This API key has been disabled by the proxy owner.",
		}
	}
	if limit.TokenLimit <= 0 {
		return allowed
	}
	usage := t.currentLocked(apiKey, false)
	if usage == nil || usage.Tokens < limit.TokenLimit {
		return allowed
	}
	message := fmt.Sprintf("This API key reached its token limit (%d tokens).", limit.TokenLimit)
	if period := limit.NormalizedPeriod(); period != config.APIKeyLimitPeriodTotal {
		_, end := periodBounds(period, t.nowFunc())
		message = fmt.Sprintf("This API key reached its %s token limit (%d tokens). It resets at %s.",
			period, limit.TokenLimit, end.Format(time.RFC3339))
	}
	return Decision{
		Status:  http.StatusTooManyRequests,
		Type:    "insufficient_quota",
		Code:    "api_key_token_limit_exceeded",
		Message: message,
	}
}

// Record adds tokens used by one upstream attempt. Successful attempts also count as requests.
func (t *Tracker) Record(apiKey string, tokens int64, success bool) {
	apiKey = strings.TrimSpace(apiKey)
	if t == nil || apiKey == "" || (tokens <= 0 && !success) {
		return
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	usage := t.currentLocked(apiKey, true)
	var requests int64
	if success {
		requests = 1
	}
	tokens = max(tokens, 0)
	usage.Tokens += tokens
	usage.Requests += requests

	now := t.nowFunc()
	today := now.Format(dayLayout)
	if usage.Days == nil {
		usage.Days = make(map[string]DayUsage)
	}
	day, seen := usage.Days[today]
	day.Tokens += tokens
	day.Requests += requests
	usage.Days[today] = day
	if !seen {
		pruneDays(usage.Days, now)
	}
	usage.LastUsed = now
	t.dirty = true
}

// localDay returns the local date offset days from now's date, formatted as dayLayout.
func localDay(now time.Time, offset int) string {
	y, m, d := now.Date()
	return time.Date(y, m, d+offset, 0, 0, 0, 0, now.Location()).Format(dayLayout)
}

// pruneDays drops days older than the HistoryRetentionDays ending today.
func pruneDays(days map[string]DayUsage, now time.Time) {
	oldest := localDay(now, 1-HistoryRetentionDays)
	for day := range days {
		// Same-length ISO dates sort lexically, so string order is date order.
		if day < oldest {
			delete(days, day)
		}
	}
}

// Reset clears the current-period counters for apiKey. The daily history is kept.
func (t *Tracker) Reset(apiKey string) bool {
	apiKey = strings.TrimSpace(apiKey)
	if t == nil || apiKey == "" {
		return false
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	usage := t.currentLocked(apiKey, false)
	if usage == nil {
		return false
	}
	usage.Tokens = 0
	usage.Requests = 0
	t.dirty = true
	return true
}

// reportedKeysLocked returns the configured keys in config order, then keys that only
// have limits, sorted. The caller must hold t.mu.
func (t *Tracker) reportedKeysLocked() []string {
	keys := append([]string(nil), t.keys...)
	known := make(map[string]bool, len(keys))
	for _, key := range keys {
		known[key] = true
	}
	// Limits for keys missing from api-keys are still reported so they can be cleaned up.
	var extra []string
	for key := range t.limits {
		if !known[key] {
			extra = append(extra, key)
		}
	}
	sort.Strings(extra)
	return append(keys, extra...)
}

// History returns zero-filled daily usage for the last days local days (oldest first,
// today last) for the keys Snapshot reports, in the same order. days is clamped to
// 1..HistoryRetentionDays.
func (t *Tracker) History(days int) History {
	days = min(max(days, 1), HistoryRetentionDays)
	if t == nil {
		return History{Dates: []string{}, Keys: []KeyHistory{}}
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	now := t.nowFunc()
	dates := make([]string, days)
	for i := range dates {
		dates[i] = localDay(now, i-days+1)
	}
	keys := t.reportedKeysLocked()
	out := History{Dates: dates, Keys: make([]KeyHistory, 0, len(keys))}
	for _, key := range keys {
		entry := KeyHistory{
			APIKey:   key,
			Name:     t.limits[key].Name,
			Tokens:   make([]int64, days),
			Requests: make([]int64, days),
		}
		if usage := t.usage[hashKey(key)]; usage != nil {
			for i, date := range dates {
				day := usage.Days[date]
				entry.Tokens[i] = day.Tokens
				entry.Requests[i] = day.Requests
				entry.TotalTokens += day.Tokens
				entry.TotalRequests += day.Requests
			}
		}
		out.Keys = append(out.Keys, entry)
	}
	return out
}

// Snapshot returns the status of every configured client key, in config order.
func (t *Tracker) Snapshot() []Status {
	if t == nil {
		return nil
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	keys := t.reportedKeysLocked()

	now := t.nowFunc()
	out := make([]Status, 0, len(keys))
	for _, key := range keys {
		limit := t.limits[key]
		period := t.periodFor(key)
		status := Status{
			APIKey:     key,
			Name:       limit.Name,
			Disabled:   limit.Disabled,
			Period:     period,
			TokenLimit: max(limit.TokenLimit, 0),
		}
		if start, end := periodBounds(period, now); !start.IsZero() {
			status.PeriodStart = &start
			status.PeriodEnd = &end
		}
		if usage := t.currentLocked(key, false); usage != nil {
			status.TokensUsed = usage.Tokens
			status.Requests = usage.Requests
			if !usage.LastUsed.IsZero() {
				lastUsed := usage.LastUsed
				status.LastUsed = &lastUsed
			}
		}
		status.Exceeded = status.TokenLimit > 0 && status.TokensUsed >= status.TokenLimit
		out = append(out, status)
	}
	return out
}

// Flush writes counters to the store file when they changed.
func (t *Tracker) Flush() error {
	if t == nil {
		return nil
	}
	t.mu.Lock()
	if !t.dirty || t.path == "" {
		t.mu.Unlock()
		return nil
	}
	data, errEncode := json.MarshalIndent(t.usage, "", "  ")
	path := t.path
	t.dirty = false
	t.mu.Unlock()
	if errEncode != nil {
		return fmt.Errorf("encode key usage: %w", errEncode)
	}

	markDirty := func() {
		t.mu.Lock()
		t.dirty = true
		t.mu.Unlock()
	}
	if errMkdir := os.MkdirAll(filepath.Dir(path), 0o700); errMkdir != nil {
		markDirty()
		return fmt.Errorf("create key usage directory: %w", errMkdir)
	}
	tmp := path + ".tmp"
	if errWrite := os.WriteFile(tmp, data, 0o600); errWrite != nil {
		markDirty()
		return fmt.Errorf("write key usage: %w", errWrite)
	}
	if errRename := os.Rename(tmp, path); errRename != nil {
		markDirty()
		return fmt.Errorf("replace key usage: %w", errRename)
	}
	return nil
}

// StorePath returns where counters are persisted: WRITABLE_PATH when set, else next to the config file.
func StorePath(configFilePath string) string {
	if writable := util.WritablePath(); writable != "" {
		return filepath.Join(writable, StoreFileName)
	}
	configFilePath = strings.TrimSpace(configFilePath)
	if configFilePath == "" {
		return ""
	}
	if info, errStat := os.Stat(configFilePath); errStat == nil && info.IsDir() {
		return filepath.Join(configFilePath, StoreFileName)
	}
	return filepath.Join(filepath.Dir(configFilePath), StoreFileName)
}
