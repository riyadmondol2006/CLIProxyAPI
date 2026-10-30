// Package tokenusage keeps a daily history of the tokens every upstream attempt used,
// broken down by provider, credential, model, and client API key.
package tokenusage

import (
	"cmp"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/router-for-me/CLIProxyAPI/v8/internal/util"
	coreusage "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/usage"
	log "github.com/sirupsen/logrus"
)

// StoreFileName is the file, next to the config, that persists the daily token usage.
const StoreFileName = "token-usage.json"

// RetentionDays is how many local days of token usage are kept, today included.
const RetentionDays = 90

const flushInterval = 15 * time.Second

// dayLayout formats the local date that keys the daily history.
const dayLayout = "2006-01-02"

// unknownValue replaces an empty provider or model.
const unknownValue = "unknown"

// storeVersion is the version of the persisted file layout.
const storeVersion = 1

// Key identifies one aggregate. Client is the SHA-256 hex of the client API key
// for native (config) keys and empty otherwise; raw client keys are never stored.
type Key struct {
	Provider  string `json:"provider"`
	AuthID    string `json:"auth-id"`
	AuthIndex string `json:"auth-index"`
	Model     string `json:"model"`
	Client    string `json:"client"`
}

// Counts is the usage recorded for one Key on one local day.
type Counts struct {
	Tokens   int64 `json:"tokens"`
	Input    int64 `json:"input"`
	Output   int64 `json:"output"`
	Requests int64 `json:"requests"`
	Failed   int64 `json:"failed"`
}

func (c *Counts) add(other Counts) {
	c.Tokens += other.Tokens
	c.Input += other.Input
	c.Output += other.Output
	c.Requests += other.Requests
	c.Failed += other.Failed
}

// Row is one Key's zero-filled daily series over the Report dates.
type Row struct {
	Key
	Tokens   []int64
	Input    []int64
	Output   []int64
	Requests []int64
	Failed   []int64
}

// Report is the daily usage of every active Key over the last N local days.
type Report struct {
	// Dates lists the local days covered, oldest first, today last.
	Dates []string
	// Rows holds the keys with activity in the window, ordered by Key.
	Rows []Row
}

// storedSeries is the persisted form of one Key and its days.
type storedSeries struct {
	Key
	Days map[string]Counts `json:"days"`
}

// storeFile is the persisted file layout.
type storeFile struct {
	Version int            `json:"version"`
	Series  []storedSeries `json:"series"`
}

// Tracker aggregates usage records per day. All methods are safe for concurrent use.
type Tracker struct {
	mu        sync.Mutex
	series    map[Key]map[string]Counts
	path      string
	dirty     bool
	prunedDay string
	nowFunc   func() time.Time

	// flushMu serializes flushes so an older snapshot never replaces a newer one.
	flushMu   sync.Mutex
	startOnce sync.Once
}

// NewTracker returns an empty tracker that uses the system clock.
func NewTracker() *Tracker {
	return &Tracker{series: make(map[Key]map[string]Counts), nowFunc: time.Now}
}

var defaultTracker = NewTracker()

// Default returns the process-wide tracker fed by the usage plugin.
func Default() *Tracker { return defaultTracker }

// SetClock replaces the clock used to pick the local day. It is meant for tests.
func (t *Tracker) SetClock(now func() time.Time) {
	if t == nil || now == nil {
		return
	}
	t.mu.Lock()
	t.nowFunc = now
	t.mu.Unlock()
}

// ClientHash returns the identifier stored for a client API key: its SHA-256 hex digest.
func ClientHash(apiKey string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(apiKey)))
	return hex.EncodeToString(sum[:])
}

// recordKey derives the normalized aggregate key of a usage record.
func recordKey(record coreusage.Record) Key {
	provider := strings.ToLower(strings.TrimSpace(record.Provider))
	if provider == "" {
		provider = unknownValue
	}
	model := strings.TrimSpace(record.Model)
	if model == "" {
		model = unknownValue
	}
	client := ""
	if record.IsNativeKey && strings.TrimSpace(record.APIKey) != "" {
		client = ClientHash(record.APIKey)
	}
	return Key{
		Provider:  provider,
		AuthID:    strings.TrimSpace(record.AuthID),
		AuthIndex: strings.TrimSpace(record.AuthIndex),
		Model:     model,
		Client:    client,
	}
}

// recordCounts converts one upstream attempt into day counts.
func recordCounts(record coreusage.Record) Counts {
	detail := record.Detail
	tokens := detail.TotalTokens
	if tokens <= 0 {
		tokens = detail.InputTokens + detail.OutputTokens
	}
	counts := Counts{
		Tokens:   max(tokens, 0),
		Input:    max(detail.InputTokens, 0),
		Output:   max(detail.OutputTokens, 0),
		Requests: 1,
	}
	if record.Failed {
		counts.Failed = 1
	}
	return counts
}

// Record adds one upstream attempt to today's aggregate for its key.
func (t *Tracker) Record(record coreusage.Record) {
	if t == nil {
		return
	}
	key := recordKey(record)
	counts := recordCounts(record)
	t.mu.Lock()
	defer t.mu.Unlock()
	now := t.nowFunc()
	today := now.Format(dayLayout)
	if t.prunedDay != today {
		t.pruneLocked(now)
		t.prunedDay = today
	}
	days := t.series[key]
	if days == nil {
		days = make(map[string]Counts)
		t.series[key] = days
	}
	day := days[today]
	day.add(counts)
	days[today] = day
	t.dirty = true
}

// localDay returns the local date offset days from now's date, formatted as dayLayout.
func localDay(now time.Time, offset int) string {
	y, m, d := now.Date()
	return time.Date(y, m, d+offset, 0, 0, 0, 0, now.Location()).Format(dayLayout)
}

// pruneLocked drops days older than the RetentionDays ending today and keys left
// without days. It reports whether anything was removed. The caller must hold t.mu.
func (t *Tracker) pruneLocked(now time.Time) bool {
	oldest := localDay(now, 1-RetentionDays)
	removed := false
	for key, days := range t.series {
		for day := range days {
			// Same-length ISO dates sort lexically, so string order is date order.
			if day < oldest {
				delete(days, day)
				removed = true
			}
		}
		if len(days) == 0 {
			delete(t.series, key)
			removed = true
		}
	}
	return removed
}

// SetStorePath loads persisted usage from path and remembers it for flushing.
// A missing file starts an empty history; an unreadable one is ignored with a warning.
func (t *Tracker) SetStorePath(path string) {
	if t == nil {
		return
	}
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
	loaded, errLoad := readStore(path)
	if errLoad != nil {
		log.WithError(errLoad).Warn("token usage: ignoring unreadable usage store")
		return
	}
	for _, series := range loaded.Series {
		key := series.Key
		days := t.series[key]
		for day, counts := range series.Days {
			if _, errParse := time.Parse(dayLayout, day); errParse != nil {
				continue
			}
			if days == nil {
				days = make(map[string]Counts)
				t.series[key] = days
			}
			current := days[day]
			current.add(counts)
			days[day] = current
		}
	}
	if t.pruneLocked(t.nowFunc()) {
		t.dirty = true
	}
}

// readStore decodes the store file at path. A missing file yields an empty store.
func readStore(path string) (storeFile, error) {
	data, errRead := os.ReadFile(path)
	if errRead != nil {
		if errors.Is(errRead, os.ErrNotExist) {
			return storeFile{}, nil
		}
		return storeFile{}, fmt.Errorf("read token usage store: %w", errRead)
	}
	var stored storeFile
	if errDecode := json.Unmarshal(data, &stored); errDecode != nil {
		return storeFile{}, fmt.Errorf("decode token usage store: %w", errDecode)
	}
	if stored.Version > storeVersion {
		return storeFile{}, fmt.Errorf("token usage store version %d is newer than supported version %d", stored.Version, storeVersion)
	}
	return stored, nil
}

// Start flushes usage to disk periodically until ctx ends, then flushes once more.
func (t *Tracker) Start(ctx context.Context) {
	if t == nil {
		return
	}
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
						log.WithError(errFlush).Warn("token usage: final flush failed")
					}
					return
				case <-ticker.C:
					if errFlush := t.Flush(); errFlush != nil {
						log.WithError(errFlush).Warn("token usage: flush failed")
					}
				}
			}
		}()
	})
}

// Flush writes usage to the store file when it changed since the last flush.
func (t *Tracker) Flush() error {
	if t == nil {
		return nil
	}
	t.flushMu.Lock()
	defer t.flushMu.Unlock()

	t.mu.Lock()
	if !t.dirty || t.path == "" {
		t.mu.Unlock()
		return nil
	}
	data, errEncode := json.MarshalIndent(t.snapshotLocked(), "", "  ")
	path := t.path
	t.dirty = false
	t.mu.Unlock()
	if errEncode != nil {
		return fmt.Errorf("encode token usage: %w", errEncode)
	}
	if errWrite := writeFileAtomic(path, data); errWrite != nil {
		t.mu.Lock()
		t.dirty = true
		t.mu.Unlock()
		return errWrite
	}
	return nil
}

// snapshotLocked returns the persisted form of the current usage, ordered by key.
// The caller must hold t.mu.
func (t *Tracker) snapshotLocked() storeFile {
	out := storeFile{Version: storeVersion, Series: make([]storedSeries, 0, len(t.series))}
	for key, days := range t.series {
		copied := make(map[string]Counts, len(days))
		for day, counts := range days {
			copied[day] = counts
		}
		out.Series = append(out.Series, storedSeries{Key: key, Days: copied})
	}
	slices.SortFunc(out.Series, func(a, b storedSeries) int { return compareKeys(a.Key, b.Key) })
	return out
}

// writeFileAtomic replaces path with data through a 0600 temp file in the same directory.
func writeFileAtomic(path string, data []byte) (err error) {
	dir := filepath.Dir(path)
	if errMkdir := os.MkdirAll(dir, 0o700); errMkdir != nil {
		return fmt.Errorf("create token usage directory: %w", errMkdir)
	}
	tmp, errCreate := os.CreateTemp(dir, filepath.Base(path)+".*.tmp")
	if errCreate != nil {
		return fmt.Errorf("create token usage temp file: %w", errCreate)
	}
	tmpPath := tmp.Name()
	defer func() {
		if err == nil {
			return
		}
		if errClose := tmp.Close(); errClose != nil && !errors.Is(errClose, os.ErrClosed) {
			log.WithError(errClose).Debug("token usage: failed to close temp file")
		}
		if errRemove := os.Remove(tmpPath); errRemove != nil && !errors.Is(errRemove, os.ErrNotExist) {
			log.WithError(errRemove).Warn("token usage: failed to remove temp file")
		}
	}()
	if errChmod := tmp.Chmod(0o600); errChmod != nil {
		return fmt.Errorf("set token usage temp file mode: %w", errChmod)
	}
	if _, errWrite := tmp.Write(data); errWrite != nil {
		return fmt.Errorf("write token usage: %w", errWrite)
	}
	if errSync := tmp.Sync(); errSync != nil {
		return fmt.Errorf("sync token usage: %w", errSync)
	}
	if errClose := tmp.Close(); errClose != nil {
		return fmt.Errorf("close token usage temp file: %w", errClose)
	}
	if errRename := os.Rename(tmpPath, path); errRename != nil {
		return fmt.Errorf("replace token usage store: %w", errRename)
	}
	return nil
}

// compareKeys orders keys by provider, auth ID, auth index, model, then client.
func compareKeys(a, b Key) int {
	return cmp.Or(
		strings.Compare(a.Provider, b.Provider),
		strings.Compare(a.AuthID, b.AuthID),
		strings.Compare(a.AuthIndex, b.AuthIndex),
		strings.Compare(a.Model, b.Model),
		strings.Compare(a.Client, b.Client),
	)
}

// Report returns zero-filled daily usage for the last days local days (oldest first,
// today last). Keys without activity in the window are left out. days is clamped to
// 1..RetentionDays.
func (t *Tracker) Report(days int) Report {
	days = min(max(days, 1), RetentionDays)
	if t == nil {
		return Report{Dates: make([]string, 0), Rows: make([]Row, 0)}
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	now := t.nowFunc()
	dates := make([]string, days)
	for i := range dates {
		dates[i] = localDay(now, i-days+1)
	}
	out := Report{Dates: dates, Rows: make([]Row, 0, len(t.series))}
	for key, series := range t.series {
		row := Row{
			Key:      key,
			Tokens:   make([]int64, days),
			Input:    make([]int64, days),
			Output:   make([]int64, days),
			Requests: make([]int64, days),
			Failed:   make([]int64, days),
		}
		active := false
		for i, date := range dates {
			day, ok := series[date]
			if !ok {
				continue
			}
			row.Tokens[i] = day.Tokens
			row.Input[i] = day.Input
			row.Output[i] = day.Output
			row.Requests[i] = day.Requests
			row.Failed[i] = day.Failed
			if day.Requests > 0 || day.Tokens > 0 {
				active = true
			}
		}
		if active {
			out.Rows = append(out.Rows, row)
		}
	}
	slices.SortFunc(out.Rows, func(a, b Row) int { return compareKeys(a.Key, b.Key) })
	return out
}

// StorePath returns where usage is persisted: WRITABLE_PATH when set, else next to the config file.
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
