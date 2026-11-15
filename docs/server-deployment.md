# Run CLIProxyAPI on a server

CLIProxyAPI runs on a Linux server with the same proxy and the same control panel as the
[desktop app](../desktop/README.md). You manage it from any browser, so the desktop app is not
needed. The same guide is built into the app under **Docs → Run on a server**.

Contents: [Install](#install-on-debian-ubuntu-fedora-or-rhel) ·
[Docker](#or-use-docker) · [Open it](#open-it-in-a-browser) ·
[Sign in to accounts](#signing-in-to-accounts-on-a-remote-server) · [HTTPS](#use-https) ·
[Files and commands](#files-and-commands) · [Security](#security) · [Updating](#updating) ·
[Troubleshooting](#troubleshooting)

## Install on Debian, Ubuntu, Fedora, or RHEL

Works on amd64 and arm64. Run it as root:

```bash
curl -fsSL https://raw.githubusercontent.com/riyadmondol2006/CLIProxyAPI/main/scripts/install-server.sh | sudo bash
```

The script installs the `cliproxyapi-server` package from the latest GitHub release, starts
the service, and prints the web address and a generated management key. Run it again to
upgrade.

To install by hand, download `cliproxyapi-server-<version>-1.x86_64.rpm` or
`cliproxyapi-server_<version>-1_amd64.deb` (`aarch64` / `arm64` for ARM) from the
[latest release](https://github.com/riyadmondol2006/CLIProxyAPI/releases/latest), then:

```bash
sudo dnf install ./cliproxyapi-server-*.rpm     # Fedora, RHEL
sudo apt install ./cliproxyapi-server_*.deb     # Ubuntu, Debian
```

The server package and the desktop package `cliproxyapi` can't be installed together.

## Or use Docker

```bash
docker run -d --name cliproxyapi -p 8317:8317 -v cliproxyapi-data:/data \
  --restart unless-stopped ghcr.io/riyadmondol2006/cliproxyapi:latest
```

Everything lives in the `/data` volume (`config.yaml`, `auths/`). To choose the management key,
add `-e CPA_MANAGEMENT_KEY=...` on the first start. Otherwise one is generated: `docker logs
cliproxyapi` shows it once, and it is saved in the volume:

```bash
docker exec cliproxyapi cat /data/management-key
```

`docker-compose.yml` in the repository does the same: `docker compose up -d`.

## Open it in a browser

Go to `http://<server-ip>:8317/`. It redirects to the control panel at `/management.html`.
Log in with the management key. Then:

- **Sign in** connects provider accounts.
- **Access keys** creates client API keys. The proxy rejects requests without one.
- **Connect apps** shows the base URL, `http(s)://<server>/v1`.

To read the key again: `sudo cat /etc/cliproxyapi/management-key`.

## Signing in to accounts on a remote server

Provider sign-in pages redirect to a `localhost` address on **your** computer, which fails to
load. That is expected. Copy the full URL from the browser's address bar and paste it into the
**Callback URL** field on the **Sign in** page, then press **Submit Callback URL**. It looks
like `http://localhost:1455/auth/callback?code=...&state=...`.

An SSH tunnel for the callback port also works, for example
`ssh -L 1455:localhost:1455 user@server`.

## Use HTTPS

On the internet, use HTTPS. The management key and your client keys travel in every request.
The simplest way is Caddy in front of the proxy. A `Caddyfile`:

```
proxy.example.com {
  reverse_proxy 127.0.0.1:8317
}
```

Then firewall port 8317 so only Caddy can reach it, or set `server.host: 127.0.0.1` in the
config. With Docker, keep the config as it is and publish the port as `-p 127.0.0.1:8317:8317`
instead. nginx works the same way. Behind a proxy, add its address to `server.trusted-proxies`
in the config so the proxy trusts the forwarded client IP headers it sends:

```yaml
server:
  host: 127.0.0.1
  trusted-proxies:
    - 127.0.0.1
```

The proxy can also serve HTTPS itself: set `server.tls.enable: true` with `server.tls.cert`
and `server.tls.key`.

## Files and commands

| Path | What it is |
| --- | --- |
| `/usr/bin/cli-proxy-api` | The program. |
| `/etc/cliproxyapi/config.yaml` | Your settings. Kept on upgrade. |
| `/etc/cliproxyapi/management-key` | The management key. Readable by root only. |
| `/var/lib/cliproxyapi/` | Data: usage and logs. |
| `/var/lib/cliproxyapi/auths/` | Signed-in accounts. |

The systemd service `cliproxyapi-server` runs as the user `cliproxyapi`. By default it listens
on all interfaces, port 8317, with remote management on.

```bash
sudo systemctl status cliproxyapi-server
sudo systemctl restart cliproxyapi-server    # after editing the config
sudo journalctl -u cliproxyapi-server -f     # follow the log
```

## Security

- Keep the management key secret. Anyone with it controls the proxy and your accounts.
- Use HTTPS (above) and a firewall.
- Create one client key per person or app under **Access keys**.
- To change the management key, put a new value in `management.secret-key` in the config. It is
  stored as plain text, hashed on the next start. Then restart the service.

## Updating

Run the install script again, or `sudo dnf upgrade` / `sudo apt install` the new package. For
Docker, `docker pull ghcr.io/riyadmondol2006/cliproxyapi:latest`, then remove and recreate the
container with the same `docker run` command. Your data stays in the volume.

Some features are desktop-app only and are not in the web version: Claude usage from local
Claude Code logs, start at login, and the service buttons.

## Troubleshooting

- **The page doesn't load:** open port 8317 in the server's firewall and in your cloud
  provider's security group. Check that the proxy is listening:
  `sudo ss -ltnp | grep 8317`.
- **The management key is rejected:** read it again with `sudo cat
  /etc/cliproxyapi/management-key`, or `docker exec cliproxyapi cat /data/management-key`.
- **Port 8317 is in use:** stop the other program or change `server.port` in the config, then
  restart.
- **Anything else:** read the log with `journalctl -u cliproxyapi-server`, or
  `docker logs cliproxyapi`.
