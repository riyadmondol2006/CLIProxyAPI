# Getting started

CLIProxyAPI turns the AI accounts and API keys you already have into one local API that
speaks the OpenAI, Anthropic (Claude), Gemini, and Codex formats. Any app that can talk to
one of those APIs can use your accounts through it.

## How the app works

- **The proxy runs in the background.** It is a systemd user service called
  `cliproxyapi`. It starts when you log in and keeps running when you close this window,
  so other apps and other devices can keep using it.
- **This window is the control panel.** It needs no password: it talks to the service with
  a token that only works from this computer and changes every time the service starts.
- **Your settings live in one file:** `~/.config/cliproxyapi/config.yaml`. Sign-in tokens
  for your accounts are stored in `~/.cli-proxy-api/`.

## First steps

1. **Connect an account.** Open **Sign in** and pick a provider (Claude, Codex, Gemini via
   Antigravity, Kimi, xAI, …), or add an API key under **Providers**.
2. **Check the models.** **Connect apps** lists the models your accounts give you.
3. **Point an app at the proxy.** Use base URL `http://127.0.0.1:8317/v1` and the client
   API key shown on **Home**. **Connect apps** has ready-to-paste setup for Claude Code,
   Codex CLI, Gemini CLI, Python, and cURL.
4. **Optional: share it.** Create a key per friend or device under **Access keys**, set a
   token limit, and allow LAN access.

## Words used in this app

| Term | Meaning |
| --- | --- |
| Client API key | A key *your apps* send to the proxy. You make these up; they are not provider keys. |
| Account / credential | A signed-in provider account (OAuth) stored as a file in `~/.cli-proxy-api/`. |
| Provider key | An upstream API key (for example an OpenAI-compatible endpoint) stored in the config. |
| Model alias / prefix | Optional names that route a model request to specific credentials. |
