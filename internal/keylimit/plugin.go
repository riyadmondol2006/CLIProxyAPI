package keylimit

import (
	"context"

	coreusage "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/usage"
)

func init() {
	coreusage.RegisterPlugin(usagePlugin{tracker: defaultTracker})
}

// usagePlugin feeds usage records for config-defined client keys into a tracker.
type usagePlugin struct {
	tracker *Tracker
}

func (p usagePlugin) HandleUsage(_ context.Context, record coreusage.Record) {
	if p.tracker == nil || !record.IsNativeKey {
		return
	}
	p.tracker.Record(record.APIKey, recordTokens(record.Detail), !record.Failed)
}

// recordTokens returns the total tokens for a record, deriving it when providers omit the total.
func recordTokens(detail coreusage.Detail) int64 {
	if detail.TotalTokens > 0 {
		return detail.TotalTokens
	}
	derived := detail.InputTokens + detail.OutputTokens
	if derived < 0 {
		return 0
	}
	return derived
}
