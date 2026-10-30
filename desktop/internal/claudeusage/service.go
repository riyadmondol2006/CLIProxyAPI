// Package claudeusage reads Claude Code's local transcript logs, stores per-turn token
// usage in a SQLite database, and serves aggregated usage and cost statistics to the
// desktop UI under /app/claude-usage/.
//
// The idea follows claude-usage by Pawel Huryn (https://github.com/phuryn/claude-usage,
// MIT License, Copyright (c) 2026 Pawel Huryn). This is an independent Go implementation.
package claudeusage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	log "github.com/sirupsen/logrus"
)

// refreshAfter is how old the last scan may be before a /data request starts a new one.
const refreshAfter = 60 * time.Second

// errScanRunning is returned by Scan when another scan is in progress.
var errScanRunning = errors.New("a scan is already running")

// Service scans transcripts in the background and answers the usage API.
type Service struct {
	dbPath  string
	sources []string
	db      *sql.DB

	ctx    context.Context
	cancel context.CancelFunc
	wg     sync.WaitGroup

	// now and location are replaceable in tests.
	now      func() time.Time
	location func() *time.Location

	prog       progress
	mu         sync.Mutex
	scanning   bool
	lastScanAt time.Time
	lastError  string
}

// Status is returned by GET /app/claude-usage/status and POST /app/claude-usage/scan.
type Status struct {
	Scanning   bool     `json:"scanning"`
	FilesTotal int64    `json:"files-total"`
	FilesDone  int64    `json:"files-done"`
	BytesTotal int64    `json:"bytes-total"`
	BytesDone  int64    `json:"bytes-done"`
	LastScanAt string   `json:"last-scan-at"`
	LastError  string   `json:"last-error"`
	Turns      int64    `json:"turns"`
	Sessions   int64    `json:"sessions"`
	Sources    []string `json:"sources"`
	DBPath     string   `json:"db-path"`
}

// DefaultSources returns the directories Claude Code and Xcode's Claude agent write
// transcripts to. Missing directories are skipped when scanning.
func DefaultSources() []string {
	home, errHome := os.UserHomeDir()
	if errHome != nil {
		return nil
	}
	return []string{
		filepath.Join(home, ".claude", "projects"),
		filepath.Join(home, "Library", "Developer", "Xcode", "CodingAssistant", "ClaudeAgentConfig", "projects"),
	}
}

// New opens the database at dbPath. Call Start to run the first scan and Close when done.
func New(dbPath string, sources []string) (*Service, error) {
	db, errOpen := openDB(dbPath)
	if errOpen != nil {
		return nil, fmt.Errorf("claude usage database: %w", errOpen)
	}
	ctx, cancel := context.WithCancel(context.Background())
	return &Service{
		dbPath:   dbPath,
		sources:  append([]string(nil), sources...),
		db:       db,
		ctx:      ctx,
		cancel:   cancel,
		now:      time.Now,
		location: func() *time.Location { return time.Local },
	}, nil
}

// Start runs an initial scan in the background. Scans stop when ctx is done.
func (s *Service) Start(ctx context.Context) {
	if ctx != nil {
		context.AfterFunc(ctx, s.cancel)
	}
	s.startScan()
}

// Close stops a running scan and closes the database.
func (s *Service) Close() error {
	// Cancel under the lock so no scan can start between cancel and Wait.
	s.mu.Lock()
	s.cancel()
	s.mu.Unlock()
	s.wg.Wait()
	if errClose := s.db.Close(); errClose != nil {
		return fmt.Errorf("close claude usage database: %w", errClose)
	}
	return nil
}

// startScan starts a background scan unless one is running. It reports whether it started one.
func (s *Service) startScan() bool {
	if !s.beginScan() {
		return false
	}
	go func() {
		defer s.wg.Done()
		s.runScan(s.ctx)
	}()
	return true
}

// Scan runs an incremental scan and waits for it. It also stops when the service closes.
func (s *Service) Scan(ctx context.Context) error {
	if !s.beginScan() {
		return errScanRunning
	}
	defer s.wg.Done()
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	stop := context.AfterFunc(s.ctx, cancel)
	defer stop()
	return s.runScan(ctx)
}

// beginScan reserves the single scan slot and registers it with the wait group.
// The caller must call s.wg.Done when the scan ends.
func (s *Service) beginScan() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.scanning || s.ctx.Err() != nil {
		return false
	}
	s.scanning = true
	s.wg.Add(1)
	s.prog.filesTotal.Store(0)
	s.prog.filesDone.Store(0)
	s.prog.bytesTotal.Store(0)
	s.prog.bytesDone.Store(0)
	return true
}

// runScan does the work of a scan that beginScan reserved.
func (s *Service) runScan(ctx context.Context) error {
	started := time.Now()
	errScan := s.scan(ctx)
	s.mu.Lock()
	s.scanning = false
	s.lastScanAt = s.now()
	stopped := ctx.Err() != nil
	switch {
	case stopped:
		// Interrupted (app closing); the next scan resumes where this one stopped.
		s.lastError = "scan stopped before it finished"
	case errScan != nil:
		s.lastError = errScan.Error()
	default:
		s.lastError = ""
	}
	s.mu.Unlock()
	entry := log.WithFields(log.Fields{
		"files":    s.prog.filesTotal.Load(),
		"bytes":    s.prog.bytesDone.Load(),
		"duration": time.Since(started).Round(time.Millisecond).String(),
	})
	switch {
	case stopped:
		entry.Debug("claude usage: scan stopped")
	case errScan != nil:
		entry.WithError(errScan).Warn("claude usage: scan finished with errors")
	default:
		entry.Debug("claude usage: scan finished")
	}
	return errScan
}

func (s *Service) scan(ctx context.Context) error {
	paths, metas, errDiscover := discover(ctx, s.sources)
	if errDiscover != nil {
		return errDiscover
	}
	states, errStates := loadFileStates(ctx, s.db)
	if errStates != nil {
		return errStates
	}
	jobs := planJobs(paths, states)
	var bytesTotal int64
	for _, job := range jobs {
		bytesTotal += job.Size - job.Offset
	}
	s.prog.filesTotal.Store(int64(len(paths)))
	s.prog.filesDone.Store(int64(len(paths) - len(jobs)))
	s.prog.bytesTotal.Store(bytesTotal)
	writer := &dbWriter{db: s.db}
	errs := scanFiles(ctx, writer, jobs, &s.prog)
	if len(errs) == 0 {
		if errMetas := writer.writeMetas(ctx, planJobs(metas, states)); errMetas != nil {
			errs = append(errs, errMetas)
		}
	}
	switch len(errs) {
	case 0:
		return nil
	case 1:
		return errs[0]
	default:
		return fmt.Errorf("%w (and %d more errors)", errs[0], len(errs)-1)
	}
}

// Status reports scan progress and database totals.
func (s *Service) Status(ctx context.Context) Status {
	s.mu.Lock()
	status := Status{
		Scanning:  s.scanning,
		LastError: s.lastError,
		DBPath:    s.dbPath,
		Sources:   existingDirs(s.sources),
	}
	if !s.lastScanAt.IsZero() {
		status.LastScanAt = s.lastScanAt.UTC().Format(time.RFC3339)
	}
	s.mu.Unlock()
	status.FilesTotal = s.prog.filesTotal.Load()
	status.FilesDone = s.prog.filesDone.Load()
	status.BytesTotal = s.prog.bytesTotal.Load()
	status.BytesDone = s.prog.bytesDone.Load()
	if errCount := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM turns`).Scan(&status.Turns); errCount != nil {
		log.WithError(errCount).Debug("claude usage: count turns")
	}
	if errCount := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM sessions`).Scan(&status.Sessions); errCount != nil {
		log.WithError(errCount).Debug("claude usage: count sessions")
	}
	return status
}

// refreshIfStale starts a background scan when the data is older than refreshAfter.
func (s *Service) refreshIfStale() {
	s.mu.Lock()
	stale := !s.scanning && (s.lastScanAt.IsZero() || s.now().Sub(s.lastScanAt) > refreshAfter)
	s.mu.Unlock()
	if stale {
		s.startScan()
	}
}

// ServeHTTP answers /app/claude-usage/status, /scan and /data.
func (s *Service) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	switch strings.TrimPrefix(r.URL.Path, "/app/claude-usage") {
	case "/status":
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "use GET"})
			return
		}
		writeJSON(w, http.StatusOK, s.Status(r.Context()))
	case "/scan":
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "use POST"})
			return
		}
		s.startScan()
		writeJSON(w, http.StatusOK, s.Status(r.Context()))
	case "/data":
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "use GET"})
			return
		}
		s.handleData(w, r)
	default:
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
	}
}

func (s *Service) handleData(w http.ResponseWriter, r *http.Request) {
	values := r.URL.Query()
	loc := s.location()
	q, errQuery := parseQuery(values.Get("from"), values.Get("to"), values.Get("models"), loc)
	if errQuery != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": errQuery.Error()})
		return
	}
	s.refreshIfStale()
	data, errData := buildData(r.Context(), s.db, q, loc, s.now())
	if errData != nil {
		if errors.Is(errData, context.Canceled) {
			return
		}
		log.WithError(errData).Warn("claude usage: build data")
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "could not read the usage database"})
		return
	}
	writeJSON(w, http.StatusOK, data)
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if errEncode := json.NewEncoder(w).Encode(value); errEncode != nil {
		log.WithError(errEncode).Debug("claude usage: write JSON response")
	}
}
