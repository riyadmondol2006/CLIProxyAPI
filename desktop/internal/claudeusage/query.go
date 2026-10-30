package claudeusage

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"
)

const (
	dateLayout = "2006-01-02"
	// maxZeroFillDays bounds the daily series that is zero-filled.
	maxZeroFillDays = 400
	maxSessions     = 500
	maxDispatches   = 50
)

// query is a parsed /data request.
type query struct {
	From, To string // inclusive local dates, "" when unbounded
	Models   map[string]bool
	from, to time.Time // local midnight of From, and of the day after To
}

// parseQuery validates the date range and model filter.
func parseQuery(from, to, models string, loc *time.Location) (query, error) {
	q := query{From: strings.TrimSpace(from), To: strings.TrimSpace(to)}
	if q.From != "" {
		day, errParse := time.ParseInLocation(dateLayout, q.From, loc)
		if errParse != nil {
			return q, fmt.Errorf("invalid from date %q, use YYYY-MM-DD", q.From)
		}
		q.from = day
	}
	if q.To != "" {
		day, errParse := time.ParseInLocation(dateLayout, q.To, loc)
		if errParse != nil {
			return q, fmt.Errorf("invalid to date %q, use YYYY-MM-DD", q.To)
		}
		q.to = day.AddDate(0, 0, 1)
	}
	if !q.from.IsZero() && !q.to.IsZero() && !q.from.Before(q.to) {
		return q, fmt.Errorf("from %s is after to %s", q.From, q.To)
	}
	for _, model := range strings.Split(models, ",") {
		if model = strings.TrimSpace(model); model != "" {
			if q.Models == nil {
				q.Models = make(map[string]bool)
			}
			q.Models[model] = true
		}
	}
	return q, nil
}

// Data is the /app/claude-usage/data response.
type Data struct {
	GeneratedAt   string        `json:"generated-at"`
	From          string        `json:"from"`
	To            string        `json:"to"`
	Models        []ModelOption `json:"models"`
	Totals        Totals        `json:"totals"`
	Daily         []DailyRow    `json:"daily"`
	Hourly        []HourlyRow   `json:"hourly"`
	ByModel       []ModelRow    `json:"by-model"`
	Projects      []ProjectRow  `json:"projects"`
	Branches      []BranchRow   `json:"branches"`
	Sessions      []SessionRow  `json:"sessions"`
	SessionsTotal int           `json:"sessions-total"`
	Subagents     []SubagentRow `json:"subagents"`
	Dispatches    []DispatchRow `json:"dispatches"`
}

// ModelOption lists a model seen in the range, regardless of the model filter.
type ModelOption struct {
	Model  string `json:"model"`
	Turns  int64  `json:"turns"`
	Tokens int64  `json:"tokens"`
	Priced bool   `json:"priced"`
}

// Totals sums every matching turn.
type Totals struct {
	Sessions       int64   `json:"sessions"`
	Turns          int64   `json:"turns"`
	Input          int64   `json:"input"`
	Output         int64   `json:"output"`
	CacheRead      int64   `json:"cache-read"`
	CacheWrite     int64   `json:"cache-write"`
	SubagentTokens int64   `json:"subagent-tokens"`
	Cost           float64 `json:"cost"`
}

// usageSums are the token and cost columns shared by most rows.
type usageSums struct {
	Turns      int64   `json:"turns"`
	Input      int64   `json:"input"`
	Output     int64   `json:"output"`
	CacheRead  int64   `json:"cache-read"`
	CacheWrite int64   `json:"cache-write"`
	Cost       float64 `json:"cost"`
}

func (u *usageSums) add(t tokens, cost float64) {
	u.Turns++
	u.Input += t.Input
	u.Output += t.Output
	u.CacheRead += t.CacheRead
	u.CacheWrite += t.Write5m + t.Write1h
	u.Cost += cost
}

func (u usageSums) total() int64 {
	return u.Input + u.Output + u.CacheRead + u.CacheWrite
}

// DailyRow is one local day.
type DailyRow struct {
	Day string `json:"day"`
	usageSums
}

// HourlyRow is one local hour of the day.
type HourlyRow struct {
	Hour      int     `json:"hour"`
	Turns     int64   `json:"turns"`
	Output    int64   `json:"output"`
	AvgTurns  float64 `json:"avg-turns"`
	AvgOutput float64 `json:"avg-output"`
}

// ModelRow is usage per model.
type ModelRow struct {
	Model string `json:"model"`
	usageSums
	Priced bool `json:"priced"`
}

// ProjectRow is usage per project.
type ProjectRow struct {
	Project  string `json:"project"`
	Sessions int64  `json:"sessions"`
	usageSums
}

// BranchRow is usage per project and git branch.
type BranchRow struct {
	Project  string `json:"project"`
	Branch   string `json:"branch"`
	Sessions int64  `json:"sessions"`
	usageSums
}

// SessionRow is one session with matching turns.
type SessionRow struct {
	SessionID   string  `json:"session-id"`
	Project     string  `json:"project"`
	Branch      string  `json:"branch"`
	Topic       string  `json:"topic"`
	First       string  `json:"first"`
	Last        string  `json:"last"`
	DurationMin float64 `json:"duration-min"`
	Model       string  `json:"model"`
	usageSums
}

// SubagentRow is subagent usage per agent type.
type SubagentRow struct {
	AgentType  string `json:"agent-type"`
	Dispatches int64  `json:"dispatches"`
	usageSums
}

// DispatchRow is one subagent run.
type DispatchRow struct {
	AgentID    string  `json:"agent-id"`
	AgentType  string  `json:"agent-type"`
	Model      string  `json:"model"`
	Started    string  `json:"started"`
	Turns      int64   `json:"turns"`
	ToolUses   int64   `json:"tool-uses"`
	DurationMs int64   `json:"duration-ms"`
	Status     string  `json:"status"`
	Input      int64   `json:"input"`
	Output     int64   `json:"output"`
	CacheRead  int64   `json:"cache-read"`
	CacheWrite int64   `json:"cache-write"`
	Cost       float64 `json:"cost"`
}

type sessionMeta struct {
	Project, Branch, Topic, First, Last string
}

type agentMeta struct {
	Type, Status             string
	DurationMs, ToolUseCount int64
}

// modelPicker tracks output tokens per model to find the dominant one.
type modelPicker map[string]int64

func (m modelPicker) best() string {
	best, bestOut := "", int64(-1)
	for model, out := range m {
		if out > bestOut || out == bestOut && model < best {
			best, bestOut = model, out
		}
	}
	return best
}

type sessionAcc struct {
	usageSums
	models      modelPicker
	first, last string
}

type groupAcc struct {
	usageSums
	sessions map[string]struct{}
}

type subagentAcc struct {
	usageSums
	agents map[string]struct{}
}

type dispatchAcc struct {
	usageSums
	models  modelPicker
	started string
}

func loadSessions(ctx context.Context, db *sql.DB) (map[string]sessionMeta, error) {
	rows, errQuery := db.QueryContext(ctx,
		`SELECT session_id, project, git_branch, custom_title, ai_title, first_ts, last_ts FROM sessions`)
	if errQuery != nil {
		return nil, fmt.Errorf("load sessions: %w", errQuery)
	}
	defer closeRows(rows)
	sessions := make(map[string]sessionMeta)
	for rows.Next() {
		var id, custom, ai string
		var meta sessionMeta
		if errScan := rows.Scan(&id, &meta.Project, &meta.Branch, &custom, &ai, &meta.First, &meta.Last); errScan != nil {
			return nil, fmt.Errorf("read session: %w", errScan)
		}
		meta.Topic = custom
		if meta.Topic == "" {
			meta.Topic = ai
		}
		sessions[id] = meta
	}
	if errRows := rows.Err(); errRows != nil {
		return nil, fmt.Errorf("load sessions: %w", errRows)
	}
	return sessions, nil
}

func loadAgents(ctx context.Context, db *sql.DB) (map[string]agentMeta, error) {
	rows, errQuery := db.QueryContext(ctx,
		`SELECT agent_id, agent_type, status, total_duration_ms, total_tool_use_count FROM agents`)
	if errQuery != nil {
		return nil, fmt.Errorf("load agents: %w", errQuery)
	}
	defer closeRows(rows)
	agents := make(map[string]agentMeta)
	for rows.Next() {
		var id string
		var meta agentMeta
		if errScan := rows.Scan(&id, &meta.Type, &meta.Status, &meta.DurationMs, &meta.ToolUseCount); errScan != nil {
			return nil, fmt.Errorf("read agent: %w", errScan)
		}
		agents[id] = meta
	}
	if errRows := rows.Err(); errRows != nil {
		return nil, fmt.Errorf("load agents: %w", errRows)
	}
	return agents, nil
}

// agentType names a subagent from its dispatch metadata or its id.
func agentType(agentID string, agents map[string]agentMeta) string {
	if meta, ok := agents[agentID]; ok && meta.Type != "" {
		return meta.Type
	}
	if strings.HasPrefix(agentID, "acompact-") {
		return "auto-compact"
	}
	return "unknown"
}

// buildData aggregates every turn in the range in one pass. Days and hours use loc.
func buildData(ctx context.Context, db *sql.DB, q query, loc *time.Location, now time.Time) (*Data, error) {
	sessions, errSessions := loadSessions(ctx, db)
	if errSessions != nil {
		return nil, errSessions
	}
	agents, errAgents := loadAgents(ctx, db)
	if errAgents != nil {
		return nil, errAgents
	}

	sqlText := `SELECT timestamp, model, input, output, cache_read, cache_write_5m, cache_write_1h,
		session_id, is_subagent, agent_id FROM turns WHERE timestamp <> ''`
	var args []any
	if !q.from.IsZero() {
		sqlText += ` AND timestamp >= ?`
		args = append(args, q.from.UTC().Format(tsLayout))
	}
	if !q.to.IsZero() {
		sqlText += ` AND timestamp < ?`
		args = append(args, q.to.UTC().Format(tsLayout))
	}
	rows, errQuery := db.QueryContext(ctx, sqlText, args...)
	if errQuery != nil {
		return nil, fmt.Errorf("load turns: %w", errQuery)
	}
	defer closeRows(rows)

	modelOpts := make(map[string]*ModelOption)
	byModel := make(map[string]*ModelRow)
	daily := make(map[string]*DailyRow)
	var hourly [24]HourlyRow
	sessionAccs := make(map[string]*sessionAcc)
	projects := make(map[string]*groupAcc)
	branches := make(map[[2]string]*groupAcc)
	subagents := make(map[string]*subagentAcc)
	dispatches := make(map[string]*dispatchAcc)
	var totals Totals

	for rows.Next() {
		var ts, model, sessionID, agentID string
		var t tokens
		var subagent int
		if errScan := rows.Scan(&ts, &model, &t.Input, &t.Output, &t.CacheRead, &t.Write5m, &t.Write1h,
			&sessionID, &subagent, &agentID); errScan != nil {
			return nil, fmt.Errorf("read turn: %w", errScan)
		}
		when, errParse := time.Parse(tsLayout, ts)
		if errParse != nil {
			continue
		}
		all := t.Input + t.Output + t.CacheRead + t.Write5m + t.Write1h

		opt := modelOpts[model]
		if opt == nil {
			opt = &ModelOption{Model: model, Priced: isPriced(model)}
			modelOpts[model] = opt
		}
		opt.Turns++
		opt.Tokens += all

		if q.Models != nil && !q.Models[model] {
			continue
		}
		cost, priced := costOf(model, t)

		totals.Turns++
		totals.Input += t.Input
		totals.Output += t.Output
		totals.CacheRead += t.CacheRead
		totals.CacheWrite += t.Write5m + t.Write1h
		totals.Cost += cost

		local := when.In(loc)
		day := local.Format(dateLayout)
		dayRow := daily[day]
		if dayRow == nil {
			dayRow = &DailyRow{Day: day}
			daily[day] = dayRow
		}
		dayRow.add(t, cost)
		hourly[local.Hour()].Turns++
		hourly[local.Hour()].Output += t.Output

		modelRow := byModel[model]
		if modelRow == nil {
			modelRow = &ModelRow{Model: model, Priced: priced}
			byModel[model] = modelRow
		}
		modelRow.add(t, cost)

		meta, ok := sessions[sessionID]
		if !ok || meta.Project == "" {
			meta.Project = "unknown"
		}
		sess := sessionAccs[sessionID]
		if sess == nil {
			sess = &sessionAcc{models: modelPicker{}, first: ts, last: ts}
			sessionAccs[sessionID] = sess
		}
		sess.add(t, cost)
		sess.models[model] += t.Output
		sess.first = min(sess.first, ts)
		sess.last = max(sess.last, ts)

		project := projects[meta.Project]
		if project == nil {
			project = &groupAcc{sessions: map[string]struct{}{}}
			projects[meta.Project] = project
		}
		project.add(t, cost)
		project.sessions[sessionID] = struct{}{}

		branchKey := [2]string{meta.Project, meta.Branch}
		branch := branches[branchKey]
		if branch == nil {
			branch = &groupAcc{sessions: map[string]struct{}{}}
			branches[branchKey] = branch
		}
		branch.add(t, cost)
		branch.sessions[sessionID] = struct{}{}

		if subagent != 0 {
			totals.SubagentTokens += all
			kind := agentType(agentID, agents)
			sub := subagents[kind]
			if sub == nil {
				sub = &subagentAcc{agents: map[string]struct{}{}}
				subagents[kind] = sub
			}
			sub.add(t, cost)
			if agentID != "" {
				sub.agents[agentID] = struct{}{}
				disp := dispatches[agentID]
				if disp == nil {
					disp = &dispatchAcc{models: modelPicker{}, started: ts}
					dispatches[agentID] = disp
				}
				disp.add(t, cost)
				disp.models[model] += t.Output
				disp.started = min(disp.started, ts)
			}
		}
	}
	if errRows := rows.Err(); errRows != nil {
		return nil, fmt.Errorf("load turns: %w", errRows)
	}

	data := &Data{
		GeneratedAt: now.UTC().Format(time.RFC3339),
		From:        q.From,
		To:          q.To,
		Models:      make([]ModelOption, 0, len(modelOpts)),
		Daily:       make([]DailyRow, 0, len(daily)),
		Hourly:      make([]HourlyRow, 24),
		ByModel:     make([]ModelRow, 0, len(byModel)),
		Projects:    make([]ProjectRow, 0, len(projects)),
		Branches:    make([]BranchRow, 0, len(branches)),
		Sessions:    make([]SessionRow, 0, min(len(sessionAccs), maxSessions)),
		Subagents:   make([]SubagentRow, 0, len(subagents)),
		Dispatches:  make([]DispatchRow, 0, min(len(dispatches), maxDispatches)),
	}
	totals.Sessions = int64(len(sessionAccs))
	data.Totals = totals

	for _, opt := range modelOpts {
		data.Models = append(data.Models, *opt)
	}
	sort.Slice(data.Models, func(i, j int) bool {
		a, b := data.Models[i], data.Models[j]
		if a.Tokens != b.Tokens {
			return a.Tokens > b.Tokens
		}
		return a.Model < b.Model
	})

	if days := daySpan(q); days > 0 && days <= maxZeroFillDays {
		for i := range days {
			day := q.from.AddDate(0, 0, i).Format(dateLayout)
			if row := daily[day]; row != nil {
				data.Daily = append(data.Daily, *row)
			} else {
				data.Daily = append(data.Daily, DailyRow{Day: day})
			}
		}
	} else {
		for _, row := range daily {
			data.Daily = append(data.Daily, *row)
		}
		sort.Slice(data.Daily, func(i, j int) bool { return data.Daily[i].Day < data.Daily[j].Day })
	}

	activeDays := float64(len(daily))
	for hour := range hourly {
		row := hourly[hour]
		row.Hour = hour
		if activeDays > 0 {
			row.AvgTurns = round2(float64(row.Turns) / activeDays)
			row.AvgOutput = round2(float64(row.Output) / activeDays)
		}
		data.Hourly[hour] = row
	}

	for _, row := range byModel {
		data.ByModel = append(data.ByModel, *row)
	}
	sort.Slice(data.ByModel, func(i, j int) bool {
		return lessByCost(data.ByModel[i].usageSums, data.ByModel[j].usageSums, data.ByModel[i].Model, data.ByModel[j].Model)
	})

	for name, acc := range projects {
		data.Projects = append(data.Projects, ProjectRow{Project: name, Sessions: int64(len(acc.sessions)), usageSums: acc.usageSums})
	}
	sort.Slice(data.Projects, func(i, j int) bool {
		return lessByCost(data.Projects[i].usageSums, data.Projects[j].usageSums, data.Projects[i].Project, data.Projects[j].Project)
	})

	for key, acc := range branches {
		data.Branches = append(data.Branches, BranchRow{Project: key[0], Branch: key[1], Sessions: int64(len(acc.sessions)), usageSums: acc.usageSums})
	}
	sort.Slice(data.Branches, func(i, j int) bool {
		a, b := data.Branches[i], data.Branches[j]
		return lessByCost(a.usageSums, b.usageSums, a.Project+"\x00"+a.Branch, b.Project+"\x00"+b.Branch)
	})

	sessionRows := make([]SessionRow, 0, len(sessionAccs))
	for id, acc := range sessionAccs {
		meta, ok := sessions[id]
		if !ok || meta.Project == "" {
			meta.Project = "unknown"
		}
		first, last := meta.First, meta.Last
		if first == "" || acc.first < first {
			first = acc.first
		}
		if acc.last > last {
			last = acc.last
		}
		row := SessionRow{
			SessionID: id,
			Project:   meta.Project,
			Branch:    meta.Branch,
			Topic:     meta.Topic,
			First:     toRFC3339(first),
			Last:      toRFC3339(last),
			Model:     acc.models.best(),
			usageSums: acc.usageSums,
		}
		if start, errStart := time.Parse(tsLayout, first); errStart == nil {
			if end, errEnd := time.Parse(tsLayout, last); errEnd == nil {
				row.DurationMin = round2(end.Sub(start).Minutes())
			}
		}
		sessionRows = append(sessionRows, row)
	}
	sort.Slice(sessionRows, func(i, j int) bool {
		if sessionRows[i].Last != sessionRows[j].Last {
			return sessionRows[i].Last > sessionRows[j].Last
		}
		return sessionRows[i].SessionID < sessionRows[j].SessionID
	})
	data.SessionsTotal = len(sessionRows)
	data.Sessions = append(data.Sessions, sessionRows[:min(len(sessionRows), maxSessions)]...)

	for kind, acc := range subagents {
		data.Subagents = append(data.Subagents, SubagentRow{AgentType: kind, Dispatches: int64(len(acc.agents)), usageSums: acc.usageSums})
	}
	sort.Slice(data.Subagents, func(i, j int) bool {
		return lessByCost(data.Subagents[i].usageSums, data.Subagents[j].usageSums, data.Subagents[i].AgentType, data.Subagents[j].AgentType)
	})

	dispatchRows := make([]DispatchRow, 0, len(dispatches))
	for id, acc := range dispatches {
		meta := agents[id]
		dispatchRows = append(dispatchRows, DispatchRow{
			AgentID:    id,
			AgentType:  agentType(id, agents),
			Model:      acc.models.best(),
			Started:    toRFC3339(acc.started),
			Turns:      acc.Turns,
			ToolUses:   meta.ToolUseCount,
			DurationMs: meta.DurationMs,
			Status:     meta.Status,
			Input:      acc.Input,
			Output:     acc.Output,
			CacheRead:  acc.CacheRead,
			CacheWrite: acc.CacheWrite,
			Cost:       acc.Cost,
		})
	}
	sort.Slice(dispatchRows, func(i, j int) bool {
		a, b := dispatchRows[i], dispatchRows[j]
		ta, tb := a.Input+a.Output+a.CacheRead+a.CacheWrite, b.Input+b.Output+b.CacheRead+b.CacheWrite
		if ta != tb {
			return ta > tb
		}
		return a.AgentID < b.AgentID
	})
	data.Dispatches = append(data.Dispatches, dispatchRows[:min(len(dispatchRows), maxDispatches)]...)
	return data, nil
}

// daySpan returns the number of local days in a bounded range, or 0 when unbounded.
func daySpan(q query) int {
	if q.from.IsZero() || q.to.IsZero() {
		return 0
	}
	days := 0
	for day := q.from; day.Before(q.to) && days <= maxZeroFillDays; day = day.AddDate(0, 0, 1) {
		days++
	}
	return days
}

// lessByCost orders by cost desc, then tokens desc, then name.
func lessByCost(a, b usageSums, nameA, nameB string) bool {
	if a.Cost != b.Cost {
		return a.Cost > b.Cost
	}
	if a.total() != b.total() {
		return a.total() > b.total()
	}
	return nameA < nameB
}

// toRFC3339 converts a stored timestamp to RFC3339 in UTC.
func toRFC3339(ts string) string {
	parsedTime, errParse := time.Parse(tsLayout, ts)
	if errParse != nil {
		return ""
	}
	return parsedTime.UTC().Format(time.RFC3339)
}

func round2(v float64) float64 {
	return math.Round(v*100) / 100
}
