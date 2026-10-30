package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// scriptedRunner answers systemctl and journalctl from canned output; it never runs a command.
type scriptedRunner struct {
	calls      []string
	show       func(args []string) (string, error)
	journal    string
	journalErr error
}

func (s *scriptedRunner) run(_ context.Context, name string, args ...string) ([]byte, error) {
	s.calls = append(s.calls, name+" "+strings.Join(args, " "))
	switch name {
	case "systemctl":
		if s.show == nil {
			return nil, errors.New(`exec: "systemctl": executable file not found in $PATH`)
		}
		out, err := s.show(args)
		return []byte(out), err
	case "journalctl":
		return []byte(s.journal), s.journalErr
	}
	return nil, errors.New("unexpected command " + name)
}

const failedShow = "ActiveState=failed\nSubState=failed\nResult=exit-code\nExecMainCode=1\nExecMainStatus=1\n" +
	"NRestarts=5\nStateChangeTimestamp=@1793248332\n"

func TestSystemdUserDiagnoseReadsStateAndRedactedJournal(t *testing.T) {
	runner := &scriptedRunner{
		show: func([]string) (string, error) { return failedShow, nil },
		journal: "2026-10-29T14:02:10+06:00 host systemd[1404]: Started cliproxyapi.service - CLIProxyAPI AI gateway.\n" +
			"2026-10-29T14:02:11+06:00 host cli-proxy-api[5120]: [2026-10-29 14:02:11] [--------] [info ] request Authorization: Bearer abc.def-123\n" +
			"\n",
	}
	service := &SystemdUser{Run: runner.run}
	unit, serviceLog, errUnit := service.Diagnose(context.Background())
	if errUnit != nil {
		t.Fatalf("diagnose: %v", errUnit)
	}
	want := UnitState{ActiveState: "failed", SubState: "failed", Result: "exit-code", ExitCode: "exited",
		ExitStatus: 1, Restarts: 5, ChangedAt: "2026-10-29T04:32:12Z"}
	if unit != want {
		t.Fatalf("unit = %+v, want %+v", unit, want)
	}
	if !serviceLog.Available || len(serviceLog.Lines) != 2 || serviceLog.Truncated {
		t.Fatalf("unexpected log: %+v", serviceLog)
	}
	if strings.Contains(serviceLog.Lines[1], "abc.def-123") || !strings.Contains(serviceLog.Lines[1], "Bearer [redacted]") {
		t.Fatalf("bearer token not redacted: %q", serviceLog.Lines[1])
	}
	wantCalls := []string{
		"systemctl --user show cliproxyapi.service " + unitProperties + " --timestamp=unix",
		"journalctl --user -u cliproxyapi.service -n 80 --no-pager --quiet -o short-iso",
	}
	if strings.Join(runner.calls, "\n") != strings.Join(wantCalls, "\n") {
		t.Fatalf("commands:\n%s\nwant:\n%s", strings.Join(runner.calls, "\n"), strings.Join(wantCalls, "\n"))
	}
}

func TestSystemdUserDiagnoseFallsBackForOlderSystemd(t *testing.T) {
	runner := &scriptedRunner{show: func(args []string) (string, error) {
		if args[len(args)-1] == "--timestamp=unix" {
			return "Unknown timestamp style: unix", errors.New("exit status 1")
		}
		return "ActiveState=inactive\nSubState=dead\nResult=success\nExecMainCode=2\nExecMainStatus=9\n" +
			"NRestarts=0\nStateChangeTimestamp=Thu 2026-10-29 10:32:12 UTC\n", nil
	}}
	unit, _, errUnit := (&SystemdUser{Run: runner.run}).Diagnose(context.Background())
	if errUnit != nil {
		t.Fatalf("diagnose: %v", errUnit)
	}
	if unit.ExitCode != "killed" || unit.ExitStatus != 9 || unit.ChangedAt != "2026-10-29T10:32:12Z" {
		t.Fatalf("unexpected unit: %+v", unit)
	}
	if len(runner.calls) != 3 {
		t.Fatalf("expected a retry without --timestamp, got %q", runner.calls)
	}
}

func TestSystemdUserDiagnoseWithoutSystemd(t *testing.T) {
	runner := &scriptedRunner{journalErr: errors.New(`exec: "journalctl": executable file not found in $PATH`)}
	unit, serviceLog, errUnit := (&SystemdUser{Run: runner.run}).Diagnose(context.Background())
	if errUnit == nil || !strings.Contains(errUnit.Error(), "executable file not found") {
		t.Fatalf("expected a systemctl error, got %v", errUnit)
	}
	if unit != (UnitState{}) || serviceLog.Available || serviceLog.Lines == nil ||
		!strings.Contains(serviceLog.Error, "journalctl") {
		t.Fatalf("unexpected result: %+v %+v", unit, serviceLog)
	}
	if len(runner.calls) != 2 {
		t.Fatalf("a missing systemctl must not be retried: %q", runner.calls)
	}
}

func TestRedactLogLine(t *testing.T) {
	cases := map[string]string{
		"Authorization: Bearer eyJhbGciOi.payload.sig":                                                     "Authorization: Bearer [redacted]",
		`api_keys=sk-0123456789abcdef0123 other=1`:                                                         "api_keys=[redacted] other=1",
		"using sk-ant-api03-AbCdEf123456 for claude":                                                       "using sk-[redacted] for claude",
		"GET /v1/models?key=AIzaSyA1b2C3&alt=json":                                                         "GET /v1/models?key=[redacted]&alt=json",
		`token="abc def" secret='x y'`:                                                                     "token=[redacted] secret=[redacted]",
		`{"access_token":"ya29.a0Af","expires_in":3599}`:                                                   `{"access_token":"[redacted]","expires_in":3599}`,
		"proxy socks5://alice:hunter2@10.0.0.2:1080":                                                       "proxy socks5://[redacted]@10.0.0.2:1080",
		"id 0123456789abcdef0123456789abcdef01 done":                                                       "id [redacted] done",
		"blob QWxhZGRpbjpvcGVuIHNlc2FtZQ9xYzAbCdEf0123== end":                                              "blob [redacted] end",
		"Basic QWxhZGRpbjpvcGVu":                                                                           "Basic [redacted]",
		"open /home/u/.config/cliproxyapi/config.yaml: denied":                                             "open /home/u/.config/cliproxyapi/config.yaml: denied",
		"failed to write local management token: create token directory: mkdir /run/user/1000/cliproxyapi": "failed to write local management token: create token directory: mkdir /run/user/1000/cliproxyapi",
		"model claude-sonnet-4-5-20250929-thinking-extended used":                                          "model claude-sonnet-4-5-20250929-thinking-extended used",
	}
	for input, want := range cases {
		if got := redactLogLine(input); got != want {
			t.Errorf("redactLogLine(%q)\n got %q\nwant %q", input, got, want)
		}
	}
}

func TestBoundLogKeepsTheNewestLines(t *testing.T) {
	long := strings.Repeat("é", maxLogLineBytes) // two bytes per rune
	lines, truncated := boundLog([]string{"old", long})
	if !truncated || len(lines) != 2 || len(lines[1]) > maxLogLineBytes+len("…") || !strings.HasSuffix(lines[1], "…") {
		t.Fatalf("long line not shortened: truncated=%v len=%d", truncated, len(lines[1]))
	}
	if !strings.HasPrefix(lines[1], "é") || strings.ContainsRune(lines[1], '�') {
		t.Fatal("a line must be cut on a rune boundary")
	}

	many := make([]string, 0, 100)
	for i := 0; i < 100; i++ {
		many = append(many, strings.Repeat("x", 999)+string(rune('a'+i%26)))
	}
	lines, truncated = boundLog(many)
	total := 0
	for _, line := range lines {
		total += len(line) + 1
	}
	if !truncated || total > maxLogBytes || lines[len(lines)-1] != many[len(many)-1] {
		t.Fatalf("expected the newest lines within %d bytes, got %d lines (%d bytes)", maxLogBytes, len(lines), total)
	}
	if lines, truncated = boundLog([]string{"a", "b"}); truncated || len(lines) != 2 {
		t.Fatalf("short logs stay whole: %v %v", lines, truncated)
	}
}

const (
	journalStart = "2026-10-29T14:02:10+06:00 host systemd[1404]: Started cliproxyapi.service - CLIProxyAPI AI gateway."
	proxyLine    = "2026-10-29T14:02:11+06:00 host cli-proxy-api[5120]: [2026-10-29 14:02:11] [--------] [error] [main.go:604] "
	systemdLine  = "2026-10-29T14:02:11+06:00 host systemd[1404]: cliproxyapi.service: "
)

func TestDeriveHintsFromJournal(t *testing.T) {
	stopped := UnitState{ActiveState: "inactive", Result: "success", ExitCode: "exited"}
	listen := Listen{Host: "127.0.0.1", Port: 8317}
	cases := []struct {
		name  string
		lines []string
		want  []Hint
	}{
		{"port in use", []string{journalStart,
			proxyLine + "proxy service exited with error: failed to start HTTP server: listen tcp 127.0.0.1:8317: bind: address already in use"},
			[]Hint{{Code: HintPortInUse, Detail: "127.0.0.1:8317"}}},
		{"wildcard host not available", []string{journalStart,
			proxyLine + "proxy service exited with error: failed to start HTTP server: listen tcp 192.168.1.9:8317: bind: cannot assign requested address"},
			[]Hint{{Code: HintAddressUnavailable, Detail: "192.168.1.9:8317"}}},
		{"yaml syntax", []string{journalStart,
			proxyLine + "failed to load config: failed to parse config file: yaml: line 12: did not find expected key"},
			[]Hint{{Code: HintConfigInvalid, Detail: "yaml: line 12: did not find expected key", ConfigLine: 12}}},
		{"yaml type error on the next line", []string{journalStart,
			proxyLine + "failed to load config: failed to parse config file: yaml: unmarshal errors:",
			"2026-10-29T14:02:11+06:00 host cli-proxy-api[5120]:   line 5: cannot unmarshal !!str `abc` into int"},
			[]Hint{{Code: HintConfigInvalid, Detail: "yaml: unmarshal errors: line 5: cannot unmarshal !!str `abc` into int", ConfigLine: 5}}},
		{"v8 validation", []string{journalStart, proxyLine + "failed to load config: unknown v8 configuration section foo"},
			[]Hint{{Code: HintConfigInvalid, Detail: "unknown v8 configuration section foo"}}},
		{"unreadable config", []string{journalStart,
			proxyLine + "failed to load config: failed to read config file: open /home/u/.config/cliproxyapi/config.yaml: permission denied"},
			[]Hint{{Code: HintPermissionDenied, Detail: "/home/u/.config/cliproxyapi/config.yaml"}}},
		{"token", []string{journalStart,
			proxyLine + "failed to write local management token: create token directory: mkdir /run/user/1000/cliproxyapi: permission denied"},
			[]Hint{{Code: HintTokenNotWritten, Detail: "create token directory: mkdir /run/user/1000/cliproxyapi: permission denied"}}},
		{"missing binary and crash loop", []string{journalStart,
			systemdLine + "Failed to locate executable /usr/bin/cli-proxy-api: No such file or directory",
			systemdLine + "Main process exited, code=exited, status=203/EXEC",
			systemdLine + "Start request repeated too quickly."},
			[]Hint{{Code: HintProgramMissing, Detail: "/usr/bin/cli-proxy-api"}, {Code: HintCrashLoop}}},
		{"earlier runs are ignored", []string{
			proxyLine + "proxy service exited with error: failed to start HTTP server: listen tcp :8317: bind: address already in use",
			journalStart, proxyLine + "failed to load config: unknown v8 configuration section foo"},
			[]Hint{{Code: HintConfigInvalid, Detail: "unknown v8 configuration section foo"}}},
		{"a requested stop is not a failure", []string{journalStart,
			"2026-10-29T14:03:00+06:00 host cli-proxy-api[5120]: [2026-10-29 14:03:00] [a1b2c3d4] [warn ] upstream said: permission denied",
			"2026-10-29T14:05:00+06:00 host systemd[1404]: Stopping cliproxyapi.service - CLIProxyAPI AI gateway..."},
			[]Hint{}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := deriveHints(stopped, true, tc.lines, listen, false)
			gotJSON, _ := json.Marshal(got)
			wantJSON, _ := json.Marshal(tc.want)
			if string(gotJSON) != string(wantJSON) {
				t.Fatalf("hints\n got %s\nwant %s", gotJSON, wantJSON)
			}
		})
	}
}

func TestDeriveHintsFromStatus(t *testing.T) {
	listen := Listen{Host: "", Port: 8317}
	down := UnitState{ActiveState: "failed", Result: "start-limit-hit", ExitCode: "exited", ExitStatus: 203}
	got := deriveHints(down, true, nil, listen, true)
	want := []Hint{{Code: HintPortInUse, Detail: "127.0.0.1:8317"}, {Code: HintProgramMissing}, {Code: HintCrashLoop}}
	gotJSON, _ := json.Marshal(got)
	wantJSON, _ := json.Marshal(want)
	if string(gotJSON) != string(wantJSON) {
		t.Fatalf("hints\n got %s\nwant %s", gotJSON, wantJSON)
	}
	// A running service answering on its own port is not a conflict, and an unknown
	// state gives no status hints.
	if hints := deriveHints(UnitState{ActiveState: "active"}, true, nil, listen, true); len(hints) != 0 {
		t.Fatalf("running service: %+v", hints)
	}
	if hints := deriveHints(UnitState{}, false, nil, listen, true); len(hints) != 0 {
		t.Fatalf("unknown state: %+v", hints)
	}
}

type diagnosingService struct {
	recordingService
	unit UnitState
	log  ServiceLog
	err  error
}

func (d *diagnosingService) Diagnose(context.Context) (UnitState, ServiceLog, error) {
	return d.unit, d.log, d.err
}

func getDiagnostics(t *testing.T, server *Server) (int, map[string]any) {
	t.Helper()
	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/app/diagnostics", nil))
	var body map[string]any
	if errDecode := json.Unmarshal(recorder.Body.Bytes(), &body); errDecode != nil {
		t.Fatalf("decode: %v (%s)", errDecode, recorder.Body.String())
	}
	return recorder.Code, body
}

func TestDiagnosticsEndpoint(t *testing.T) {
	server, _ := newTestServer(t, nil)

	// No service control (dev server, containers): still a well-formed answer.
	code, body := getDiagnostics(t, server)
	if code != http.StatusOK || body["available"] != false || body["error"] == "" {
		t.Fatalf("without a service: %d %v", code, body)
	}
	if hints, ok := body["hints"].([]any); !ok || len(hints) != 0 {
		t.Fatalf("hints must be an empty list: %v", body["hints"])
	}
	if lines, ok := body["log"].(map[string]any)["lines"].([]any); !ok || len(lines) != 0 {
		t.Fatalf("log lines must be an empty list: %v", body["log"])
	}

	// A service without diagnostics behaves the same.
	server.Service = &recordingService{}
	if _, body = getDiagnostics(t, server); body["available"] != false {
		t.Fatalf("plain service: %v", body)
	}

	server.Service = &diagnosingService{
		unit: UnitState{ActiveState: "inactive", SubState: "dead", Result: "success", ExitCode: "exited", ChangedAt: "2026-10-29T08:02:11Z"},
		log: ServiceLog{Available: true, Lines: []string{journalStart,
			proxyLine + "failed to load config: failed to parse config file: yaml: line 3: mapping values are not allowed in this context"}},
	}
	code, body = getDiagnostics(t, server)
	if code != http.StatusOK || body["available"] != true {
		t.Fatalf("diagnosing service: %d %v", code, body)
	}
	unit := body["unit"].(map[string]any)
	if unit["active-state"] != "inactive" || unit["exit-code"] != "exited" || unit["changed-at"] != "2026-10-29T08:02:11Z" {
		t.Fatalf("unit JSON: %v", unit)
	}
	hints := body["hints"].([]any)
	if len(hints) != 1 || hints[0].(map[string]any)["code"] != HintConfigInvalid || hints[0].(map[string]any)["config-line"] != float64(3) {
		t.Fatalf("hints JSON: %v", hints)
	}
	if listen := body["listen"].(map[string]any); listen["port"] != float64(1) {
		t.Fatalf("listen JSON: %v", listen)
	}

	server.Service = &diagnosingService{err: errors.New("systemctl show: Failed to connect to bus"),
		log: ServiceLog{Error: "journalctl: No journal files were found."}}
	if _, body = getDiagnostics(t, server); body["available"] != false ||
		body["error"] != "systemctl show: Failed to connect to bus" {
		t.Fatalf("systemd unavailable: %v", body)
	}

	recorder := httptest.NewRecorder()
	server.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/app/diagnostics", nil))
	if recorder.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST: %d", recorder.Code)
	}
}
