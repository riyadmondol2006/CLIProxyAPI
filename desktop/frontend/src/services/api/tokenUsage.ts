/**
 * Daily token usage per provider, credential, model, and client key.
 * Backend contract: `GET /v8/management/usage/tokens?days=N`.
 */
import { apiClient } from './client';
import { isRecord } from '@/utils/helpers';

/** Days the API usage page loads; shorter periods are sliced from this on the client. */
export const TOKEN_USAGE_DAYS = 90;

export const TOKEN_CLIENT_KINDS = ['key', 'removed', 'other'] as const;
/** `key`: a configured access key; `removed`: a deleted one; `other`: e.g. plugin auth. */
export type TokenClientKind = (typeof TOKEN_CLIENT_KINDS)[number];

/** One provider/credential/model/client combination; every series has one entry per date. */
export interface TokenUsageRow {
  provider: string;
  authId: string;
  authIndex: string;
  account: string;
  model: string;
  clientKind: TokenClientKind;
  clientKey: string;
  clientName: string;
  tokens: number[];
  inputTokens: number[];
  outputTokens: number[];
  /** Every upstream attempt, retries included. */
  requests: number[];
  /** Failed attempts among `requests`. */
  failed: number[];
}

export interface TokenUsage {
  /** Server-local days (YYYY-MM-DD), oldest first; today is the last one. */
  dates: string[];
  rows: TokenUsageRow[];
}

const toCount = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const toText = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** Reads a series, padding or truncating it to `length` so it always lines up with the dates. */
const toSeries = (value: unknown, length: number): number[] => {
  const list = Array.isArray(value) ? value : [];
  return Array.from({ length }, (_, index) => toCount(list[index]));
};

const toClientKind = (value: unknown): TokenClientKind => {
  const kind = toText(value).toLowerCase();
  return (TOKEN_CLIENT_KINDS as readonly string[]).includes(kind)
    ? (kind as TokenClientKind)
    : 'other';
};

/**
 * Normalizes the response. Rows that aren't objects or lack a provider or model (the backend
 * always sends `unknown` rather than nothing) are dropped; a key row without a key or name
 * can't be told apart from other clients, so it counts as `other`.
 */
export const normalizeTokenUsage = (input: unknown): TokenUsage => {
  const record = isRecord(input) ? input : {};
  const dates = Array.isArray(record.dates) ? record.dates.map((date) => String(date)) : [];
  const list = Array.isArray(record.rows) ? record.rows : [];
  const rows: TokenUsageRow[] = [];
  list.forEach((item) => {
    if (!isRecord(item)) return;
    const provider = toText(item.provider);
    const model = toText(item.model);
    if (!provider || !model) return;
    const clientKey = toText(item['client-key']);
    const clientName = toText(item['client-name']);
    let clientKind = toClientKind(item['client-kind']);
    if (clientKind === 'key' && !clientKey && !clientName) clientKind = 'other';
    rows.push({
      provider,
      authId: toText(item['auth-id']),
      authIndex: toText(item['auth-index']),
      account: toText(item.account),
      model,
      clientKind,
      clientKey,
      clientName,
      tokens: toSeries(item.tokens, dates.length),
      inputTokens: toSeries(item['input-tokens'], dates.length),
      outputTokens: toSeries(item['output-tokens'], dates.length),
      requests: toSeries(item.requests, dates.length),
      failed: toSeries(item.failed, dates.length),
    });
  });
  return { dates, rows };
};

export const tokenUsageApi = {
  async daily(days: number = TOKEN_USAGE_DAYS): Promise<TokenUsage> {
    return normalizeTokenUsage(await apiClient.get('/usage/tokens', { params: { days } }));
  },
};
