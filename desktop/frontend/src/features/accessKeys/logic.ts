import type { KeyLimit, KeyLimitPeriod, KeyUsage } from '@/services/api/accessKeys';

export interface AccessKeyRow {
  apiKey: string;
  name?: string;
  tokenLimit?: number;
  period: KeyLimitPeriod;
  disabled: boolean;
  tokensUsed: number;
  requests: number;
  periodEnd?: string;
  lastUsed?: string;
  exceeded: boolean;
}

export interface KeyLimitDraft {
  name: string;
  tokenLimit: string;
  period: KeyLimitPeriod;
}

/** Generates a client key with 160 bits of randomness. */
export const generateApiKey = (
  fill: (bytes: Uint8Array<ArrayBuffer>) => void = (bytes) => {
    crypto.getRandomValues(bytes);
  }
): string => {
  const bytes = new Uint8Array(20);
  fill(bytes);
  return `sk-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
};

/** Parses a token-limit field; empty, zero, or invalid input means unlimited. */
export const parseTokenLimit = (value: string): number | undefined => {
  const digits = value.replace(/[\s,_]/g, '');
  if (!/^\d+$/.test(digits)) return undefined;
  const parsed = Number(digits);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const isEmptyLimit = (limit: KeyLimit): boolean =>
  !limit.name && !limit.tokenLimit && !limit.disabled;

/** Replaces the entry for limit.apiKey; entries with nothing set are dropped to keep config tidy. */
export const upsertLimit = (limits: KeyLimit[], limit: KeyLimit): KeyLimit[] => {
  const next: KeyLimit = {
    apiKey: limit.apiKey,
    name: limit.name?.trim() || undefined,
    tokenLimit: limit.tokenLimit && limit.tokenLimit > 0 ? limit.tokenLimit : undefined,
    period: limit.tokenLimit ? limit.period : undefined,
    disabled: limit.disabled || undefined,
  };
  const others = limits.filter((item) => item.apiKey !== limit.apiKey);
  if (isEmptyLimit(next)) return others;
  const index = limits.findIndex((item) => item.apiKey === limit.apiKey);
  if (index < 0) return [...others, next];
  const out = [...limits];
  out[index] = next;
  return out;
};

export const removeLimit = (limits: KeyLimit[], apiKey: string): KeyLimit[] =>
  limits.filter((item) => item.apiKey !== apiKey);

/** Joins configured keys, their limits, and live usage, in api-keys order. */
export const buildRows = (
  keys: string[],
  limits: KeyLimit[],
  usage: KeyUsage[]
): AccessKeyRow[] => {
  const limitByKey = new Map(limits.map((limit) => [limit.apiKey, limit]));
  const usageByKey = new Map(usage.map((item) => [item.apiKey, item]));
  return keys.map((apiKey) => {
    const limit = limitByKey.get(apiKey);
    const used = usageByKey.get(apiKey);
    const period = limit?.period ?? used?.period ?? 'monthly';
    const tokensUsed = used && used.period === period ? used.tokensUsed : 0;
    const tokenLimit = limit?.tokenLimit;
    return {
      apiKey,
      name: limit?.name,
      tokenLimit,
      period,
      disabled: Boolean(limit?.disabled),
      tokensUsed,
      requests: used && used.period === period ? used.requests : 0,
      periodEnd: used?.periodEnd,
      lastUsed: used?.lastUsed,
      exceeded: Boolean(tokenLimit && tokensUsed >= tokenLimit),
    };
  });
};

export const usagePercent = (used: number, limit?: number): number | null => {
  if (!limit || limit <= 0) return null;
  return Math.min(100, Math.max(0, (used / limit) * 100));
};

export const draftFromRow = (row?: AccessKeyRow): KeyLimitDraft => ({
  name: row?.name ?? '',
  tokenLimit: row?.tokenLimit ? String(row.tokenLimit) : '',
  period: row?.period ?? 'daily',
});
