import { providerLabel } from '@/features/dashboard/utils';
import { maskApiKey } from '@/features/setup/snippets';
import type { TokenUsage, TokenUsageRow } from '@/services/api/tokenUsage';

export const USAGE_PERIODS = ['today', '7d', '30d', '90d'] as const;
export type UsagePeriod = (typeof USAGE_PERIODS)[number];
export const DEFAULT_PERIOD: UsagePeriod = '30d';

export const PERIOD_DAYS: Record<UsagePeriod, number> = { today: 1, '7d': 7, '30d': 30, '90d': 90 };

export const GROUP_BYS = ['provider', 'account', 'model', 'key'] as const;
export type GroupBy = (typeof GROUP_BYS)[number];
export const DEFAULT_GROUP_BY: GroupBy = 'provider';

/** Groups drawn as their own chart series; the rest are summed as "Other". */
export const TOP_GROUPS = 5;
/** Series id of the "Other" bucket; can't collide with group ids, which carry a prefix. */
export const OTHER_SERIES = 'other';

/** Localized labels for groups the backend can't name. */
export interface GroupLabels {
  unknownProvider: string;
  unknownModel: string;
  unknownAccount: string;
  removedKeys: string;
  otherClients: string;
  other: string;
}

export interface UsageTotals {
  tokens: number;
  input: number;
  output: number;
  requests: number;
  failed: number;
}

/** Chart color slot: the index of a top group, or the shared "Other" tone. */
export type GroupTone = number | typeof OTHER_SERIES;

export interface UsageGroup {
  id: string;
  label: string;
  /** Secondary text, e.g. the masked key under a key's name. */
  detail?: string;
  /** A stand-in label (unknown account, deleted keys, other clients), shown muted. */
  placeholder: boolean;
  /** Providers seen in the group, in first-seen order. */
  providers: string[];
  totals: UsageTotals;
  /** Fraction of all tokens in the period, 0..1. */
  share: number;
  /** Tokens per date. */
  daily: number[];
  tone: GroupTone;
}

export interface ChartSeries {
  key: string;
  label: string;
  tone: GroupTone;
  values: number[];
}

export interface UsageView {
  dates: string[];
  totals: UsageTotals;
  groups: UsageGroup[];
  /** Top groups plus "Other", bottom of the stack first. */
  series: ChartSeries[];
  dailyRequests: number[];
}

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

const emptyTotals = (): UsageTotals => ({ tokens: 0, input: 0, output: 0, requests: 0, failed: 0 });

export const rowTotals = (row: TokenUsageRow): UsageTotals => ({
  tokens: sum(row.tokens),
  input: sum(row.inputTokens),
  output: sum(row.outputTokens),
  requests: sum(row.requests),
  failed: sum(row.failed),
});

const addTotals = (into: UsageTotals, add: UsageTotals) => {
  into.tokens += add.tokens;
  into.input += add.input;
  into.output += add.output;
  into.requests += add.requests;
  into.failed += add.failed;
};

export const sumTotals = (rows: TokenUsageRow[]): UsageTotals => {
  const totals = emptyTotals();
  rows.forEach((row) => addTotals(totals, rowTotals(row)));
  return totals;
};

/** Fraction of a total; never NaN. */
export const shareOf = (value: number, total: number): number =>
  total > 0 ? Math.max(0, Math.min(1, value / total)) : 0;

/** Keeps the last `days` dates (today is last) and slices every series to match. */
export const sliceDays = (usage: TokenUsage, days: number): TokenUsage => {
  const count = Math.max(0, Math.min(usage.dates.length, Math.floor(days)));
  const start = usage.dates.length - count;
  const cut = (values: number[]) => values.slice(start, start + count);
  return {
    dates: usage.dates.slice(start),
    rows: usage.rows.map((row) => ({
      ...row,
      tokens: cut(row.tokens),
      inputTokens: cut(row.inputTokens),
      outputTokens: cut(row.outputTokens),
      requests: cut(row.requests),
      failed: cut(row.failed),
    })),
  };
};

export const slicePeriod = (usage: TokenUsage, period: UsagePeriod): TokenUsage =>
  sliceDays(usage, PERIOD_DAYS[period]);

/** Whether any row has tokens or requests. */
export const hasUsage = (usage: TokenUsage): boolean =>
  usage.rows.some((row) => row.tokens.some(Boolean) || row.requests.some(Boolean));

interface GroupIdentity {
  id: string;
  label: string;
  detail?: string;
  placeholder?: boolean;
}

/** Which group a row belongs to for a dimension, and how that group is labeled. */
export function groupIdentity(row: TokenUsageRow, by: GroupBy, labels: GroupLabels): GroupIdentity {
  switch (by) {
    case 'provider':
      return {
        id: `provider:${row.provider}`,
        label: providerLabel(row.provider, labels.unknownProvider),
        placeholder: row.provider === 'unknown',
      };
    case 'account': {
      const identity = row.authIndex || row.authId || row.account;
      const label = row.account || row.authId;
      return {
        // Credentials the backend can't name stay apart per provider.
        id: identity ? `account:${identity}` : `account-unknown:${row.provider}`,
        label: label || labels.unknownAccount,
        placeholder: !label,
      };
    }
    case 'model':
      return {
        id: `model:${row.model}`,
        label: row.model === 'unknown' ? labels.unknownModel : row.model,
        placeholder: row.model === 'unknown',
      };
    case 'key':
      if (row.clientKind === 'removed') {
        return { id: 'client:removed', label: labels.removedKeys, placeholder: true };
      }
      if (row.clientKind === 'other') {
        return { id: 'client:other', label: labels.otherClients, placeholder: true };
      }
      return {
        id: row.clientKey ? `key:${row.clientKey}` : `key-name:${row.clientName}`,
        label: row.clientName || maskApiKey(row.clientKey),
        detail: row.clientName && row.clientKey ? maskApiKey(row.clientKey) : undefined,
      };
  }
}

/**
 * Groups rows by a dimension, drops groups with no activity, and sorts by tokens (then
 * requests, then label). The first TOP_GROUPS get their own tone; the rest share "Other".
 */
export function groupRows(
  usage: TokenUsage,
  by: GroupBy,
  labels: GroupLabels,
  total: number = sumTotals(usage.rows).tokens
): UsageGroup[] {
  const groups = new Map<string, UsageGroup>();
  usage.rows.forEach((row) => {
    const identity = groupIdentity(row, by, labels);
    let group = groups.get(identity.id);
    if (!group) {
      group = {
        id: identity.id,
        label: identity.label,
        detail: identity.detail,
        placeholder: Boolean(identity.placeholder),
        providers: [],
        totals: emptyTotals(),
        share: 0,
        daily: usage.dates.map(() => 0),
        tone: OTHER_SERIES,
      };
      groups.set(identity.id, group);
    } else if (group.placeholder && !identity.placeholder) {
      // A later row may know the account's name.
      group.label = identity.label;
      group.placeholder = false;
    }
    if (!group.providers.includes(row.provider)) group.providers.push(row.provider);
    addTotals(group.totals, rowTotals(row));
    row.tokens.forEach((value, index) => {
      group.daily[index] += value;
    });
  });

  return [...groups.values()]
    .filter((group) => group.totals.tokens > 0 || group.totals.requests > 0)
    .sort(
      (a, b) =>
        b.totals.tokens - a.totals.tokens ||
        b.totals.requests - a.totals.requests ||
        a.label.localeCompare(b.label)
    )
    .map((group, index) => ({
      ...group,
      share: shareOf(group.totals.tokens, total),
      tone: index < TOP_GROUPS ? index : OTHER_SERIES,
    }));
}

/** One chart series per top group, plus "Other" for the rest; series without tokens are left out. */
export function buildSeries(
  groups: UsageGroup[],
  dates: string[],
  otherLabel: string
): ChartSeries[] {
  const series: ChartSeries[] = groups
    .filter((group) => group.tone !== OTHER_SERIES)
    .map((group) => ({
      key: group.id,
      label: group.label,
      tone: group.tone,
      values: group.daily,
    }));
  const rest = groups.filter((group) => group.tone === OTHER_SERIES);
  if (rest.length > 0) {
    series.push({
      key: OTHER_SERIES,
      label: otherLabel,
      tone: OTHER_SERIES,
      values: dates.map((_, index) => sum(rest.map((group) => group.daily[index] ?? 0))),
    });
  }
  return series.filter((item) => item.values.some(Boolean));
}

/** Everything the page shows for a period and grouping. */
export function buildUsageView(
  usage: TokenUsage,
  period: UsagePeriod,
  by: GroupBy,
  labels: GroupLabels
): UsageView {
  const sliced = slicePeriod(usage, period);
  const totals = sumTotals(sliced.rows);
  const groups = groupRows(sliced, by, labels, totals.tokens);
  return {
    dates: sliced.dates,
    totals,
    groups,
    series: buildSeries(groups, sliced.dates, labels.other),
    dailyRequests: sliced.dates.map((_, index) =>
      sum(sliced.rows.map((row) => row.requests[index] ?? 0))
    ),
  };
}

/** Distinct providers, accounts, and models with activity in a period, for the page meta. */
export function countDimensions(usage: TokenUsage, labels: GroupLabels) {
  const count = (by: GroupBy) => groupRows(usage, by, labels).length;
  return { providers: count('provider'), accounts: count('account'), models: count('model') };
}
