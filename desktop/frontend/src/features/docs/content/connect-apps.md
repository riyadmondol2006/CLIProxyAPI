# Connecting apps

Every app needs two things: a **base URL** and a **client API key**. **Connect apps**
shows both with copy buttons and fills them into the examples below.

| API style | Base URL | Example endpoints |
| --- | --- | --- |
| OpenAI-compatible | `http://127.0.0.1:8317/v1` | `/chat/completions`, `/responses`, `/models` |
| Anthropic (Claude) | `http://127.0.0.1:8317` | `/v1/messages`, `/v1/messages/count_tokens` |
| Gemini | `http://127.0.0.1:8317` | `/v1beta/models/<model>:generateContent` |

The key can be sent as `Authorization: Bearer <key>`, `x-api-key: <key>`, or
`x-goog-api-key: <key>`, so each SDK's default header works.

## Claude Code

```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:8317"
export ANTHROPIC_AUTH_TOKEN="<client key>"
claude
```

## Codex CLI

Add to `~/.codex/config.toml`, then `export CLIPROXYAPI_KEY="<client key>"`:

```toml
model_provider = "cliproxyapi"
model = "<model id>"

[model_providers.cliproxyapi]
name = "CLIProxyAPI"
base_url = "http://127.0.0.1:8317/v1"
wire_api = "responses"
env_key = "CLIPROXYAPI_KEY"
```

## Gemini CLI

```bash
export GOOGLE_GEMINI_BASE_URL="http://127.0.0.1:8317"
export GEMINI_API_KEY="<client key>"
gemini -m <model id>
```

## Python (OpenAI SDK)

```python
from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:8317/v1", api_key="<client key>")
reply = client.chat.completions.create(
    model="<model id>",
    messages=[{"role": "user", "content": "Hello"}],
)
print(reply.choices[0].message.content)
```

## Other apps

Cursor, Open WebUI, Cherry Studio, Continue, and similar apps: choose an
**OpenAI-compatible** (or "custom OpenAI") provider and fill in the base URL, key, and a
model ID from the list on **Connect apps**.

## Model names

Use the IDs listed on **Connect apps** (they come from `GET /v1/models`). You can add a
thinking level to many models with a suffix, for example `model-name(high)`.
