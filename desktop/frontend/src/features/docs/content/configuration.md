# Configuration

Everything the app changes is written to `~/.config/cliproxyapi/config.yaml`, and the
service reloads the file automatically when it changes. **Settings** edits the most-used
options in a form and the whole file in a YAML editor.

## Options people change most

| Option | Default | Meaning |
| --- | --- | --- |
| `server.host` | `"127.0.0.1"` | `""` lets other devices connect. Needs a service restart. |
| `server.port` | `8317` | API port. Needs a service restart. |
| `access.api-keys` | one random key | Keys apps must send. Manage them under **Access keys**. |
| `access.key-limits` | none | Per-key names, token limits, and on/off switches. |
| `routing.strategy` | `round-robin` | How the proxy picks between matching credentials. |
| `routing.retry.request-retry` | `3` | Extra attempts on other credentials after an error. |
| `requests.proxy-url` | none | Send upstream traffic through an HTTP or SOCKS5 proxy. |
| `observability.logs.request-log` | `false` | Save full request and response logs (shown under **Logs**). |
| `observability.logs.debug` | `false` | Verbose service log. |
| `management.disable-control-panel` | `true` | Keep the browser panel off; this app replaces it. |

The **Config reference** page lists every option with comments.

## Remote management

The desktop app never needs a management password. If you also want to manage the proxy
from another machine's browser or the terminal UI (`cli-proxy-api --tui`), set
`management.secret-key` and `management.allow-remote: true`, and turn the browser panel back
on with `management.disable-control-panel: false`.
