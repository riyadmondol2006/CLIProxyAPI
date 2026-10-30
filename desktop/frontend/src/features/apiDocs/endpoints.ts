/**
 * Client API reference for the proxy, taken from the route registrations in
 * internal/api/server_routes.go and their handlers. Management routes are not listed.
 */

export type HttpMethod = 'GET' | 'POST' | 'HEAD';
export type EndpointAuth = 'none' | 'key' | 'realtime';

export interface EndpointExample {
  method: HttpMethod;
  /** Path with query string, appended to the selected base URL. */
  path: string;
  /** JSON body; `{{model}}` is replaced with the selected model. */
  body?: Record<string, unknown>;
  /** Extra headers besides auth and Content-Type. */
  headers?: Record<string, string>;
  /** Send the key as x-api-key / x-goog-api-key instead of a Bearer token. */
  keyHeader?: 'bearer' | 'x-api-key' | 'x-goog-api-key';
  /** Stream the response (adds curl -N). */
  stream?: boolean;
}

export interface Endpoint {
  id: string;
  methods: (HttpMethod | 'WS')[];
  path: string;
  /** More paths served by the same handler. */
  aliases?: string[];
  auth: EndpointAuth;
  format: string;
  streaming?: string;
  providers?: string;
  summary: string;
  notes?: string[];
  example?: EndpointExample;
}

export interface EndpointGroup {
  id: string;
  title: string;
  intro?: string;
  endpoints: Endpoint[];
}

export const ENDPOINT_GROUPS: EndpointGroup[] = [
  {
    id: 'discovery',
    title: 'Health and models',
    endpoints: [
      {
        id: 'healthz',
        methods: ['GET', 'HEAD'],
        path: '/healthz',
        auth: 'none',
        format: 'JSON',
        summary: 'Liveness check. Returns {"status":"ok"}.',
        example: { method: 'GET', path: '/healthz' },
      },
      {
        id: 'root',
        methods: ['GET'],
        path: '/',
        auth: 'none',
        format: 'JSON',
        summary: 'Server banner with a short list of endpoints.',
      },
      {
        id: 'models',
        methods: ['GET'],
        path: '/v1/models',
        auth: 'key',
        format: 'OpenAI or Anthropic model list',
        summary: 'Lists every model your connected accounts and provider keys offer.',
        notes: [
          'Returns the OpenAI shape ({"object":"list","data":[...]}) by default.',
          'Returns the Anthropic shape when the request has an anthropic-version header or a Claude CLI User-Agent. Non-Claude models are then shown under claude-… aliases, which /v1/messages maps back.',
          'Codex CLI (query client_version) and Grok Shell (User-Agent) get their own catalog formats.',
        ],
        example: { method: 'GET', path: '/v1/models' },
      },
      {
        id: 'model',
        methods: ['GET'],
        path: '/v1/models/{model}',
        auth: 'key',
        format: 'Same entry shape as /v1/models',
        summary: 'One model from the same catalog. The model ID may contain "/".',
      },
      {
        id: 'gemini-models',
        methods: ['GET'],
        path: '/v1beta/models',
        aliases: ['/v1beta/models/{model}'],
        auth: 'key',
        format: 'Gemini',
        summary: 'Model list and single model in Gemini format ({"models":[{"name":"models/…"}]}).',
      },
    ],
  },
  {
    id: 'openai',
    title: 'OpenAI-compatible',
    intro: 'Use the base URL with /v1 in OpenAI SDKs and apps.',
    endpoints: [
      {
        id: 'chat',
        methods: ['POST'],
        path: '/v1/chat/completions',
        auth: 'key',
        format: 'OpenAI Chat Completions',
        streaming: '"stream": true returns server-sent events ending with data: [DONE]',
        providers: 'Any account or provider that offers the model',
        summary: 'Chat completion.',
        notes: [
          'A body with "input" or "instructions" and no "messages" is treated as a Responses request.',
        ],
        example: {
          method: 'POST',
          path: '/v1/chat/completions',
          body: { model: '{{model}}', messages: [{ role: 'user', content: 'Hello' }] },
        },
      },
      {
        id: 'completions',
        methods: ['POST'],
        path: '/v1/completions',
        auth: 'key',
        format: 'OpenAI legacy Completions',
        streaming: '"stream": true (server-sent events)',
        summary:
          'Legacy text completion, run as a one-message chat. Only prompt, max_tokens, temperature, top_p, the penalties, and stop are used.',
      },
      {
        id: 'responses',
        methods: ['POST'],
        path: '/v1/responses',
        auth: 'key',
        format: 'OpenAI Responses',
        streaming: '"stream": true (server-sent events)',
        providers: 'Any account or provider that offers the model',
        summary: 'Responses API.',
        example: {
          method: 'POST',
          path: '/v1/responses',
          body: { model: '{{model}}', input: 'Hello' },
        },
      },
      {
        id: 'responses-ws',
        methods: ['WS'],
        path: '/v1/responses',
        auth: 'key',
        format: 'OpenAI Responses over WebSocket',
        streaming: 'Events arrive as WebSocket messages',
        summary:
          'Responses over a WebSocket (response.create / response.append). A GET without the WebSocket upgrade returns 400.',
      },
      {
        id: 'compact',
        methods: ['POST'],
        path: '/v1/responses/compact',
        auth: 'key',
        format: 'OpenAI Responses compact',
        streaming: 'Not supported',
        providers:
          'Codex, xAI, and OpenAI-compatible providers; emulated for Claude and Antigravity. Gemini, Vertex, Meta, and Kimi return 501.',
        summary: 'Conversation compaction.',
      },
    ],
  },
  {
    id: 'anthropic',
    title: 'Anthropic-compatible',
    intro: 'Use the base URL without /v1 in Anthropic SDKs and Claude Code.',
    endpoints: [
      {
        id: 'messages',
        methods: ['POST'],
        path: '/v1/messages',
        auth: 'key',
        format: 'Anthropic Messages',
        streaming: '"stream": true (server-sent events)',
        providers: 'Any account or provider that offers the model (translated as needed)',
        summary: 'Claude Messages API. Errors use the Anthropic error shape.',
        example: {
          method: 'POST',
          path: '/v1/messages',
          keyHeader: 'x-api-key',
          headers: { 'anthropic-version': '2023-06-01' },
          body: {
            model: '{{model}}',
            max_tokens: 1024,
            messages: [{ role: 'user', content: 'Hello' }],
          },
        },
      },
      {
        id: 'count-tokens',
        methods: ['POST'],
        path: '/v1/messages/count_tokens',
        auth: 'key',
        format: 'Anthropic count_tokens',
        summary: 'Counts the input tokens of a Messages request.',
        example: {
          method: 'POST',
          path: '/v1/messages/count_tokens',
          keyHeader: 'x-api-key',
          headers: { 'anthropic-version': '2023-06-01' },
          body: { model: '{{model}}', messages: [{ role: 'user', content: 'Hello' }] },
        },
      },
    ],
  },
  {
    id: 'gemini',
    title: 'Gemini-compatible',
    intro: 'Use the base URL without /v1 in Gemini SDKs and Gemini CLI.',
    endpoints: [
      {
        id: 'generate',
        methods: ['POST'],
        path: '/v1beta/models/{model}:generateContent',
        auth: 'key',
        format: 'Gemini generateContent',
        providers: 'Any account or provider that offers the model',
        summary: 'Gemini content generation. The key also works as x-goog-api-key or ?key=.',
        example: {
          method: 'POST',
          path: '/v1beta/models/{{model}}:generateContent',
          keyHeader: 'x-goog-api-key',
          body: { contents: [{ role: 'user', parts: [{ text: 'Hello' }] }] },
        },
      },
      {
        id: 'stream-generate',
        methods: ['POST'],
        path: '/v1beta/models/{model}:streamGenerateContent',
        auth: 'key',
        format: 'Gemini generateContent',
        streaming: 'Always streams; add ?alt=sse for server-sent events',
        summary: 'Streaming Gemini content generation.',
        example: {
          method: 'POST',
          path: '/v1beta/models/{{model}}:streamGenerateContent?alt=sse',
          keyHeader: 'x-goog-api-key',
          stream: true,
          body: { contents: [{ role: 'user', parts: [{ text: 'Hello' }] }] },
        },
      },
      {
        id: 'gemini-count',
        methods: ['POST'],
        path: '/v1beta/models/{model}:countTokens',
        auth: 'key',
        format: 'Gemini countTokens',
        summary: 'Counts tokens for a Gemini request.',
      },
      {
        id: 'interactions',
        methods: ['POST'],
        path: '/v1beta/interactions',
        auth: 'key',
        format: 'Gemini Interactions API',
        streaming: '"stream": true',
        summary:
          'Gemini Interactions. The body needs exactly one of "model" or "agent"; agent requests use Interactions API keys.',
      },
    ],
  },
  {
    id: 'media',
    title: 'Images, audio, and video',
    endpoints: [
      {
        id: 'images',
        methods: ['POST'],
        path: '/v1/images/generations',
        auth: 'key',
        format: 'OpenAI Images (JSON)',
        streaming: '"stream": true (server-sent events)',
        providers:
          'gpt-image-* through Codex accounts, grok-imagine-image* through xAI, or OpenAI-compatible image models',
        summary: 'Image generation. The default model is gpt-image-2.',
        notes: ['Turned off when multimedia.disable-image-generation is true (returns 404).'],
        example: {
          method: 'POST',
          path: '/v1/images/generations',
          body: { model: 'gpt-image-2', prompt: 'A lighthouse at dusk', size: '1024x1024' },
        },
      },
      {
        id: 'image-edits',
        methods: ['POST'],
        path: '/v1/images/edits',
        auth: 'key',
        format: 'OpenAI Images (multipart or JSON)',
        streaming: 'stream form field or "stream": true',
        summary: 'Image editing with the same models as generation.',
      },
      {
        id: 'speech',
        methods: ['POST'],
        path: '/v1/audio/speech',
        aliases: ['/v1/tts'],
        auth: 'key',
        format: 'OpenAI speech, mapped to xAI text-to-speech',
        providers: 'xAI only',
        summary:
          'Text to speech. tts-1, tts-1-hd, and gpt-4o-mini-tts map to grok-tts; OpenAI voice names map to xAI voices. response_format: mp3 (default), wav, or pcm.',
        notes: ['Text comes from "input" or "text", up to 60,000 characters.'],
      },
      {
        id: 'xai-videos',
        methods: ['POST'],
        path: '/v1/videos',
        aliases: ['/v1/videos/generations', '/v1/videos/edits', '/v1/videos/extensions'],
        auth: 'key',
        format: 'xAI video (asynchronous job)',
        providers: 'xAI (grok-imagine-video models)',
        summary: 'Starts xAI video generation, edit, or extension jobs.',
      },
      {
        id: 'xai-video-status',
        methods: ['GET'],
        path: '/v1/videos/{request_id}',
        auth: 'key',
        format: 'xAI video job status',
        summary: 'Polls an xAI video job.',
      },
      {
        id: 'openai-videos',
        methods: ['POST', 'GET'],
        path: '/openai/v1/videos',
        aliases: ['/openai/v1/videos/{video_id}', '/openai/v1/videos/{video_id}/content'],
        auth: 'key',
        format: 'OpenAI Videos (Sora-style)',
        providers: 'xAI; sora-2* names map to grok-imagine-video',
        summary:
          'Create a video, read its status, and download the file. Each video stays tied to the account that made it (3 hours by default).',
      },
    ],
  },
  {
    id: 'realtime',
    title: 'Realtime voice',
    intro:
      'Served only by Codex (ChatGPT) sign-ins. gpt-realtime* model names map to gpt-live-1-codex.',
    endpoints: [
      {
        id: 'realtime-ws',
        methods: ['WS'],
        path: '/v1/realtime?model={model}',
        auth: 'realtime',
        format: 'OpenAI Realtime over WebSocket',
        summary: 'Realtime session over a WebSocket. Without the upgrade it returns 426.',
      },
      {
        id: 'realtime-calls',
        methods: ['POST'],
        path: '/v1/realtime/calls',
        aliases: ['/v1/realtime', '/v1/live'],
        auth: 'realtime',
        format: 'WebRTC SDP offer and answer',
        summary:
          'Starts a WebRTC call. Send application/sdp, JSON {sdp, session}, or multipart; the answer comes back as application/sdp.',
        notes: ['/v1/live takes a client key only (no ek_ secrets).'],
      },
      {
        id: 'realtime-sideband',
        methods: ['WS'],
        path: '/v1/realtime/calls/{call_id}',
        aliases: ['/v1/live/{call_id}'],
        auth: 'realtime',
        format: 'WebSocket events channel',
        summary: 'Event channel for a WebRTC call.',
      },
      {
        id: 'realtime-hangup',
        methods: ['POST'],
        path: '/v1/realtime/calls/{call_id}/hangup',
        auth: 'key',
        format: 'JSON',
        summary: 'Ends a call started through this proxy.',
      },
      {
        id: 'client-secrets',
        methods: ['POST'],
        path: '/v1/realtime/client_secrets',
        aliases: ['/v1/realtime/sessions'],
        auth: 'key',
        format: 'JSON',
        summary:
          'Creates a short-lived ek_ secret for browsers and apps (10 minutes by default, 10 to 7200 seconds). /sessions is the legacy form.',
        notes: [
          'Transcription sessions, translations, and SIP accept/reject/refer return 501 (not supported).',
        ],
      },
    ],
  },
  {
    id: 'codex',
    title: 'Codex',
    intro:
      'Codex CLI can point its ChatGPT base URL at {base}/backend-api/codex; these paths behave like the /v1 ones.',
    endpoints: [
      {
        id: 'codex-responses',
        methods: ['POST', 'WS'],
        path: '/backend-api/codex/responses',
        aliases: ['/backend-api/codex/responses/compact'],
        auth: 'key',
        format: 'OpenAI Responses',
        summary: 'Same as /v1/responses and /v1/responses/compact.',
      },
      {
        id: 'alpha-search',
        methods: ['POST'],
        path: '/v1/alpha/search',
        aliases: ['/backend-api/codex/alpha/search'],
        auth: 'key',
        format: 'Codex search (passed through unchanged)',
        providers: 'Codex sign-ins, or Codex API keys with a base_url',
        summary: 'The standalone search endpoint current Codex clients use.',
      },
    ],
  },
  {
    id: 'other',
    title: 'Other',
    endpoints: [
      {
        id: 'aistudio-ws',
        methods: ['WS'],
        path: '/v1/ws',
        auth: 'key',
        format: 'AI Studio relay',
        summary:
          'A connected AI Studio client acts as a Gemini upstream. Needs a key unless oauth.providers.aistudio.ws-auth is false.',
      },
    ],
  },
];

export interface ErrorRow {
  status: string;
  when: string;
  body: string;
}

export const ERROR_ROWS: ErrorRow[] = [
  { status: '401', when: 'Missing key', body: '{"error":"Missing API key"}' },
  { status: '401', when: 'Wrong key', body: '{"error":"Invalid API key"}' },
  {
    status: '403',
    when: 'Key disabled under Access keys',
    body: '{"error":{"type":"permission_error","code":"api_key_disabled",…}}',
  },
  {
    status: '429',
    when: 'Key used up its token limit',
    body: '{"error":{"type":"insufficient_quota","code":"api_key_token_limit_exceeded","message":"… It resets at …"}}',
  },
  {
    status: '400',
    when: 'No account or provider offers the model',
    body: '{"error":{"code":"model_not_found","message":"unknown provider for model …"}}',
  },
  {
    status: '413',
    when: 'Body larger than server.max-request-body-bytes',
    body: '{"error":"http: request body too large"}',
  },
];

export const AUTH_HEADERS = [
  'Authorization: Bearer <key>',
  'x-api-key: <key>',
  'x-goog-api-key: <key>',
  '?key=<key>  (query string)',
];

export const ROUTING_NOTES = [
  'The "model" field (or the model in a Gemini path) picks the upstream: any connected account or provider key that offers that model can serve any compatible endpoint; requests are translated between formats.',
  'A provider with a prefix also offers prefix/model. With routing.force-model-prefix, unprefixed names reach only unprefixed providers.',
  'Add a thinking level with a suffix: model(low|medium|high|xhigh|max), model(none) to turn it off, model(auto), or a token budget like model(16384).',
  '"model": "auto" uses the first available model.',
];

export interface CurlInput {
  base: string;
  key: string;
  model: string;
}

const shellQuote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`;

const fillModel = (value: unknown, model: string): unknown => {
  if (typeof value === 'string') return value.replace(/\{\{model\}\}/g, model);
  if (Array.isArray(value)) return value.map((item) => fillModel(item, model));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, fillModel(v, model)])
    );
  }
  return value;
};

/** Builds a copy-pasteable curl command for an example. */
export const buildCurl = (example: EndpointExample, input: CurlInput): string => {
  const base = input.base.replace(/\/+$/, '');
  const path = example.path.replace(/\{\{model\}\}/g, input.model);
  const lines = [`curl${example.stream ? ' -N' : ''} ${shellQuote(`${base}${path}`)}`];
  if (example.method !== 'GET' || example.body) lines[0] += ` -X ${example.method}`;
  if (example.path !== '/healthz') {
    const keyHeader = example.keyHeader ?? 'bearer';
    lines.push(
      keyHeader === 'bearer'
        ? `-H ${shellQuote(`Authorization: Bearer ${input.key}`)}`
        : `-H ${shellQuote(`${keyHeader}: ${input.key}`)}`
    );
  }
  for (const [name, value] of Object.entries(example.headers ?? {})) {
    lines.push(`-H ${shellQuote(`${name}: ${value}`)}`);
  }
  if (example.body) {
    lines.push(`-H 'Content-Type: application/json'`);
    lines.push(`-d ${shellQuote(JSON.stringify(fillModel(example.body, input.model)))}`);
  }
  return lines.join(' \\\n  ');
};
