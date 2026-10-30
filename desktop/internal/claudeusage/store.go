package claudeusage

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"

	log "github.com/sirupsen/logrus"
	_ "modernc.org/sqlite" // Pure-Go SQLite driver.
)

const schema = `
CREATE TABLE IF NOT EXISTS turns (
	id INTEGER PRIMARY KEY,
	message_id TEXT UNIQUE,
	session_id TEXT NOT NULL,
	timestamp TEXT NOT NULL DEFAULT '',
	model TEXT NOT NULL DEFAULT '',
	input INTEGER NOT NULL DEFAULT 0,
	output INTEGER NOT NULL DEFAULT 0,
	cache_read INTEGER NOT NULL DEFAULT 0,
	cache_write_5m INTEGER NOT NULL DEFAULT 0,
	cache_write_1h INTEGER NOT NULL DEFAULT 0,
	tool_name TEXT NOT NULL DEFAULT '',
	cwd TEXT NOT NULL DEFAULT '',
	is_subagent INTEGER NOT NULL DEFAULT 0,
	agent_id TEXT NOT NULL DEFAULT ''
);
-- Covers the /data query so date ranges read only the index.
CREATE INDEX IF NOT EXISTS turns_timestamp ON turns(timestamp, model, input, output, cache_read,
	cache_write_5m, cache_write_1h, session_id, is_subagent, agent_id);
CREATE INDEX IF NOT EXISTS turns_session ON turns(session_id);
CREATE TABLE IF NOT EXISTS sessions (
	session_id TEXT PRIMARY KEY,
	project TEXT NOT NULL DEFAULT 'unknown',
	git_branch TEXT NOT NULL DEFAULT '',
	custom_title TEXT NOT NULL DEFAULT '',
	ai_title TEXT NOT NULL DEFAULT '',
	first_ts TEXT NOT NULL DEFAULT '',
	last_ts TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS agents (
	agent_id TEXT PRIMARY KEY,
	agent_type TEXT NOT NULL DEFAULT '',
	status TEXT NOT NULL DEFAULT '',
	total_tokens INTEGER NOT NULL DEFAULT 0,
	total_duration_ms INTEGER NOT NULL DEFAULT 0,
	total_tool_use_count INTEGER NOT NULL DEFAULT 0,
	session_id TEXT NOT NULL DEFAULT '',
	timestamp TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS files (
	path TEXT PRIMARY KEY,
	size INTEGER NOT NULL,
	mtime INTEGER NOT NULL,
	offset INTEGER NOT NULL
);
`

// The last record per message id wins, but a tool name found in an earlier streamed
// block of the same message is kept when the later block has none.
const upsertTurnSQL = `
INSERT INTO turns (message_id, session_id, timestamp, model, input, output, cache_read,
	cache_write_5m, cache_write_1h, tool_name, cwd, is_subagent, agent_id)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(message_id) DO UPDATE SET
	session_id = excluded.session_id,
	timestamp = excluded.timestamp,
	model = excluded.model,
	input = excluded.input,
	output = excluded.output,
	cache_read = excluded.cache_read,
	cache_write_5m = excluded.cache_write_5m,
	cache_write_1h = excluded.cache_write_1h,
	tool_name = CASE WHEN turns.tool_name = '' THEN excluded.tool_name ELSE turns.tool_name END,
	cwd = excluded.cwd,
	is_subagent = excluded.is_subagent,
	agent_id = excluded.agent_id`

const upsertSessionSQL = `
INSERT INTO sessions (session_id, project, git_branch, custom_title, ai_title, first_ts, last_ts)
VALUES (?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(session_id) DO UPDATE SET
	project = CASE WHEN sessions.project IN ('', 'unknown') THEN excluded.project ELSE sessions.project END,
	git_branch = CASE WHEN sessions.git_branch = '' THEN excluded.git_branch ELSE sessions.git_branch END,
	custom_title = CASE WHEN excluded.custom_title <> '' THEN excluded.custom_title ELSE sessions.custom_title END,
	ai_title = CASE WHEN excluded.ai_title <> '' THEN excluded.ai_title ELSE sessions.ai_title END,
	first_ts = CASE WHEN sessions.first_ts = '' OR (excluded.first_ts <> '' AND excluded.first_ts < sessions.first_ts)
		THEN excluded.first_ts ELSE sessions.first_ts END,
	last_ts = CASE WHEN excluded.last_ts > sessions.last_ts THEN excluded.last_ts ELSE sessions.last_ts END`

const upsertAgentSQL = `
INSERT INTO agents (agent_id, agent_type, status, total_tokens, total_duration_ms,
	total_tool_use_count, session_id, timestamp)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(agent_id) DO UPDATE SET
	agent_type = excluded.agent_type,
	status = excluded.status,
	total_tokens = excluded.total_tokens,
	total_duration_ms = excluded.total_duration_ms,
	total_tool_use_count = excluded.total_tool_use_count,
	session_id = excluded.session_id,
	timestamp = excluded.timestamp`

// A sidecar only fills an agent type the dispatch record did not provide.
const upsertAgentTypeSQL = `
INSERT INTO agents (agent_id, agent_type, session_id) VALUES (?, ?, ?)
ON CONFLICT(agent_id) DO UPDATE SET
	agent_type = CASE WHEN agents.agent_type = '' THEN excluded.agent_type ELSE agents.agent_type END,
	session_id = CASE WHEN agents.session_id = '' THEN excluded.session_id ELSE agents.session_id END`

const upsertFileSQL = `
INSERT INTO files (path, size, mtime, offset) VALUES (?, ?, ?, ?)
ON CONFLICT(path) DO UPDATE SET size = excluded.size, mtime = excluded.mtime, offset = excluded.offset`

// openDB opens (and creates) the usage database in WAL mode.
func openDB(path string) (*sql.DB, error) {
	if errMkdir := os.MkdirAll(filepath.Dir(path), 0o700); errMkdir != nil {
		return nil, fmt.Errorf("create database directory: %w", errMkdir)
	}
	// Create the file first so it is private: it holds project paths and session titles.
	// SQLite gives the -wal and -shm files the same permissions.
	f, errCreate := os.OpenFile(path, os.O_RDWR|os.O_CREATE, 0o600)
	if errCreate != nil {
		return nil, fmt.Errorf("create %s: %w", path, errCreate)
	}
	if errClose := f.Close(); errClose != nil {
		return nil, fmt.Errorf("create %s: %w", path, errClose)
	}
	query := url.Values{}
	query.Add("_pragma", "journal_mode(WAL)")
	query.Add("_pragma", "synchronous(NORMAL)")
	query.Add("_pragma", "busy_timeout(10000)")
	query.Add("_pragma", "foreign_keys(OFF)")
	dsn := "file:" + filepath.ToSlash(path) + "?" + query.Encode()
	db, errOpen := sql.Open("sqlite", dsn)
	if errOpen != nil {
		return nil, fmt.Errorf("open %s: %w", path, errOpen)
	}
	if _, errSchema := db.Exec(schema); errSchema != nil {
		if errClose := db.Close(); errClose != nil {
			return nil, fmt.Errorf("create schema: %w (close: %v)", errSchema, errClose)
		}
		return nil, fmt.Errorf("create schema: %w", errSchema)
	}
	return db, nil
}

// fileState is what the database remembers about a transcript file.
type fileState struct {
	Size, Mtime, Offset int64
}

func loadFileStates(ctx context.Context, db *sql.DB) (map[string]fileState, error) {
	rows, errQuery := db.QueryContext(ctx, `SELECT path, size, mtime, offset FROM files`)
	if errQuery != nil {
		return nil, fmt.Errorf("load file states: %w", errQuery)
	}
	defer closeRows(rows)
	states := make(map[string]fileState)
	for rows.Next() {
		var path string
		var state fileState
		if errScan := rows.Scan(&path, &state.Size, &state.Mtime, &state.Offset); errScan != nil {
			return nil, fmt.Errorf("read file state: %w", errScan)
		}
		states[path] = state
	}
	if errRows := rows.Err(); errRows != nil {
		return nil, fmt.Errorf("load file states: %w", errRows)
	}
	return states, nil
}

// sessionAgg collects session fields from one batch of lines before they are written.
type sessionAgg struct {
	Project     string
	GitBranch   string
	CustomTitle string
	AITitle     string
	First, Last string
}

func (a *sessionAgg) add(p parsed) {
	if a.Project == "" || a.Project == "unknown" {
		if p.Cwd != "" {
			a.Project = projectName(p.Cwd)
		}
	}
	if a.GitBranch == "" && p.GitBranch != "" {
		a.GitBranch = p.GitBranch
	}
	if p.CustomTitle != "" {
		a.CustomTitle = p.CustomTitle
	}
	if p.AITitle != "" {
		a.AITitle = p.AITitle
	}
	if p.Timestamp != "" {
		if a.First == "" || p.Timestamp < a.First {
			a.First = p.Timestamp
		}
		if p.Timestamp > a.Last {
			a.Last = p.Timestamp
		}
	}
}

// batch writes one file's lines inside a single transaction.
type batch struct {
	tx       *sql.Tx
	turn     *sql.Stmt
	agent    *sql.Stmt
	sessions map[string]*sessionAgg
	order    []string
}

func beginBatch(ctx context.Context, db *sql.DB) (*batch, error) {
	tx, errBegin := db.BeginTx(ctx, nil)
	if errBegin != nil {
		return nil, fmt.Errorf("begin transaction: %w", errBegin)
	}
	b := &batch{tx: tx, sessions: make(map[string]*sessionAgg)}
	var errPrepare error
	if b.turn, errPrepare = tx.PrepareContext(ctx, upsertTurnSQL); errPrepare != nil {
		b.rollback()
		return nil, fmt.Errorf("prepare turn upsert: %w", errPrepare)
	}
	if b.agent, errPrepare = tx.PrepareContext(ctx, upsertAgentSQL); errPrepare != nil {
		b.rollback()
		return nil, fmt.Errorf("prepare agent upsert: %w", errPrepare)
	}
	return b, nil
}

func (b *batch) add(ctx context.Context, p parsed) error {
	agg := b.sessions[p.SessionID]
	if agg == nil {
		agg = &sessionAgg{}
		b.sessions[p.SessionID] = agg
		b.order = append(b.order, p.SessionID)
	}
	agg.add(p)
	if t := p.Turn; t != nil {
		var messageID any
		if t.MessageID != "" {
			messageID = t.MessageID
		}
		if _, errExec := b.turn.ExecContext(ctx, messageID, t.SessionID, t.Timestamp, t.Model,
			t.Tokens.Input, t.Tokens.Output, t.Tokens.CacheRead, t.Tokens.Write5m, t.Tokens.Write1h,
			t.ToolName, t.Cwd, boolInt(t.Subagent), t.AgentID); errExec != nil {
			return fmt.Errorf("store turn: %w", errExec)
		}
	}
	if d := p.Dispatch; d != nil {
		if _, errExec := b.agent.ExecContext(ctx, d.AgentID, d.AgentType, d.Status, d.TotalTokens,
			d.DurationMs, d.ToolUseCount, d.SessionID, d.Timestamp); errExec != nil {
			return fmt.Errorf("store agent dispatch: %w", errExec)
		}
	}
	return nil
}

// commit writes the collected sessions and the file's new state, then commits.
func (b *batch) commit(ctx context.Context, path string, state fileState) error {
	for _, id := range b.order {
		agg := b.sessions[id]
		project := agg.Project
		if project == "" {
			project = "unknown"
		}
		if _, errExec := b.tx.ExecContext(ctx, upsertSessionSQL, id, project, agg.GitBranch,
			agg.CustomTitle, agg.AITitle, agg.First, agg.Last); errExec != nil {
			b.rollback()
			return fmt.Errorf("store session: %w", errExec)
		}
	}
	if _, errExec := b.tx.ExecContext(ctx, upsertFileSQL, path, state.Size, state.Mtime, state.Offset); errExec != nil {
		b.rollback()
		return fmt.Errorf("store file state: %w", errExec)
	}
	b.closeStmts()
	if errCommit := b.tx.Commit(); errCommit != nil {
		return fmt.Errorf("commit: %w", errCommit)
	}
	return nil
}

func (b *batch) closeStmts() {
	for _, stmt := range []*sql.Stmt{b.turn, b.agent} {
		if stmt == nil {
			continue
		}
		if errClose := stmt.Close(); errClose != nil {
			log.WithError(errClose).Debug("claude usage: close statement")
		}
	}
}

func (b *batch) rollback() {
	b.closeStmts()
	rollback(b.tx)
}

func rollback(tx *sql.Tx) {
	if errRollback := tx.Rollback(); errRollback != nil && !errors.Is(errRollback, sql.ErrTxDone) {
		log.WithError(errRollback).Debug("claude usage: roll back")
	}
}

func boolInt(v bool) int {
	if v {
		return 1
	}
	return 0
}

func closeRows(rows *sql.Rows) {
	if errClose := rows.Close(); errClose != nil {
		log.WithError(errClose).Debug("claude usage: close rows")
	}
}

// dbWriter is the single writer of a scan.
type dbWriter struct {
	db *sql.DB
}

// write stores one chunk and its file state in one transaction.
func (w *dbWriter) write(ctx context.Context, c chunk) error {
	b, errBegin := beginBatch(ctx, w.db)
	if errBegin != nil {
		return errBegin
	}
	for _, record := range c.Records {
		if errAdd := b.add(ctx, record); errAdd != nil {
			b.rollback()
			return errAdd
		}
	}
	return b.commit(ctx, c.Path, c.State)
}

// writeMetas stores subagent sidecars that changed since the last scan.
func (w *dbWriter) writeMetas(ctx context.Context, jobs []fileJob) error {
	if len(jobs) == 0 {
		return nil
	}
	tx, errBegin := w.db.BeginTx(ctx, nil)
	if errBegin != nil {
		return fmt.Errorf("begin transaction: %w", errBegin)
	}
	for _, job := range jobs {
		if d, ok := agentFromMeta(job.Path); ok {
			if _, errExec := tx.ExecContext(ctx, upsertAgentTypeSQL, d.AgentID, d.AgentType, d.SessionID); errExec != nil {
				rollback(tx)
				return fmt.Errorf("store subagent type: %w", errExec)
			}
		}
		if _, errExec := tx.ExecContext(ctx, upsertFileSQL, job.Path, job.Size, job.Mtime, job.Size); errExec != nil {
			rollback(tx)
			return fmt.Errorf("store file state: %w", errExec)
		}
	}
	if errCommit := tx.Commit(); errCommit != nil {
		return fmt.Errorf("commit: %w", errCommit)
	}
	return nil
}
