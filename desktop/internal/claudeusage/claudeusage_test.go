package claudeusage

import (
	"context"
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// --- fixtures ---

type usageFixture struct {
	in, out, read, write int64
	split                *[2]int64 // ephemeral 5m and 1h, when present
}

func assistantLine(t *testing.T, session, id, ts, model string, u usageFixture, extra map[string]any) string {
	t.Helper()
	usage := map[string]any{
		"input_tokens":                u.in,
		"output_tokens":               u.out,
		"cache_read_input_tokens":     u.read,
		"cache_creation_input_tokens": u.write,
	}
	if u.split != nil {
		usage["cache_creation"] = map[string]any{
			"ephemeral_5m_input_tokens": u.split[0],
			"ephemeral_1h_input_tokens": u.split[1],
		}
	}
	rec := map[string]any{
		"type":      "assistant",
		"sessionId": session,
		"timestamp": ts,
		"cwd":       "/home/me/work/proj",
		"gitBranch": "main",
		"message": map[string]any{
			"id":      id,
			"model":   model,
			"usage":   usage,
			"content": []any{map[string]any{"type": "text", "text": "hi"}, map[string]any{"type": "tool_use", "name": "Bash"}},
		},
	}
	for k, v := range extra {
		rec[k] = v
	}
	return mustJSON(t, rec)
}

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	data, errMarshal := json.Marshal(v)
	if errMarshal != nil {
		t.Fatalf("marshal fixture: %v", errMarshal)
	}
	return string(data)
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if errMkdir := os.MkdirAll(filepath.Dir(path), 0o700); errMkdir != nil {
		t.Fatal(errMkdir)
	}
	if errWrite := os.WriteFile(path, []byte(content), 0o600); errWrite != nil {
		t.Fatal(errWrite)
	}
}

func appendFile(t *testing.T, path, content string) {
	t.Helper()
	f, errOpen := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o600)
	if errOpen != nil {
		t.Fatal(errOpen)
	}
	if _, errWrite := f.WriteString(content); errWrite != nil {
		t.Fatal(errWrite)
	}
	if errClose := f.Close(); errClose != nil {
		t.Fatal(errClose)
	}
}

func lines(items ...string) string {
	return strings.Join(items, "\n") + "\n"
}

func newTestService(t *testing.T, sources ...string) *Service {
	t.Helper()
	s, errNew := New(filepath.Join(t.TempDir(), "db", "usage.db"), sources)
	if errNew != nil {
		t.Fatalf("New: %v", errNew)
	}
	t.Cleanup(func() {
		if errClose := s.Close(); errClose != nil {
			t.Errorf("Close: %v", errClose)
		}
	})
	return s
}

func mustScan(t *testing.T, s *Service) {
	t.Helper()
	if errScan := s.Scan(context.Background()); errScan != nil {
		t.Fatalf("Scan: %v", errScan)
	}
}

func mustData(t *testing.T, s *Service, from, to, models string) *Data {
	t.Helper()
	q, errQuery := parseQuery(from, to, models, time.Local)
	if errQuery != nil {
		t.Fatalf("parseQuery: %v", errQuery)
	}
	data, errData := buildData(context.Background(), s.db, q, time.Local, time.Now())
	if errData != nil {
		t.Fatalf("buildData: %v", errData)
	}
	return data
}

type turnRow struct {
	output, write5m, write1h int64
	subagent                 bool
	agentID, toolName        string
}

func loadTurns(t *testing.T, s *Service) map[string]turnRow {
	t.Helper()
	rows, errQuery := s.db.Query(`SELECT COALESCE(message_id, ''), output, cache_write_5m, cache_write_1h, is_subagent, agent_id, tool_name FROM turns`)
	if errQuery != nil {
		t.Fatal(errQuery)
	}
	defer closeRows(rows)
	out := map[string]turnRow{}
	for rows.Next() {
		var id string
		var row turnRow
		if errScan := rows.Scan(&id, &row.output, &row.write5m, &row.write1h, &row.subagent, &row.agentID, &row.toolName); errScan != nil {
			t.Fatal(errScan)
		}
		out[id] = row
	}
	return out
}

func setLocal(t *testing.T, loc *time.Location) {
	t.Helper()
	prev := time.Local
	time.Local = loc
	t.Cleanup(func() { time.Local = prev })
}

// --- parsing and incremental scanning ---

func TestStreamingDuplicatesLastWinsWithinFileAndAcrossScans(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "p", "s1.jsonl")
	ts := "2026-10-01T10:00:00Z"
	writeFile(t, path, lines(
		assistantLine(t, "s1", "msg_1", ts, "claude-opus-5-5", usageFixture{in: 5, out: 10}, nil),
		assistantLine(t, "s1", "msg_1", ts, "claude-opus-5-5", usageFixture{in: 5, out: 40}, nil),
	))
	s := newTestService(t, dir)
	mustScan(t, s)
	if got := loadTurns(t, s); len(got) != 1 || got["msg_1"].output != 40 {
		t.Fatalf("within file: %+v", got)
	}

	appendFile(t, path, lines(assistantLine(t, "s1", "msg_1", ts, "claude-opus-5-5", usageFixture{in: 5, out: 70}, nil)))
	mustScan(t, s)
	got := loadTurns(t, s)
	if len(got) != 1 || got["msg_1"].output != 70 {
		t.Fatalf("across scans: %+v", got)
	}
	if data := mustData(t, s, "", "", ""); data.Totals.Output != 70 || data.Totals.Turns != 1 {
		t.Fatalf("duplicates must not be summed: %+v", data.Totals)
	}
}

func TestPartialLastLineIsReadAfterItCompletes(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "p", "s1.jsonl")
	first := assistantLine(t, "s1", "msg_1", "2026-10-01T10:00:00Z", "claude-opus-5-5", usageFixture{out: 1}, nil)
	second := assistantLine(t, "s1", "msg_2", "2026-10-01T10:01:00Z", "claude-opus-5-5", usageFixture{out: 2}, nil)
	writeFile(t, path, first+"\n"+second[:len(second)/2])
	s := newTestService(t, dir)
	mustScan(t, s)
	if got := loadTurns(t, s); len(got) != 1 {
		t.Fatalf("partial line must wait: %+v", got)
	}
	var offset int64
	if errRow := s.db.QueryRow(`SELECT offset FROM files WHERE path = ?`, path).Scan(&offset); errRow != nil {
		t.Fatal(errRow)
	}
	if offset != int64(len(first)+1) {
		t.Fatalf("offset = %d, want end of the first line %d", offset, len(first)+1)
	}
	appendFile(t, path, second[len(second)/2:]+"\n")
	mustScan(t, s)
	if got := loadTurns(t, s); len(got) != 2 || got["msg_2"].output != 2 {
		t.Fatalf("completed line: %+v", got)
	}
}

func TestBadLinesAreSkippedIndividually(t *testing.T) {
	dir := t.TempDir()
	ts := "2026-10-01T10:00:00Z"
	writeFile(t, filepath.Join(dir, "p", "s1.jsonl"), lines(
		assistantLine(t, "s1", "msg_1", ts, "claude-opus-5-5", usageFixture{out: 1}, nil),
		`{"type":"assistant","sessionId":"s1", this is not json`,
		`{"type":"assistant","sessionId":"s1","message":"not an object"}`,
		`{"type":"assistant","sessionId":"s1","message":{"id":"x","model":7,"usage":{}}}`,
		`{"type":"assistant","message":{"id":"nosession","usage":{"output_tokens":5}}}`,
		`[1,2,3]`,
		``,
		assistantLine(t, "s1", "msg_zero", ts, "claude-opus-5-5", usageFixture{}, nil),
		assistantLine(t, "s1", "msg_2", ts, "claude-opus-5-5", usageFixture{out: 2}, nil),
	))
	s := newTestService(t, dir)
	mustScan(t, s)
	got := loadTurns(t, s)
	if len(got) != 2 || got["msg_1"].output != 1 || got["msg_2"].output != 2 {
		t.Fatalf("want msg_1 and msg_2 only: %+v", got)
	}
}

func TestTruncatedFileIsReadAgainFromStart(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "p", "s1.jsonl")
	ts := "2026-10-01T10:00:00Z"
	writeFile(t, path, lines(
		assistantLine(t, "s1", "msg_1", ts, "claude-opus-5-5", usageFixture{out: 1}, nil),
		assistantLine(t, "s1", "msg_2", ts, "claude-opus-5-5", usageFixture{out: 2}, nil),
	))
	s := newTestService(t, dir)
	mustScan(t, s)
	writeFile(t, path, lines(assistantLine(t, "s1", "msg_3", ts, "claude-opus-5-5", usageFixture{out: 3}, nil)))
	mustScan(t, s)
	if got := loadTurns(t, s); len(got) != 3 || got["msg_3"].output != 3 {
		t.Fatalf("shrunk file must be re-read: %+v", got)
	}
}

func TestCacheWriteSplit(t *testing.T) {
	tests := []struct {
		name             string
		usage            usageFixture
		want5m, wantHour int64
	}{
		{"split present", usageFixture{out: 1, write: 300, split: &[2]int64{100, 200}}, 100, 200},
		{"no split counts as 5m", usageFixture{out: 1, write: 300}, 300, 0},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			line := assistantLine(t, "s", "m", "2026-10-01T10:00:00Z", "claude-opus-5-5", tc.usage, nil)
			p, ok := parseLine([]byte(line), false)
			if !ok || p.Turn == nil {
				t.Fatal("line not parsed")
			}
			if p.Turn.Tokens.Write5m != tc.want5m || p.Turn.Tokens.Write1h != tc.wantHour {
				t.Fatalf("got %+v", p.Turn.Tokens)
			}
			if p.Turn.ToolName != "Bash" {
				t.Fatalf("tool name = %q", p.Turn.ToolName)
			}
		})
	}
}

func TestSubagentDetectionAndDispatchMetadata(t *testing.T) {
	dir := t.TempDir()
	ts := "2026-10-01T10:00:00Z"
	u := usageFixture{in: 1, out: 10}
	writeFile(t, filepath.Join(dir, "p", "main.jsonl"), lines(
		assistantLine(t, "s1", "plain", ts, "claude-opus-5-5", u, nil),
		assistantLine(t, "s1", "sidechain", ts, "claude-opus-5-5", u, map[string]any{"isSidechain": true}),
		assistantLine(t, "s1", "top-agent", ts, "claude-opus-5-5", u, map[string]any{"agentId": "a1"}),
		assistantLine(t, "s1", "data-agent", ts, "claude-opus-5-5", u, map[string]any{"data": map[string]any{"agentId": "a2"}}),
		assistantLine(t, "s1", "compact", ts, "claude-opus-5-5", u, map[string]any{"agentId": "acompact-xyz"}),
		mustJSON(t, map[string]any{
			"type": "user", "sessionId": "s1", "timestamp": ts,
			"toolUseResult": map[string]any{
				"agentId": "a1", "agentType": "Explore", "status": "completed",
				"totalTokens": 1234, "totalDurationMs": 5000, "totalToolUseCount": 7,
				"content": []any{map[string]any{"type": "text", "text": "secret"}},
			},
		}),
		mustJSON(t, map[string]any{"type": "user", "sessionId": "s1", "timestamp": ts, "toolUseResult": "plain string result"}),
	))
	writeFile(t, filepath.Join(dir, "p", "s1", "subagents", "agent-a3.jsonl"), lines(
		assistantLine(t, "s1", "by-path", ts, "claude-opus-5-5", u, nil),
	))
	writeFile(t, filepath.Join(dir, "p", "s1", "subagents", "agent-a2.meta.json"), `{"agentType":"Plan","description":"x"}`)

	s := newTestService(t, dir)
	mustScan(t, s)
	got := loadTurns(t, s)
	tests := []struct {
		id       string
		subagent bool
		agentID  string
	}{
		{"plain", false, ""},
		{"sidechain", true, ""},
		{"top-agent", true, "a1"},
		{"data-agent", true, "a2"},
		{"compact", true, "acompact-xyz"},
		{"by-path", true, ""},
	}
	for _, tc := range tests {
		if row := got[tc.id]; row.subagent != tc.subagent || row.agentID != tc.agentID {
			t.Errorf("%s: got subagent=%v agent=%q", tc.id, row.subagent, row.agentID)
		}
	}

	var agentType, status string
	var totalTokens, duration, tools int64
	var session string
	if errRow := s.db.QueryRow(`SELECT agent_type, status, total_tokens, total_duration_ms, total_tool_use_count, session_id FROM agents WHERE agent_id = 'a1'`).
		Scan(&agentType, &status, &totalTokens, &duration, &tools, &session); errRow != nil {
		t.Fatal(errRow)
	}
	if agentType != "Explore" || status != "completed" || totalTokens != 1234 || duration != 5000 || tools != 7 || session != "s1" {
		t.Fatalf("dispatch metadata: %s %s %d %d %d %s", agentType, status, totalTokens, duration, tools, session)
	}

	data := mustData(t, s, "", "", "")
	types := map[string]SubagentRow{}
	for _, row := range data.Subagents {
		types[row.AgentType] = row
	}
	for kind, wantTurns := range map[string]int64{"Explore": 1, "Plan": 1, "auto-compact": 1, "unknown": 2} {
		if types[kind].Turns != wantTurns {
			t.Errorf("subagents[%s].turns = %d, want %d (all: %+v)", kind, types[kind].Turns, wantTurns, data.Subagents)
		}
	}
	if types["unknown"].Dispatches != 0 || types["Explore"].Dispatches != 1 {
		t.Errorf("dispatch counts: %+v", data.Subagents)
	}
	if want := int64(5 * 11); data.Totals.SubagentTokens != want {
		t.Errorf("subagent-tokens = %d, want %d", data.Totals.SubagentTokens, want)
	}
	var explore *DispatchRow
	for i := range data.Dispatches {
		if data.Dispatches[i].AgentID == "a1" {
			explore = &data.Dispatches[i]
		}
	}
	if explore == nil || explore.AgentType != "Explore" || explore.ToolUses != 7 || explore.DurationMs != 5000 ||
		explore.Status != "completed" || explore.Model != "claude-opus-5-5" || explore.Started != "2026-10-01T10:00:00Z" {
		t.Fatalf("dispatch row: %+v", explore)
	}
}

func TestSessionFields(t *testing.T) {
	dir := t.TempDir()
	u := usageFixture{out: 1}
	noCwd := func(line string) string {
		var m map[string]any
		_ = json.Unmarshal([]byte(line), &m)
		delete(m, "cwd")
		delete(m, "gitBranch")
		return mustJSON(t, m)
	}
	writeFile(t, filepath.Join(dir, "p", "s1.jsonl"), lines(
		mustJSON(t, map[string]any{"type": "ai-title", "sessionId": "s1", "aiTitle": "AI one"}),
		noCwd(assistantLine(t, "s1", "m1", "2026-10-01T10:05:00Z", "claude-opus-5-5", u, nil)),
		assistantLine(t, "s1", "m2", "2026-10-01T09:00:00Z", "claude-opus-5-5", u, map[string]any{"cwd": `C:\Users\me\repo\`, "gitBranch": "feat"}),
		assistantLine(t, "s1", "m3", "2026-10-01T11:00:00Z", "claude-opus-5-5", u, map[string]any{"cwd": "/other/place", "gitBranch": "later"}),
		mustJSON(t, map[string]any{"type": "custom-title", "sessionId": "s1", "customTitle": "Mine"}),
		mustJSON(t, map[string]any{"type": "ai-title", "sessionId": "s1", "aiTitle": "AI two"}),
	))
	s := newTestService(t, dir)
	mustScan(t, s)
	data := mustData(t, s, "", "", "")
	if len(data.Sessions) != 1 {
		t.Fatalf("sessions: %+v", data.Sessions)
	}
	got := data.Sessions[0]
	if got.Project != "me/repo" || got.Branch != "feat" || got.Topic != "Mine" ||
		got.First != "2026-10-01T09:00:00Z" || got.Last != "2026-10-01T11:00:00Z" || got.DurationMin != 120 {
		t.Fatalf("session: %+v", got)
	}
}

func TestProjectName(t *testing.T) {
	tests := map[string]string{
		"":                      "unknown",
		"/":                     "unknown",
		"/root":                 "/root",
		"/root/":                "/root",
		"/home/me/work/proj":    "work/proj",
		"/home/me/work/proj///": "work/proj",
		`C:\Users\me\repo\`:     "me/repo",
		"relative":              "relative",
		"/a/b":                  "a/b",
	}
	for cwd, want := range tests {
		if got := projectName(cwd); got != want {
			t.Errorf("projectName(%q) = %q, want %q", cwd, got, want)
		}
	}
}

// --- pricing ---

func TestResolveModel(t *testing.T) {
	tests := []struct {
		model, want string
		ok          bool
	}{
		{"claude-opus-5-5", "claude-opus-5-5", true},
		{"claude-sonnet-4-5-20250929", "claude-sonnet-4-5", true},
		{"claude-fable-5-1-20261001", "claude-fable-5-1", true},
		{"claude-fable-5-20260101", "claude-fable-5", true},
		{"claude-opus-4-1", "claude-opus-5-5", true},
		{"claude-3-5-sonnet-latest", "claude-sonnet-5-5", true},
		{"claude-mythos-preview", "claude-fable-5-1", true},
		{"claude-3-haiku", "claude-haiku-5-5", true},
		{"<synthetic>", "", false},
		{"gpt-5", "", false},
		{"", "", false},
	}
	for _, tc := range tests {
		got, ok := resolveModel(tc.model)
		if got != tc.want || ok != tc.ok {
			t.Errorf("resolveModel(%q) = %q, %v; want %q, %v", tc.model, got, ok, tc.want, tc.ok)
		}
	}
}

func TestCostOf(t *testing.T) {
	tests := []struct {
		name   string
		model  string
		tokens tokens
		want   float64
		priced bool
	}{
		{"opus 4.5 all kinds", "claude-opus-4-5", tokens{Input: 1e6, Output: 1e6, CacheRead: 1e6, Write5m: 1e6, Write1h: 1e6}, 5 + 25 + 0.5 + 6.25 + 10, true},
		{"5m vs 1h writes", "claude-sonnet-4-6", tokens{Write5m: 2e6, Write1h: 1e6}, 2*3.75 + 6, true},
		{"dated suffix", "claude-sonnet-4-5-20250929", tokens{Output: 1e6}, 15, true},
		{"haiku 5.5 small prompt", "claude-haiku-5-5", tokens{Input: 50_000, CacheRead: 50_000, Output: 1e6}, 0.05*0.10 + 0.05*0.01 + 0.50, true},
		{"haiku 5.5 large prompt", "claude-haiku-5-5", tokens{Input: 50_000, CacheRead: 50_000, Write1h: 1, Output: 1e6}, 0.05*0.50 + 0.05*0.05 + 1e-6*1.00 + 2.50, true},
		{"synthetic unpriced", "<synthetic>", tokens{Output: 1e6}, 0, false},
		{"other vendor unpriced", "grok-4", tokens{Output: 1e6}, 0, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, priced := costOf(tc.model, tc.tokens)
			if priced != tc.priced || math.Abs(got-tc.want) > 1e-9 {
				t.Fatalf("costOf = %v, %v; want %v, %v", got, priced, tc.want, tc.priced)
			}
		})
	}
}

// --- aggregation ---

func TestLocalDayBucketingDailyZeroFillAndHourly(t *testing.T) {
	setLocal(t, time.FixedZone("UTC+6", 6*3600))
	dir := t.TempDir()
	u := usageFixture{in: 1, out: 100}
	writeFile(t, filepath.Join(dir, "p", "s1.jsonl"), lines(
		// 20:30 UTC on Oct 1 is 02:30 local on Oct 2.
		assistantLine(t, "s1", "m1", "2026-10-01T20:30:00Z", "claude-opus-5-5", u, nil),
		assistantLine(t, "s1", "m2", "2026-10-02T03:00:00Z", "claude-opus-5-5", u, nil),
		// 17:59 UTC on Oct 3 is 23:59 local on Oct 3.
		assistantLine(t, "s1", "m3", "2026-10-03T17:59:00Z", "claude-opus-5-5", u, nil),
	))
	s := newTestService(t, dir)
	mustScan(t, s)

	data := mustData(t, s, "2026-10-01", "2026-10-04", "")
	wantDays := []struct {
		day   string
		turns int64
	}{{"2026-10-01", 0}, {"2026-10-02", 2}, {"2026-10-03", 1}, {"2026-10-04", 0}}
	if len(data.Daily) != len(wantDays) {
		t.Fatalf("daily: %+v", data.Daily)
	}
	for i, want := range wantDays {
		if data.Daily[i].Day != want.day || data.Daily[i].Turns != want.turns {
			t.Errorf("daily[%d] = %+v, want %+v", i, data.Daily[i], want)
		}
	}
	if len(data.Hourly) != 24 {
		t.Fatalf("hourly has %d entries", len(data.Hourly))
	}
	if data.Hourly[2].Turns != 1 || data.Hourly[9].Turns != 1 || data.Hourly[23].Turns != 1 {
		t.Errorf("hourly: %+v", data.Hourly)
	}
	// Two distinct days have data.
	if data.Hourly[2].AvgTurns != 0.5 || data.Hourly[2].AvgOutput != 50 {
		t.Errorf("hourly averages: %+v", data.Hourly[2])
	}

	// m1 was written on Oct 1 UTC but belongs to local Oct 2.
	if got := mustData(t, s, "2026-10-02", "2026-10-02", ""); got.Totals.Turns != 2 || len(got.Daily) != 1 {
		t.Errorf("single local day: totals=%+v daily=%+v", got.Totals, got.Daily)
	}

	unbounded := mustData(t, s, "", "", "")
	if len(unbounded.Daily) != 2 || unbounded.Daily[0].Day != "2026-10-02" || unbounded.Daily[1].Day != "2026-10-03" {
		t.Errorf("unbounded daily must list only days with data: %+v", unbounded.Daily)
	}
	if long := mustData(t, s, "2020-01-01", "2026-10-04", ""); len(long.Daily) != 2 {
		t.Errorf("spans over 400 days are not zero-filled: %d rows", len(long.Daily))
	}
}

func TestModelFilterDoesNotChangeModelList(t *testing.T) {
	dir := t.TempDir()
	ts := "2026-10-01T10:00:00Z"
	writeFile(t, filepath.Join(dir, "p", "s1.jsonl"), lines(
		assistantLine(t, "s1", "m1", ts, "claude-opus-5-5", usageFixture{out: 100}, nil),
		assistantLine(t, "s1", "m2", ts, "claude-sonnet-5-5", usageFixture{out: 300}, nil),
		assistantLine(t, "s2", "m3", ts, "<synthetic>", usageFixture{out: 5}, nil),
	))
	s := newTestService(t, dir)
	mustScan(t, s)
	data := mustData(t, s, "", "", "claude-opus-5-5")
	if len(data.Models) != 3 || data.Models[0].Model != "claude-sonnet-5-5" || data.Models[2].Model != "<synthetic>" || data.Models[2].Priced {
		t.Fatalf("models: %+v", data.Models)
	}
	if len(data.ByModel) != 1 || data.ByModel[0].Model != "claude-opus-5-5" || data.Totals.Output != 100 || data.Totals.Sessions != 1 {
		t.Fatalf("filtered: by-model=%+v totals=%+v", data.ByModel, data.Totals)
	}
	if data.SessionsTotal != 1 || len(data.Projects) != 1 || data.Projects[0].Project != "work/proj" || len(data.Branches) != 1 {
		t.Fatalf("filtered groups: sessions=%d projects=%+v branches=%+v", data.SessionsTotal, data.Projects, data.Branches)
	}
	if want := 100 * 20.0 / 1e6; math.Abs(data.Totals.Cost-want) > 1e-12 {
		t.Fatalf("cost = %v, want %v", data.Totals.Cost, want)
	}
}

// --- HTTP ---

func TestHTTPHandlers(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "p", "s1.jsonl"), lines(
		assistantLine(t, "s1", "m1", "2026-10-01T10:00:00Z", "claude-opus-5-5", usageFixture{out: 100}, nil),
	))
	s := newTestService(t, dir, filepath.Join(dir, "missing"))
	mustScan(t, s)

	do := func(method, target string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		s.ServeHTTP(rec, httptest.NewRequest(method, target, nil))
		return rec
	}

	rec := do(http.MethodGet, "/app/claude-usage/status")
	if rec.Code != http.StatusOK {
		t.Fatalf("status: %d %s", rec.Code, rec.Body)
	}
	var status map[string]any
	if errDecode := json.Unmarshal(rec.Body.Bytes(), &status); errDecode != nil {
		t.Fatal(errDecode)
	}
	for _, key := range []string{"scanning", "files-total", "files-done", "bytes-total", "bytes-done", "last-scan-at", "last-error", "turns", "sessions", "sources", "db-path"} {
		if _, ok := status[key]; !ok {
			t.Errorf("status lacks %q: %s", key, rec.Body)
		}
	}
	if status["turns"] != float64(1) || status["sessions"] != float64(1) || status["last-scan-at"] == "" {
		t.Errorf("status values: %s", rec.Body)
	}
	if sources, _ := status["sources"].([]any); len(sources) != 1 || sources[0] != dir {
		t.Errorf("sources must list existing dirs only: %v", status["sources"])
	}

	rec = do(http.MethodGet, "/app/claude-usage/data?from=2026-10-01&to=2026-10-01")
	if rec.Code != http.StatusOK {
		t.Fatalf("data: %d %s", rec.Code, rec.Body)
	}
	var data map[string]any
	if errDecode := json.Unmarshal(rec.Body.Bytes(), &data); errDecode != nil {
		t.Fatal(errDecode)
	}
	for _, key := range []string{"generated-at", "from", "to", "models", "totals", "daily", "hourly", "by-model", "projects", "branches", "sessions", "sessions-total", "subagents", "dispatches"} {
		if _, ok := data[key]; !ok {
			t.Errorf("data lacks %q", key)
		}
	}
	for _, key := range []string{"subagents", "dispatches"} {
		if list, ok := data[key].([]any); !ok || len(list) != 0 {
			t.Errorf("%s must be an empty list, got %v", key, data[key])
		}
	}
	totals, _ := data["totals"].(map[string]any)
	for _, key := range []string{"sessions", "turns", "input", "output", "cache-read", "cache-write", "subagent-tokens", "cost"} {
		if _, ok := totals[key]; !ok {
			t.Errorf("totals lacks %q", key)
		}
	}
	sessions, _ := data["sessions"].([]any)
	if len(sessions) != 1 {
		t.Fatalf("sessions: %v", data["sessions"])
	}
	for _, key := range []string{"session-id", "project", "branch", "topic", "first", "last", "duration-min", "model", "turns", "input", "output", "cache-read", "cache-write", "cost"} {
		if _, ok := sessions[0].(map[string]any)[key]; !ok {
			t.Errorf("session lacks %q", key)
		}
	}

	for _, target := range []string{"/app/claude-usage/data?from=2026-13-01", "/app/claude-usage/data?to=yesterday", "/app/claude-usage/data?from=2026-10-02&to=2026-10-01"} {
		if rec = do(http.MethodGet, target); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: %d, want 400", target, rec.Code)
		}
	}
	if rec = do(http.MethodPost, "/app/claude-usage/status"); rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST status: %d", rec.Code)
	}
	if rec = do(http.MethodGet, "/app/claude-usage/scan"); rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("GET scan: %d", rec.Code)
	}
	if rec = do(http.MethodGet, "/app/claude-usage/nope"); rec.Code != http.StatusNotFound {
		t.Errorf("unknown route: %d", rec.Code)
	}

	// POST scan starts a background scan and answers with the status shape.
	appendFile(t, filepath.Join(dir, "p", "s1.jsonl"), lines(
		assistantLine(t, "s1", "m2", "2026-10-01T11:00:00Z", "claude-opus-5-5", usageFixture{out: 1}, nil),
	))
	rec = do(http.MethodPost, "/app/claude-usage/scan")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"files-total"`) {
		t.Fatalf("scan: %d %s", rec.Code, rec.Body)
	}
	waitIdle(t, s)
	if got := s.Status(context.Background()); got.Turns != 2 || got.LastError != "" {
		t.Fatalf("after POST scan: %+v", got)
	}
}

func TestDataStartsRefreshWhenStale(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "p", "s1.jsonl")
	writeFile(t, path, lines(assistantLine(t, "s1", "m1", "2026-10-01T10:00:00Z", "claude-opus-5-5", usageFixture{out: 1}, nil)))
	s := newTestService(t, dir)
	clock := time.Date(2026, 10, 30, 12, 0, 0, 0, time.UTC)
	s.now = func() time.Time { return clock }
	mustScan(t, s)
	appendFile(t, path, lines(assistantLine(t, "s1", "m2", "2026-10-01T10:01:00Z", "claude-opus-5-5", usageFixture{out: 1}, nil)))

	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/app/claude-usage/data", nil))
	waitIdle(t, s)
	if got := s.Status(context.Background()).Turns; got != 1 {
		t.Fatalf("fresh data must not rescan: %d turns", got)
	}

	clock = clock.Add(61 * time.Second)
	rec = httptest.NewRecorder()
	s.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/app/claude-usage/data", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("data: %d", rec.Code)
	}
	waitIdle(t, s)
	if got := s.Status(context.Background()).Turns; got != 2 {
		t.Fatalf("stale data must rescan: %d turns", got)
	}
}

// waitIdle waits for background scans to finish.
func waitIdle(t *testing.T, s *Service) {
	t.Helper()
	done := make(chan struct{})
	go func() {
		s.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		t.Fatal("scan did not finish")
	}
}
