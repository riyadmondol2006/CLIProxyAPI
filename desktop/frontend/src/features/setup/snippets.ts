/**
 * Pure builders for the Setup Guide: endpoint URLs, client snippets, and CLI login commands.
 * Kept free of React so they can be unit tested.
 */

export const SETUP_CLIENT_IDS = [
  'curl',
  'python',
  'claudeCode',
  'codex',
  'geminiCli',
  'other',
] as const;

export type SetupClientId = (typeof SETUP_CLIENT_IDS)[number];

export const API_KEY_PLACEHOLDER = 'YOUR_API_KEY';
export const MODEL_PLACEHOLDER = 'MODEL_ID';

export interface SetupEndpoints {
  openai: string;
  anthropic: string;
  gemini: string;
}

export interface SnippetInput {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface Snippet {
  /** Short label shown above the code block, e.g. a file name or "shell". */
  context: string;
  code: string;
}

const trimBase = (baseUrl: string): string => baseUrl.trim().replace(/\/+$/, '');

export const buildEndpoints = (baseUrl: string): SetupEndpoints => {
  const base = trimBase(baseUrl);
  return {
    openai: `${base}/v1`,
    anthropic: base,
    gemini: base,
  };
};

export const maskApiKey = (key: string): string => {
  const value = key.trim();
  if (value.length <= 10) return '•'.repeat(Math.max(value.length, 4));
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
};

export const buildSnippet = (client: SetupClientId, input: SnippetInput): Snippet => {
  const base = trimBase(input.baseUrl);
  const { openai } = buildEndpoints(base);
  const key = input.apiKey.trim() || API_KEY_PLACEHOLDER;
  const model = input.model.trim() || MODEL_PLACEHOLDER;

  switch (client) {
    case 'curl':
      return {
        context: 'shell',
        code: [
          `curl ${openai}/chat/completions \\`,
          `  -H "Authorization: Bearer ${key}" \\`,
          `  -H "Content-Type: application/json" \\`,
          `  -d '{"model": "${model}", "messages": [{"role": "user", "content": "Hello"}]}'`,
        ].join('\n'),
      };
    case 'python':
      return {
        context: 'python · pip install openai',
        code: [
          'from openai import OpenAI',
          '',
          `client = OpenAI(base_url="${openai}", api_key="${key}")`,
          'reply = client.chat.completions.create(',
          `    model="${model}",`,
          '    messages=[{"role": "user", "content": "Hello"}],',
          ')',
          'print(reply.choices[0].message.content)',
        ].join('\n'),
      };
    case 'claudeCode':
      return {
        context: 'shell',
        code: [
          `export ANTHROPIC_BASE_URL="${base}"`,
          `export ANTHROPIC_AUTH_TOKEN="${key}"`,
          `export ANTHROPIC_MODEL="${model}"  # optional`,
          'claude',
        ].join('\n'),
      };
    case 'codex':
      return {
        context: '~/.codex/config.toml',
        code: [
          'model_provider = "cliproxyapi"',
          `model = "${model}"`,
          '',
          '[model_providers.cliproxyapi]',
          'name = "CLIProxyAPI"',
          `base_url = "${openai}"`,
          'wire_api = "responses"',
          'env_key = "CLIPROXYAPI_KEY"',
          '',
          '# Then, in your shell:',
          `# export CLIPROXYAPI_KEY="${key}"`,
        ].join('\n'),
      };
    case 'geminiCli':
      return {
        context: 'shell',
        code: [
          `export GOOGLE_GEMINI_BASE_URL="${base}"`,
          `export GEMINI_API_KEY="${key}"`,
          `gemini -m ${model}`,
        ].join('\n'),
      };
    case 'other':
    default:
      return {
        context: 'OpenAI-compatible app (Cursor, Open WebUI, Cherry Studio, …)',
        code: [
          'Provider type: OpenAI-compatible',
          `Base URL:      ${openai}`,
          `API key:       ${key}`,
          `Model:         ${model}`,
        ].join('\n'),
      };
  }
};

export interface LoginCommand {
  label: string;
  flag: string;
}

/** Mirrors the login flags defined in CLIProxyAPI `cmd/server/main.go`. */
export const LOGIN_COMMANDS: readonly LoginCommand[] = [
  { label: 'Claude', flag: '--claude-login' },
  { label: 'Codex / ChatGPT', flag: '--codex-login' },
  { label: 'Codex (device code)', flag: '--codex-device-login' },
  { label: 'Antigravity', flag: '--antigravity-login' },
  { label: 'Kimi (kimi.com)', flag: '--kimi-login' },
  { label: 'Kimi (kimi.ai)', flag: '--kimi-ai-login' },
  { label: 'xAI', flag: '--xai-login' },
  { label: 'Devin', flag: '--devin-login' },
  { label: 'Meta', flag: '--meta-login' },
];

export const buildLoginCommand = (flag: string): string => `./cli-proxy-api ${flag}`;
