# CLIProxyAPI desktop app

A native window (Wails, WebKitGTK) for managing CLIProxyAPI on the computer it runs on.

- The proxy runs as the systemd user service `cliproxyapi` (`packaging/linux/cliproxyapi.service`)
  and keeps running when the window is closed.
- On first launch the app writes `~/.config/cliproxyapi/config.yaml` (localhost only, browser
  panel off, one random client key) and runs `systemctl --user enable --now cliproxyapi`.
- The service starts with `--local-token-file $XDG_RUNTIME_DIR/cliproxyapi/management-token`.
  That token is accepted only from localhost and changes on every start; the app reads it and
  adds it to management requests, so the UI needs no login.
- The UI (`frontend/`) is embedded into the binary. Requests that are not bundled assets go to
  `internal/app`: `/app/*` for status, service control and opening links, everything else is
  forwarded to the proxy.

## Build

Needs Go, Bun, and the GTK/WebKitGTK 4.1 development packages
(`libgtk-3-dev libwebkit2gtk-4.1-dev` on Debian/Ubuntu, `gtk3-devel webkit2gtk4.1-devel` on Fedora).

```bash
(cd frontend && bun install --frozen-lockfile && bun run build)
go build -tags desktop,production,webkit2_41 -o build/bin/cliproxyapi-desktop .
```

Set `CPA_DESKTOP_DEBUG=1` to log every request the UI makes.

## Develop in a browser

`cmd/devserver` serves the built UI and the same backend over HTTP, so the app can be tested
without WebKitGTK:

```bash
go run ./cmd/devserver -dist frontend/dist   # then open http://127.0.0.1:34115
```

## Packages

`.github/workflows/packages.yml` builds the proxy, this app, and `.deb`/`.rpm` packages with
nfpm (`packaging/nfpm.yaml`) on every push.

## Updates

Each published release also carries `latest.json`, a feed with the version, recent commit
subjects, and each package's size and SHA-256. The app checks the feed set at build time with
`-ldflags "-X main.updateFeed=..."` (`CPA_UPDATE_FEED` overrides it; the dev server takes
`-update-feed` and `-version`). `internal/app/update.go` serves `GET /app/update`, installs
the matching package with `pkexec` after checking its SHA-256 (`POST /app/update/install`),
then restarts the proxy service; `POST /app/update/relaunch` restarts the app.
