# Claude usage

**Claude usage** shows how much you use Claude Code on this computer: tokens, estimated cost,
sessions, projects, models, and subagents. It reads Claude Code's own logs, so it works
whether Claude Code talks to Anthropic directly or through this proxy.

## Where the data comes from

- Claude Code writes a log for every session under `~/.claude/projects/` (and, on macOS
  with Xcode, under Xcode's Claude agent folder). The app reads those files; it never changes
  or uploads them.
- The first scan reads your whole history and can take a little while for large histories.
  After that the app only reads what was added, so rescans take a fraction of a second.
- What it learns is kept in `~/.config/cliproxyapi/claude-usage.db`, so the history stays
  even after Claude Code deletes old logs. Delete that file to start over.

## Reading the numbers

- **Est. cost** prices every turn at Anthropic's API list prices for that turn's model,
  including prompt-cache writes (5-minute and 1-hour) and cache reads. Pro and Max
  subscriptions are billed differently, so treat it as "what this would cost on the API".
- Models without a known price (for example non-Claude models used through the proxy) show
  **n/a** and are left out of the cost.
- **Cache read** is usually the largest number: Claude Code re-reads the cached conversation
  on every turn, and cached tokens are much cheaper than fresh input.
- **Subagent tokens** are included in all totals; the subagent tables break them down by
  agent type.
- Days and hours use this computer's time zone.

## Using the page

- Pick a range (today, 7/30/90 days, this or last month, all time) and filter by model.
  The view is kept in the address, so it survives restarts.
- **Rescan** reads new log lines right away; the page also refreshes every minute while the
  range includes today.
- Every chart has **Show as table**, and the tables export to CSV.

Based on the open-source [claude-usage](https://github.com/phuryn/claude-usage) dashboard by
Pawel Huryn (MIT).
