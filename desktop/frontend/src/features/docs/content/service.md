# The background service

The proxy runs as the systemd **user** service `cliproxyapi`. The app starts and enables it
the first time you open the app. **Home** shows its state and has start, stop, and restart
buttons. The same actions from a terminal:

```bash
systemctl --user status cliproxyapi      # state and recent log lines
systemctl --user restart cliproxyapi     # apply a host/port change
systemctl --user stop cliproxyapi
systemctl --user disable --now cliproxyapi   # stop and don't start at login
journalctl --user -u cliproxyapi -f      # follow the log
```

The service runs while you are logged in. To keep it running after you log out (for example
on a machine that serves other devices), enable lingering once:

```bash
loginctl enable-linger "$USER"
```

## Files

| Path | What it is |
| --- | --- |
| `~/.config/cliproxyapi/config.yaml` | Your settings. Created on first launch with a random client key. |
| `~/.config/cliproxyapi/key-usage.json` | Token counters for access keys. |
| `~/.cli-proxy-api/` | Saved account sign-ins. |
| `$XDG_RUNTIME_DIR/cliproxyapi/management-token` | The app's local token, rewritten on every service start. |
| `/usr/share/cliproxyapi/config.example.yaml` | Every option, with comments. |

## Running without the app

The service is the same `cli-proxy-api` program you can run by hand:

```bash
cli-proxy-api --config ~/.config/cliproxyapi/config.yaml
```

Stop the service first so the two don't fight over the port.

## Updating and removing

Install a newer `.rpm` or `.deb` over the old one; the service restarts on the next login or
when you press **Restart service**. Removing the package keeps your config and accounts in
your home folder.
