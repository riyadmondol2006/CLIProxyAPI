# Sharing with friends and other devices

You can let other computers on your network, or friends you trust, use the proxy without
sharing your accounts. Each person or device gets its **own client key**, and each key can
have its own **token limit**.

## 1. Create a key per person or device

Open **Access keys → New key**. Give it a name (for example "Alex's laptop"). A random key
is generated for you. Optionally set:

- **Token limit:** input plus output tokens allowed per period. Leave empty for no limit.
- **Resets:** daily, weekly, monthly, or total (never resets).

After you create it, the app shows the base URL and key to send. Keep at least one key for
yourself; with no keys at all the proxy would accept requests without a key.

## 2. Allow LAN access

By default the proxy only accepts connections from this computer. On **Access keys**, use
**Allow LAN access**, then restart the service (**Home → Restart service**). The card then
lists the addresses other devices should use, for example `http://192.168.1.20:8317/v1`.

If another device still cannot connect, open the port in this computer's firewall:

```bash
# Fedora / RHEL (firewalld)
sudo firewall-cmd --add-port=8317/tcp --permanent && sudo firewall-cmd --reload

# Ubuntu / Debian (ufw)
sudo ufw allow 8317/tcp
```

## How limits work

- Usage is counted from the token counts the upstream provider reports.
- When a key reaches its limit, requests get **HTTP 429** with the time the limit resets.
- A **disabled** key gets **HTTP 403** until you enable it again.
- The limit is checked before each request, so the request that crosses the limit still
  finishes.
- Counters are saved in `~/.config/cliproxyapi/key-usage.json` and survive restarts.
  **Reset usage** clears the current period for one key.
- **Usage history** on the Access Keys page shows tokens per day for each key. Days are kept
  for 90 days, and resetting a key's usage does not erase them.

## Safety

- Only share keys with people you trust: requests made with them use your accounts.
- This control panel is never reachable from other devices; only the API is.
- Delete or disable a key at any time and it stops working immediately.
