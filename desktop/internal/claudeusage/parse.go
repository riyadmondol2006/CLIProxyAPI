package claudeusage

import (
	"bytes"
	"encoding/json"
	"strings"
	"time"
)

// tsLayout is how timestamps are stored: fixed-width UTC, so text order is time order.
const tsLayout = "2006-01-02T15:04:05.000Z"

// rawRecord holds the fields of a transcript line this package reads. Fields whose
// shape varies between Claude Code versions are kept raw and decoded leniently.
type rawRecord struct {
	Type          string          `json:"type"`
	SessionID     string          `json:"sessionId"`
	Timestamp     string          `json:"timestamp"`
	Cwd           string          `json:"cwd"`
	GitBranch     string          `json:"gitBranch"`
	UUID          string          `json:"uuid"`
	IsSidechain   json.RawMessage `json:"isSidechain"`
	AgentID       json.RawMessage `json:"agentId"`
	Data          json.RawMessage `json:"data"`
	Message       json.RawMessage `json:"message"`
	ToolUseResult json.RawMessage `json:"toolUseResult"`
	CustomTitle   string          `json:"customTitle"`
	AITitle       string          `json:"aiTitle"`
}

type rawMessage struct {
	ID      string          `json:"id"`
	Model   string          `json:"model"`
	Usage   *rawUsage       `json:"usage"`
	Content json.RawMessage `json:"content"`
}

type rawUsage struct {
	InputTokens              int64 `json:"input_tokens"`
	OutputTokens             int64 `json:"output_tokens"`
	CacheReadInputTokens     int64 `json:"cache_read_input_tokens"`
	CacheCreationInputTokens int64 `json:"cache_creation_input_tokens"`
	CacheCreation            *struct {
		Ephemeral5m *int64 `json:"ephemeral_5m_input_tokens"`
		Ephemeral1h *int64 `json:"ephemeral_1h_input_tokens"`
	} `json:"cache_creation"`
}

type rawDispatch struct {
	AgentID           string `json:"agentId"`
	AgentType         string `json:"agentType"`
	Status            string `json:"status"`
	TotalTokens       int64  `json:"totalTokens"`
	TotalDurationMs   int64  `json:"totalDurationMs"`
	TotalToolUseCount int64  `json:"totalToolUseCount"`
}

// turn is one assistant API response.
type turn struct {
	MessageID string // message.id, or "uuid:"+uuid when the id is missing; "" stores NULL
	SessionID string
	Timestamp string
	Model     string
	Tokens    tokens
	ToolName  string
	Cwd       string
	Subagent  bool
	AgentID   string
}

// dispatch is the result of one Agent tool call, read from the dispatching session.
type dispatch struct {
	AgentID      string
	AgentType    string
	Status       string
	TotalTokens  int64
	DurationMs   int64
	ToolUseCount int64
	SessionID    string
	Timestamp    string
}

// parsed is what one transcript line contributes.
type parsed struct {
	SessionID   string
	Timestamp   string
	Cwd         string
	GitBranch   string
	CustomTitle string
	AITitle     string
	Turn        *turn
	Dispatch    *dispatch
}

// keepMarkers are the compact forms of the record types this package reads. Claude Code
// writes compact JSON, so lines without any of them are skipped without decoding.
var keepMarkers = [][]byte{
	[]byte(`"type":"assistant"`),
	[]byte(`"type":"user"`),
	[]byte(`"type":"custom-title"`),
	[]byte(`"type":"ai-title"`),
}

var spacedTypeMarker = []byte(`"type": `)

// worthDecoding is a cheap pre-filter. It never rejects a line that could be kept.
func worthDecoding(line []byte) bool {
	for _, marker := range keepMarkers {
		if bytes.Contains(line, marker) {
			return true
		}
	}
	// Non-compact JSON: let the decoder decide.
	return bytes.Contains(line, spacedTypeMarker)
}

// parseLine decodes one transcript line. It returns false for lines that are invalid,
// of another type, or missing a session id.
func parseLine(line []byte, subagentPath bool) (parsed, bool) {
	var out parsed
	if !worthDecoding(line) {
		return out, false
	}
	var rec rawRecord
	if errDecode := json.Unmarshal(line, &rec); errDecode != nil {
		return out, false
	}
	switch rec.Type {
	case "assistant", "user", "custom-title", "ai-title":
	default:
		return out, false
	}
	if rec.SessionID == "" {
		return out, false
	}
	out.SessionID = rec.SessionID
	out.Timestamp = normalizeTimestamp(rec.Timestamp)
	out.Cwd = rec.Cwd
	out.GitBranch = rec.GitBranch
	switch rec.Type {
	case "custom-title":
		out.CustomTitle = strings.TrimSpace(rec.CustomTitle)
	case "ai-title":
		out.AITitle = strings.TrimSpace(rec.AITitle)
	case "assistant":
		out.Turn = parseTurn(&rec, out.Timestamp, subagentPath)
	case "user":
		out.Dispatch = parseDispatch(&rec, out.Timestamp)
	}
	return out, true
}

func parseTurn(rec *rawRecord, timestamp string, subagentPath bool) *turn {
	if len(rec.Message) == 0 || rec.Message[0] != '{' {
		return nil
	}
	var msg rawMessage
	if errDecode := json.Unmarshal(rec.Message, &msg); errDecode != nil || msg.Usage == nil {
		return nil
	}
	u := msg.Usage
	t := tokens{Input: u.InputTokens, Output: u.OutputTokens, CacheRead: u.CacheReadInputTokens}
	if cc := u.CacheCreation; cc != nil && (cc.Ephemeral5m != nil || cc.Ephemeral1h != nil) {
		if cc.Ephemeral5m != nil {
			t.Write5m = *cc.Ephemeral5m
		}
		if cc.Ephemeral1h != nil {
			t.Write1h = *cc.Ephemeral1h
		}
	} else {
		t.Write5m = u.CacheCreationInputTokens
	}
	if t.Input == 0 && t.Output == 0 && t.CacheRead == 0 && t.Write5m == 0 && t.Write1h == 0 {
		return nil
	}
	agentPresent := len(rec.AgentID) > 0 && string(rec.AgentID) != "null"
	agentID := rawString(rec.AgentID)
	if agentID == "" {
		agentID = dataAgentID(rec.Data)
	}
	id := msg.ID
	if id == "" && rec.UUID != "" {
		id = "uuid:" + rec.UUID
	}
	return &turn{
		MessageID: id,
		SessionID: rec.SessionID,
		Timestamp: timestamp,
		Model:     msg.Model,
		Tokens:    t,
		ToolName:  firstToolName(msg.Content),
		Cwd:       rec.Cwd,
		Subagent:  subagentPath || truthy(rec.IsSidechain) || agentPresent || agentID != "",
		AgentID:   agentID,
	}
}

func parseDispatch(rec *rawRecord, timestamp string) *dispatch {
	if len(rec.ToolUseResult) == 0 || rec.ToolUseResult[0] != '{' || !bytes.Contains(rec.ToolUseResult, []byte(`"agentType"`)) {
		return nil
	}
	var res rawDispatch
	if errDecode := json.Unmarshal(rec.ToolUseResult, &res); errDecode != nil {
		return nil
	}
	if res.AgentID == "" || res.AgentType == "" {
		return nil
	}
	return &dispatch{
		AgentID:      res.AgentID,
		AgentType:    res.AgentType,
		Status:       res.Status,
		TotalTokens:  res.TotalTokens,
		DurationMs:   res.TotalDurationMs,
		ToolUseCount: res.TotalToolUseCount,
		SessionID:    rec.SessionID,
		Timestamp:    timestamp,
	}
}

// firstToolName returns the name of the first tool_use block in message.content.
func firstToolName(content json.RawMessage) string {
	if len(content) == 0 || content[0] != '[' || !bytes.Contains(content, []byte(`tool_use`)) {
		return ""
	}
	var items []struct {
		Type string `json:"type"`
		Name string `json:"name"`
	}
	if errDecode := json.Unmarshal(content, &items); errDecode != nil {
		return ""
	}
	for _, item := range items {
		if item.Type == "tool_use" {
			return item.Name
		}
	}
	return ""
}

func dataAgentID(data json.RawMessage) string {
	if len(data) == 0 || data[0] != '{' {
		return ""
	}
	var d struct {
		AgentID json.RawMessage `json:"agentId"`
	}
	if errDecode := json.Unmarshal(data, &d); errDecode != nil {
		return ""
	}
	return rawString(d.AgentID)
}

// rawString returns a JSON string value, or "" for any other JSON value.
func rawString(raw json.RawMessage) string {
	if len(raw) == 0 || raw[0] != '"' {
		return ""
	}
	var s string
	if errDecode := json.Unmarshal(raw, &s); errDecode != nil {
		return ""
	}
	return s
}

// truthy follows JavaScript truthiness for JSON values.
func truthy(raw json.RawMessage) bool {
	switch strings.TrimSpace(string(raw)) {
	case "", "false", "null", "0", `""`:
		return false
	}
	return true
}

// normalizeTimestamp converts an RFC3339 timestamp to the stored UTC form, or "".
func normalizeTimestamp(value string) string {
	if value == "" {
		return ""
	}
	parsedTime, errParse := time.Parse(time.RFC3339Nano, value)
	if errParse != nil {
		return ""
	}
	return parsedTime.UTC().Format(tsLayout)
}

// projectName returns the last two path segments of a working directory.
func projectName(cwd string) string {
	path := strings.ReplaceAll(strings.TrimSpace(cwd), `\`, "/")
	for len(path) > 1 && strings.HasSuffix(path, "/") {
		path = strings.TrimSuffix(path, "/")
	}
	if path == "" || path == "/" {
		return "unknown"
	}
	parts := strings.Split(path, "/")
	segments := make([]string, 0, len(parts))
	for _, part := range parts {
		if part != "" {
			segments = append(segments, part)
		}
	}
	switch {
	case len(segments) == 0:
		return "unknown"
	case len(segments) == 1:
		if strings.HasPrefix(path, "/") {
			return "/" + segments[0]
		}
		return segments[0]
	default:
		return segments[len(segments)-2] + "/" + segments[len(segments)-1]
	}
}
