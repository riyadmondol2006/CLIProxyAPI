/**
 * Client key limits (access.key-limits), per-key usage, and LAN listen info.
 * Backend contract: CLIProxyAPI `internal/keylimit` and `/v8/management/access/*`.
 */
import { apiClient } from './client';
import { getConfigValue } from './configValue';
import { isRecord } from '@/utils/helpers';

const LIMITS_PATH = '/config/access/key-limits';
const HOST_PATH = '/config/server/host';

export const KEY_LIMIT_PERIODS = ['daily', 'weekly', 'monthly', 'total'] as const;
export type KeyLimitPeriod = (typeof KEY_LIMIT_PERIODS)[number];

export interface KeyLimit {
  apiKey: string;
  name?: string;
  tokenLimit?: number;
  period?: KeyLimitPeriod;
  disabled?: boolean;
}

export interface KeyUsage {
  apiKey: string;
  period: KeyLimitPeriod;
  tokensUsed: number;
  requests: number;
  periodEnd?: string;
  lastUsed?: string;
}

export interface ServerNetwork {
  host: string;
  port: number;
  scheme: string;
  lanEnabled: boolean;
  lanUrls: string[];
  /** Host from the config; differs from `host` until the service restarts. */
  configuredHost: string;
  restartRequired: boolean;
}

const toNumber = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const toPeriod = (value: unknown): KeyLimitPeriod => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase();
  return (KEY_LIMIT_PERIODS as readonly string[]).includes(normalized)
    ? (normalized as KeyLimitPeriod)
    : 'monthly';
};

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

export const normalizeKeyLimits = (input: unknown): KeyLimit[] => {
  if (!Array.isArray(input)) return [];
  const out: KeyLimit[] = [];
  input.forEach((item) => {
    if (!isRecord(item)) return;
    const apiKey = String(item['api-key'] ?? '').trim();
    if (!apiKey) return;
    const tokenLimit = toNumber(item['token-limit']);
    out.push({
      apiKey,
      name: optionalString(item.name),
      tokenLimit: tokenLimit > 0 ? tokenLimit : undefined,
      period: item.period === undefined ? undefined : toPeriod(item.period),
      disabled: item.disabled === true ? true : undefined,
    });
  });
  return out;
};

export const serializeKeyLimits = (limits: KeyLimit[]): Record<string, unknown>[] =>
  limits.map((limit) => {
    const out: Record<string, unknown> = { 'api-key': limit.apiKey };
    if (limit.name) out.name = limit.name;
    if (limit.tokenLimit && limit.tokenLimit > 0) out['token-limit'] = limit.tokenLimit;
    if (limit.period) out.period = limit.period;
    if (limit.disabled) out.disabled = true;
    return out;
  });

export const normalizeKeyUsage = (input: unknown): KeyUsage[] => {
  const list = isRecord(input) && Array.isArray(input.keys) ? input.keys : [];
  const out: KeyUsage[] = [];
  list.forEach((item) => {
    if (!isRecord(item)) return;
    const apiKey = String(item['api-key'] ?? '').trim();
    if (!apiKey) return;
    out.push({
      apiKey,
      period: toPeriod(item.period),
      tokensUsed: toNumber(item['tokens-used']),
      requests: toNumber(item.requests),
      periodEnd: optionalString(item['period-end']),
      lastUsed: optionalString(item['last-used']),
    });
  });
  return out;
};

export const normalizeServerNetwork = (input: unknown): ServerNetwork => {
  const record = isRecord(input) ? input : {};
  return {
    host: String(record.host ?? ''),
    port: toNumber(record.port),
    scheme: String(record.scheme ?? 'http'),
    lanEnabled: record['lan-enabled'] === true,
    lanUrls: Array.isArray(record['lan-urls'])
      ? record['lan-urls'].map((url) => String(url)).filter(Boolean)
      : [],
    configuredHost: String(record['configured-host'] ?? record.host ?? ''),
    restartRequired: record['restart-required'] === true,
  };
};

export const accessKeysApi = {
  async listLimits(): Promise<KeyLimit[]> {
    return normalizeKeyLimits(await getConfigValue<unknown>(LIMITS_PATH, []));
  },

  replaceLimits: (limits: KeyLimit[]) => apiClient.put(LIMITS_PATH, serializeKeyLimits(limits)),

  async listUsage(): Promise<KeyUsage[]> {
    return normalizeKeyUsage(await apiClient.get('/access/key-usage'));
  },

  resetUsage: (apiKey: string) => apiClient.post('/access/key-usage/reset', { 'api-key': apiKey }),

  async network(): Promise<ServerNetwork> {
    return normalizeServerNetwork(await apiClient.get('/server/network'));
  },

  setHost: (host: string) => apiClient.put(HOST_PATH, host),
};
