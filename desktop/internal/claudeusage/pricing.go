package claudeusage

import "strings"

// price is in dollars per million tokens.
type price struct {
	Input, Output, Write5m, Write1h, Read float64
}

// haikuTierThreshold is the prompt size (input + cache read + cache write) above which
// Haiku 5.5 bills at its long-context rate.
const haikuTierThreshold = 100_000

const haiku55 = "claude-haiku-5-5"

var (
	haiku55Small = price{Input: 0.10, Output: 0.50, Write5m: 0.125, Write1h: 0.20, Read: 0.01}
	haiku55Large = price{Input: 0.50, Output: 2.50, Write5m: 0.625, Write1h: 1.00, Read: 0.05}
)

// prices lists the known model ids. Haiku 5.5 is listed with its small-prompt rate;
// costOf switches it to the large rate per turn.
var prices = map[string]price{
	"claude-fable-5-1":  {10, 50, 12.5, 20, 0.25},
	"claude-mythos-5-1": {10, 50, 12.5, 20, 0.25},
	"claude-fable-5":    {10, 50, 12.5, 20, 1.00},
	"claude-mythos-5":   {10, 50, 12.5, 20, 1.00},
	"claude-opus-5-5":   {4, 20, 5, 8, 0.20},
	"claude-opus-5":     {5, 25, 6.25, 10, 0.50},
	"claude-opus-4-8":   {5, 25, 6.25, 10, 0.50},
	"claude-opus-4-7":   {5, 25, 6.25, 10, 0.50},
	"claude-opus-4-6":   {5, 25, 6.25, 10, 0.50},
	"claude-opus-4-5":   {5, 25, 6.25, 10, 0.50},
	"claude-sonnet-5-5": {2, 10, 2.5, 4, 0.20},
	"claude-sonnet-5":   {2, 10, 2.5, 4, 0.20},
	"claude-sonnet-4-6": {3, 15, 3.75, 6, 0.30},
	"claude-sonnet-4-5": {3, 15, 3.75, 6, 0.30},
	haiku55:             haiku55Small,
	"claude-haiku-4-5":  {1, 5, 1.25, 2, 0.10},
}

// families maps a model family name found anywhere in an id to the id whose price it uses.
var families = []struct{ needle, id string }{
	{"fable", "claude-fable-5-1"},
	{"mythos", "claude-fable-5-1"},
	{"opus", "claude-opus-5-5"},
	{"sonnet", "claude-sonnet-5-5"},
	{"haiku", haiku55},
}

// resolveModel returns the price-table id for a model: exact id, then the longest known
// id that prefixes it (dated ids like claude-sonnet-4-5-20250929), then its family.
func resolveModel(model string) (string, bool) {
	id := strings.ToLower(strings.TrimSpace(model))
	if id == "" {
		return "", false
	}
	if _, ok := prices[id]; ok {
		return id, true
	}
	best := ""
	for known := range prices {
		if len(known) <= len(best) || !strings.HasPrefix(id, known) {
			continue
		}
		// Do not let claude-opus-4-5 match a hypothetical claude-opus-4-50.
		if next := id[len(known)]; next >= '0' && next <= '9' {
			continue
		}
		best = known
	}
	if best != "" {
		return best, true
	}
	for _, family := range families {
		if strings.Contains(id, family.needle) {
			return family.id, true
		}
	}
	return "", false
}

// isPriced reports whether a model has a known price.
func isPriced(model string) bool {
	_, ok := resolveModel(model)
	return ok
}

// tokens are the four billed token kinds of a turn, with the cache write split.
type tokens struct {
	Input, Output, CacheRead, Write5m, Write1h int64
}

// costOf returns the dollar cost of one turn and whether its model is priced.
func costOf(model string, t tokens) (float64, bool) {
	id, ok := resolveModel(model)
	if !ok {
		return 0, false
	}
	p := prices[id]
	if id == haiku55 && t.Input+t.CacheRead+t.Write5m+t.Write1h > haikuTierThreshold {
		p = haiku55Large
	}
	cost := float64(t.Input)*p.Input +
		float64(t.Output)*p.Output +
		float64(t.Write5m)*p.Write5m +
		float64(t.Write1h)*p.Write1h +
		float64(t.CacheRead)*p.Read
	return cost / 1_000_000, true
}
