# Troubleshooting

## The app says the service is not running

- Press **Start service** on the start screen or on **Home**.
- If it stops again right away, read its log:
  `journalctl --user -u cliproxyapi -n 50`. A common cause is another program already using
  port 8317: change `server.port` in the config or stop the other program.

## Apps get 401 Unauthorized

The app is not sending one of your client keys. Copy the key from **Home** or
**Access keys** and send it as a Bearer token, `x-api-key`, or `x-goog-api-key`.

## Apps get 429 or 403

- **429** with `api_key_token_limit_exceeded`: that key used its token limit. Raise the limit,
  reset its usage, or wait for the reset time in the message.
- **403** with `api_key_disabled`: the key is disabled under **Access keys**.

## No models are listed

No connected account works yet. Sign in again under **Sign in**, check **Credentials** for
expired or disabled accounts, and press refresh.

## Another device can't connect

1. **Access keys** must show **Reachable**. If not, allow LAN access and restart the service.
2. Open the port in the firewall (see **Sharing**).
3. Use this computer's LAN address, not `127.0.0.1`, on the other device.

## A sign-in page shows an error

Start the sign-in again. If the browser can't return to the proxy, copy the final address
from the browser and paste it into the sign-in dialog.

## Where to look

- **Logs** shows the service log and, when enabled, full request logs.
- **Activity** shows recent request volume and error rates per provider.
- **Quota** shows remaining usage per account.
