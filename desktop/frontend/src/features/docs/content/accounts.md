# Accounts and sign-in

The proxy forwards requests to the accounts you connect. Connect as many as you like; the
proxy rotates between accounts of the same kind and skips ones that are cooling down
after a rate limit.

## Sign in from the app

Open **Sign in**, pick a provider, and finish the sign-in in your browser. When it
succeeds the account appears under **Credentials**.

| Provider | Flow | Notes |
| --- | --- | --- |
| Claude | Browser | Claude Pro/Max subscriptions. |
| Codex | Browser | ChatGPT accounts for Codex. A device-code flow is available from the terminal. |
| Antigravity | Browser | Google accounts; serves Gemini and other models available to Antigravity. |
| Kimi (kimi.com / kimi.ai) | Device code | Kimi Code accounts on the China or international site. |
| xAI | Browser | Grok accounts. |
| Devin | Browser | Devin accounts. |
| Muse (Meta) | Device code | Meta accounts. |
| Vertex AI | File import | Import a Google Cloud service-account JSON file. |

If a sign-in page cannot reach back to the proxy (for example when the proxy runs on
another machine), paste the final callback URL into the sign-in dialog.

## Sign in from the terminal

The same sign-ins are available from a terminal. Run one, and the account is saved to
`~/.cli-proxy-api/` where the running service picks it up automatically:

```bash
cli-proxy-api --claude-login
cli-proxy-api --codex-login          # or --codex-device-login
cli-proxy-api --antigravity-login
cli-proxy-api --kimi-login           # or --kimi-ai-login
cli-proxy-api --xai-login
cli-proxy-api --devin-login
cli-proxy-api --meta-login
```

Add `--no-browser` on a machine without a browser; the command prints the link instead.

## Managing credentials

**Credentials** lists every saved account. From there you can:

- turn an account off without deleting it,
- set a priority, weight, proxy, or model aliases for it,
- see recent requests and errors per account,
- delete it.

**Quota** shows remaining usage for providers that report it (Claude, Codex, Kimi, xAI,
Antigravity, Devin, Meta) and when it resets.
