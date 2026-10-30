package management

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/router-for-me/CLIProxyAPI/v8/internal/keylimit"
)

// defaultKeyUsageHistoryDays is the window served when ?days is missing or not a number.
const defaultKeyUsageHistoryDays = 30

// GetAPIKeyUsageHistory returns daily token and request counts for every client API key over
// the last ?days local days (default 30, clamped to 1..keylimit.HistoryRetentionDays).
func (h *Handler) GetAPIKeyUsageHistory(c *gin.Context) {
	days := defaultKeyUsageHistoryDays
	if raw := strings.TrimSpace(c.Query("days")); raw != "" {
		if parsed, errParse := strconv.Atoi(raw); errParse == nil {
			days = parsed
		}
	}
	days = min(max(days, 1), keylimit.HistoryRetentionDays)
	c.JSON(http.StatusOK, keylimit.Default().History(days))
}
