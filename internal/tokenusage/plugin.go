package tokenusage

import (
	"context"

	coreusage "github.com/router-for-me/CLIProxyAPI/v8/sdk/cliproxy/usage"
)

func init() {
	coreusage.RegisterPlugin(usagePlugin{tracker: defaultTracker})
}

// usagePlugin feeds every upstream usage record into a tracker.
type usagePlugin struct {
	tracker *Tracker
}

func (p usagePlugin) HandleUsage(_ context.Context, record coreusage.Record) {
	if p.tracker == nil {
		return
	}
	p.tracker.Record(record)
}
