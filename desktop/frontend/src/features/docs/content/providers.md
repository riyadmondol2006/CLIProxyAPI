# API-key providers

Besides signed-in accounts, the proxy can use API keys for upstream services. Add them under
**Providers**. Each provider type has its own list, and every entry can hold several keys
that the proxy rotates between.

| Type | Use it for |
| --- | --- |
| Gemini | Google AI Studio API keys. |
| Interactions API | Google Interactions API keys. |
| Codex | OpenAI API keys used through the Codex/Responses format. |
| Claude | Anthropic API keys or Anthropic-compatible endpoints. |
| Vertex | Vertex AI keys. |
| xAI | xAI API keys. |
| Muse (Meta) | Meta API keys. |
| Kimi | Kimi Open Platform keys. |
| OpenAI compatibility | Any OpenAI-compatible endpoint: OpenRouter, a company gateway, or a local server. |

## Local models (Ollama, LM Studio, llama.cpp)

Add an **OpenAI compatibility** provider:

- **Base URL:** your server's OpenAI endpoint, for example `http://127.0.0.1:11434/v1`
  for Ollama or `http://127.0.0.1:1234/v1` for LM Studio.
- **API key:** any text if the server does not check keys.
- **Models:** fetch them from the server, or list them by hand.

The same entry in `config.yaml`:

```yaml
api-keys:
  openai-compatibility:
    - name: "ollama"
      base-url: "http://127.0.0.1:11434/v1"
      keys:
        - api-key: "none"
      models:
        - name: "llama3.1"
```

## Routing options

- **Prefix:** require requests like `myprefix/model-name` to use only this provider.
- **Model aliases:** expose an upstream model under a different name.
- **Excluded models:** hide models you do not want offered.
- **Priority and weight:** prefer some keys over others.

**Settings → Routing** chooses how the proxy picks between matching credentials
(round-robin, weighted round-robin, or fill-first) and how often it retries.
