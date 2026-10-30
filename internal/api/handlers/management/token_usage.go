package management

import (
	"cmp"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/tokenusage"
	coreauth "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/auth"
)

// defaultTokenUsageDays is the window served when ?days is missing or not a number.
const defaultTokenUsageDays = 30

// Client kinds reported for a token usage row.
const (
	tokenUsageClientKey     = "key"
	tokenUsageClientRemoved = "removed"
	tokenUsageClientOther   = "other"
)

// tokenUsageSecretFields are credential fields whose values must never appear in a label.
var tokenUsageSecretFields = []string{"api_key", "access_token", "refresh_token"}

type tokenUsageRow struct {
	Provider     string  `json:"provider"`
	AuthID       string  `json:"auth-id"`
	AuthIndex    string  `json:"auth-index"`
	Account      string  `json:"account"`
	Model        string  `json:"model"`
	ClientKind   string  `json:"client-kind"`
	ClientKey    string  `json:"client-key"`
	ClientName   string  `json:"client-name"`
	Tokens       []int64 `json:"tokens"`
	InputTokens  []int64 `json:"input-tokens"`
	OutputTokens []int64 `json:"output-tokens"`
	Requests     []int64 `json:"requests"`
	Failed       []int64 `json:"failed"`

	totalTokens   int64
	totalRequests int64
}

type tokenUsageResponse struct {
	Dates []string        `json:"dates"`
	Rows  []tokenUsageRow `json:"rows"`
}

// GetTokenUsage returns daily upstream token usage per provider, credential, model, and
// client key over the last ?days local days (default 30, clamped to 1..tokenusage.RetentionDays).
func (h *Handler) GetTokenUsage(c *gin.Context) {
	if h == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "handler not initialized"})
		return
	}
	days := defaultTokenUsageDays
	if raw := strings.TrimSpace(c.Query("days")); raw != "" {
		if parsed, errParse := strconv.Atoi(raw); errParse == nil {
			days = parsed
		}
	}
	days = min(max(days, 1), tokenusage.RetentionDays)

	tracker := h.tokenUsage
	if tracker == nil {
		tracker = tokenusage.Default()
	}
	report := tracker.Report(days)

	h.mu.Lock()
	manager := h.authManager
	cfg := h.cfg
	h.mu.Unlock()
	accounts := newTokenUsageAccounts(manager)
	clients := newTokenUsageClients(cfg)

	rows := make([]tokenUsageRow, 0, len(report.Rows))
	byIdentity := make(map[[6]string]int, len(report.Rows))
	for _, usage := range report.Rows {
		kind, key, name := clients.resolve(usage.Client)
		// Removed keys are indistinguishable once resolved, so their rows are merged.
		identity := [6]string{usage.Provider, usage.AuthID, usage.AuthIndex, usage.Model, kind, key}
		if i, ok := byIdentity[identity]; ok {
			rows[i].add(usage)
			continue
		}
		row := tokenUsageRow{
			Provider:     usage.Provider,
			AuthID:       usage.AuthID,
			AuthIndex:    usage.AuthIndex,
			Account:      accounts.label(usage.AuthID, usage.AuthIndex),
			Model:        usage.Model,
			ClientKind:   kind,
			ClientKey:    key,
			ClientName:   name,
			Tokens:       make([]int64, len(report.Dates)),
			InputTokens:  make([]int64, len(report.Dates)),
			OutputTokens: make([]int64, len(report.Dates)),
			Requests:     make([]int64, len(report.Dates)),
			Failed:       make([]int64, len(report.Dates)),
		}
		row.add(usage)
		byIdentity[identity] = len(rows)
		rows = append(rows, row)
	}
	slices.SortFunc(rows, func(a, b tokenUsageRow) int {
		return cmp.Or(
			cmp.Compare(b.totalTokens, a.totalTokens),
			cmp.Compare(b.totalRequests, a.totalRequests),
			strings.Compare(a.Provider, b.Provider),
			strings.Compare(a.AuthID, b.AuthID),
			strings.Compare(a.AuthIndex, b.AuthIndex),
			strings.Compare(a.Model, b.Model),
			strings.Compare(a.ClientKind, b.ClientKind),
			strings.Compare(a.ClientKey, b.ClientKey),
		)
	})
	c.JSON(http.StatusOK, tokenUsageResponse{Dates: report.Dates, Rows: rows})
}

// add sums a tracker row into r. Both series cover the same dates.
func (r *tokenUsageRow) add(usage tokenusage.Row) {
	for i := range r.Tokens {
		r.Tokens[i] += usage.Tokens[i]
		r.InputTokens[i] += usage.Input[i]
		r.OutputTokens[i] += usage.Output[i]
		r.Requests[i] += usage.Requests[i]
		r.Failed[i] += usage.Failed[i]
		r.totalTokens += usage.Tokens[i]
		r.totalRequests += usage.Requests[i]
	}
}

// tokenUsageClients maps stored client hashes to the configured access keys and their names.
type tokenUsageClients struct {
	keys  map[string]string // client hash -> configured key
	names map[string]string // configured key -> key-limits name
}

func newTokenUsageClients(cfg *config.Config) tokenUsageClients {
	clients := tokenUsageClients{keys: make(map[string]string), names: make(map[string]string)}
	if cfg == nil {
		return clients
	}
	for _, key := range cfg.APIKeys {
		if key = strings.TrimSpace(key); key != "" {
			clients.keys[tokenusage.ClientHash(key)] = key
		}
	}
	for _, limit := range cfg.APIKeyLimits {
		if key := strings.TrimSpace(limit.APIKey); key != "" {
			clients.names[key] = strings.TrimSpace(limit.Name)
		}
	}
	return clients
}

// resolve returns the client kind, configured key, and name for a stored client hash.
func (c tokenUsageClients) resolve(hash string) (kind, key, name string) {
	if hash == "" {
		return tokenUsageClientOther, "", ""
	}
	key, ok := c.keys[hash]
	if !ok {
		return tokenUsageClientRemoved, "", ""
	}
	return tokenUsageClientKey, key, c.names[key]
}

// tokenUsageAccounts resolves friendly credential labels from the current auths.
type tokenUsageAccounts struct {
	byID    map[string]*coreauth.Auth
	byIndex map[string]*coreauth.Auth
}

func newTokenUsageAccounts(manager *coreauth.Manager) tokenUsageAccounts {
	accounts := tokenUsageAccounts{byID: make(map[string]*coreauth.Auth), byIndex: make(map[string]*coreauth.Auth)}
	if manager == nil {
		return accounts
	}
	// List returns clones, so assigning a missing index here touches no shared state.
	for _, auth := range manager.List() {
		if auth == nil {
			continue
		}
		if id := strings.TrimSpace(auth.ID); id != "" {
			accounts.byID[id] = auth
		}
		if index := strings.TrimSpace(auth.EnsureIndex()); index != "" {
			accounts.byIndex[index] = auth
		}
	}
	return accounts
}

// label returns the friendly label of a credential, falling back to authID.
// It never returns a string containing the credential's secrets.
func (a tokenUsageAccounts) label(authID, authIndex string) string {
	auth := a.byID[authID]
	if auth == nil && authIndex != "" {
		auth = a.byIndex[authIndex]
	}
	if label := tokenUsageAccountLabel(auth); label != "" {
		return label
	}
	if tokenUsageRevealsSecret(authID, tokenUsageAuthSecrets(auth)) {
		return ""
	}
	return authID
}

// tokenUsageAccountLabel labels API-key credentials by name or base-URL host plus a masked
// key, and OAuth or file credentials by email, label, then file name.
func tokenUsageAccountLabel(auth *coreauth.Auth) string {
	if auth == nil {
		return ""
	}
	secrets := tokenUsageAuthSecrets(auth)
	var candidates []string
	if auth.AuthKind() == coreauth.AuthKindAPIKey {
		candidates = append(candidates, tokenUsageAPIKeyLabel(auth))
	}
	candidates = append(candidates, authEmail(auth))
	// AccountInfo returns the raw key for API-key credentials, so only its OAuth email is used.
	if kind, account := auth.AccountInfo(); kind == "oauth" {
		candidates = append(candidates, account)
	}
	candidates = append(candidates, strings.TrimSpace(auth.Label), strings.TrimSpace(auth.FileName), tokenUsageAPIKeyLabel(auth))
	for _, candidate := range candidates {
		if candidate = strings.TrimSpace(candidate); candidate != "" && !tokenUsageRevealsSecret(candidate, secrets) {
			return candidate
		}
	}
	return ""
}

// tokenUsageAPIKeyLabel returns "<name or host> · <masked key>", or whichever part exists.
func tokenUsageAPIKeyLabel(auth *coreauth.Auth) string {
	name := strings.TrimSpace(authAttribute(auth, "compat_name"))
	if name == "" {
		name = tokenUsageURLHost(authAttribute(auth, "base_url"))
	}
	apiKey := strings.TrimSpace(authAttribute(auth, coreauth.AttributeAPIKey))
	if apiKey == "" && auth != nil {
		apiKey, _ = auth.Metadata[coreauth.AttributeAPIKey].(string)
	}
	masked := maskTokenUsageSecret(apiKey)
	switch {
	case name != "" && masked != "":
		return name + " · " + masked
	case name != "":
		return name
	default:
		return masked
	}
}

// tokenUsageURLHost returns the host of a base URL, without credentials, path, or query.
func tokenUsageURLHost(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	if !strings.Contains(raw, "://") {
		raw = "https://" + raw
	}
	parsed, errParse := url.Parse(raw)
	if errParse != nil {
		return ""
	}
	return parsed.Host
}

// maskTokenUsageSecret keeps only enough of a secret to tell keys apart, e.g. "sk-ab…cd".
// Secrets too short to show any of safely return "", so labels don't end in a bare "…".
func maskTokenUsageSecret(secret string) string {
	runes := []rune(strings.TrimSpace(secret))
	switch {
	case len(runes) == 0:
		return ""
	case len(runes) >= 12:
		return string(runes[:5]) + "…" + string(runes[len(runes)-2:])
	case len(runes) >= 6:
		return string(runes[:2]) + "…"
	default:
		return ""
	}
}

// tokenUsageAuthSecrets returns the secret values a credential carries.
func tokenUsageAuthSecrets(auth *coreauth.Auth) []string {
	if auth == nil {
		return nil
	}
	var secrets []string
	for _, field := range tokenUsageSecretFields {
		if value := strings.TrimSpace(authAttribute(auth, field)); value != "" {
			secrets = append(secrets, value)
		}
		if value, ok := auth.Metadata[field].(string); ok && strings.TrimSpace(value) != "" {
			secrets = append(secrets, strings.TrimSpace(value))
		}
	}
	return secrets
}

func tokenUsageRevealsSecret(label string, secrets []string) bool {
	for _, secret := range secrets {
		if strings.Contains(label, secret) {
			return true
		}
	}
	return false
}
