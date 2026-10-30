package app

import (
	"context"
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

// Diagnostics explains why the proxy service is not running. GET /app/diagnostics returns it.
type Diagnostics struct {
	// Available is false when the service manager can't be asked (no systemd, a container,
	// or a dev server without service control). Unit is empty then.
	Available bool       `json:"available"`
	Error     string     `json:"error,omitempty"`
	Unit      UnitState  `json:"unit"`
	Log       ServiceLog `json:"log"`
	// Hints are likely causes, the most direct first.
	Hints  []Hint `json:"hints"`
	Listen Listen `json:"listen"`
	// Reachable reports whether something accepts connections on the proxy's address.
	Reachable bool `json:"reachable"`
}

// UnitState is what systemd knows about the service's last run.
type UnitState struct {
	ActiveState string `json:"active-state"` // active, inactive, failed, activating, ...
	SubState    string `json:"sub-state"`    // running, dead, failed, auto-restart, ...
	Result      string `json:"result"`       // success, exit-code, signal, core-dump, start-limit-hit, ...
	// ExitCode is how the main process ended: exited, killed, dumped, or "" when it hasn't run.
	ExitCode string `json:"exit-code"`
	// ExitStatus is the exit status for exited, or the signal number for killed and dumped.
	ExitStatus int `json:"exit-status"`
	// Restarts counts automatic restarts since the service was last started by hand.
	Restarts int `json:"restarts"`
	// ChangedAt is when the service entered its current state (RFC 3339), or "" when unknown.
	ChangedAt string `json:"changed-at"`
}

// ServiceLog is the redacted tail of the service's journal.
type ServiceLog struct {
	Available bool     `json:"available"`
	Error     string   `json:"error,omitempty"`
	Lines     []string `json:"lines"`
	// Truncated is true when older lines or the end of a very long line were dropped.
	Truncated bool `json:"truncated"`
}

// Hint is a likely cause of the failure.
type Hint struct {
	Code string `json:"code"`
	// Detail is the matching message, address, or path (already redacted).
	Detail string `json:"detail,omitempty"`
	// ConfigLine is the config file line an error points at, or 0.
	ConfigLine int `json:"config-line,omitempty"`
}

// Hint codes.
const (
	HintPortInUse          = "port_in_use"
	HintAddressUnavailable = "address_unavailable"
	HintConfigInvalid      = "config_invalid"
	HintPermissionDenied   = "permission_denied"
	HintTokenNotWritten    = "token_not_written"
	HintProgramMissing     = "program_missing"
	HintCrashLoop          = "crash_loop"
)

// hintOrder lists hint codes from the most to the least direct cause.
var hintOrder = []string{
	HintPortInUse, HintAddressUnavailable, HintConfigInvalid, HintPermissionDenied,
	HintTokenNotWritten, HintProgramMissing, HintCrashLoop,
}

// Diagnoser is implemented by services that can explain why they stopped.
type Diagnoser interface {
	// Diagnose reads the unit state and the log tail. The error is about the unit state;
	// the log reports its own availability.
	Diagnose(ctx context.Context) (UnitState, ServiceLog, error)
}

const (
	journalLines    = 80
	maxLogLineBytes = 1000
	maxLogBytes     = 32 << 10
	maxDetailBytes  = 300
	redacted        = "[redacted]"
)

const unitProperties = "--property=ActiveState,SubState,Result,ExecMainCode,ExecMainStatus,NRestarts,StateChangeTimestamp"

// exitCodes maps systemd's ExecMainCode (the siginfo CLD_* code) to a word.
var exitCodes = map[string]string{"1": "exited", "2": "killed", "3": "dumped"}

// Diagnose implements Diagnoser.
func (s *SystemdUser) Diagnose(ctx context.Context) (UnitState, ServiceLog, error) {
	unit, errUnit := s.unitState(ctx)
	return unit, s.journal(ctx), errUnit
}

func (s *SystemdUser) unitState(ctx context.Context) (UnitState, error) {
	out, errShow := s.systemctl(ctx, "show", ServiceName, unitProperties, "--timestamp=unix")
	if errShow != nil && strings.Contains(strings.ToLower(string(out)), "timestamp") {
		// Older systemd has no --timestamp=unix: ask again for the default format.
		out, errShow = s.systemctl(ctx, "show", ServiceName, unitProperties)
	}
	if errShow != nil {
		return UnitState{}, fmt.Errorf("systemctl show: %s", commandError(out, errShow))
	}
	props := parseProperties(out)
	status, _ := strconv.Atoi(props["ExecMainStatus"])
	restarts, _ := strconv.Atoi(props["NRestarts"])
	return UnitState{
		ActiveState: props["ActiveState"],
		SubState:    props["SubState"],
		Result:      props["Result"],
		ExitCode:    exitCodes[props["ExecMainCode"]],
		ExitStatus:  status,
		Restarts:    restarts,
		ChangedAt:   parseSystemdTime(props["StateChangeTimestamp"]),
	}, nil
}

func (s *SystemdUser) journal(ctx context.Context) ServiceLog {
	out, errRun := s.command(ctx, "journalctl", "--user", "-u", ServiceName,
		"-n", strconv.Itoa(journalLines), "--no-pager", "--quiet", "-o", "short-iso")
	if errRun != nil {
		return ServiceLog{Lines: []string{}, Error: "journalctl: " + commandError(out, errRun)}
	}
	lines := []string{}
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimRight(line, "\r\t ")
		if line == "" || strings.HasPrefix(line, "-- ") {
			continue
		}
		lines = append(lines, redactLogLine(line))
	}
	lines, truncated := boundLog(lines)
	return ServiceLog{Available: true, Lines: lines, Truncated: truncated}
}

// parseSystemdTime reads "@<unix seconds>" (--timestamp=unix) or systemd's default local
// format and returns RFC 3339 in UTC, or "" when the value is empty or unreadable.
func parseSystemdTime(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || value == "n/a" {
		return ""
	}
	if raw, ok := strings.CutPrefix(value, "@"); ok {
		raw, _, _ = strings.Cut(raw, ".")
		seconds, errParse := strconv.ParseInt(raw, 10, 64)
		if errParse != nil || seconds <= 0 {
			return ""
		}
		return time.Unix(seconds, 0).UTC().Format(time.RFC3339)
	}
	parsed, errParse := time.ParseInLocation("Mon 2006-01-02 15:04:05 MST", value, time.Local)
	if errParse != nil {
		return ""
	}
	return parsed.UTC().Format(time.RFC3339)
}

// commandError is the first line a failed command printed, or the run error itself.
func commandError(out []byte, errRun error) string {
	for _, line := range strings.Split(string(out), "\n") {
		if line = strings.TrimSpace(line); line != "" {
			return truncateBytes(redactLogLine(line), maxDetailBytes)
		}
	}
	return errRun.Error()
}

// truncateBytes shortens text to at most limit bytes (plus an ellipsis) on a rune boundary.
func truncateBytes(text string, limit int) string {
	if len(text) <= limit {
		return text
	}
	cut := limit
	for cut > 0 && !utf8.RuneStart(text[cut]) {
		cut--
	}
	return text[:cut] + "…"
}

// boundLog keeps the newest lines within maxLogBytes and shortens very long lines.
func boundLog(lines []string) ([]string, bool) {
	truncated := false
	kept := make([]string, 0, len(lines))
	total := 0
	for i := len(lines) - 1; i >= 0; i-- {
		line := lines[i]
		if len(line) > maxLogLineBytes {
			line = truncateBytes(line, maxLogLineBytes)
			truncated = true
		}
		if total+len(line)+1 > maxLogBytes {
			truncated = true
			break
		}
		total += len(line) + 1
		kept = append(kept, line)
	}
	slices.Reverse(kept)
	return kept, truncated
}

var (
	bearerPattern     = regexp.MustCompile(`(?i)\b(bearer)\s+[A-Za-z0-9._~+/=-]+`)
	basicPattern      = regexp.MustCompile(`\b(Basic)\s+[A-Za-z0-9+/]{8,}={0,2}`)
	urlUserPattern    = regexp.MustCompile(`(?i)\b([a-z][a-z0-9+.-]*://)[^/\s:@]+:[^/\s@]+@`)
	jsonSecretPattern = regexp.MustCompile(`(?i)("[\w.-]*(?:key|token|secret|password|passwd|authorization)[\w.-]*"\s*:\s*)"[^"]*"`)
	assignPattern     = regexp.MustCompile(`(?i)([\w.-]*(?:key|token|secret|password|passwd|authorization)[\w.-]*=)("[^"]*"|'[^']*'|[^\s"',;&]+)`)
	skKeyPattern      = regexp.MustCompile(`\bsk-[A-Za-z0-9_-]{8,}`)
	hexRunPattern     = regexp.MustCompile(`\b[0-9a-fA-F]{32,}\b`)
	// Slashes are left out so file paths are not mistaken for base64.
	base64RunPattern = regexp.MustCompile(`[A-Za-z0-9+_-]{32,}={0,2}`)
)

// redactLogLine hides values that look like credentials: bearer tokens, sk- keys,
// key=/token=/secret= values, passwords in URLs, and long hex or base64 runs.
func redactLogLine(line string) string {
	line = bearerPattern.ReplaceAllString(line, "${1} "+redacted)
	line = basicPattern.ReplaceAllString(line, "${1} "+redacted)
	line = urlUserPattern.ReplaceAllString(line, "${1}"+redacted+"@")
	line = jsonSecretPattern.ReplaceAllString(line, `${1}"`+redacted+`"`)
	line = assignPattern.ReplaceAllString(line, "${1}"+redacted)
	line = skKeyPattern.ReplaceAllString(line, "sk-"+redacted)
	line = hexRunPattern.ReplaceAllString(line, redacted)
	return base64RunPattern.ReplaceAllStringFunc(line, func(run string) string {
		var upper, lower, digit bool
		for _, r := range run {
			switch {
			case r >= 'A' && r <= 'Z':
				upper = true
			case r >= 'a' && r <= 'z':
				lower = true
			case r >= '0' && r <= '9':
				digit = true
			}
		}
		if upper && lower && digit {
			return redacted
		}
		return run
	})
}

// The patterns below match what the proxy (cmd/server, internal/config, internal/api) and
// systemd actually print.
var (
	// net.Listen errors: "listen tcp 127.0.0.1:8317: bind: address already in use".
	bindPattern = regexp.MustCompile(`listen (?:tcp|tcp4|tcp6) (\S*): bind: (address already in use|cannot assign requested address|permission denied)`)
	// cmd/server: "failed to load config: failed to parse config file: yaml: line 12: ...".
	configPattern     = regexp.MustCompile(`failed to (?:load config|parse config file|read config file|parse prepared config): (.+)`)
	configLinePattern = regexp.MustCompile(`\bline (\d+)\b`)
	// cmd/server: "failed to write local management token: create token directory: ...".
	tokenPattern      = regexp.MustCompile(`failed to write local management token: (.+)`)
	permissionPattern = regexp.MustCompile(`(?i)permission denied|operation not permitted`)
	// Go path errors: "open /home/u/.config/cliproxyapi/config.yaml: permission denied".
	pathPattern = regexp.MustCompile(`(?i)\b(?:open|openat|mkdir|stat|lstat|read|write|rename|remove|unlinkat|chmod|chdir) (/[^\s:]+): (?:permission denied|operation not permitted)`)
	// systemd: "Failed to locate executable /usr/bin/cli-proxy-api: No such file or directory",
	// "Failed at step EXEC spawning ...", "Main process exited, code=exited, status=203/EXEC".
	execPattern       = regexp.MustCompile(`Failed (?:at step EXEC spawning|to locate executable|to execute) (/[^\s:]+)|status=203/EXEC`)
	startLimitPattern = regexp.MustCompile(`Start request repeated too quickly|'start-limit-hit'`)
	startedPattern    = regexp.MustCompile(`\bsystemd\[\d+\]: Start(?:ed|ing) `)
	stoppingPattern   = regexp.MustCompile(`\bsystemd\[\d+\]: Stopping `)
	// "2026-10-29T14:02:11+06:00 host cli-proxy-api[5120]: " (journalctl -o short-iso).
	journalPrefixPattern = regexp.MustCompile(`^\S+ \S+ [^\s\[:]+(?:\[\d+\])?: `)
	// "[2026-10-29 14:02:11] [--------] [error] [main.go:604] " (the proxy's log format).
	logrusPrefixPattern = regexp.MustCompile(`^(?:\[[^\]]*\] ){3,4}`)
)

// deriveHints finds likely causes in the latest run's log and in the unit state. unitKnown
// says whether unit was read; reachable whether something answers on the proxy's address.
func deriveHints(unit UnitState, unitKnown bool, lines []string, listen Listen, reachable bool) []Hint {
	found := map[string]Hint{}
	add := func(hint Hint) {
		// The first hint of a code wins; a later one only fills in a missing detail.
		if existing, ok := found[hint.Code]; !ok || (existing.Detail == "" && hint.Detail != "") {
			found[hint.Code] = hint
		}
	}
	run := lastRun(lines)
	if !stoppedOnRequest(run) {
		// Newest first, so a code keeps the detail of its latest occurrence.
		for i := len(run) - 1; i >= 0; i-- {
			if hint, ok := lineHint(run, i); ok {
				add(hint)
			}
		}
	}
	if unitKnown {
		down := unit.ActiveState == "inactive" || unit.ActiveState == "failed"
		if down && reachable {
			// The service is not running, yet something answers on its port.
			add(Hint{Code: HintPortInUse, Detail: upstreamHost(listen)})
		}
		if unit.Result == "start-limit-hit" {
			add(Hint{Code: HintCrashLoop})
		}
		if unit.ExitCode == "exited" && unit.ExitStatus == 203 {
			add(Hint{Code: HintProgramMissing})
		}
	}
	hints := []Hint{}
	for _, code := range hintOrder {
		if hint, ok := found[code]; ok {
			hints = append(hints, hint)
		}
	}
	return hints
}

// lastRun returns the lines after systemd last started the service (all lines when the
// start is no longer in the tail), so problems from earlier runs are not reported.
func lastRun(lines []string) []string {
	for i := len(lines) - 1; i >= 0; i-- {
		if startedPattern.MatchString(lines[i]) {
			return lines[i+1:]
		}
	}
	return lines
}

// stoppedOnRequest reports whether the run ended because someone stopped the service.
func stoppedOnRequest(run []string) bool {
	return slices.ContainsFunc(run, stoppingPattern.MatchString)
}

// logMessage strips the journal and proxy log prefixes from a line.
func logMessage(line string) string {
	return logrusPrefixPattern.ReplaceAllString(journalPrefixPattern.ReplaceAllString(line, ""), "")
}

func lineHint(lines []string, index int) (Hint, bool) {
	line := lines[index]
	if match := bindPattern.FindStringSubmatch(line); match != nil {
		if match[2] == "address already in use" {
			return Hint{Code: HintPortInUse, Detail: match[1]}, true
		}
		return Hint{Code: HintAddressUnavailable, Detail: match[1]}, true
	}
	if strings.Contains(line, "address already in use") {
		return Hint{Code: HintPortInUse}, true
	}
	if match := tokenPattern.FindStringSubmatch(line); match != nil {
		return Hint{Code: HintTokenNotWritten, Detail: truncateBytes(match[1], maxDetailBytes)}, true
	}
	if match := execPattern.FindStringSubmatch(line); match != nil {
		return Hint{Code: HintProgramMissing, Detail: match[1]}, true
	}
	permission := permissionPattern.MatchString(line)
	if match := configPattern.FindStringSubmatch(line); match != nil && !permission {
		detail := match[1]
		for _, prefix := range []string{"failed to parse config file: ", "failed to read config file: ", "failed to parse prepared config: "} {
			detail = strings.TrimPrefix(detail, prefix)
		}
		// yaml.v3 puts each unmarshal error on its own line.
		if strings.HasSuffix(detail, "unmarshal errors:") && index+1 < len(lines) {
			detail += " " + strings.TrimSpace(logMessage(lines[index+1]))
		}
		hint := Hint{Code: HintConfigInvalid, Detail: truncateBytes(detail, maxDetailBytes)}
		if lineMatch := configLinePattern.FindStringSubmatch(detail); lineMatch != nil {
			hint.ConfigLine, _ = strconv.Atoi(lineMatch[1])
		}
		return hint, true
	}
	if permission {
		detail := strings.TrimSpace(logMessage(line))
		if match := pathPattern.FindStringSubmatch(line); match != nil {
			detail = match[1]
		}
		return Hint{Code: HintPermissionDenied, Detail: truncateBytes(detail, maxDetailBytes)}, true
	}
	if startLimitPattern.MatchString(line) {
		return Hint{Code: HintCrashLoop}, true
	}
	return Hint{}, false
}
