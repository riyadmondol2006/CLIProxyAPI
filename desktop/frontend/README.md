# CLIProxyAPI desktop UI

React 19 + TypeScript + Vite UI for the CLIProxyAPI desktop app (`../`). It talks to the
v8 Management API. It was imported from
[Cli-Proxy-API-Management-Center](https://github.com/router-for-me/Cli-Proxy-API-Management-Center)
(MIT, see `LICENSE`) and adapted for the desktop app.

Requires **Bun 1.4.3** (pinned in `package.json`).

```bash
bun install --frozen-lockfile
bun run dev      # Vite dev server
bun run build    # single-file build in dist/, embedded by the desktop app
bun run verify   # tests, lint, build
```

Inside the desktop window the UI runs on the `wails://wails` origin. It needs no login:
the app forwards API calls to the local proxy service and adds a token that only works
from this computer. The same build still works as a browser panel.
